// Synthetic accounts only. Real production backup/storage code and crypto; reduced Argon2 cost for race tests.
const { shared, appSource, makeTab, VAULT_KEY } = require('./lib/tabs.cjs');
const { check, finish, harnessError } = require('./lib/check.cjs');
const [build, src] = process.argv.slice(2);
const app = appSource(build, src, ['00-config.js', '01-util.js', '01b-i18n.js', '03-qubic.js', '04-storage.js', '04b-backup.js', '05-net.js', '06-store.js']);
function tab() {
  return makeTab(app, `
    let flow = null;
    const closeAllSheets = () => {}, toast = () => {}, showUnlock = () => {}, showWelcome = () => {};
    const enterWallet = () => { state.phase = 'ready'; };
    ${app.text}
    state.selfTest.status = 'pass'; state.phase = 'welcome'; state.prefs.resumeOnReload = false;
    window.__t = { Backup, Vault, state, Q, buildAccount, vaultPayload, sessionGuard, nextSession, dropSecrets, journalEntries };
  `, { extra: { setInterval, clearInterval, AbortController, fetch: async () => { throw new Error('offline'); }, requestAnimationFrame: () => {} } });
}
const pw = 'Synthetic-backup-only!83';
const seed = 'abcdefghijklmnopqrstuvwxyz'.repeat(3).slice(0, 55);
const yes = () => true;
const rejects = async (fn, code) => { try { await fn(); return false; } catch (e) { return !code || e.code === code; } };
const copy = (x) => JSON.parse(JSON.stringify(x));
(async () => {
  const t = tab(); const { Backup, Vault, state, Q } = t.t;
  state.accounts = [t.t.buildAccount({ kind: 'seed', seed, name: 'Synthetic main' }),
    t.t.buildAccount({ kind: 'watch', identity: Q.publicKeyToIdentity(Q.deriveKeys('b'.repeat(55)).publicKey), name: 'Synthetic watch' })];
  state.selection = state.accounts[0].id; state.mode = 'session'; state.phase = 'ready';
  state.accounts[0].avatar = { color: 3, finish: 'radial' };
  state.contacts = [{ id: '1234567890abcdef', name: 'Synthetic friend', identity: Q.publicKeyToIdentity(Q.deriveKeys('c'.repeat(55)).publicKey), createdAt: 1 }];
  const signed = await Q.signTransaction(Q.buildTransaction({ source: state.accounts[0].publicKey, destination: state.accounts[1].identity,
    amount: 1n, targetTick: 100, inputType: 0, currentTick: 90 }), seed);
  const entry = { hash: Q.computeTransactionHash(signed), encoded: Q.encodeTransaction(signed), startTick: 90, createdAt: 1 };
  const payload = { ...t.t.vaultPayload(), pending: [entry] };
  const text = await Backup.encode(payload, pw, yes);
  check('Portable file contains no plaintext seed, names, contacts or password', ![seed, pw, 'Synthetic main', 'Synthetic friend'].some((s) => text.includes(s)));
  check('Detached backup creation writes no local vault', !shared.ls.has(VAULT_KEY));
  const opened = await Backup.open(text, pw, yes);
  check('Round trip preserves every account, name, avatar, contact and pending transfer', JSON.stringify(opened) === JSON.stringify(payload));
  const second = JSON.parse(await Backup.encode(payload, pw, yes)); const first = JSON.parse(text);
  check('Each backup has a fresh salt and IV', first.kdf.salt !== second.kdf.salt && first.cipher.iv !== second.cipher.iv);
  check('Wrong password fails without changing storage', await rejects(() => Backup.open(text, 'wrong password', yes)) && !shared.ls.has(VAULT_KEY));
  check('Weak backup passwords refused by the core', await rejects(() => Backup.encode(payload, '1234567890', yes), 'WEAK_PASSWORD'));
  for (const [name, change] of [
    ['ciphertext', (r) => { r.data = (r.data[0] === 'A' ? 'B' : 'A') + r.data.slice(1); }],
    ['IV', (r) => { r.cipher.iv = 'AAAAAAAAAAAAAAAA'; }],
    ['KDF', (r) => { r.kdf.t++; }],
    ['format', (r) => { r.format = 'qubic-web-wallet-vault'; }],
    ['version', (r) => { r.version++; }],
    ['excessive KDF cost', (r) => { r.kdf.m = 999999999; }],
    ['external journal', (r) => { r.pending = {}; }],
  ]) {
    const changed = copy(first); change(changed);
    check(`Tampered ${name} refused`, await rejects(() => Backup.open(JSON.stringify(changed), pw, yes)));
  }
  check('Oversized file refused before KDF', await rejects(() => Backup.open(' '.repeat(1024 * 1024 + 1), pw, yes)));
  for (const [name, change] of [
    ['mismatched seed', (p) => { p.accounts[0].seed = 'd'.repeat(55); }],
    ['duplicate account IDs', (p) => { p.accounts[1].id = p.accounts[0].id; }],
    ['invalid contact', (p) => { p.contacts[0].identity = 'INVALID'; }],
    ['missing journal', (p) => { delete p.pending; }],
    ['forged journal', (p) => { p.pending[0].hash = 'INVALID'; }],
    ['duplicate journal', (p) => { p.pending.push(p.pending[0]); }],
  ]) {
    const changed = copy(payload); change(changed);
    check(`${name} refused rather than silently dropping recovery data`, await rejects(() => Backup.encode(changed, pw, yes)));
  }
  let active = true; const gate = t.pauseNextEncrypt();
  const cancelled = Backup.encode(payload, pw, () => active);
  await gate.atGate; active = false; gate.release();
  check('Leaving during encryption cannot return a downloadable backup', await rejects(() => cancelled, 'CANCELLED'));
  const fresh = tab();
  await fresh.t.Backup.restore(opened, pw, fresh.t.sessionGuard());
  const saved = shared.ls.get(VAULT_KEY);
  check('Restore creates an encrypted wallet with all accounts and contacts', fresh.t.state.phase === 'ready' && fresh.t.state.accounts.length === 2 && fresh.t.state.contacts.length === 1 && !saved.includes(seed));
  check('Restore preserves the pending transfer send block', fresh.t.state.pending.some((p) => p.hash === entry.hash && p.status === 'waiting'));
  check('Restored wallet reopens with the backup password', (await fresh.t.Vault.open(pw, { resume: false })).payload.accounts[0].seed === seed);
  check('Existing wallet cannot be overwritten', await rejects(() => fresh.t.Backup.restore(opened, pw, yes), 'EXISTS') && shared.ls.get(VAULT_KEY) === saved);
  check('Export from saved wallet requires current password', await rejects(() => fresh.t.Backup.create('wrong-password', yes), 'WRONG_PASSWORD'));
  check('Saved export does not change the device vault', !!(await fresh.t.Backup.open(await fresh.t.Backup.create(pw, yes), pw, yes)) && shared.ls.get(VAULT_KEY) === saved);
  shared.ls.clear();
  const race = tab(); const wait = race.pauseNextEncrypt();
  const restoring = race.t.Backup.restore(opened, pw, race.t.sessionGuard());
  await wait.atGate; race.t.nextSession(); wait.release();
  check('Cancelled restore cannot write after a session change', await rejects(() => restoring, 'CANCELLED') && !shared.ls.has(VAULT_KEY));
  const writeFail = tab(); shared.failVaultWrites = true;
  check('Storage failure leaves no adopted accounts', await rejects(() => writeFail.t.Backup.restore(opened, pw, yes), 'STORAGE') && writeFail.t.state.accounts.length === 0);
  shared.failVaultWrites = false;
  const a = tab(); const b = tab();
  const attempts = await Promise.allSettled([a.t.Backup.restore(opened, pw, yes), b.t.Backup.restore(opened, pw, yes)]);
  check('Two concurrent restores produce one saved wallet and one refusal', attempts.filter((r) => r.status === 'fulfilled').length === 1 && attempts.some((r) => r.status === 'rejected' && r.reason.code === 'EXISTS'));
  finish('encrypted backup');
})().catch(harnessError);
