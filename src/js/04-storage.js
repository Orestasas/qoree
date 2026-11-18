// ═══════════════════════════════════════════════════════════════════════════
// 5. STORAGE
// Preferences are non-sensitive UI settings. The vault is the only place a seed
// is ever persisted, and only as AES-256-GCM ciphertext under an Argon2id key.
// ═══════════════════════════════════════════════════════════════════════════
// A saved setting is kept only when it is one of its allowed values (switches: a boolean).
/** @type {Record<string, readonly unknown[]>} */
const PREF_CHOICES = { lang: LANGUAGES.map((l) => l.id), theme: ['dark', 'light', 'system'], grays: ['warm', 'neutral'], heroUnit: ['usd', 'qubic'], priceUnit: ['unit', 'billion'], tickOffset: TICK_OFFSETS, autoLockMinutes: AUTO_LOCK_CHOICES };
const PREF_SWITCHES = ['privacy', 'marketData', 'labels', 'orderBooks', 'bpp', 'exchangeStatus', 'resumeOnReload', 'activityFiltersOpen'];
const Prefs = {
  load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.prefs) || 'null'); } catch { raw = null; }
    const p = { ...DEFAULT_PREFS };
    if (raw && typeof raw === 'object') {
      // A saved accent counts only once it was picked (every save stores the whole object, defaults included).
      // 'cyan' is teal's earlier name; 'custom' is a colour from the picker.
      const accent = raw.accent === 'cyan' ? 'teal' : raw.accent;
      if (typeof raw.accentCustom === 'string' && /^#[0-9a-f]{6}$/i.test(raw.accentCustom)) p.accentCustom = raw.accentCustom.toLowerCase();
      const known = ACCENTS.some((a) => a.id === accent) || (accent === 'custom' && p.accentCustom);
      if (raw.accentChosen === true && known) { p.accent = accent; p.accentChosen = true; }
      for (const [k, allowed] of Object.entries(PREF_CHOICES)) if (allowed.includes(raw[k])) p[k] = raw[k];
      for (const k of PREF_SWITCHES) if (typeof raw[k] === 'boolean') p[k] = raw[k];
      if (raw.selection === 'all' || (typeof raw.selection === 'string' && /^[0-9a-f]{16}$/.test(raw.selection))) p.selection = raw.selection;
    }
    return p;
  },
  save(p) {
    try { localStorage.setItem(STORAGE_KEYS.prefs, JSON.stringify(p)); } catch { /* non-critical */ }
  },
};

// One record holds the wallet: the header (format, KDF), the sealed accounts and, when there are any, the sealed
// journal of unsettled transfers (`pending`). Both parts are bound to the header, and a password change re-seals both
// in a single write, so they can never end up under different keys.
const Vault = {
  exists() {
    try { return localStorage.getItem(STORAGE_KEYS.vault) != null; } catch { return false; }
  },

  readHeader() {
    let v;
    try { v = JSON.parse(localStorage.getItem(STORAGE_KEYS.vault) ?? 'null'); } catch { throw new AppError('VAULT_CORRUPT'); }
    return Vault.parseHeader(v);
  },

  // Shared structural validation for storage and portable encrypted files; no storage side effects.
  parseHeader(v, format = VAULT_FORMAT) {
    const inRange = (x, range) => Number.isInteger(x) && x >= range[0] && x <= range[1];
    const k = v && v.kdf;
    const c = v && v.cipher;
    const p = v && v.pending;
    const ok = v && v.format === format && v.version === 1
      && k && k.name === 'argon2id' && inRange(k.m, VAULT_KDF_LIMITS.m) && inRange(k.t, VAULT_KDF_LIMITS.t)
      && inRange(k.p, VAULT_KDF_LIMITS.p) && typeof k.salt === 'string'
      && c && c.name === 'AES-256-GCM' && typeof c.iv === 'string' && typeof v.data === 'string'
      && (p == null || (typeof p.iv === 'string' && typeof p.data === 'string'));
    if (!ok) throw new AppError('VAULT_CORRUPT');
    try {
      if (fromB64(k.salt).length !== 16 || fromB64(c.iv).length !== 12 || fromB64(v.data).length < 17) throw new Error();
      if (p && (fromB64(p.iv).length !== 12 || fromB64(p.data).length < 17)) throw new Error();
    } catch { throw new AppError('VAULT_CORRUPT'); }
    return {
      format: v.format, version: v.version, kdf: { name: k.name, m: k.m, t: k.t, p: k.p, salt: k.salt }, cipher: { name: c.name, iv: c.iv }, data: v.data,
      ...(p ? { pending: { iv: p.iv, data: p.data } } : {}),
    };
  },

  // Everything except the IV and ciphertext is bound to the ciphertext as AES-GCM associated data; the journal part has
  // 'pending' in place of the cipher name.
  aad: (hd, part = hd.cipher.name) => utf8(JSON.stringify([hd.format, hd.version, hd.kdf.name, hd.kdf.m, hd.kdf.t, hd.kdf.p, hd.kdf.salt, part])),
  pendingAad: (hd) => Vault.aad(hd, 'pending'),

  // Argon2id output; the caller imports it as a non-extractable key and wipes it. It hands the page back every 25 ms of
  // work, so the loader keeps moving: Safari, which has no scheduler.yield, makes each of those pauses at least 4 ms,
  // and pausing every 10 ms made unlocking there about 40% slower.
  async deriveRaw(password, kdf) {
    const pw = utf8(password.normalize('NFKC'));
    try {
      return await Q.argon2idAsync(pw, fromB64(kdf.salt), { t: kdf.t, m: kdf.m, p: kdf.p, dkLen: 32, asyncTick: 25 });
    } finally {
      wipe(pw);
    }
  },
  keyFrom: (raw) => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']),

  async encrypt(key, aad, value) {
    const iv = randomBytes(12);
    const plain = utf8(JSON.stringify(value));
    try {
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, plain);
      return { iv: toB64(iv), data: toB64(new Uint8Array(ct)) };
    } finally {
      wipe(plain);
    }
  },
  async decrypt(key, aad, part) {
    let plain = null;
    try {
      plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(part.iv), additionalData: aad, tagLength: 128 }, key, fromB64(part.data)));
      return JSON.parse(new TextDecoder().decode(plain));
    } finally {
      wipe(plain);
    }
  },

  // The one place the record is written. auth() is asked right here, after every slow step: a lock, an erase or a
  // cancelled pane that came in meanwhile stops the write instead of landing after it.
  write(record, auth) {
    if (auth && !auth()) throw new AppError('CANCELLED', trLater('Cancelled. Nothing was changed.'));
    try { localStorage.setItem(STORAGE_KEYS.vault, JSON.stringify(record)); } catch { throw new AppError('STORAGE'); }
    return record;
  },

  // Accounts sealed with a fresh IV. pending: journal entries to seal with them; left out, the journal part already
  // stored for this same vault is kept as it is (it is sealed with the same key).
  /** @param {CryptoKey} key @param {VaultHeader} base @param {VaultPayload} payload @param {{ auth?: (() => boolean) | null, pending?: JournalEntry[], stored?: VaultRecord | null }} [opts] */
  async seal(key, base, payload, { auth = null, pending, stored = null } = {}) {
    const next = { format: base.format, version: base.version, kdf: base.kdf, cipher: { name: 'AES-256-GCM', iv: '' }, data: '' };
    const sealed = await Vault.encrypt(key, Vault.aad(next), payload);
    next.cipher.iv = sealed.iv;
    next.data = sealed.data;
    if (Array.isArray(pending)) {
      if (pending.length) next.pending = await Vault.encrypt(key, Vault.pendingAad(next), { v: 1, entries: pending });
    } else if (stored && stored.pending && sameKey(stored, next)) next.pending = stored.pending;
    return Vault.write(next, auth);
  },

  // A new vault (first wallet, encrypting a session, changing the password). The password rule is enforced here too,
  // so no caller (or race in one) can save a wallet under a weak or empty password. auth() must hold before the write
  // and before the reload key is kept. Under the write lock: expect is the record this replaces (null: none may exist,
  // so another tab's wallet is never overwritten), carry(stored) gives the journal entries to seal into it, and
  // onCommit({ key, header }) runs right after the write, so writes queued behind it already use the new key.
  /** @param {string} password @param {VaultPayload} payload @param {{ auth?: (() => boolean) | null, carry?: ((stored: VaultRecord | null) => Promise<JournalEntry[]>) | null, expect?: VaultRecord | null, onCommit?: ((made: { key: CryptoKey, header: VaultRecord }) => void) | null }} [opts] */
  async create(password, payload, { auth = null, carry = null, expect = null, onCommit = null } = {}) {
    if (!locksAvailable()) throw new AppError('NO_LOCKS');
    if (!secureStorageSupported()) throw new AppError('NO_SECURE_CONTEXT');
    if (typeof password !== 'string' || password.length < MIN_PASSWORD || passwordScore(password) < 2) throw new AppError('WEAK_PASSWORD');
    const base = { format: VAULT_FORMAT, version: 1, kdf: { ...VAULT_KDF, salt: toB64(randomBytes(16)) } };
    const raw = await Vault.deriveRaw(password, base.kdf);
    try {
      const key = await Vault.keyFrom(raw);
      if (auth && !auth()) throw new AppError('CANCELLED', trLater('Cancelled. Nothing was changed.'));
      const header = await vaultUpdate(async (stored) => {
        if (expect === null ? stored : !sameAccounts(stored, expect)) throw new AppError(expect === null ? 'EXISTS' : 'STALE');
        const written = await Vault.seal(key, base, payload, { auth, pending: carry ? await carry(stored) : [] });
        if (onCommit) onCommit({ key, header: written });
        return written;
      });
      const resumeTag = await Resume.save(raw, auth);
      // Erased, or its password changed in another tab, while the reload key was being stored (that tab's notice may
      // not have arrived yet): the caller must not carry on with this key, and the reload key just stored goes too.
      if (!sameKey(Vault.current(), header)) { Resume.drop(resumeTag); throw new AppError('GONE'); }
      return { key, header, resumeTag };
    } finally {
      wipe(raw);
    }
  },

  // resume: false only checks the password (e.g. before changing it). auth(): the unlock is still wanted (no erase or
  // reset meanwhile); if not, the result is discarded and no reload key is kept.
  /** @param {string} password @param {{ resume?: boolean, auth?: (() => boolean) | null }} [opts] */
  async open(password, { resume = true, auth = null } = {}) {
    const header = Vault.readHeader();
    const raw = await Vault.deriveRaw(password, header.kdf);
    try {
      const opened = await Vault.openWithKey(await Vault.keyFrom(raw), header);
      // Erased, or replaced by another tab (accounts or password), while the key was being derived: don't adopt it.
      const now = Vault.exists() ? Vault.readHeader() : null;
      if (!now || (auth && !auth())) throw new AppError('CANCELLED', trLater('Cancelled.'));
      if (!sameAccounts(now, header)) throw new AppError('STALE', trLater('The wallet was changed in another tab meanwhile. Try again.'));
      let resumeTag = null;
      if (resume) {
        resumeTag = await Resume.save(raw, auth);
        // Storing the reload key waits on IndexedDB: erased or changed meanwhile (its notice may not have arrived yet),
        // nothing is adopted and the key just stored goes too. The caller checks once more right before adopting.
        if (!Vault.still(header) || (auth && !auth())) { Resume.drop(resumeTag); throw new AppError('CANCELLED', trLater('Cancelled.')); }
      }
      return { ...opened, resumeTag };
    } finally {
      wipe(raw);
    }
  },

  // The accounts, and the journal: its entries, null when there is none, or 'unreadable'.
  async openWithKey(key, header = Vault.readHeader()) {
    let payload;
    try {
      payload = await Vault.decrypt(key, Vault.aad(header), { iv: header.cipher.iv, data: header.data });
    } catch (e) {
      throw new AppError(e instanceof SyntaxError ? 'VAULT_CORRUPT' : 'WRONG_PASSWORD');
    }
    let pending = null;
    if (header.pending) {
      try { pending = await Journal.read(key, header); } catch { pending = 'unreadable'; }
    }
    return { key, header, payload, pending };
  },

  // A record this tab wrote and then gave up on (the screen that asked for it was left): deleted under the write lock,
  // only if it is still exactly that record, byte for byte. A change since from another tab, even to its journal part
  // alone, keeps it. → 'removed'; 'gone' (nothing of it is stored: erased, or another wallet saved since); 'kept'
  // (changed since); 'failed' (still stored: the lock or the delete failed, or storage can't be read to check).
  async discard(record) {
    const mine = JSON.stringify(record);
    const raw = () => { try { return localStorage.getItem(STORAGE_KEYS.vault); } catch { return undefined; } };
    const instead = () => (sameKey(Vault.current(), record) ? 'kept' : 'gone');
    try {
      return await vaultUpdate(async () => {
        const now = raw();
        if (now === undefined) return 'failed';
        if (now !== mine) return instead();
        Vault.remove();
        return raw() === null ? 'removed' : 'failed';
      });
    } catch {
      const now = raw();
      return now === undefined || now === mine ? 'failed' : instead();
    }
  },
  // Verifiably gone: storage answers, and holds neither the record nor the previous version's journal.
  absent() {
    try { return localStorage.getItem(STORAGE_KEYS.vault) === null && localStorage.getItem(STORAGE_KEYS.journal) === null; } catch { return false; }
  },
  // The stored record's header, or null when there is none or it can't be read.
  current() {
    try { return Vault.exists() ? Vault.readHeader() : null; } catch { return null; }
  },
  // True while the stored record is still this one: same key, same accounts part (its journal part may have moved on).
  still: (header) => sameAccounts(Vault.current(), header),

  remove() {
    try { localStorage.removeItem(STORAGE_KEYS.vault); localStorage.removeItem(STORAGE_KEYS.journal); } catch { /* storage blocked: the callers check what is left */ }
  },
};

// Key generation: the KDF salt (new with every password). Accounts part: its IV and ciphertext (new with every save).
const sameKey = (a, b) => Boolean(a && b && a.kdf.salt === b.kdf.salt);
const sameAccounts = (a, b) => sameKey(a, b) && a.cipher.iv === b.cipher.iv && a.data === b.data;

// Every write to the stored wallet runs through here, and so does erasing it: one at a time in this tab and, under a
// Web Lock, across its tabs. change(stored) gets the record as stored at that moment, so no write drops another's part
// or brings back an erased wallet. Without Web Locks nothing is written at all (NO_LOCKS): there would be no way to
// keep another tab from writing over a change, so changes to the saved wallet fail closed.
let vaultChain = Promise.resolve();
// Runs run() after every write or erase already queued in this tab, whatever their outcome.
const queued = (run) => { const done = vaultChain.then(run); vaultChain = done.catch(() => {}); return done; };
async function withLock(name, fn) {
  if (!locksAvailable()) throw new AppError('NO_LOCKS');
  let entered = false;
  try {
    return await navigator.locks.request(name, () => { entered = true; return fn(); });
  } catch (e) {
    if (!entered) throw new AppError('NO_LOCKS');
    throw e;
  }
}
function vaultUpdate(change) {
  return queued(() => withLock('qubic-wallet-vault', async () => change(Vault.exists() ? Vault.readHeader() : null)));
}
// Erase (and stop remembering): under the same lock, after any write already holding it (another tab's included),
// which is deleted with the rest. A write queued behind the erase finds no record and stops: persist and the journal
// refuse (STALE, LOCKED), a password change expects the old record (STALE). Without Web Locks no write can run, so the
// record is simply removed.
function eraseStored() {
  const run = () => withLock('qubic-wallet-vault', async () => { Vault.remove(); }).catch(() => { Vault.remove(); });
  return queued(run);
}

// The auto-lock window: the reload key's deadline and the auto-lock itself both use it.
const autoLockMs = () => state.prefs.autoLockMinutes * 60000;

// ── Staying unlocked across a reload (encrypted mode, opt-in) ───────────────
// Off by default. When on, unlocking keeps a copy of the vault key for this tab, split in two: the key AES-GCM-wrapped
// under a fresh random 256-bit secret in IndexedDB, and that secret (with the auto-lock deadline) in this tab's
// sessionStorage. Neither half opens the wallet alone; a reload in the same tab joins them until the deadline (app
// policy, not a cryptographic expiry). Lock, auto-lock, turning the setting off, stop-remembering and erasing delete
// both halves, and a save only happens as part of a still-current unlock or password change. Trade-off: while both
// halves exist, code in this origin or anyone with this browser profile's files can join them; browsers may also keep
// sessionStorage on disk or restore it with the tab.
const Resume = (() => {
  const STORE = 'resume';
  const LEGACY_KEY = 'qubic-wallet.resume.v1';
  let tag = null; let gen = 0;
  // Version 2 drops version 1's store, which held usable keys.
  const open = () => new Promise((resolve, reject) => {
    const rq = indexedDB.open('qubic-wallet', 2);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      db.createObjectStore(STORE, { keyPath: 'tag' });
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
  async function run(mode, fn) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const rq = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(rq ? rq.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    } finally { db.close(); }
  }
  const aad = (t) => utf8(`qubic-wallet resume ${t}`);
  const deadline = () => state.lastActivity + autoLockMs();
  let touchedAt = 0;
  const readSaved = () => { try { return JSON.parse(sessionStorage.getItem(STORAGE_KEYS.resume) || 'null'); } catch { return null; } };
  const writeSaved = (v) => { try { sessionStorage.setItem(STORAGE_KEYS.resume, JSON.stringify(v)); } catch { /* reloads lock */ } };
  const dropSaved = () => { try { sessionStorage.removeItem(STORAGE_KEYS.resume); sessionStorage.removeItem(LEGACY_KEY); } catch { /* nothing kept */ } };
  const forget = (t) => { if (t) run('readwrite', (st) => st.delete(t)).catch(() => {}); };
  return {
    // raw: the vault key bytes, available only while the password is being turned into the key. auth: the unlock or
    // password change this belongs to, which must still hold before and after the write; a save can't start on its own.
    // Returns the key's tag when one was kept (for drop()), otherwise null.
    async save(raw, auth) {
      const g = ++gen;
      if (typeof auth !== 'function' || !auth()) return null;
      if (!state.prefs.resumeOnReload || typeof indexedDB === 'undefined') { this.clear(); return null; }
      const next = toB64(randomBytes(16));
      const secret = randomBytes(32); const iv = randomBytes(12);
      try {
        const wrapKey = await crypto.subtle.importKey('raw', secret, { name: 'AES-GCM' }, false, ['encrypt']);
        const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(next), tagLength: 128 }, wrapKey, raw));
        await run('readwrite', (st) => st.put({ tag: next, iv: toB64(iv), wrapped: toB64(wrapped), created: Date.now() }));
        // Locked, erased, turned off or replaced while this was being written: keep nothing.
        if (g !== gen || !auth() || !state.prefs.resumeOnReload) { forget(next); return null; }
        const old = tag; tag = next;
        // Saving happens as the wallet unlocks, which is activity: the deadline starts now.
        writeSaved({ tag: next, s: toB64(secret), until: Date.now() + autoLockMs() });
        forget(old);
        return next;
      } catch {
        forget(next);
        return null;
      } finally {
        wipe(secret);
      }
    },
    // Moves the deadline with activity, at most every 15 s (input comes in bursts: a scroll is dozens of events), and
    // right before the page unloads (final; sessionStorage only). A deadline written up to 15 s early only locks sooner.
    touch(final = false) {
      if (!final && Date.now() - touchedAt < 15000) return;
      const saved = tag && readSaved();
      if (!saved || saved.tag !== tag || state.mode !== 'vault' || !state.vault) return;
      touchedAt = Date.now();
      writeSaved({ ...saved, until: deadline() });
    },
    // At startup: the key, if this tab kept both halves and the deadline hasn't passed.
    async take() {
      if (typeof indexedDB === 'undefined') return null;
      const saved = readSaved();
      const now = Date.now();
      try {
        await run('readwrite', (st) => {
          const rq = st.openCursor();
          // Deleted: entries older than a day, from any tab, and this tab's own once its deadline has passed.
          rq.onsuccess = () => {
            const c = rq.result; if (!c) return;
            if (!(c.value.created > now - DAY_MS) || (saved && c.value.tag === saved.tag && !(saved.until > now))) c.delete();
            c.continue();
          };
          return null;
        });
      } catch { return null; }
      if (!state.prefs.resumeOnReload || !saved || typeof saved.tag !== 'string' || typeof saved.s !== 'string' || !(saved.until > now)) { this.clear(); return null; }
      const g = gen;
      let raw = null; let secret = null;
      try {
        const entry = await run('readonly', (st) => st.get(saved.tag));
        if (!entry) throw new Error('missing');
        secret = fromB64(saved.s);
        const unwrapKey = await crypto.subtle.importKey('raw', secret, { name: 'AES-GCM' }, false, ['decrypt']);
        raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(entry.iv), additionalData: aad(saved.tag), tagLength: 128 }, unwrapKey, fromB64(entry.wrapped)));
        const key = await Vault.keyFrom(raw);
        if (g !== gen) return null;
        tag = saved.tag;
        return { key, tag: saved.tag, lastActivity: saved.until - autoLockMs() };
      } catch {
        this.clear();
        return null;
      } finally {
        wipe(raw, secret);
      }
    },
    // One operation giving up on the key it saved (or took): that key goes, only that one. A newer key, or a save still
    // in flight for a newer unlock, is left alone (unlike clear()).
    drop(t) {
      if (!t) return;
      forget(t);
      if (t !== tag) return;
      tag = null;
      const saved = readSaved();
      if (saved && saved.tag === t) dropSaved();
    },
    // Synchronous: bumps the generation first, so a save in flight discards itself.
    clear() {
      gen++;
      const saved = readSaved();
      dropSaved();
      forget(tag); if (saved && saved.tag !== tag) forget(saved.tag);
      tag = null;
    },
    // Erase and stop-remembering: every entry this browser holds, from any tab.
    purge() {
      gen++;
      dropSaved();
      tag = null;
      if (typeof indexedDB !== 'undefined') run('readwrite', (st) => st.clear()).catch(() => {});
    },
  };
})();

// ── Unsettled transfers (encrypted mode) ────────────────────────────────────
// The record's journal part: signed transfers that haven't settled, from every tab. Each write merges with what is
// stored (other tabs' entries stay, entries this tab settled go) under the same lock as every other write. Entries are
// written before a transfer is broadcast; after a reload or an unlock they are restored and tracked again, and their
// account can't send until they settle. A session-only wallet keeps nothing.
// The most journal entries kept when read, merged or folded in: well above the one open transfer each account can have.
const JOURNAL_MAX = 50;
const Journal = {
  async read(key, record) {
    let d;
    try { d = await Vault.decrypt(key, Vault.pendingAad(record), record.pending); } catch { throw new AppError('JOURNAL'); }
    if (!d || d.v !== 1 || !Array.isArray(d.entries)) throw new AppError('JOURNAL');
    return d.entries.filter((e) => e && typeof e.hash === 'string' && typeof e.encoded === 'string').slice(0, JOURNAL_MAX);
  },
  merge(stored, mine, settled) {
    const byHash = new Map(stored.filter((e) => !settled.has(e.hash)).map((e) => [e.hash, e]));
    for (const e of mine) byHash.set(e.hash, e);
    return [...byHash.values()].slice(-JOURNAL_MAX);
  },
  // vault(): this tab's { key, header } when the write runs (not when it was queued), so a write queued behind this
  // tab's own password change uses the new key. If the stored record has another key (another tab changed the
  // password), nothing is written: STALE. mine() / settled(): this tab's unsettled entries / settled hashes, also read
  // when the write runs. Throws if it can't be written.
  save(vault, mine, settled, auth) {
    return vaultUpdate(async (stored) => {
      const v = vault();
      if (!stored || !v || !v.key) throw new AppError('LOCKED');
      if (!sameKey(stored, v.header)) throw new AppError('STALE');
      const entries = Journal.merge(stored.pending ? await Journal.read(v.key, stored) : [], mine(), settled());
      const next = { ...stored };
      delete next.pending;
      if (entries.length) next.pending = await Vault.encrypt(v.key, Vault.pendingAad(stored), { v: 1, entries });
      return Vault.write(next, auth);
    });
  },
  // The separate journal key written by the previous version, folded in on the first unlock.
  async legacy(key) {
    let j;
    try { j = JSON.parse(localStorage.getItem(STORAGE_KEYS.journal) || 'null'); } catch { j = null; }
    if (!j || typeof j.iv !== 'string' || typeof j.data !== 'string') return [];
    const d = await Vault.decrypt(key, utf8('qubic-wallet pending v1'), j).catch(() => { throw new AppError('JOURNAL'); });
    return d && d.v === 1 && Array.isArray(d.entries) ? d.entries.slice(0, JOURNAL_MAX) : [];
  },
};

const isHexId = (v) => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
// An account's chosen avatar: a colour (0–9; null: the one its address picks) and a finish. Neither chosen: null.
function cleanAvatar(v) {
  if (!v || typeof v !== 'object') return null;
  const color = Number.isInteger(v.color) && v.color >= 0 && v.color < AVATAR_COLORS ? v.color : null;
  const finish = AVATAR_FINISH_IDS.includes(v.finish) ? v.finish : 'radial';
  return color === null && finish === 'radial' ? null : { color, finish };
}
const cleanName = (s, fallback = tr('Account')) => cleanText(String(s || ''), 32) || fallback;

// Validates a decrypted payload and re-derives every seed's identity before trusting it.
function restoreAccounts(payload) {
  if (!payload || payload.v !== 1 || !Array.isArray(payload.accounts) || payload.accounts.length > MAX_ACCOUNTS) {
    throw new AppError('VAULT_CORRUPT');
  }
  /** @type {Account[]} */
  const accounts = [];
  for (const a of payload.accounts) {
    if (!a || !isHexId(a.id) || !isId(a.identity)) throw new AppError('VAULT_CORRUPT');
    const base = { id: a.id, name: cleanName(a.name), identity: a.identity, createdAt: Number(a.createdAt) || Date.now(), avatar: cleanAvatar(a.avatar) };
    if (a.kind === 'seed') {
      if (typeof a.seed !== 'string' || !SEED_RE.test(a.seed)) throw new AppError('VAULT_CORRUPT');
      const derived = deriveAccount(a.seed);
      if (derived.identity !== a.identity) throw new AppError('VAULT_CORRUPT', trLater('A saved seed does not match its address. The saved data may have been modified.'));
      accounts.push({ ...base, kind: 'seed', seed: a.seed, publicKey: derived.publicKey });
    } else if (a.kind === 'watch') {
      if (checkIdentity(a.identity).state !== 'valid') throw new AppError('VAULT_CORRUPT');
      accounts.push({ ...base, kind: 'watch', publicKey: Q.identityToPublicKey(a.identity) });
    } else {
      throw new AppError('VAULT_CORRUPT');
    }
  }
  if (new Set(accounts.map((x) => x.identity)).size !== accounts.length) throw new AppError('VAULT_CORRUPT');
  const selection = payload.selection === 'all' || accounts.some((x) => x.id === payload.selection) ? payload.selection : accounts[0]?.id;
  // The address book: each entry re-validated; one that isn't a valid, canonical, distinct address is left out.
  const contacts = [];
  for (const c of Array.isArray(payload.contacts) ? payload.contacts.slice(0, MAX_CONTACTS) : []) {
    if (!c || !isHexId(c.id) || !isId(c.identity) || checkIdentity(c.identity).state !== 'valid') continue;
    if (accounts.some((a) => a.identity === c.identity) || contacts.some((x) => x.identity === c.identity)) continue;
    contacts.push({ id: c.id, name: cleanName(c.name, tr('Saved address')), identity: c.identity, createdAt: Number(c.createdAt) || Date.now() });
  }
  return { accounts, selection, contacts };
}

function vaultPayload() {
  return {
    v: 1,
    accounts: state.accounts.map((a) => ({
      id: a.id, name: a.name, kind: a.kind, identity: a.identity, createdAt: a.createdAt,
      ...(a.avatar ? { avatar: a.avatar } : {}),
      ...(a.kind === 'seed' ? { seed: a.seed } : {}),
    })),
    selection: state.selection,
    contacts: state.contacts.map((c) => ({ id: c.id, name: c.name, identity: c.identity, createdAt: c.createdAt })),
  };
}

// Account changes: the accounts part re-sealed with a fresh IV, the stored journal part kept, in the shared write
// queue. Only on top of the record this tab last saw: if another tab changed the accounts or the password meanwhile,
// its change stands, nothing is written here, and this tab locks (STALE).
function persist() {
  if (state.mode !== 'vault' || !state.vault || !state.vault.key) return Promise.resolve();
  const auth = sessionGuard();
  return vaultUpdate(async (stored) => {
    if (state.mode !== 'vault' || !state.vault || !state.vault.key || !auth()) return;
    if (!sameAccounts(stored, state.vault.header)) throw new AppError('STALE');
    state.vault.header = await Vault.seal(state.vault.key, state.vault.header, vaultPayload(), { auth, stored });
  }).catch((e) => {
    // A write from a session that has since ended must not lock the one now open.
    if (e.code === 'STALE' && auth()) staleTab();
    throw e;
  });
}
