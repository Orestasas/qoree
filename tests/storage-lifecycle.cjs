// Storage lifecycle (src/js 00–04 + the vendored bundle): the review's V2 scenarios, run against the real Vault,
// Resume and Journal code. Each "tab" is its own VM context with its own sessionStorage and state; tabs share one
// localStorage, one IndexedDB stand-in and one Web Locks stand-in, as tabs of one origin do. Encryption can be paused
// mid-call to hit the windows the review describes. KDF cost is lowered for speed (the code path is unchanged).
// Also the startup check for a service worker on the wallet's address.
// Usage: node storage-lifecycle.cjs <build dir> <src dir>     MUTATE=<name> (the mutation lines below) puts one fault back.
const fs = require('fs'); const path = require('path');
const { VAULT_KEY, RESUME_KEY, shared, localStorage, resumeRecords, appSource, makeTab: newTab, settle } = require('./lib/tabs.cjs');
const { check, finish, harnessError } = require('./lib/check.cjs');
const { mutable, SESSIONS } = require('./lib/load.cjs');
const [BUILD, SRC] = process.argv.slice(2);
const app = appSource(BUILD, SRC, ['00-config.js', '01-util.js', '01b-i18n.js', '03-qubic.js', '04-storage.js']);
// MUTATE=write-auth removes the check right before the write, to show the V2-01/V2-03 checks catch its absence.
app.mutation('write-auth', "if (auth && !auth()) throw new AppError('CANCELLED', trLater('Cancelled. Nothing was changed.'));\n    try { localStorage", 'try { localStorage');
// The V4 and V5 fixes.
app.mutation('erase-unlocked', "const run = () => withLock('qubic-wallet-vault', async () => { Vault.remove(); }).catch(() => { Vault.remove(); });", 'const run = async () => { Vault.remove(); };');
app.mutation('lock-fallback', "if (!locksAvailable()) throw new AppError('NO_LOCKS');\n  let entered", 'if (!locksAvailable()) return fn();\n  let entered');
app.mutation('no-final-check', "if (!Vault.still(header) || (auth && !auth())) { Resume.drop(resumeTag); throw new AppError('CANCELLED', trLater('Cancelled.')); }", '');
app.mutation('no-gone', "if (!sameKey(Vault.current(), header)) { Resume.drop(resumeTag); throw new AppError('GONE'); }", 'if (!sameKey(Vault.current(), header)) Resume.drop(resumeTag);');
// A page served through a service worker, a worker registered on the address, or a worker list that never
// answers (startup held), each undone; and a removal that never answers (the screen spins forever), or one that
// distrusts a worker that confirmed its removal.
app.mutation('worker-controller', '    if (sw.controller) return true;\n', '');
app.mutation('worker-listed', '    return Array.isArray(listed) && listed.length > 0;', '    return false;');
app.mutation('worker-wait', 'await Promise.race([sw.getRegistrations(), unanswered]);', 'await sw.getRegistrations();');
app.mutation('remove-wait', 'return (await Promise.race([work, unanswered])) === true;', 'return (await work) === true;');
app.mutation('remove-listed', '      return done.every((ok) => ok === true) || (await sw.getRegistrations()).length === 0;',
  '      return (await sw.getRegistrations()).length === 0;');
// Where boot runs that check (src/js/11-main.js needs a page, so it is read as text): after the self-test or a resume,
// without waiting for its answer, or leaving the reload key in place.
const MAIN = fs.readFileSync(path.join(SRC, 'js', '11-main.js'), 'utf8');
const bootAt = MAIN.indexOf('\nasync function boot() {');
if (bootAt < 0) throw new Error('async function boot() not found in 11-main.js');
const bootSrc = mutable(MAIN.slice(bootAt + 1, MAIN.indexOf('\n}\n', bootAt) + 3));
const REFUSAL = '  if (await foreignWorker()) { Resume.clear(); showWorkerRefusal(); return; }\n';
bootSrc.mutation('worker-late', REFUSAL, '');
bootSrc.mutation('worker-late', '  await runSelfTest();\n', `  await runSelfTest();\n${REFUSAL}`);
bootSrc.mutation('worker-unawaited', 'if (await foreignWorker())', 'if (foreignWorker())');
bootSrc.mutation('worker-keeps-reload-key', '{ Resume.clear(); showWorkerRefusal(); return; }', '{ showWorkerRefusal(); return; }');
// The no-library path skipping the worker check (it returned before reaching it).
bootSrc.mutation('worker-skipped-without-library', '    const foreign = await foreignWorker();\n', '    const foreign = false;\n');

// A browser without Web Locks, and one whose lock manager refuses requests (e.g. an opaque origin).
const refusingLocks = { request: () => Promise.reject(Object.assign(new Error('insecure'), { name: 'SecurityError' })) };

// ── Tabs ────────────────────────────────────────────────────────────────────
// lockManager: null for a browser without Web Locks. The encrypt/decrypt gates come with every tab
// (tests/lib/tabs.cjs).
function makeTab({ lockManager } = {}) {
  const tab = newTab(app, `
    ${SESSIONS}
    const state = { prefs: { resumeOnReload: true, autoLockMinutes: 10 }, mode: 'vault', vault: null, accounts: [], contacts: [], selection: null, session: openSession(), lastActivity: Date.now(), pending: [] };
    let staleCount = 0; const staleTab = () => { staleCount++; };
    ${app.text}
    window.__t = { state, Vault, Resume, Journal, persist, eraseStored, sessionGuard, nextSession, secureStorageSupported, restoreAccounts, vaultPayload, foreignWorker, removeWorkers, get staleCount() { return staleCount; } };`,
  { lockManager });
  // What a lock does to these modules: the session ends and the reload key is cleared.
  tab.lock = () => { tab.t.nextSession(); tab.t.Resume.clear(); tab.t.state.vault = null; };
  return tab;
}

const P1 = 'plum-orbit-candle-ferry'; const P2 = 'quartz-meadow-lantern-oak'; const P3 = 'violet-harbor-copper-tide';
const entry = (n) => ({ hash: `hash${n}`.padEnd(60, 'x'), encoded: `encoded-${n}`, startTick: 1, createdAt: 1 });
const opensWith = async (tab, pw) => { try { await tab.t.Vault.open(pw, { resume: false }); return true; } catch { return false; } };
const pendingWith = async (tab, pw) => (await tab.t.Vault.open(pw, { resume: false })).pending;
const codeOf = (p) => p.then(() => 'none', (e) => e.code); // the error code a call ends with, or 'none'
const journalOf = async (tab, pw) => (await pendingWith(tab, pw)).map((e) => e.hash.slice(0, 5)).sort().join(',');

(async () => {
  const A = makeTab();
  const payload = { v: 1, accounts: [], selection: null, updatedAt: 1 };
  // A wallet with password P1, unlocked in tab A.
  {
    const auth = A.t.sessionGuard();
    const made = await A.t.Vault.create(P1, payload, { auth });
    A.t.state.vault = { key: made.key, header: made.header };
    await settle();
  }

  // V2-01: lock while the new vault is being encrypted (password change with reload-unlock on).
  {
    const before = localStorage.getItem(VAULT_KEY);
    const authBase = A.t.sessionGuard();
    const pause = A.pauseNextEncrypt();
    const change = A.t.Vault.create(P2, payload, { auth: authBase, expect: A.t.state.vault.header });
    await pause.atGate;
    A.lock();
    pause.release();
    const code = await codeOf(change);
    await settle();
    check('V2-01 lock during password-change encryption cancels the write', code === 'CANCELLED' && localStorage.getItem(VAULT_KEY) === before, `code ${code}`);
    check('V2-01 old password still opens, new one does not', (await opensWith(A, P1)) && !(await opensWith(A, P2)));
    check('V2-01 no reload key left behind (session half, IndexedDB half)', !A.session.get(RESUME_KEY) && resumeRecords() === 0, `records ${resumeRecords()}`);
    // A change that went through anyway (a fault) is undone, so the scenarios below still start from the P1 wallet.
    if (localStorage.getItem(VAULT_KEY) !== before) localStorage.setItem(VAULT_KEY, before);
  }

  // A save can't start on its own: no authorisation, no reload key.
  {
    await A.t.Resume.save(new Uint8Array(32));
    await settle();
    check('Resume.save without an authorisation keeps nothing', !A.session.get(RESUME_KEY) && resumeRecords() === 0);
    await A.t.Resume.save(new Uint8Array(32), () => false);
    await settle();
    check('Resume.save with a lapsed authorisation keeps nothing', !A.session.get(RESUME_KEY) && resumeRecords() === 0);
  }

  // Re-open tab A (unlock), with the reload key on, and check the authorised path still works.
  {
    const auth = A.t.sessionGuard();
    const opened = await A.t.Vault.open(P1, { auth });
    A.t.state.vault = { key: opened.key, header: opened.header };
    await settle();
    check('Authorised unlock keeps both halves of the reload key', Boolean(A.session.get(RESUME_KEY)) && resumeRecords() === 1);
  }

  // V2-05: erased while an unlock is running: the unlock's result is discarded and no reload key is kept.
  {
    const B = makeTab();
    A.t.Resume.purge();
    await settle();
    const auth = B.t.sessionGuard();
    const unlock = B.t.Vault.open(P1, { auth });
    B.t.nextSession(); // what Erase does first
    const code = await codeOf(unlock);
    await settle();
    check('V2-05 an unlock overtaken by an erase is discarded', code === 'CANCELLED' && !B.session.get(RESUME_KEY) && resumeRecords() === 0, `code ${code}`);
  }

  // V2-02: the journal can't be written, so the send path gets an error (and stops before broadcasting).
  {
    shared.failVaultWrites = true;
    const code = await codeOf(A.t.Journal.save(() => A.t.state.vault, () => [entry(1)], () => new Set(), A.t.sessionGuard()));
    shared.failVaultWrites = false;
    check('V2-02 a failed journal write is reported to the sender', code === 'STORAGE', `code ${code}`);
  }

  // V2-03: locked while the journal is being written: the write is cancelled (and the sender checks again after it).
  {
    const before = localStorage.getItem(VAULT_KEY);
    const pause = A.pauseNextEncrypt();
    const kept = A.t.state.vault;
    const save = A.t.Journal.save(() => kept, () => [entry(2)], () => new Set(), A.t.sessionGuard());
    await pause.atGate;
    const key = A.t.state.vault.key;
    A.lock();
    pause.release();
    const code = await codeOf(save);
    check('V2-03 a lock during the journal write cancels it', code === 'CANCELLED' && localStorage.getItem(VAULT_KEY) === before, `code ${code}`);
    A.t.state.vault = { key, header: A.t.Vault.readHeader() };
  }

  // V2-06: two tabs journal transfers from different accounts; both entries survive, and settling one keeps the other.
  const C = makeTab();
  {
    const opened = await C.t.Vault.open(P1, { resume: false });
    C.t.state.vault = { key: opened.key, header: opened.header };
    await Promise.all([
      A.t.Journal.save(() => A.t.state.vault, () => [entry('A')], () => new Set(), A.t.sessionGuard()),
      C.t.Journal.save(() => C.t.state.vault, () => [entry('B')], () => new Set(), C.t.sessionGuard()),
    ]);
    const both = await journalOf(A, P1);
    check('V2-06 two tabs journalling at once keep both entries', both === 'hashA,hashB', both);
    await A.t.Journal.save(() => A.t.state.vault, () => [], () => new Set([entry('A').hash]), A.t.sessionGuard());
    const left = await journalOf(A, P1);
    check('V2-06 settling one tab’s entry leaves the other tab’s', left === 'hashB', left);
  }

  // Account changes (persist) keep the journal part as it is.
  {
    A.t.state.mode = 'vault';
    A.t.state.accounts = [];
    await A.t.persist();
    const left = await journalOf(A, P1);
    check('Saving accounts keeps the stored journal', left === 'hashB', left);
  }

  // A password change in tab A carries the stored journal over into the new record.
  const carry = async (stored) => A.t.Journal.merge(stored && stored.pending ? await A.t.Journal.read(A.t.state.vault.key, stored) : [], [], new Set());
  // V2-04: the password change re-seals the journal in the same write; a failed write leaves the old pair intact.
  {
    shared.failVaultWrites = true;
    const code = await codeOf(A.t.Vault.create(P2, payload, { auth: A.t.sessionGuard(), carry, expect: A.t.state.vault.header }));
    shared.failVaultWrites = false;
    const intact = await journalOf(A, P1);
    check('V2-04 a password change whose write fails leaves vault and journal as they were', code === 'STORAGE' && intact === 'hashB', `${code}; ${intact}`);
    const made = await A.t.Vault.create(P3, payload, { auth: A.t.sessionGuard(), carry, expect: A.t.state.vault.header });
    const moved = await journalOf(A, P3);
    check('V2-04 after a password change the journal opens with the new password', moved === 'hashB' && !(await opensWith(A, P1)), moved);
    A.t.state.vault = { key: made.key, header: made.header };
  }

  // V3-01: tab C still has the old key and header after tab A changed the password; its queued account save must not
  // undo the change or drop the journal.
  {
    C.t.state.mode = 'vault'; C.t.state.accounts = [];
    const before = localStorage.getItem(VAULT_KEY);
    const code = await codeOf(C.t.persist());
    check('V3-01 a stale tab’s account save is refused', code === 'STALE' && localStorage.getItem(VAULT_KEY) === before && C.t.staleCount === 1, `code ${code}`);
    const kept = await journalOf(A, P3);
    check('V3-01 the new password still opens, the journal is intact', kept === 'hashB' && !(await opensWith(A, P1)), kept);
  }

  // V3-02: a journal write from the stale tab (old key) is refused; one queued behind this tab's own rekey uses the
  // new key because the tab's vault switches inside the write lock.
  {
    const before = localStorage.getItem(VAULT_KEY);
    const code = await codeOf(C.t.Journal.save(() => C.t.state.vault, () => [entry('C')], () => new Set(), C.t.sessionGuard()));
    check('V3-02 a journal write with the old key is refused', code === 'STALE' && localStorage.getItem(VAULT_KEY) === before, `code ${code}`);
    const rekey = A.t.Vault.create(P1, payload, { auth: A.t.sessionGuard(), carry, expect: A.t.state.vault.header, onCommit: (v) => { A.t.state.vault = v; } });
    const queued = A.t.Journal.save(() => A.t.state.vault, () => [entry('D')], () => new Set(), A.t.sessionGuard());
    await rekey; await queued;
    const after = await journalOf(A, P1);
    check('V3-02 a journal write queued behind a rekey lands under the new key', after === 'hashB,hashD', after);
    // The review's exact order: the rekey is mid-write (its accounts encryption paused) when the send's journal write
    // is queued; when it runs, the tab already holds the new key.
    const pause = A.pauseNextEncrypt();
    const rekey2 = A.t.Vault.create(P3, payload, { auth: A.t.sessionGuard(), carry, expect: A.t.state.vault.header, onCommit: (v) => { A.t.state.vault = v; } });
    await pause.atGate;
    const queued2 = A.t.Journal.save(() => A.t.state.vault, () => [entry('E')], () => new Set(), A.t.sessionGuard());
    pause.release();
    await rekey2; await queued2;
    const after2 = await journalOf(A, P3);
    check('V3-02 a journal write queued while the rekey is writing uses the new key', after2 === 'hashB,hashD,hashE', after2);
  }

  // V3-03: tab D is unlocking when tab A erases the vault, or replaces it: the unlock is not adopted.
  {
    const D = makeTab();
    const unlock = D.t.Vault.open(P3, { auth: D.t.sessionGuard() });
    const saved = localStorage.getItem(VAULT_KEY);
    localStorage.removeItem(VAULT_KEY);
    const code = await codeOf(unlock);
    check('V3-03 an unlock overtaken by an erase in another tab is not adopted', code === 'CANCELLED', `code ${code}`);
    localStorage.setItem(VAULT_KEY, saved);
    const unlock2 = D.t.Vault.open(P3, { auth: D.t.sessionGuard() });
    const rec = JSON.parse(saved); rec.cipher.iv = A.t.state.vault.header.cipher.iv.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));
    localStorage.setItem(VAULT_KEY, JSON.stringify(rec));
    const changed = await codeOf(unlock2);
    localStorage.setItem(VAULT_KEY, saved);
    check('V3-03 an unlock overtaken by a change in another tab is not adopted', changed === 'STALE', `code ${changed}`);
  }

  // A new vault (encrypting a session-only wallet) never overwrites one another tab already saved.
  {
    const E = makeTab();
    const before = localStorage.getItem(VAULT_KEY);
    const code = await codeOf(E.t.Vault.create(P2, payload, { auth: E.t.sessionGuard(), expect: null }));
    check('A new vault refuses to overwrite an existing one', code === 'EXISTS' && localStorage.getItem(VAULT_KEY) === before, `code ${code}`);
  }

  // An unreadable journal is reported as such, not as an empty list.
  {
    const rec = JSON.parse(localStorage.getItem(VAULT_KEY));
    rec.pending.data = rec.pending.data.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));
    localStorage.setItem(VAULT_KEY, JSON.stringify(rec));
    const p = await pendingWith(A, P3);
    check('An unreadable journal is flagged, not treated as empty', p === 'unreadable', String(p));
  }


  // ── V4 ──────────────────────────────────────────────────────────────────
  // A fresh wallet (P1), unlocked in tabs F and G, reload key on.
  localStorage.removeItem(VAULT_KEY);
  const F = makeTab(); const G = makeTab();
  const unlockIn = async (tab, pw) => { const o = await tab.t.Vault.open(pw, { resume: false }); tab.t.state.vault = { key: o.key, header: o.header }; tab.t.state.mode = 'vault'; };
  {
    const made = await F.t.Vault.create(P1, payload, { auth: F.t.sessionGuard(), expect: null });
    F.t.state.vault = { key: made.key, header: made.header };
    await unlockIn(G, P1);
  }

  // V4-01, the review's order: F's account save holds the shared lock (paused mid-encryption) when G erases. The erase
  // waits for it, then deletes; no storage event reaches F meanwhile.
  {
    const pause = F.pauseNextEncrypt();
    const save = F.t.persist();
    await pause.atGate;
    const erase = G.t.eraseStored();
    await settle();
    const waited = localStorage.getItem(VAULT_KEY) !== null;
    pause.release();
    const code = await codeOf(save);
    await erase;
    check('V4-01 an erase waits for a write already holding the lock, then the wallet stays erased',
      waited && code === 'none' && localStorage.getItem(VAULT_KEY) === null && !(await opensWith(G, P1)), `write ${code}`);
    // Erased whatever happened (a fault can bring the record back), so the next scenario starts from an empty store.
    localStorage.removeItem(VAULT_KEY);
  }

  // V4-01, the other order: the erase runs first; writes queued behind it (no storage event delivered) find no record
  // and stop instead of bringing the wallet back: account save (STALE), journal (LOCKED), password change (STALE).
  {
    const made = await F.t.Vault.create(P1, payload, { auth: F.t.sessionGuard(), expect: null });
    F.t.state.vault = { key: made.key, header: made.header };
    await unlockIn(G, P1);
    const erase = G.t.eraseStored();
    const [, ...codes] = await Promise.all([
      erase,
      codeOf(F.t.persist()),
      codeOf(F.t.Journal.save(() => F.t.state.vault, () => [entry('F')], () => new Set(), F.t.sessionGuard())),
      codeOf(F.t.Vault.create(P2, payload, { auth: F.t.sessionGuard(), expect: F.t.state.vault.header })),
    ]);
    check('V4-01 writes queued behind an erase are refused and the wallet stays erased',
      codes.join(',') === 'STALE,LOCKED,STALE' && localStorage.getItem(VAULT_KEY) === null && !(await opensWith(G, P1)) && !(await opensWith(G, P2)), codes.join(','));
  }

  // V4-02: without Web Locks (missing, or refusing requests) nothing is written: no account save, journal or password
  // change, so another tab's change can't be rolled back; encrypted storage isn't offered; erasing still works.
  {
    const made = await F.t.Vault.create(P1, payload, { auth: F.t.sessionGuard(), expect: null });
    F.t.state.vault = { key: made.key, header: made.header };
    for (const [label, lockManager] of [['missing', null], ['refusing', refusingLocks]]) {
      const N = makeTab({ lockManager });
      await unlockIn(N, P1);
      const before = localStorage.getItem(VAULT_KEY);
      const codes = [
        await codeOf(N.t.persist()),
        await codeOf(N.t.Journal.save(() => N.t.state.vault, () => [entry('N')], () => new Set(), N.t.sessionGuard())),
        await codeOf(N.t.Vault.create(P2, payload, { auth: N.t.sessionGuard(), expect: N.t.state.vault.header })),
      ];
      check(`V4-02 Web Locks ${label}: every vault write is refused and nothing changes`,
        codes.join(',') === 'NO_LOCKS,NO_LOCKS,NO_LOCKS' && localStorage.getItem(VAULT_KEY) === before && (await opensWith(N, P1)) && !(await opensWith(N, P2)), codes.join(','));
      if (label === 'missing') check('V4-02 encrypted storage is not offered without Web Locks', N.t.secureStorageSupported() === false && F.t.secureStorageSupported() === true);
    }
    // The review's interleaving: a lock-less tab checks the old record, then pauses in encryption while a tab with
    // locks changes the password. The lock-less write can't proceed, so the new password keeps working.
    const N = makeTab({ lockManager: null });
    await unlockIn(N, P1);
    const stale = codeOf(N.t.persist());
    const rekey = await codeOf(F.t.Vault.create(P2, payload, { auth: F.t.sessionGuard(), expect: F.t.state.vault.header, onCommit: (v) => { F.t.state.vault = v; } }));
    check('V4-02 a lock-less tab can’t roll back a password change',
      (await stale) === 'NO_LOCKS' && rekey === 'none' && (await opensWith(F, P2)) && !(await opensWith(F, P1)), `lock-less write ${await stale}, password change ${rekey}`);
    const E = makeTab({ lockManager: null });
    await E.t.eraseStored();
    check('V4-02 erasing still works without Web Locks', localStorage.getItem(VAULT_KEY) === null);
  }

  // V4-05: an unlock whose record is deleted while its reload key is being stored (IndexedDB still busy, the erase's
  // event not yet delivered) is not adopted, and the key it just stored is deleted.
  {
    const made = await F.t.Vault.create(P1, payload, { auth: F.t.sessionGuard(), expect: null });
    F.t.state.vault = { key: made.key, header: made.header };
    F.t.Resume.purge();
    await settle();
    const H = makeTab();
    let saved = null;
    shared.onIdbPut = () => { shared.onIdbPut = null; saved = localStorage.getItem(VAULT_KEY); localStorage.removeItem(VAULT_KEY); };
    const code = await codeOf(H.t.Vault.open(P1, { auth: H.t.sessionGuard() }));
    await settle();
    check('V4-05 an unlock whose record vanished during the reload-key save is not adopted and keeps no reload key',
      code === 'CANCELLED' && Boolean(saved) && !H.session.get(RESUME_KEY) && resumeRecords() === 0, `code ${code}, records ${resumeRecords()}`);
    localStorage.setItem(VAULT_KEY, saved);
    // Vault.still: the adoption check accepts this tab's own journal changes, not an erase or an account change.
    const header = F.t.Vault.readHeader();
    await F.t.Journal.save(() => ({ key: made.key, header }), () => [entry('S')], () => new Set(), F.t.sessionGuard());
    const afterJournal = F.t.Vault.still(header);
    F.t.state.vault = { key: made.key, header };
    await F.t.persist();
    const afterAccounts = F.t.Vault.still(header);
    localStorage.removeItem(VAULT_KEY);
    check('V4-05 the adoption check: journal change ok; account change or erase not', afterJournal && !afterAccounts && !F.t.Vault.still(F.t.state.vault.header));
  }

  // Address book: contacts go into the sealed payload and come back validated (invalid or duplicate entries dropped).
  {
    const kat = 'BZBQFLLBNCXEMGLOBHUVFTLUPLVCPQUASSILFABOFFBCADQSSUPNWLZBQEXK';
    const other = 'IVLONFAFVZIRMEBQALCHIUREXODDLDMSZHPQTSIUJGMQUNZCYNXBZHQGYHTO';
    F.t.state.contacts = [{ id: '0123456789abcdef', name: 'Bitget deposit', identity: kat, createdAt: 1 }];
    const back = F.t.restoreAccounts({ ...F.t.vaultPayload(), contacts: [...F.t.vaultPayload().contacts,
      { id: '0123456789abcdee', name: 'Dup', identity: kat, createdAt: 2 },
      { id: 'zz', name: 'Bad id', identity: other, createdAt: 3 },
      { id: '0123456789abcded', name: 'Bad address', identity: other.replace(/^I/, 'J'), createdAt: 4 },
      { id: '0123456789abcdec', name: '\u0007Friend\u0000', identity: other, createdAt: 5 }] });
    const got = back.contacts.map((c) => `${c.name}:${c.identity.slice(0, 4)}`).join(',');
    check('Address book entries survive the vault round trip; invalid and duplicate ones are dropped', got === 'Bitget deposit:BZBQ,Friend:IVLO', got);
    // Avatars: a chosen colour and finish come back as saved; anything else falls back to automatic.
    const acct = (id, avatar) => ({ id, name: 'W', kind: 'watch', identity: id.endsWith('1') ? kat : other, createdAt: 1, avatar });
    const looks = F.t.restoreAccounts({ v: 1, accounts: [acct('00000000000000a1', { color: 3, finish: 'aqua' }), acct('00000000000000a2', { color: 99, finish: 'glitter' })], selection: 'all' })
      .accounts.map((a) => JSON.stringify(a.avatar)).join(' ');
    check('A chosen avatar survives the vault round trip; invalid choices fall back to automatic', looks === '{"color":3,"finish":"aqua"} null', looks);
  }


  // V5-1: a new wallet erased in another tab while its reload key is being stored (that tab's notice not yet here):
  // creating it fails (GONE), so the caller never goes on with a key for a wallet that's gone, and no reload key stays.
  {
    F.t.Resume.purge();
    await settle();
    localStorage.removeItem(VAULT_KEY);
    const J = makeTab();
    shared.onIdbPut = () => { shared.onIdbPut = null; localStorage.removeItem(VAULT_KEY); };
    const code = await codeOf(J.t.Vault.create(P1, payload, { auth: J.t.sessionGuard(), expect: null }));
    await settle();
    check('V5-1 a new wallet erased while its reload key was stored is refused; no key or reload key is kept',
      code === 'GONE' && !J.session.get(RESUME_KEY) && resumeRecords() === 0 && localStorage.getItem(VAULT_KEY) === null,
      `code ${code}, records ${resumeRecords()}`);
  }

  // The wallet never installs a service worker (CSP worker-src 'none'), so one on its address came from
  // another page served there. At startup the wallet refuses to open while one serves the page or is registered.
  {
    const W = makeTab();
    const sw = (over) => { W.navigator.serviceWorker = { controller: null, getRegistrations: async () => [], ...over }; };
    const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms, 'still waiting'))]);
    check('a browser without service workers opens the wallet', (await W.t.foreignWorker()) === false);
    sw({});
    check('no service worker on this address: the wallet opens', (await W.t.foreignWorker()) === false);
    sw({ controller: { scriptURL: 'http://127.0.0.1:47213/sw.js' } });
    check('a page served through a service worker is refused', (await W.t.foreignWorker()) === true);
    sw({ getRegistrations: async () => [{ scope: 'http://127.0.0.1:47213/elsewhere/' }] });
    check('a service worker registered on this address is refused, even one not serving this page', (await W.t.foreignWorker()) === true);
    sw({ getRegistrations: () => Promise.reject(Object.assign(new Error('blocked'), { name: 'SecurityError' })) });
    const rejected = await W.t.foreignWorker();
    Object.defineProperty(W.navigator, 'serviceWorker', { configurable: true, get() { throw Object.assign(new Error('insecure'), { name: 'SecurityError' }); } });
    const threw = await W.t.foreignWorker();
    delete W.navigator.serviceWorker;
    check('a browser that can’t list workers doesn’t keep the wallet closed', rejected === false && threw === false);
    sw({ getRegistrations: () => new Promise(() => {}) });
    const hung = await within(W.t.foreignWorker(50), 1000);
    check('a listing that never answers doesn’t hold up startup', hung === false, String(hung));
    // "Remove it and reload": a stand-in registry of workers on the address.
    const registry = new Set();
    const reg = (removable, listedAfter = false) => {
      const r = { unregister: async () => { if (removable && !listedAfter) registry.delete(r); return removable; } };
      registry.add(r);
    };
    sw({ getRegistrations: async () => [...registry] });
    reg(true); reg(true);
    const removed = await W.t.removeWorkers();
    check('Remove it unregisters every worker on this address', removed === true && registry.size === 0, `left ${registry.size}`);
    reg(false);
    check('a worker that stays is reported, not taken as removed', (await W.t.removeWorkers()) === false && registry.size === 1);
    registry.clear();
    reg(true, true); // unregistered, but still listed while it controls this page
    check('a worker that confirms its removal counts as removed, even while the browser still lists it', (await W.t.removeWorkers()) === true);
    sw({ getRegistrations: () => new Promise(() => {}) });
    const stuck = await within(W.t.removeWorkers(50), 1000);
    check('a removal the browser never answers ends, so the screen can say how to remove it by hand', stuck === false, String(stuck));
    delete W.navigator.serviceWorker;
    check('the page can’t install a worker of its own (CSP worker-src none, and no register call in the app)',
      fs.readFileSync(path.join(SRC, 'assemble.py'), 'utf8').includes('"worker-src \'none\'"')
      && !fs.readdirSync(path.join(SRC, 'js')).some((f) => fs.readFileSync(path.join(SRC, 'js', f), 'utf8').includes('serviceWorker.register')));
  }
  // Where boot runs the check: awaited, right after the frame refusal and before anything else starts (a listener, the
  // self-test, the heartbeat, a resume, a read of the saved wallet, a screen), and its refusal forgets the reload key.
  {
    const b = bootSrc.text;
    const line = b.indexOf('if (await foreignWorker())');
    const framed = b.indexOf('if (isFramed())');
    const later = ['noteActivity', "addEventListener('visibilitychange'", "addEventListener('pagehide'", "addEventListener('online'",
      "addEventListener('storage'", 'runSelfTest()', 'setInterval(heartbeat', 'Vault.exists()', 'resumeWallet()', 'showUnlock(', 'showWelcome('];
    const early = later.filter((s) => b.indexOf(s) < 0 || b.indexOf(s) < line);
    check('boot awaits the service-worker check right after the frame refusal, before any listener, self-test, resume or saved-wallet read',
      framed >= 0 && line > framed && !early.length, line < 0 ? 'no awaited check' : early.join(', '));
    const refusal = line < 0 ? '' : b.slice(line, b.indexOf('\n', line));
    check('the refusal forgets the reload key, shows the refusal screen and starts nothing else',
      /\{ Resume\.clear\(\); showWorkerRefusal\(\); return; \}$/.test(refusal), refusal.trim());
    const noLib = b.indexOf('if (!Q || !QR) {');
    const noLibBlock = noLib < 0 ? '' : b.slice(noLib, b.indexOf('\n  }\n', noLib));
    check('when the libraries didn’t start, boot still runs the worker check first and its refusal forgets the reload key',
      /const foreign = await foreignWorker\(\);\n\s+if \(foreign\) \{ Resume\.clear\(\); showWorkerRefusal\(\); \}/.test(noLibBlock), noLibBlock.split('\n').slice(0, 3).join(' | '));
  }

  finish('lifecycle');
})().catch(harnessError);
