// Portable backups use the vault's Argon2id + AES-GCM primitives with their own format/AAD.
// Accounts, contacts and unsettled transfers share ONE authenticated ciphertext: removing the journal invalidates it.
const BACKUP_FORMAT = 'qoree-encrypted-backup';
const BACKUP_MAX_BYTES = 1024 * 1024;
const backupError = () => new AppError('BACKUP', trLater('The backup could not be opened. Check the password and use an intact qoree backup file.'));
const backupAuth = (auth) => { if (!auth()) throw new AppError('CANCELLED', trLater('Cancelled. Nothing was changed.')); };
const Backup = {
  parse(text) {
    if (typeof text !== 'string' || text.length > BACKUP_MAX_BYTES) throw backupError();
    try {
      const record = JSON.parse(text);
      if (record.pending != null) throw backupError();
      return Vault.parseHeader(record, BACKUP_FORMAT);
    } catch { throw backupError(); }
  },
  validate(payload) {
    try {
      const restored = restoreAccounts(payload);
      if (!restored.accounts.length || new Set(restored.accounts.map((a) => a.id)).size !== restored.accounts.length
        || !Array.isArray(payload.contacts) || payload.contacts.length > MAX_CONTACTS
        || restored.contacts.length !== payload.contacts.length
        || new Set(restored.contacts.map((c) => c.id)).size !== restored.contacts.length
        || !Array.isArray(payload.pending) || payload.pending.length > JOURNAL_MAX) throw backupError();
      const hashes = new Set();
      for (const e of payload.pending) {
        if (!e || typeof e.encoded !== 'string' || e.encoded.length > 1024) throw backupError();
        const bytes = fromB64(e.encoded);
        const d = Q.decodeTransaction(bytes);
        if (Q.computeTransactionHash(bytes) !== e.hash || !Q.verifyTransactionSignature(bytes)
          || hashes.has(e.hash) || BigInt(d.amount) <= 0n || BigInt(d.amount) > MAX_AMOUNT
          || d.inputType !== 0 || d.payload.length) throw backupError();
        hashes.add(e.hash);
      }
      return restored;
    } catch { throw backupError(); }
  },
  async open(text, password, auth) {
    backupAuth(auth);
    const header = Backup.parse(text);
    const raw = await Vault.deriveRaw(password, header.kdf);
    try {
      backupAuth(auth);
      const key = await Vault.keyFrom(raw);
      let payload;
      try { payload = await Vault.decrypt(key, Vault.aad(header), { iv: header.cipher.iv, data: header.data }); }
      catch { throw backupError(); }
      backupAuth(auth);
      Backup.validate(payload);
      return payload;
    } finally { wipe(raw); }
  },
  // Detached encryption: creating a backup never enables storage or changes the device password.
  async encode(payload, password, auth) {
    backupAuth(auth);
    if (typeof password !== 'string' || password.length < MIN_PASSWORD || passwordScore(password) < 2) throw new AppError('WEAK_PASSWORD');
    Backup.validate(payload);
    const header = { format: BACKUP_FORMAT, version: 1, kdf: { ...VAULT_KDF, salt: toB64(randomBytes(16)) }, cipher: { name: 'AES-256-GCM', iv: '' }, data: '' };
    const raw = await Vault.deriveRaw(password, header.kdf);
    try {
      backupAuth(auth);
      const key = await Vault.keyFrom(raw);
      const sealed = await Vault.encrypt(key, Vault.aad(header), payload);
      header.cipher.iv = sealed.iv; header.data = sealed.data;
      const text = JSON.stringify(header);
      // Check the exact serialized file, including every account and contact, before offering it for download.
      const parsed = Backup.parse(text);
      const checked = await Vault.decrypt(key, Vault.aad(parsed), { iv: parsed.cipher.iv, data: parsed.data });
      Backup.validate(checked);
      if (JSON.stringify(checked) !== JSON.stringify(payload)) throw backupError();
      backupAuth(auth);
      return text;
    } finally { wipe(raw); }
  },
  create(password, auth) {
    return editWallet(async () => {
      backupAuth(auth);
      if (state.phase !== 'ready' || state.journalProblem) throw new AppError('JOURNAL');
      let payload;
      if (state.mode === 'vault') {
        // Password confirmation is required even when this tab already holds the vault key.
        const opened = await Vault.open(password, { resume: false, auth });
        payload = await vaultUpdate(async (stored) => {
          backupAuth(auth);
          if (!sameAccounts(stored, opened.header) || !sameAccounts(stored, state.vault?.header)) throw new AppError('STALE');
          const saved = stored.pending ? await Journal.read(opened.key, stored) : [];
          backupAuth(auth);
          return { ...vaultPayload(), pending: Journal.merge(saved, journalEntries(), settledHashes()) };
        });
      } else payload = { ...vaultPayload(), pending: journalEntries() };
      return Backup.encode(payload, password, auth);
    });
  },
  async restore(payload, password, auth) {
    backupAuth(auth);
    if (state.phase !== 'welcome' || state.accounts.length || Vault.exists()) throw new AppError('EXISTS');
    if (!canSign()) throw new AppError('NO_SECURE_CONTEXT');
    Backup.validate(payload);
    const { pending, ...accounts } = payload;
    let made;
    try {
      // A fresh salt/key and an atomic no-overwrite check also protect against another tab creating a wallet here.
      made = await Vault.create(password, accounts, { auth, expect: null, carry: async () => pending });
      backupAuth(auth);
      await adoptVault({ ...made, payload: accounts, pending }, auth);
      backupAuth(auth);
    } catch (e) {
      if (made) {
        if (state.vault && sameAccounts(state.vault.header, made.header)) dropSecrets();
        Resume.drop(made.resumeTag); await leaveCreated(made.header);
      }
      throw e;
    }
    enterWallet();
  },
};
