// Taking in an opened vault (src/js 00–06 + the vendored bundle): adoptVault, as used by unlock and by the reload
// resume, run for real through resumeWallet while an older journal is migrated (a write the adoption waits on). Each
// "tab" is its own VM context with its own state and sessionStorage; tabs share one localStorage, one IndexedDB
// stand-in and one Web Locks stand-in. Screens are stubbed. KDF cost is lowered for speed (the code path is unchanged).
// Usage: node adopt.cjs <build dir> <src dir>     MUTATE=<name> (the mutation lines below) puts one fixed fault back.
// Also the look-alike check (05 fetchSentTo; 06 noteSent, loadSent, loadKnownAddresses, lookalikeOf, lookalikeWarnings;
// Review's holdForCheck and Add address's saveAnyway, taken from the UI files): what counts as an address you know,
// how each seed account's outgoing transfers are read and kept, and what is waited for, said or asked while they're
// missing. The archive is a fetch stub that pages like getTransactionsForIdentity and applies (or ignores) the source
// filter.
const { VAULT_KEY, RESUME_KEY, shared, localStorage, resumeRecords, appSource, makeTab: newTab, settle } = require('./lib/tabs.cjs');
const { check, finish, harnessError } = require('./lib/check.cjs');
const { pickFunction } = require('./lib/load.cjs');
const [BUILD, SRC] = process.argv.slice(2);
// Plus how Activity reads a transaction (describeTx, txLook), Review's hold for the look-alike check (holdForCheck),
// Add address's questions before saving (saveAnyway) and the send itself (executeSend, broadcastRecord), taken from the
// UI files, which need a page to load whole.
const app = appSource(BUILD, SRC, ['00-config.js', '01-util.js', '01b-i18n.js', '03-qubic.js', '04-storage.js', '05-net.js', '06-store.js'],
  [['09-dashboard.js', 'describeTx'], ['09-dashboard.js', 'txLook'], ['10a2-send-review.js', 'holdForCheck'], ['10c-contacts.js', 'saveAnyway'],
    ['10a3-send-execute.js', 'executeSend'], ['10a3-send-execute.js', 'broadcastRecord']]);
app.mutation('no-drop', '    if (taken && state.accounts === taken) dropSecrets();', '');
app.mutation('no-owner', '    if (taken && state.accounts === taken) dropSecrets();', '    if (taken) dropSecrets();');
app.mutation('no-cancel', "    if (!auth()) {\n      abandon();\n      Resume.drop(made.resumeTag);", "    if (false) {\n      abandon();\n      Resume.drop(made.resumeTag);");
app.mutation('erase-late', '  dropSecrets();\n  state.phase = \'welcome\';\n  await eraseStored();', '  state.phase = \'welcome\';\n  await eraseStored();\n  dropSecrets();');
app.mutation('erase-unchecked', '  const gone = Vault.absent();', '  const gone = true;');
// A cancelled new wallet: compared by its accounts part only (another tab's journal update is lost), or a failed or
// declined delete left unsaid.
app.mutation('discard-accounts', '        if (now !== mine) return instead();', '        if (!sameAccounts(Vault.current(), record)) return instead();');
app.mutation('discard-silent', "  if (left !== 'kept' && left !== 'failed') return;", '  return;');
// Settling on account-level records that may have started afresh (finding 1, and its parts: a record Core no longer
// holds, a deposit in the transfer's own tick), on the archive's false (the review of 21 Oct), success from the
// account's record (finding 2), Activity showing the archive's flag over the settlement, and zero amounts restored.
const FAIL_LINE = "  if (out < targetTick && unbrokenSince(live, targetTick)) return { status: 'failed' };";
const UNBROKEN = 'const unbrokenSince = (live, tick) => live.incoming > 0n && live.lastInTick < tick;';
app.mutation('fail-on-account', FAIL_LINE, "  if (out < targetTick) return { status: 'failed' };");
app.mutation('fail-on-flag', FAIL_LINE, "  if (out < targetTick && (evidence.moneyFlew === false || unbrokenSince(live, targetTick))) return { status: 'failed' };");
app.mutation('fail-when-gone', UNBROKEN, 'const unbrokenSince = (live, tick) => live.lastInTick < tick;');
app.mutation('same-tick-deposit', UNBROKEN, 'const unbrokenSince = (live, tick) => live.incoming > 0n && live.lastInTick <= tick;');
app.mutation('send-on-account', "  return { status: 'unknown', note: UNSETTLED_NOTES[evidence.moneyFlew === false ? 'flagOnly' : 'noEvidence'] };",
  "  return out === targetTick ? { status: 'success' } : { status: 'unknown', note: UNSETTLED_NOTES.noEvidence };");
app.mutation('flag-row', '  return own ? own.status : archivedStatus(tx);', '  return archivedStatus(tx);');
// The archive's false shown as "failed" again once this session's settlement is gone (the review of 22 Oct).
app.mutation('flag-failed', "    if (tx.moneyFlew !== true) return 'unknown';", "    if (tx.moneyFlew !== true) return tx.moneyFlew === false ? 'failed' : 'unknown';");
// Settling on an archive record that isn't the transfer signed here, or on "not found" without a processed tick or a
// whole, well-formed tick list (or despite a list that contains it).
app.mutation('sent-unchecked', '    if (!sameAsSigned(tx, p.hash, p.encoded)) {', '    if (false) {');
app.mutation('same-loose-signature', '    && Boolean(sig) && bytesEqual(sig, s.signature);', ';');
app.mutation('absent-unprocessed', "    if (!intervals.some((iv) => tick >= iv.firstTick && tick <= iv.lastTick)) return 'unknown';\n", '');
app.mutation('absent-loose-list', '  if (list.length > TRANSACTIONS_PER_TICK || !list.every(isHash) || new Set(list).size !== list.length) return null;',
  '  if (list.length > TRANSACTIONS_PER_TICK) return null;');
app.mutation('absent-other-tick', '  if (!td || td.tickNumber !== tick || !Array.isArray(td.transactionHashes)) return null;', '  if (!td || !Array.isArray(td.transactionHashes)) return null;');
app.mutation('present-ignored', "    return hashes.includes(hash) ? 'present' : 'absent';", "    return 'absent';");
// Broadcast without waiting for the journal write (so a failed one doesn't stop it), or after a lock that came in once
// it had landed.
app.mutation('broadcast-unjournalled', '      await saveJournal({ strict: true });', '      saveJournal({ strict: true }).catch(() => {});');
app.mutation('broadcast-after-lock', "    if (!alive()) throw new AppError('LOCKED', trLater('The wallet locked before sending. Nothing was broadcast.'));\n    changed();", '    changed();');
// Fake deposits: the archive's flag read for input type 0 only, as in an earlier version, or for
// every address but a contract's (a watched contract then still takes in calls that moved nothing as received); money
// coming in shown as received while unconfirmed: by the status rule, by direction alone, or given its dollar value.
const MOVED_LINE = '  if (tx.amount > 0n || sendMany) {';
app.mutation('flag-by-type', MOVED_LINE, '  if ((tx.inputType === 0 && tx.amount > 0n) || sendMany) {');
app.mutation('contract-call-unflagged', MOVED_LINE, "  if ((tx.amount > 0n && (tx.inputType === 0 || identityKind(tx.destination) !== 'contract')) || sendMany) {");
app.mutation('credit-unconfirmed', "const wentThrough = (tx) => ['success', 'executed'].includes(txStatus(tx));", "const wentThrough = (tx) => txStatus(tx) !== 'failed';");
app.mutation('received-by-dir', "  const received = dir === 'in' && wentThrough(tx);", "  const received = dir === 'in';");
app.mutation('valued-unconfirmed', "  const doubtful = (info.dir === 'in' || info.dir === 'self') && !wentThrough(tx);", '  const doubtful = false;');
// The seed generator trusting a broken random generator: no look at it first, or no check of the seed it made.
app.mutation('rng-unchecked', "  if (randomLooksBroken()) throw new AppError('RANDOM');\n", '');
app.mutation('rng-rejected-bytes', ' || s.every((x) => x >= 234)', '');
app.mutation('seed-unchecked', "  if (checkSeed(seed).state !== 'valid') throw new AppError('RANDOM');\n", '');
app.mutation('zero-restored', "      if (amount <= 0n || amount > MAX_AMOUNT || d.inputType !== 0 || d.payload.length) continue;", '');
// Removing an account while a transfer from it is unsettled, and a journalled transfer whose account has gone
// skipped again on restore (so that seed, imported again, could send before it settles, and a migration dropped it).
app.mutation('remove-open', "    if (hasOpenTransfer(state.accounts[i].identity)) throw new AppError('REMOVE_BUSY');\n", '');
app.mutation('restore-gone-sender', '      if (hash !== e.hash || !Q.verifyTransactionSignature(bytes) || state.pending.some((p) => p.hash === hash)) continue;',
  '      if (hash !== e.hash || !acct || !Q.verifyTransactionSignature(bytes) || state.pending.some((p) => p.hash === hash)) continue;');
// Journal sync without its guards: any stored record, and results applied whatever session is open by then.
app.mutation('sync-unguarded', '  if (!record.pending || !sameAccounts(record, state.vault.header)) return;', '  if (!record.pending) return;');
app.mutation('sync-unguarded', '  const ours = () => auth() && state.vault === vault;', '  const ours = () => true;');
app.mutation('sync-unguarded', 'if (!ours() || !Vault.still(record)) return;', 'if (!ours()) return;');
// Account changes: the account limit checked before an upgrade (which adds no account), and a removal whose save fails
// left undrawn. Price history asked for with market data off.
app.mutation('limit-first', 'async function addAccount(draft) {\n  return editWallet(async () => {\n    const account = buildAccount(draft);',
  "async function addAccount(draft) {\n  return editWallet(async () => {\n    if (state.accounts.length >= MAX_ACCOUNTS) throw new AppError('LIMIT');\n    const account = buildAccount(draft);");
app.mutation('remove-silent', '    try { await persist(); } finally { changed(); }\n  });\n}', '    await persist();\n    changed();\n  });\n}');
app.mutation('price-unguarded', '  if (!state.prefs.marketData || !(age >= 0)) return null;', '  if (!(age >= 0)) return null;');
// Giving up on a transfer as unknown (which can then be marked as checked) before the network has passed its
// tick and the archive has processed it; marking one as checked before then, or on the archive alone, or at the tick
// itself; the send claim (and its cross-tab lock) dropped after 15 minutes while the transfer is still open; and a
// stalled tick shown as moving, or any repeat of a tick shown as a stall.
app.mutation('give-up-early', "      if (stale && pastTarget(p)) finalizePending(p, 'unknown');", "      if (stale) finalizePending(p, 'unknown');");
app.mutation('dismiss-early', "  if (p.status !== 'unknown' || !pastTarget(p)) return false;", "  if (p.status !== 'unknown') return false;");
app.mutation('dismiss-unarchived', '  && archive.tick != null && archive.tick >= p.targetTick;', ';');
app.mutation('dismiss-tickless', 'Number.isSafeInteger(p.targetTick) && state.net.tick != null && state.net.tick > p.targetTick',
  'Number.isSafeInteger(p.targetTick)');
app.mutation('dismiss-at-tick', 'state.net.tick > p.targetTick', 'state.net.tick >= p.targetTick');
const RENEW_LINE = '    if (state.pending.some((p) => p.from === identity && isOpenTransfer(p) && !pastTarget(p))) armBackstop(identity, claim);';
app.mutation('claim-backstop', `${RENEW_LINE}\n    else releaseSend(identity);`, '    releaseSend(identity);');
// The lock renewed past the transfer's tick too (it can't execute any more, so another tab would be kept out for nothing).
app.mutation('claim-past-tick', RENEW_LINE, RENEW_LINE.replace(' && !pastTarget(p)', ''));
app.mutation('stall-unseen', '      if (n.tick == null || t.tick > n.tick) n.movedAt = now;', '      n.movedAt = now;');
app.mutation('stall-instant', '  return ms > TICK_STALL_MS ? ms : 0;', '  return ms;');
// The look-alike check: the outgoing read without its source filter (dust can push a payee out of it again); only the
// accounts on screen read; transfers signed here left out; an address you know never flagged (being known cleared
// it); an account still loading passed in silence; and a hold in progress kept when what the check says changes.
app.mutation('history-total-lenient', '!d.hits || !isUint(d.hits.total) ||', '!d.hits ||');
app.mutation('history-total-lenient', 'return { txs, total: d.hits.total, validForTick', 'return { txs, total: uintOr0(d.hits.total), validForTick');
app.mutation('sent-unfiltered', 'fetchHistory(identity, offset, FULL_HISTORY_PAGE, { source: identity })', 'fetchHistory(identity, offset, FULL_HISTORY_PAGE)');
app.mutation('lookalike-scope-only', 'const next = () => seedAccounts().find(', "const next = () => scopeAccounts().filter((a) => a.kind === 'seed').find(");
// Every call starting a run of its own (a run per change while Send is open); a run from before a lock joined after
// it; a run that reads only the accounts due when it started; one that reads an account again (in an outage where
// reads fail slowly it never ends); one that starts while the old run's reads are still going; and those old reads going
// on past their page, keeping what they read, or keeping their failure.
app.mutation('known-run-unshared', '  if (knownRun && knownRun.session === state.session) return knownRun.done;\n', '');
app.mutation('known-run-across-sessions', 'if (knownRun && knownRun.session === state.session) return', 'if (knownRun) return');
// Money arriving: said for what the first read already had, before the archive says it moved, twice, or for a watched
// address.
app.mutation('arrivals-from-start', '  if (d.arrivedFrom === null) { d.arrivedFrom = txs.reduce((m, t) => Math.max(m, t.tick), 0); return; }', '  if (d.arrivedFrom === null) d.arrivedFrom = 0;');
app.mutation('arrivals-unmoved', '    && !d.announced.has(t.hash) && !accountByIdentity(t.source) && wentThrough(t));', '    && !d.announced.has(t.hash) && !accountByIdentity(t.source));');
app.mutation('arrivals-twice', '  for (const t of fresh) d.announced.add(t.hash);\n', '');
app.mutation('arrivals-after-lock', '      if (!alive()) return;\n      const before = { txs: d.history, total: d.historyTotal };\n',
  '      const before = { txs: d.history, total: d.historyTotal };\n');
app.mutation('arrivals-after-lock', '      if (!more && state.accounts.includes(account)) noteArrivals', '      if (!more) noteArrivals');
app.mutation('arrivals-watched', "  if (account.kind !== 'seed') return;\n  if (d.arrivedFrom === null)", '  if (d.arrivedFrom === null)');
// Send's "sent here" line: "haven't sent" said before every account's outgoing transfers are read, or about your own.
app.mutation('sent-here-early', "  return sentGaps().length ? null : tr('You haven’t sent to this address before.');", "  return tr('You haven’t sent to this address before.');");
app.mutation('sent-here-own', '  if (!isId(identity) || accountByIdentity(identity)) return null;', '  if (!isId(identity)) return null;');
// The full history read again in full for every new transaction (as it was), or at once past a gap.
app.mutation('full-no-topup', '      const topped = fullTopUp(d);', '      const topped = null;');
app.mutation('full-unthrottled', '  return Boolean(fullTopUp(d)) || Date.now() - d.full.at >= (d.full.capped ? FULL_HISTORY_CAPPED_MS : FULL_HISTORY_MIN_MS);', '  return true;');
app.mutation('known-run-snapshot', '  const next = () => seedAccounts().find((a) => !run.tried.has(a.identity) && sentDue(dataFor(a.identity)));',
  '  const due = seedAccounts().filter((a) => sentDue(dataFor(a.identity)));\n  const next = () => due.shift();');
app.mutation('known-run-retries', '!run.tried.has(a.identity) && sentDue', 'sentDue');
app.mutation('known-run-overlap', '(prev ? prev.done.then(start) : start())', 'start()');
app.mutation('sent-read-past-lock', '    if (!alive()) break;\n', '');
app.mutation('sent-kept-past-lock', '      if (!alive()) return; // a lock', '      // a lock');
app.mutation('sent-failed-past-lock', '{ if (alive()) { d.sentErr = e; d.sentErrAt = Date.now(); } }', '{ d.sentErr = e; d.sentErrAt = Date.now(); }');
// The message check leaving out watch-only accounts' addresses; Review's hold sending without the check's guard.
app.mutation('scope-no-watch', 'identities: state.accounts.filter((a) => !a.seed).map((a) => a.identity) };', 'identities: [] };');
app.mutation('check-not-offered', '  hold.check = () => { const at = keyOf(lookalikeWarnings(to, since)); return () => keyOf(lookalikeWarnings(to, since)) === at; };\n', '');
app.mutation('switch-reseals', "  if (state.mode === 'vault') setPref('selection', selection); else changed();\n  refreshAll();\n}",
  "  changed();\n  refreshAll();\n  editWallet(() => persist()).catch(() => {});\n}");
app.mutation('guard-sends-anyway', '    if (read.stale() || (asked && !asked())) { hold.reset(); repaint(); return false; }\n', '');
// Review's dialog: the guard not checking what the check said as the question was asked.
app.mutation('guard-asked-ignored', 'if (read.stale() || (asked && !asked())) {', 'if (read.stale()) {');
app.mutation('sent-no-pending', '  for (const p of state.pending) if (p.hash) ids.add(p.to);\n', '');
app.mutation('sent-no-pending', '  for (const p of state.pending) if (p.hash && p.to === identity) hashes.add(p.hash);\n', '');
app.mutation('lookalike-known-silent', '  let best = null;\n  for (const k of ids) {',
  '  if (ids.has(identity)) return null;\n  let best = null;\n  for (const k of ids) {');
app.mutation('lookalike-loading-silent', ": d.sentErr && !d.inflight.sent ? 'failed' : 'loading';", ": d.sentErr && !d.inflight.sent ? 'failed' : null;");
app.mutation('hold-not-cancelled', '    if (said !== null && key !== said) hold.cancel();\n', '');
// A hold that completes in the moment between a new warning and the repaint that would cancel it.
app.mutation('hold-stale-ignored', '  read.stale = () => { const check = lookalikeWarnings(to, since); return check.waiting || keyOf(check) !== said; };',
  '  read.stale = () => false;');

// ── Tabs ────────────────────────────────────────────────────────────────────
const STUBS = `
  let flow = null;
  const closeAllSheets = () => {};
  const toasts = [];
  const toast = (m, kind) => { toasts.push({ m, kind }); };
  const statusShown = [];
  const sendStatus = (sheet, record) => { statusShown.push(record); };
  const showUnlock = () => { state.phase = 'locked'; };
  const showWelcome = () => { state.phase = 'welcome'; };
  const enterWallet = () => { state.phase = 'ready'; };
  const partyName = (identity) => identity.slice(0, 5);
  // Payments said to have arrived (see noteArrivals), as [account name, hashes].
  const arrivals = [];
  const announceArrivals = (account, txs) => { arrivals.push([account.name, txs.map((t) => t.hash)]); };
  // Add address's questions (see saveAnyway): each waits in dialogs until a check answers it.
  const dialogs = [];
  const confirmDialog = (o) => new Promise((resolve) => { dialogs.push({ ...o, answer: resolve }); });
`;
// session: the sessionStorage map to use (a reload keeps the tab's). fetch: the network's answers (offline by default).
// timers: setTimeout / clearTimeout to use instead of the real ones (see fakeClock).
function makeTab({ session, fetch = async () => { throw new TypeError('offline'); }, timers = {} } = {}) {
  return newTab(app, `
    ${STUBS}
    ${app.text}
    state.prefs = { ...state.prefs, resumeOnReload: true, autoLockMinutes: 10 };
    state.selfTest = { status: 'pass', steps: [] };
    const legacyJournal = async (key, entries) => localStorage.setItem(STORAGE_KEYS.journal, JSON.stringify(await Vault.encrypt(key, utf8('qubic-wallet pending v1'), { v: 1, entries })));
    window.__t = { generateSeed, messageSeedScope, signMessage, state, Vault, Resume, resumeWallet, sessionGuard, nextSession, legacyJournal, Q, deriveAccount, startWallet, forgetEverything, dropSecrets, persist, syncJournal, toasts, ERROR_TEXT, settleTransfer, restorePending, hasOpenTransfer, isOpenTransfer, txStatus, parseTx, wentThrough, describeTx, txLook, addAccount, removeAccount, selectScope, subscribe, priceAt, adoptVault, lockWallet, claimSend, releaseSend, trackPending, dismissTransfer, loadTick, tickStall, archiveTick,
      dataFor, loadHistory, loadFullHistory, lookalikeOf, lookalikeText, lookalikeWarnings, loadKnownAddresses, holdForCheck, saveAnyway, dialogs, sentHereText, arrivals,
      executeSend, statusShown, Journal,
      LOOKALIKE_WAIT_MS, SENT_RETRY_MS };`,
  { session, extra: { setInterval, clearInterval, AbortController, fetch, requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), 0), ...timers } });
}
// Timers of a minute or more are held until fire() runs them (the 15-minute send backstop); shorter ones run as usual.
function fakeClock() {
  const held = new Map(); let next = 0;
  const timers = {
    setTimeout: (fn, ms, ...args) => { if (!(ms >= 60000)) return setTimeout(fn, ms, ...args); const id = `held-${++next}`; held.set(id, () => fn(...args)); return id; },
    clearTimeout: (id) => { if (held.has(id)) held.delete(id); else clearTimeout(id); },
  };
  const fire = () => { const due = [...held.values()]; held.clear(); for (const fn of due) fn(); };
  return { timers, fire };
}
// A network for one tab: tick-info answers net.tick in net.epoch (404 while net.down), getLastProcessedTick answers
// net.archive (404 when null), getProcessedTickIntervals answers net.intervals when given, and anything else is a 404,
// so no lookup finds a transfer: one past its tick and the give-up time can then only end as unknown. When given,
// getTransactionByHash answers net.tx, getTickData net.hashes (for the tick asked, or net.hashesTick), the live balance
// net.live and getEventLogs net.events.
const networkAt = (net) => async (url, init = {}) => {
  const body = (b, status = 200) => new Response(JSON.stringify(b), { status });
  const none = () => body({ code: 5, message: 'not found' }, 404);
  if (url.includes('tick-info')) return net.down ? none() : body({ tickInfo: { tick: net.tick, epoch: net.epoch || 200, duration: 1, initialTick: 1 } });
  if (url.includes('getLastProcessedTick')) return net.archive == null ? none() : body({ tickNumber: net.archive, epoch: net.epoch || 200 });
  if (url.includes('getProcessedTickIntervals') && net.intervals) return body(net.intervals);
  if (url.includes('getTransactionByHash') && net.tx) return body(net.tx);
  if (url.includes('getTickData') && net.hashes) return body({ tickData: { tickNumber: net.hashesTick ?? JSON.parse(init.body).tickNumber, transactionHashes: net.hashes } });
  if (url.includes('/live/v1/balances/') && net.live) return body({ balance: net.live });
  if (url.includes('getEventLogs') && net.events) return body({ eventLogs: net.events });
  return none();
};

const SEED = 'qwertyuiopasdfghjklzxcvbnmqwertyuiopasdfghjklzxcvbnmqwe'; // publicly known test seed, never funded here
const OTHER = 'IVLONFAFVZIRMEBQALCHIUREXODDLDMSZHPQTSIUJGMQUNZCYNXBZHQGYHTO';
const P1 = 'plum-orbit-candle-ferry'; const P2 = 'quartz-meadow-lantern-oak';
// A journal entry for a transfer from SEED to OTHER, signed 10 ticks before its target tick.
const journalEntry = async (Q, amount, targetTick, createdAt) => {
  const signed = await Q.signTransaction(Q.buildTransaction({ source: Q.deriveKeys(SEED).publicKey, destination: OTHER, amount, targetTick, inputType: 0, currentTick: targetTick - 10 }), SEED);
  return { hash: Q.computeTransactionHash(signed), encoded: Q.encodeTransaction(signed), startTick: targetTick - 10, createdAt };
};

// Nothing secret is left in the tab's state: no accounts (or seeds), key, address book or restored transfers.
const clean = (t, accounts) => t.state.accounts.length === 0 && t.state.vault === null && t.state.contacts.length === 0
  && t.state.pending.length === 0 && accounts.every((a) => a.seed === null);

(async () => {
  // A saved wallet with one seed account and one saved address, unlocked with "Stay unlocked on reload" on, plus a
  // journal left under the previous version's separate key (one signed transfer), which the next unlock migrates.
  async function setup() {
    shared.ls.clear(); shared.idb.clear();
    const A = makeTab();
    const { identity } = A.t.deriveAccount(SEED);
    const id = '0123456789abcdef';
    const payload = { v: 1, accounts: [{ id, name: 'Main', kind: 'seed', seed: SEED, identity, createdAt: 1 }], selection: id,
      contacts: [{ id: 'fedcba9876543210', name: 'Friend', identity: OTHER, createdAt: 1 }] };
    const made = await A.t.Vault.create(P1, payload, { auth: A.t.sessionGuard(), expect: null });
    await A.t.legacyJournal(made.key, [await journalEntry(A.t.Q, 5n, 90000000, 1)]);
    await settle();
    return { A, made, payload };
  }

  // Control: with nothing else going on, the reload resume takes the wallet in and migrates the journal.
  {
    const { A } = await setup();
    const B = makeTab({ session: A.session });
    const ok = await B.t.resumeWallet();
    check('control: a reload resume takes in the wallet and its old journal', ok === true && B.t.state.phase === 'ready' && B.t.state.accounts.length === 1
      && B.t.state.contacts.length === 1 && B.t.state.pending.length === 1 && localStorage.getItem('qubic-wallet.pending.v1') === null);
  }

  // V5-2, the review's case: the migration's write is under way when another tab's password change is announced
  // (the session moves on). The resume is abandoned, and nothing it loaded stays.
  {
    const { A } = await setup();
    const B = makeTab({ session: A.session });
    const pause = B.pauseNextEncrypt();
    const resumed = B.t.resumeWallet();
    await pause.atGate;
    const loaded = [...B.t.state.accounts];
    const hadSeed = loaded.length === 1 && loaded[0].seed === SEED;
    B.t.nextSession(); // what the storage event does
    pause.release();
    const ok = await resumed;
    await settle();
    check('V5-2 a resume cancelled during the journal migration keeps no seed, key or address book', ok === false && hadSeed && clean(B.t, loaded) && B.t.state.phase !== 'ready',
      `returned ${ok}, accounts ${B.t.state.accounts.length}, key ${B.t.state.vault ? 'kept' : 'gone'}`);
    check('V5-2 …and no reload key either', !B.session.get(RESUME_KEY) && resumeRecords() === 0, `records ${resumeRecords()}`);
  }

  // V5-2, its notice not yet delivered: another tab changes the password while this one is reading the old journal.
  // The migration's write is then refused (another key) and the final check sees a different record.
  {
    const { A, made, payload } = await setup();
    const B = makeTab({ session: A.session });
    const C = makeTab();
    const pause = B.pauseDecryptOf('qubic-wallet pending v1');
    const resumed = B.t.resumeWallet();
    await pause.atGate;
    const loaded = [...B.t.state.accounts];
    await C.t.Vault.create(P2, payload, { auth: C.t.sessionGuard(), expect: made.header });
    pause.release();
    const ok = await resumed;
    await settle();
    check('V5-2 a resume overtaken by a password change elsewhere (no notice yet) keeps nothing', ok === false && loaded.length === 1 && clean(B.t, loaded),
      `returned ${ok}, accounts ${B.t.state.accounts.length}`);
  }

  // The same for an erase in another tab (no notice yet).
  {
    const { A } = await setup();
    const B = makeTab({ session: A.session });
    const pause = B.pauseDecryptOf('qubic-wallet pending v1');
    const resumed = B.t.resumeWallet();
    await pause.atGate;
    const loaded = [...B.t.state.accounts];
    localStorage.removeItem(VAULT_KEY);
    pause.release();
    const ok = await resumed;
    await settle();
    check('a resume overtaken by an erase elsewhere (no notice yet) keeps nothing', ok === false && loaded.length === 1 && clean(B.t, loaded), `returned ${ok}`);
  }


  // ── Cancel imports: the screen that asked for a new wallet is left while it's being saved ─────────────────────────
  const draft = { kind: 'seed', name: 'Main', seed: SEED };
  {
    shared.ls.clear(); shared.idb.clear();
    const T = makeTab();
    let here = true;
    const pause = T.pauseNextEncrypt();
    const run = T.t.startWallet({ draft: { ...draft }, mode: 'vault', password: P1, auth: () => here }).then(() => 'opened', (e) => e.code);
    await pause.atGate;
    here = false;
    pause.release();
    const out = await run;
    await settle();
    check('cancel import, left before the write: nothing saved or kept, the wallet doesn’t open',
      out === 'CANCELLED' && localStorage.getItem(VAULT_KEY) === null && T.t.state.accounts.length === 0 && T.t.state.phase !== 'ready'
      && resumeRecords() === 0 && !T.session.get(RESUME_KEY), out);
  }
  {
    shared.ls.clear(); shared.idb.clear();
    const T = makeTab();
    let here = true;
    shared.onIdbPut = () => { shared.onIdbPut = null; here = false; };
    const out = await T.t.startWallet({ draft: { ...draft }, mode: 'vault', password: P1, auth: () => here }).then(() => 'opened', (e) => e.code);
    await settle();
    check('cancel import, left after the write: the record is deleted again; nothing kept, not opened',
      out === 'CANCELLED' && localStorage.getItem(VAULT_KEY) === null && T.t.state.accounts.length === 0 && T.t.state.phase !== 'ready'
      && resumeRecords() === 0 && !T.session.get(RESUME_KEY) && T.t.toasts.length === 0, out);
  }
  // Left after the write, and meanwhile another tab opened the new wallet and saved a transfer to its journal (the
  // accounts part unchanged): that is no longer the record written, so it stays; this tab says so and shows it locked.
  {
    shared.ls.clear(); shared.idb.clear();
    const T = makeTab();
    let here = true;
    shared.onIdbPut = () => {
      shared.onIdbPut = null;
      const rec = JSON.parse(localStorage.getItem(VAULT_KEY));
      rec.pending = { iv: 'AAAAAAAAAAAAAAAA', data: 'A'.repeat(40) }; // another tab's sealed journal part
      localStorage.setItem(VAULT_KEY, JSON.stringify(rec));
      here = false;
    };
    const out = await T.t.startWallet({ draft: { ...draft }, mode: 'vault', password: P1, auth: () => here }).then(() => 'opened', (e) => e.code);
    await settle();
    const kept = JSON.parse(localStorage.getItem(VAULT_KEY) || 'null');
    const said = T.t.toasts.some((x) => x.m === T.t.ERROR_TEXT.DISCARD_KEPT);
    check('cancel import, another tab updated the new wallet’s journal meanwhile: kept, said so, shown locked, nothing in memory',
      out === 'CANCELLED' && Boolean(kept && kept.pending) && said && T.t.state.phase === 'locked' && T.t.state.accounts.length === 0 && T.t.state.vault === null,
      `${out}, record ${kept ? 'kept' : 'deleted'}, told ${said}`);
  }
  // Left after the write, and the browser refuses the delete: reported (not a silent "cancelled"), and the wallet that
  // stays is shown as saved and locked.
  {
    shared.ls.clear(); shared.idb.clear();
    const T = makeTab();
    let here = true;
    shared.onIdbPut = () => { shared.onIdbPut = null; here = false; shared.failRemove = true; };
    const out = await T.t.startWallet({ draft: { ...draft }, mode: 'vault', password: P1, auth: () => here }).then(() => 'opened', (e) => e.code);
    shared.failRemove = false;
    await settle();
    const said = T.t.toasts.some((x) => x.m === T.t.ERROR_TEXT.DISCARD_FAILED && x.kind === 'err');
    check('cancel import, the browser refuses to delete the saved copy: reported, shown locked, nothing in memory',
      out === 'CANCELLED' && localStorage.getItem(VAULT_KEY) !== null && said && T.t.state.phase === 'locked' && T.t.state.accounts.length === 0 && T.t.state.vault === null,
      `${out}, told ${said}, phase ${T.t.state.phase}`);
  }

  // ── Cleanup belongs to its operation: an old resume failing late leaves a newer session alone ─────────────────────
  {
    const { A } = await setup();
    const B = makeTab({ session: A.session });
    const pause = B.pauseNextEncrypt(); // the old journal's migration write
    const resumed = B.t.resumeWallet();
    await pause.atGate;
    // Meanwhile the wallet locks, and a newer session opens with its own reload key.
    B.t.dropSecrets();
    const newer = { id: 'feedfacecafebeef', name: 'Newer', kind: 'watch', identity: OTHER, publicKey: null, createdAt: 2 };
    B.t.state.accounts = [newer]; B.t.state.vault = { key: 'newer-key', header: null }; B.t.state.phase = 'ready';
    const newerTag = await B.t.Resume.save(new Uint8Array(32).fill(7), B.t.sessionGuard());
    pause.release();
    const ok = await resumed;
    await settle();
    const saved = JSON.parse(B.session.get(RESUME_KEY) || 'null');
    check('an old resume failing late leaves the newer session’s accounts, key, journal state and reload key alone',
      ok === false && B.t.state.accounts.length === 1 && B.t.state.accounts[0] === newer && B.t.state.vault && B.t.state.vault.key === 'newer-key'
      && B.t.state.journalProblem === false && B.t.state.pending.length === 0 && Boolean(newerTag) && saved && saved.tag === newerTag && resumeRecords() === 1,
      `returned ${ok}, accounts ${B.t.state.accounts.length}, reload key ${saved ? 'kept' : 'gone'}`);
  }

  // ── Journal sync: another tab's journal update is taken in only from the record this session holds, and only into
  // this same session; a read still under way when the session ends changes nothing in the next one ───────────────
  // B holds the wallet (its old journal migrated); C, another tab with it open, seals a journal with one more transfer.
  async function ready() {
    const { A, payload } = await setup();
    const B = makeTab({ session: A.session });
    await B.t.resumeWallet();
    const C = makeTab();
    const o = await C.t.Vault.open(P1, { resume: false });
    const entries = [...o.pending, await journalEntry(C.t.Q, 7n, 90000100, 2)];
    const sealed = await C.t.Vault.encrypt(o.key, C.t.Vault.pendingAad(o.header), { v: 1, entries });
    const bytes = Buffer.from(sealed.data, 'base64'); bytes[3] ^= 1;
    const garbled = { iv: sealed.iv, data: bytes.toString('base64') };
    const pendingAad = Buffer.from(Array.from(B.t.Vault.pendingAad(o.header))).toString();
    return { B, C, o, sealed, garbled, pendingAad, account: payload.accounts[0] };
  }
  // Another tab's journal write: the same record with a new journal part (its notice is delivered by calling
  // syncJournal).
  const withJournal = (pending) => { const rec = JSON.parse(localStorage.getItem(VAULT_KEY)); rec.pending = pending; localStorage.setItem(VAULT_KEY, JSON.stringify(rec)); };
  {
    const { B, sealed } = await ready();
    withJournal(sealed);
    B.t.syncJournal();
    await settle();
    check('journal sync: another tab’s new transfer is taken in by the session holding that wallet',
      B.t.state.pending.length === 2 && B.t.state.journalProblem === false, `pending ${B.t.state.pending.length}`);
  }
  {
    const { B, garbled } = await ready();
    withJournal(garbled);
    B.t.syncJournal();
    await settle();
    check('journal sync: an unreadable journal from another tab pauses sending in that session', B.t.state.journalProblem === true);
  }
  {
    const { B, garbled, pendingAad } = await ready();
    const gate = B.pauseDecryptOf(pendingAad);
    withJournal(garbled);
    B.t.syncJournal();
    await gate.atGate;
    B.t.dropSecrets(); // the wallet locks, and a newer session opens
    B.t.state.mode = 'vault'; B.t.state.phase = 'ready'; B.t.state.vault = { key: 'newer-key', header: null };
    gate.release();
    await settle();
    check('journal sync: a read failing after its session ended doesn’t pause sending in the next one', B.t.state.journalProblem === false);
  }
  {
    const { B, sealed, pendingAad, account } = await ready();
    const gate = B.pauseDecryptOf(pendingAad);
    withJournal(sealed);
    B.t.syncJournal();
    await gate.atGate;
    B.t.dropSecrets(); // the wallet locks, and a session-only wallet with the same seed opens
    B.t.state.accounts = [{ ...account }]; B.t.state.selection = account.id; B.t.state.mode = 'session'; B.t.state.phase = 'ready';
    gate.release();
    await settle();
    check('journal sync: transfers read after their session ended aren’t restored into the next one', B.t.state.pending.length === 0, `pending ${B.t.state.pending.length}`);
  }
  {
    const { B, C, o } = await ready();
    await C.t.Vault.create(P2, o.payload, { auth: C.t.sessionGuard(), expect: C.t.Vault.current(), carry: async () => o.pending });
    B.t.syncJournal(); // an earlier journal-only notice, handled once the record has been re-keyed elsewhere
    await settle();
    check('journal sync: a record re-keyed elsewhere isn’t read with the old key (no false “unreadable”)',
      B.t.state.journalProblem === false && B.t.state.phase === 'ready');
  }

  // ── Settling a transfer: sent only on evidence about this transaction, failed only on Core's record of its account
  // when that record can't have started afresh; otherwise it stays unknown, send block kept ──
  {
    const T0 = 90000000;
    const from = makeTab().t.deriveAccount(SEED).identity;
    const hash = 'b'.repeat(60);
    // A route is a JSON body (200), or a function: it may return a Response, or throw (the network failing).
    const answer = (routes, asked) => async (url) => {
      const hit = Object.keys(routes).find((k) => url.includes(k));
      if (hit) asked.push(hit);
      if (hit && typeof routes[hit] === 'function') return routes[hit]();
      return new Response(JSON.stringify(hit ? routes[hit] : { code: 5, message: 'not found' }), { status: hit ? 200 : 404 });
    };
    // The account's live record: by default Core holds it and its last deposit came well before the transfer's tick.
    const settleWith = async ({ lastOut, lastIn = T0 - 500, incoming = '1000', moneyFlew = null, logs = [] }) => {
      const asked = [];
      const T = makeTab({ fetch: answer({
        [`balances/${from}`]: { balance: { id: from, balance: '10', validForTick: T0 + 9, latestOutgoingTransferTick: lastOut, latestIncomingTransferTick: lastIn, incomingAmount: incoming } },
        getEventLogs: typeof logs === 'function' ? logs : { hits: { total: logs.length }, eventLogs: logs },
      }, asked) });
      T.t.state.net.tick = T0 + 20;
      const p = { hash, from, to: OTHER, amount: 5n, targetTick: T0, status: 'confirming', createdAt: Date.now() };
      T.t.state.pending = [p];
      await T.t.settleTransfer(p, { included: true, moneyFlew, event: null }, () => true);
      return { status: p.status, blocked: T.t.hasOpenTransfer(from), asked: asked.join(','), t: T.t };
    };
    const show = (r) => `${r.status}, ${r.blocked ? 'send blocked' : 'send free'}, asked ${r.asked}`;
    const event = { tickNumber: T0, transactionHash: hash, logType: 0, quTransfer: { source: from, destination: OTHER, amount: '5' } };
    const flagged = await settleWith({ lastOut: T0, moneyFlew: true });
    check('moneyFlew true settles as sent without asking the log', flagged.status === 'success' && !flagged.blocked && flagged.asked === `balances/${from}`, show(flagged));
    const logged = await settleWith({ lastOut: T0, logs: [event] });
    check('no moneyFlew: Core’s log of this transfer settles it as sent', logged.status === 'success' && logged.asked.endsWith('getEventLogs'), show(logged));
    // Finding 2: a pruned zero-amount transaction of the same key moved the outgoing tick, so this one looks like the
    // account's only transaction there. No transaction-specific evidence: unknown, its send block kept.
    const pruned = await settleWith({ lastOut: T0 });
    check('finding 2: QUBIC gone at its tick, no flag, no log → unknown with the send block kept, never sent', pruned.status === 'unknown' && pruned.blocked, show(pruned));
    // Finding 1: the full balance was sent, Core dropped the emptied account, and the log has no entry yet. Its record
    // then shows no outgoing tick: started afresh by a later deposit, or not held at all. Unknown, send block kept:
    // never a failure inviting a resend.
    const afresh = await settleWith({ lastOut: 0, lastIn: T0 + 5 });
    const gone = await settleWith({ lastOut: 0, lastIn: 0, incoming: '0' });
    check('finding 1: an account record started afresh, or gone, no flag, no log → unknown with the send block kept, never failed',
      afresh.status === 'unknown' && afresh.blocked && gone.status === 'unknown' && gone.blocked, `${show(afresh)} | ${show(gone)}`);
    const down = { 500: () => new Response('{"message":"down"}', { status: 500 }), malformed: () => new Response('{"eventLogs":"x"}', { status: 200 }),
      unreachable: () => { throw new TypeError('network down'); } };
    // The review of 21 Oct: the archive serves moneyFlew = false when it has no status for a transaction. With the
    // account's record started afresh (or gone) and the event log unreachable, that false must not read as "failed".
    const review = await settleWith({ lastOut: 0, lastIn: T0 + 5, moneyFlew: false, logs: down.unreachable });
    const reviewGone = await settleWith({ lastOut: 0, lastIn: 0, incoming: '0', moneyFlew: false, logs: down.unreachable });
    check('review: the archive’s false, the record started afresh or gone, the log unreachable → unknown with the send block kept',
      review.status === 'unknown' && review.blocked && reviewGone.status === 'unknown' && reviewGone.blocked, `${show(review)} | ${show(reviewGone)}`);
    // A deposit in the transfer's own tick could be the account coming back within that tick.
    const sameTick = await settleWith({ lastOut: T0 - 100, lastIn: T0, moneyFlew: false });
    check('a deposit in the transfer’s own tick leaves it open: unknown, send block kept', sameTick.status === 'unknown' && sameTick.blocked, show(sameTick));
    const failed = await settleWith({ lastOut: T0 - 100, moneyFlew: false });
    const failedNoFlag = await settleWith({ lastOut: T0 - 100 });
    check('failed on Core’s record, unbroken since before the tick, showing nothing sent from it on (after one look at the log); the send block goes',
      failed.status === 'failed' && !failed.blocked && failed.asked.endsWith('getEventLogs') && failedNoFlag.status === 'failed' && !failedNoFlag.blocked, `${show(failed)} | ${show(failedNoFlag)}`);
    const logWins = await settleWith({ lastOut: T0, moneyFlew: false, logs: [event] });
    check('the archive’s false and Core’s log of the transfer → sent (that false can mean “no status”)', logWins.status === 'success' && !logWins.blocked, show(logWins));
    // The event log unavailable, in every way it can be: never a "sent"; Core's unbroken record still settles a
    // failure, and one that may have started afresh doesn't, whatever the archive's flag says.
    for (const [how, logs] of Object.entries(down)) {
      const none = await settleWith({ lastOut: T0, logs });
      const no = await settleWith({ lastOut: T0 - 100, moneyFlew: false, logs });
      const reset = await settleWith({ lastOut: 0, lastIn: T0 + 5, moneyFlew: false, logs });
      check(`event log ${how}: no flag → unknown, send blocked; an unbroken record → failed; one started afresh, with the archive’s false → unknown, send blocked`,
        none.status === 'unknown' && none.blocked && no.status === 'failed' && reset.status === 'unknown' && reset.blocked, `${show(none)} | ${show(no)} | ${show(reset)}`);
    }
    // In Activity: a transfer settled here shows that outcome, not the archive's flag alone; one still open stays in
    // progress (with "I've checked it on the explorer"); anything else shows the archive's word, where only
    // moneyFlew = true counts.
    const A = makeTab();
    const row = { hash, source: from, destination: OTHER, amount: 5n, tick: T0, inputType: 0, inputSize: 0, moneyFlew: false };
    A.t.state.pending = [{ hash, from, to: OTHER, amount: 5n, targetTick: T0, status: 'success' }];
    const settledShows = A.t.txStatus(row);
    A.t.state.pending[0].status = 'failed';
    const failedShows = A.t.txStatus(row);
    A.t.state.pending[0].status = 'unknown';
    const stillOpen = A.t.isOpenTransfer(A.t.state.pending[0]);
    A.t.state.pending = [];
    const archiveShows = A.t.txStatus(row);
    const flaggedMoved = A.t.txStatus({ ...row, moneyFlew: true });
    check('Activity: this session’s settlement shows (sent by the log though the archive’s flag reads false, or failed); an unsettled one stays in progress',
      settledShows === 'success' && failedShows === 'failed' && stillOpen === true, `${settledShows}, ${failedShows}, ${stillOpen}`);
    check('Activity: without it, the archive’s false shows as unconfirmed, never failed; its true as confirmed',
      archiveShows === 'unknown' && flaggedMoved === 'success', `${archiveShows}, ${flaggedMoved}`);
    // The review of 22 Oct: a payment settled as sent (Core's log, the archive's flag reading false: the logWins case
    // above), then the wallet locks. Locking drops every transfer record with the secrets, so the settlement is
    // forgotten; the payment must then read as unconfirmed, never as failed, which could prompt paying again.
    const beforeLock = logWins.t.txStatus(row); logWins.t.dropSecrets(); const afterLock = logWins.t.txStatus(row);
    check('review: a payment sent by Core’s log, archive flag false, then a lock → confirmed before, unconfirmed after, never failed',
      logWins.status === 'success' && beforeLock === 'success' && afterLock === 'unknown' && logWins.t.state.pending.length === 0, `${logWins.status}: ${beforeLock} → ${afterLock}`);
  }
  // Fake deposits: anyone holding 1 QU can sign a transfer to you with any input type
  // and an amount it can't pay, which the archive lists with moneyFlew false or no flag. Core moves the amount before
  // anything else, ignores the input type at an address that isn't a contract, and runs a contract's procedure only
  // once the amount has reached it. So nothing carrying QUBIC reads as moved without the flag, and nothing unmoved shows
  // as received (no plus, no green, no dollar value, no lit icon). Records go through parseTx, as the archive's answers
  // do; every case is [label, got, want].
  {
    const F = makeTab();
    const me = F.t.deriveAccount(SEED).identity;
    const QX = 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARMID'; // contract 1, watched as an account
    const QUTIL = 'EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVWRF'; // contract 4, SendMany's
    const rec = (to, amount, inputType, moneyFlew, from = OTHER) => F.t.parseTx({ hash: 'f'.repeat(60), source: from, destination: to,
      amount: String(amount), tickNumber: 90000000, timestamp: '1760000000000', inputType, inputSize: 0, inputData: '', signature: 'x',
      ...(moneyFlew === null ? {} : { moneyFlew }) });
    // Each input type the probe tried, at 1,000 QUBIC and at Core's MAX_AMOUNT.
    const cases = (fn) => [0, 1, 2, 7, 0xFFFF].flatMap((type) => [1000n, 10n ** 15n].flatMap((amount) => fn(type, amount)));
    const wrong = (list) => list.filter(([, got, want]) => got !== want).map(([what, got, want]) => `${what}: ${got}, not ${want}`).join('; ');
    const status = (to, amount, type, flag) => F.t.txStatus(rec(to, amount, type, flag));
    const fake = cases((type, amount) => [false, null].map((flag) => [`type ${type}, ${amount}, flag ${flag}`, status(me, amount, type, flag), 'unknown']));
    check('fake deposit: a transfer to you that moved nothing (flag false or missing) reads as unconfirmed, never executed or confirmed, whatever its input type',
      !wrong(fake), wrong(fake));
    const moved = cases((type, amount) => [[`type ${type}, ${amount}`, status(me, amount, type, true), 'success']]);
    check('fake deposit: the archive’s true still confirms a transfer to you, whatever its input type', !wrong(moved), wrong(moved));
    const calls = cases((type, amount) => [false, null, true].map((flag) => [`type ${type}, ${amount}, flag ${flag}`, status(QX, amount, type, flag),
      flag !== true ? 'unknown' : type === 0 ? 'success' : 'executed']));
    check('fake deposit: QUBIC to a contract counts only on the archive’s true (a call then executed); without it, unconfirmed', !wrong(calls), wrong(calls));
    const empty = [['call carrying nothing', status(QX, 0n, 7, false), 'executed'], ['zero transfer to you', status(me, 0n, 0, false), 'executed'],
      ['zero, type 7, to you', status(me, 0n, 7, null), 'executed'], ['SendMany carrying nothing', status(QUTIL, 0n, 1, false), 'unknown']];
    check('fake deposit: unchanged where nothing moves: calls and transfers carrying nothing read as executed, SendMany follows the flag', !wrong(empty), wrong(empty));
    const through = cases((type, amount) => [me, QX].flatMap((to) => [false, null, true].map((flag) =>
      [`to ${to === me ? 'you' : 'a contract'}, type ${type}, ${amount}, flag ${flag}`, F.t.wentThrough(rec(to, amount, type, flag)), flag === true])));
    F.t.state.pending = [{ hash: 'f'.repeat(60), from: OTHER, to: me, amount: 1000n, targetTick: 90000000, status: 'failed' }];
    through.push(['settled here as failed, archive true', F.t.wentThrough(rec(me, 1000n, 0, true)), false]);
    F.t.state.pending = [];
    check('fake deposit: money coming in counts as gone through only once it moved, never while unconfirmed or once settled here as failed',
      !wrong(through), wrong(through));
    // What Activity shows for each, in its row and its details (describeTx and txLook, from 09-dashboard.js).
    const shows = (tx, mine) => {
      const info = F.t.describeTx(tx, new Set(mine));
      const look = F.t.txLook(tx, info);
      return `${info.title}, ${look.sign || 'no sign'}, ${look.credit ? 'green' : 'plain'}, ${look.valued ? 'valued' : 'no value'}, icon ${look.type}`;
    };
    const RECEIVED = 'Received, +, green, valued, icon in';
    const DOUBT = 'Transfer to you, no sign, plain, no value, icon unconfirmed';
    const looks = cases((type, amount) => [me, QX].flatMap((to) => [false, null, true].map((flag) =>
      [`to ${to === me ? 'you' : 'a contract'}, type ${type}, ${amount}, flag ${flag}`, shows(rec(to, amount, type, flag), [to]), flag === true ? RECEIVED : DOUBT])));
    check('fake deposit: Activity shows money coming in as received (a plus, green, a dollar value, the lit icon) only once it moved; otherwise a plain “Transfer to you”',
      !wrong(looks), wrong(looks));
    // Between your accounts (one side may be an address you only watch): no dollar value until it's known to have moved.
    const between = [true, false, null].map((flag) => [`flag ${flag}`, shows(rec(me, 1000n, 0, flag), [me, OTHER]),
      `Between your accounts, no sign, plain, ${flag === true ? 'valued' : 'no value'}, icon move`]);
    check('fake deposit: a move between your accounts has a dollar value only once it moved', !wrong(between), wrong(between));
  }

  // ── A transfer can execute only in its target tick, so until the live tick is past it and the archive has
  // processed it, it is never given up on as unknown nor marked as checked, however long the network stalls: its
  // account stays blocked, as a second payment could go through as well ──────────────────────────────────────────
  {
    const T0 = 90000300;
    const probe = makeTab();
    const from = probe.t.deriveAccount(SEED).identity;
    const entry = await journalEntry(probe.t.Q, 5n, T0, Date.now() - 20 * 60000);
    const record = (status, createdAt = Date.now() - 16 * 60000) => ({ hash: entry.hash, encoded: entry.encoded, from, to: OTHER, amount: 5n,
      targetTick: T0, startTick: T0 - 10, createdAt, status, peers: 3, note: null });
    const gaveUp = (T) => T.t.toasts.some((x) => x.m.startsWith('Couldn’t confirm'));
    // One round of tracking, 16 minutes after signing (past the give-up time), on the network given (see networkAt):
    // fed by the tick feed's own poll (feed), or restored from the journal 20 minutes after signing (restored). Then
    // an attempt to mark it as checked, and one to send again from its account.
    const run = async ({ feed = false, restored = false, ...net }) => {
      const T = makeTab({ fetch: networkAt(net) });
      T.t.state.net.tick = net.start ?? net.tick; T.t.state.net.tickAt = Date.now();
      let p;
      if (restored) {
        T.t.state.accounts = [{ id: '0123456789abcdef', name: 'Main', kind: 'seed', seed: SEED, identity: from, createdAt: 1 }];
        T.t.restorePending([entry]);
        p = T.t.state.pending[0];
      } else {
        p = record('waiting');
        T.t.state.pending = [p];
      }
      if (feed) await T.t.loadTick();
      await settle();
      await T.t.trackPending();
      const status = p.status; const toast = gaveUp(T);
      const dismissed = T.t.dismissTransfer(p);
      const blocked = T.t.hasOpenTransfer(from);
      const claim = T.t.claimSend(from);
      if (claim) T.t.releaseSend(from);
      return { status, toast, dismissed, after: p.status, blocked, claimed: Boolean(claim), epoch: T.t.state.net.epoch };
    };
    const held = (r, status) => r.status === status && r.after === status && !r.toast && r.dismissed === false && r.blocked && !r.claimed;
    const show = (r) => `${r.status}${r.toast ? ' (gave up)' : ''} → ${r.after}, ${r.blocked ? 'blocked' : 'free'}, ${r.claimed ? 'sent again' : 'no second send'}`;
    const short = await run({ tick: T0 - 5, archive: T0 - 5 });
    check('past the give-up time, the network 5 ticks short of the target: still waiting, can’t be marked as checked, no second send', held(short, 'waiting'), show(short));
    const atTick = await run({ tick: T0, archive: T0 - 5 });
    check('the network stalled at the target tick itself: still waiting, no second send', held(atTick, 'waiting'), show(atTick));
    const feedDown = await run({ tick: T0 - 5, archive: T0 - 5, down: true, feed: true });
    check('the tick feed failing (its own poll), the last tick short of the target: still waiting, no second send', held(feedDown, 'waiting'), show(feedDown));
    const restored = await run({ tick: T0 - 5, archive: T0 - 5, restored: true });
    check('restored from the journal 20 minutes after signing, the network short of the target: waiting, no second send', held(restored, 'waiting'), show(restored));
    const behind = await run({ tick: T0 + 2, archive: T0 - 1 });
    check('the tick passed but the archive hasn’t processed it: still confirming, can’t be marked as checked', held(behind, 'confirming'), show(behind));
    const archiveDown = await run({ tick: T0 + 2, archive: null });
    check('the tick passed but the archive can’t be read: still confirming, can’t be marked as checked', held(archiveDown, 'confirming'), show(archiveDown));
    // The weekly epoch change: the feed stalls at the end of epoch 200, then answers epoch 201, whose ticks start below
    // the target (Core may still run it there).
    const below = await run({ start: T0 - 5, tick: T0 - 1, epoch: 201, archive: T0 - 5, feed: true });
    check('a new epoch whose ticks start below the target tick: still waiting, no second send', held(below, 'waiting') && below.epoch === 201, `${show(below)}, epoch ${below.epoch}`);
    // Control: a new epoch that starts above the target skipped it, so it can no longer execute.
    const above = await run({ start: T0 - 5, tick: T0 + 60, epoch: 201, archive: T0 + 55, feed: true,
      intervals: [{ firstTick: T0 - 1000, lastTick: T0 - 3 }, { firstTick: T0 + 40, lastTick: T0 + 55 }] });
    check('control: a new epoch that began above the target tick: unknown (never sent or failed), and it can be marked as checked',
      above.status === 'unknown' && above.toast && above.after === 'dismissed' && !above.blocked && above.claimed, show(above));
    const past = await run({ tick: T0 + 2, archive: T0 + 1 });
    check('control: once the network and the archive have passed its tick, it gives up as unknown and can be marked as checked',
      past.status === 'unknown' && past.toast && past.after === 'dismissed' && !past.blocked && past.claimed, show(past));
    // Already unknown (settled so earlier, say), and the network reads short again: marking it as checked is refused
    // while the live tick, or the archive, reads short of its tick (a lagging backend), or both sit exactly at it.
    const mark = async ({ tick, archive }) => {
      const T = makeTab({ fetch: networkAt({ tick, archive }) });
      T.t.state.net.tick = tick; T.t.state.net.tickAt = Date.now();
      await T.t.archiveTick();
      const p = record('unknown');
      T.t.state.pending = [p];
      const dismissed = T.t.dismissTransfer(p);
      const blocked = T.t.hasOpenTransfer(from);
      const claim = T.t.claimSend(from);
      if (claim) T.t.releaseSend(from);
      return { status: 'unknown', toast: false, dismissed, after: p.status, blocked, claimed: Boolean(claim) };
    };
    const tickShort = await mark({ tick: T0 - 3, archive: T0 + 20 });
    const archiveShort = await mark({ tick: T0 + 20, archive: T0 - 1 });
    check('an unknown transfer can’t be marked as checked while the live tick, or the archive, reads short of its tick',
      held(tickShort, 'unknown') && held(archiveShort, 'unknown'), `${show(tickShort)} | ${show(archiveShort)}`);
    const atBoth = await mark({ tick: T0, archive: T0 });
    const oneOn = await mark({ tick: T0 + 1, archive: T0 });
    check('at its tick exactly (the live tick and the archive both at it) it can’t be marked as checked; one tick on, it can',
      held(atBoth, 'unknown') && oneOn.dismissed === true && oneOn.after === 'dismissed' && !oneOn.blocked && oneOn.claimed, `${show(atBoth)} | ${show(oneOn)}`);
  }
  // ── “Sent” and “not executed” only on the archive's evidence. The record it returns has to be the transfer signed
  // here, every field compared with the signed bytes (a missing one is never read as 0), before its flag or Core's
  // event log counts; “not found” counts as not executed only once the archive has processed the tick and that tick's
  // whole list, every entry well-formed, lacks the hash. One round of tracking each, the tick passed ─────────────────
  {
    const T0 = 90000500;
    const probe = makeTab();
    const from = probe.t.deriveAccount(SEED).identity;
    const entry = await journalEntry(probe.t.Q, 5n, T0, Date.now());
    const signature = Buffer.from(entry.encoded, 'base64').subarray(-64);
    const exact = { hash: entry.hash, source: from, destination: OTHER, amount: '5', tickNumber: T0, timestamp: '1760000000000',
      inputType: 0, inputSize: 0, inputData: '', signature: signature.toString('base64'), moneyFlew: true };
    // The sending account's live record, five ticks on: QUBIC left it at the transfer's tick (sent) or long before (idle).
    const live = (lastOut) => ({ id: from, validForTick: T0 + 5, latestOutgoingTransferTick: lastOut, latestIncomingTransferTick: T0 - 900, incomingAmount: '1000' });
    const sent = live(T0); const idle = live(T0 - 800);
    const processed = [{ firstTick: T0 - 1000, lastTick: T0 + 5 }];
    const other = (n) => n.toString(16).padStart(2, '0').repeat(30).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
    const logged = (amount = '5') => [{ logType: 0, transactionHash: entry.hash, tickNumber: T0, quTransfer: { source: from, destination: OTHER, amount } }];
    const run = async (net) => {
      const T = makeTab({ fetch: networkAt({ tick: T0 + 5, archive: T0 + 5, ...net }) });
      T.t.state.net.tick = T0 + 5; T.t.state.net.tickAt = Date.now();
      const p = { hash: entry.hash, encoded: entry.encoded, from, to: OTHER, amount: 5n, targetTick: T0, startTick: T0 - 10,
        createdAt: Date.now() - 60000, status: 'waiting', peers: 3, note: null };
      T.t.state.pending = [p];
      await T.t.trackPending();
      return { status: p.status, held: Boolean(p.mismatch), said: T.t.toasts.map((x) => x.m).join(' | ') };
    };
    const show = (r) => `${r.status}${r.held ? ', held' : ''}${r.said ? ` (${r.said})` : ''}`;
    const results = async (list) => { const out = []; for (const [label, net, ok] of list) { const r = await run(net); if (!ok(r)) out.push(`${label}: ${show(r)}`); } return out; };
    const success = (r) => r.status === 'success' && !r.held;
    const contradicted = (r) => r.status === 'unknown' && r.held;
    const open = (r) => r.status === 'confirming' && !r.held && !r.said;

    const control = await run({ tx: exact, live: sent });
    check('control: the archive’s exact record of the transfer, marked as moved, and its account sent at that tick: sent', success(control), show(control));
    // One field changed at a time, the flag still true: a contradiction, held for you to check, never “sent”.
    const flip = Buffer.from(signature); flip[10] ^= 1;
    const changedFields = await results([
      ['another amount', { tx: { ...exact, amount: '6' }, live: sent }, contradicted],
      ['another destination', { tx: { ...exact, destination: from }, live: sent }, contradicted],
      ['another source', { tx: { ...exact, source: OTHER }, live: sent }, contradicted],
      ['another tick', { tx: { ...exact, tickNumber: T0 + 1 }, live: sent }, contradicted],
      ['another type', { tx: { ...exact, inputType: 1 }, live: sent }, contradicted],
      ['an input it doesn’t have', { tx: { ...exact, inputSize: 1, inputData: 'AA==' }, live: sent }, contradicted],
      ['another signature', { tx: { ...exact, signature: flip.toString('base64') }, live: sent }, contradicted],
      ['no signature', { tx: { ...exact, signature: undefined }, live: sent }, contradicted],
    ]);
    check('a record that differs from the signed transfer in any field (amount, either side, tick, type, input, signature) is held as unknown, never sent',
      changedFields.length === 0, changedFields.join('; '));
    // A record missing a required field, or for another hash, is malformed: nothing settles, it's looked up again.
    const malformed = await results([
      ['no amount', { tx: { ...exact, amount: undefined }, live: sent }, open],
      ['no type', { tx: { ...exact, inputType: undefined }, live: sent }, open],
      ['no tick', { tx: { ...exact, tickNumber: undefined }, live: sent }, open],
      ['another hash', { tx: { ...exact, hash: other(7) }, live: sent }, open],
    ]);
    check('a record missing a field (never read as 0) or for another hash settles nothing: still confirming', malformed.length === 0, malformed.join('; '));
    // The flag alone, false or missing, says nothing; Core's event log of the same transfer does.
    const flags = await results([
      ['flag false, no log', { tx: { ...exact, moneyFlew: false }, live: sent }, (r) => r.status === 'unknown' && !r.held],
      ['no flag, no log', { tx: { ...exact, moneyFlew: undefined }, live: sent }, (r) => r.status === 'unknown' && !r.held],
      ['flag false, logged', { tx: { ...exact, moneyFlew: false }, live: sent, events: logged() }, success],
      ['flag false, logged with another amount', { tx: { ...exact, moneyFlew: false }, live: sent, events: logged('50') }, (r) => r.status === 'unknown' && !r.held],
      ['flag true, account record unreadable', { tx: exact }, open],
    ]);
    check('the archive’s flag false or missing is no outcome; Core’s log of the same transfer (sides and amount) makes it sent; no account record, no outcome',
      flags.length === 0, flags.join('; '));

    // Not found by its hash.
    const notExecuted = await run({ intervals: processed, hashes: [other(1), other(2)], live: idle });
    check('control: not found, its tick processed, the tick’s whole list without it, and nothing sent since: not executed',
      notExecuted.status === 'not-executed' && !notExecuted.held, show(notExecuted));
    const absent = await results([
      ['the tick not processed yet', { intervals: [{ firstTick: T0 - 1000, lastTick: T0 - 1 }], hashes: [other(1)], live: idle }, open],
      ['no processed ranges', { hashes: [other(1)], live: idle }, open],
      ['the tick’s list unreadable', { intervals: processed, live: idle }, open],
      ['a malformed entry in the list', { intervals: processed, hashes: [other(1), 'not-a-hash'], live: idle }, open],
      ['a repeated entry in the list', { intervals: processed, hashes: [other(1), other(1)], live: idle }, open],
      ['the list of another tick', { intervals: processed, hashes: [other(1)], hashesTick: T0 - 1, live: idle }, open],
      ['the list contains it', { intervals: processed, hashes: [other(1), entry.hash], live: idle }, contradicted],
      ['its account sent at that tick', { intervals: processed, hashes: [other(1)], live: sent }, contradicted],
    ]);
    check('not found settles as not executed only on a processed tick and its whole, well-formed list; a list with it, or a send at that tick, is held',
      absent.length === 0, absent.join('; '));
  }
  // The send claim's lock keeps another tab with the same seed but none of this one's journal (a session-only wallet)
  // from sending. Its 15-minute backstop renews it while this tab still tracks the transfer as open (a stall can last
  // longer), and releases it once the transfer has settled.
  {
    const clock = fakeClock();
    const A = makeTab({ timers: clock.timers });
    const B = makeTab();
    const from = A.t.deriveAccount(SEED).identity;
    const claim = A.t.claimSend(from);
    const got = claim ? await claim.ready : null;
    const p = { hash: 'c'.repeat(60), encoded: 'x', from, to: OTHER, amount: 5n, targetTick: 90000400, createdAt: Date.now(), status: 'waiting' };
    A.t.state.pending.push(p);
    const otherTab = async () => { const c = B.t.claimSend(from); const ok = c ? await c.ready : null; if (c) B.t.releaseSend(from); return ok; };
    clock.fire(); // 15 minutes on, the network still short of the tick
    await settle();
    const during = await otherTab();
    p.status = 'success'; // settled, its own release left to the backstop
    clock.fire();
    await settle();
    const afterwards = await otherTab();
    check('the cross-tab send lock outlasts its 15-minute backstop while the transfer is open (another tab with the seed can’t send); it goes once settled',
      got === true && during === false && afterwards === true, `claimed ${got}, other tab during ${during}, after ${afterwards}`);
  }
  // Past its tick a transfer can't execute any more, so the backstop lets the lock go even while this tab still holds
  // the record unsettled ('unknown' after the give-up): another tab isn't kept from sending for nothing. This tab's own
  // send block stays, from the record.
  {
    const clock = fakeClock();
    const A = makeTab({ timers: clock.timers, fetch: networkAt({ tick: 90000500, archive: 90000450 }) });
    const B = makeTab();
    const from = A.t.deriveAccount(SEED).identity;
    const claim = A.t.claimSend(from);
    const got = claim ? await claim.ready : null;
    A.t.state.net.tick = 90000500; A.t.state.net.tickAt = Date.now();
    await A.t.archiveTick();
    A.t.state.pending.push({ hash: 'd'.repeat(60), encoded: 'x', from, to: OTHER, amount: 5n, targetTick: 90000400, createdAt: Date.now(), status: 'unknown' });
    clock.fire(); // 15 minutes on, the network past the tick
    await settle();
    const c = B.t.claimSend(from); const other = c ? await c.ready : null; if (c) B.t.releaseSend(from);
    check('the cross-tab send lock goes at its backstop once the network has passed the transfer’s tick, while this tab keeps its own send block',
      got === true && other === true && A.t.hasOpenTransfer(from) === true, `claimed ${got}, other tab ${other}, this tab blocked ${A.t.hasOpenTransfer(from)}`);
  }
  // A stall: the same tick answered for two minutes. A new tick clears it; a gap in polling alone (a hidden tab) isn't
  // one; a feed that stops answering is (shown as an error in the network bar, counted here).
  {
    const net = { tick: 90000500 };
    const T = makeTab({ fetch: networkAt(net) });
    const n = T.t.state.net;
    const reads = [];
    await T.t.loadTick(); reads.push(['first answer', T.t.tickStall(), (v) => v === 0]);
    n.movedAt = Date.now() - 30000; await T.t.loadTick(); reads.push(['same tick, 30 s', T.t.tickStall(), (v) => v === 0]);
    n.movedAt = Date.now() - 120000; await T.t.loadTick(); reads.push(['same tick, 2 min', T.t.tickStall(), (v) => v >= 119000]);
    net.tick += 1; await T.t.loadTick(); reads.push(['next tick', T.t.tickStall(), (v) => v === 0]);
    n.tickAt = n.movedAt = Date.now() - 600000; reads.push(['hidden 10 min', T.t.tickStall(), (v) => v === 0]);
    net.down = true; await T.t.loadTick(); reads.push(['feed failing', T.t.tickStall(), (v) => v >= 599000]);
    const wrong = reads.filter(([, v, ok]) => !ok(v)).map(([what, v]) => `${what}: ${v}`).join('; ');
    check('stall: the same tick for 2 minutes is a stall, not under a minute; a new tick clears it; a polling gap alone isn’t one; a failing feed is', !wrong, wrong);
  }

  // A saved entry for a zero amount (this wallet never signs one) is never restored, so it can't be settled.
  {
    const T = makeTab();
    const { identity } = T.t.deriveAccount(SEED);
    T.t.state.accounts = [{ id: 'z', name: 'Main', kind: 'seed', seed: SEED, identity, createdAt: 1 }];
    T.t.restorePending([await journalEntry(T.t.Q, 0n, 90000200, 3), await journalEntry(T.t.Q, 9n, 90000200, 3)]);
    check('a zero-amount journal entry isn’t restored; a normal one is', T.t.state.pending.length === 1 && T.t.state.pending[0].amount === 9n, `${T.t.state.pending.length} restored`);
  }

  // ── An account with an unsettled transfer can't be removed; a journalled transfer whose account has gone
  // (removed in another tab, or by an earlier version) is still tracked, so its seed imported again can't send ─────
  const SEED2 = 'mnbvcxzlkjhgfdsapoiuytrewqmnbvcxzlkjhgfdsapoiuytrewqmnb'; // a second test seed, never funded here
  // A saved wallet holding Main (unless gone) and Savings (unless only Main), with T, 5 QUBIC from Main whose tick is
  // still ahead, journalled in the record, or under the previous version's separate key (legacy), or not at all (none).
  // Opened by a reload resume, offline, or on a network (net, see networkAt) whose tick is already the live one.
  async function withTransfer({ mainGone = false, onlyMain = false, legacy = false, none = false, createdAt = Date.now(), net = null } = {}) {
    await settle(); // earlier tabs' journal writes land before the shared storage is cleared
    shared.ls.clear(); shared.idb.clear();
    const A = makeTab();
    const main = { id: '0123456789abcdef', name: 'Main', kind: 'seed', seed: SEED, identity: A.t.deriveAccount(SEED).identity, createdAt: 1 };
    const savings = { id: '1123456789abcdef', name: 'Savings', kind: 'seed', seed: SEED2, identity: A.t.deriveAccount(SEED2).identity, createdAt: 1 };
    const accounts = mainGone ? [savings] : onlyMain ? [main] : [main, savings];
    const made = await A.t.Vault.create(P1, { v: 1, accounts, selection: accounts[0].id, contacts: [] }, { auth: A.t.sessionGuard(), expect: null });
    const entry = await journalEntry(A.t.Q, 5n, 90000300, createdAt);
    if (legacy) await A.t.legacyJournal(made.key, [entry]);
    else if (!none) {
      const rec = JSON.parse(localStorage.getItem(VAULT_KEY));
      rec.pending = await A.t.Vault.encrypt(made.key, A.t.Vault.pendingAad(made.header), { v: 1, entries: [entry] });
      localStorage.setItem(VAULT_KEY, JSON.stringify(rec));
    }
    await settle();
    const B = makeTab({ session: A.session, fetch: net ? networkAt(net) : undefined });
    if (net) { B.t.state.net.tick = net.tick; B.t.state.net.tickAt = Date.now(); }
    const opened = await B.t.resumeWallet();
    if (net) await settle(); // the restored transfer's first lookups
    return { B, main, savings, entry, hash: entry.hash, opened };
  }
  // The network past T's tick (90000300) and the archive past it too: an unconfirmed T can be given up on as unknown.
  const PAST_T = { tick: 90000302, archive: 90000301 };
  // The transfers sealed in the stored record's journal, by hash.
  const journalled = async (T, key) => { const { pending } = await T.t.Vault.openWithKey(key); return Array.isArray(pending) ? pending.map((e) => e.hash) : []; };
  // A lock, then an unlock with the password, as the unlock screen does (which then shows the wallet).
  const relock = async (T) => {
    T.t.lockWallet();
    const o = await T.t.Vault.open(P1, { resume: false, auth: T.t.sessionGuard() });
    await T.t.adoptVault(o, T.t.sessionGuard());
    T.t.state.phase = 'ready';
    return o;
  };
  const removal = (T, id) => T.t.removeAccount(id).then(() => 'removed', (e) => e.code);
  {
    // Switching accounts leaves the sealed wallet as it is (every other open tab took a rewrite for a change elsewhere,
    // and locked); the account last in view is the one shown after the next unlock.
    const { B, savings } = await withTransfer({ none: true });
    await settle();
    const before = localStorage.getItem(VAULT_KEY);
    B.t.selectScope(savings.id);
    await settle();
    const untouched = localStorage.getItem(VAULT_KEY) === before;
    await relock(B);
    check('switching accounts doesn’t rewrite the sealed wallet; the account last in view comes back after unlocking',
      untouched && B.t.state.selection === savings.id, `vault ${untouched ? 'untouched' : 'rewritten'}, selection ${B.t.state.selection}`);
  }
  {
    const { B, main, savings, hash, opened } = await withTransfer();
    const before = localStorage.getItem(VAULT_KEY);
    const out = await removal(B, main.id);
    const kept = B.t.state.accounts.find((a) => a.identity === main.identity);
    check('an account with an unsettled transfer can’t be removed: refused, its seed and the saved wallet unchanged, sending still blocked',
      opened && out === 'REMOVE_BUSY' && Boolean(kept && kept.seed === SEED) && localStorage.getItem(VAULT_KEY) === before && B.t.hasOpenTransfer(main.identity), out);
    const other = await removal(B, savings.id);
    check('another account, with no transfer of its own, can still be removed meanwhile', other === 'removed' && !B.t.state.accounts.some((a) => a.id === savings.id), other);
    const T = B.t.state.pending.find((p) => p.hash === hash);
    if (T) T.status = 'success';
    const after = await removal(B, main.id);
    check('control: once that transfer has settled, the account can be removed', after === 'removed' && !B.t.state.accounts.some((a) => a.identity === main.identity), after);
  }
  {
    // The only account: removing it would erase the wallet, its journal with it.
    const { B, main, hash } = await withTransfer({ onlyMain: true });
    const out = await removal(B, main.id);
    const kept = localStorage.getItem(VAULT_KEY) !== null && B.t.state.vault ? (await journalled(B, B.t.state.vault.key)).includes(hash) : false;
    check('the only account, with a transfer unsettled, is refused too: the wallet and its journal aren’t erased',
      out === 'REMOVE_BUSY' && kept && B.t.state.phase === 'ready', `${out}, journal kept ${kept}, ${B.t.state.phase}`);
  }
  {
    const { B, main, hash } = await withTransfer({ createdAt: 1, net: PAST_T });
    const status = (B.t.state.pending.find((p) => p.hash === hash) || {}).status;
    const out = await removal(B, main.id);
    check('a transfer left unconfirmed (past the 15-minute give-up and its tick) refuses removal too', status === 'unknown' && out === 'REMOVE_BUSY', `${status}: ${out}`);
  }
  {
    const { B, savings } = await withTransfer({ none: true });
    const claim = B.t.claimSend(savings.identity);
    const out = await removal(B, savings.id);
    B.t.releaseSend(savings.identity);
    check('an account whose transfer is being signed (claimed, nothing journalled yet) can’t be removed', Boolean(claim) && out === 'REMOVE_BUSY', out);
  }
  for (const [when, createdAt, net] of [['its tick still ahead', Date.now(), null], ['past the 15-minute give-up and its tick, unconfirmed', 1, PAST_T]]) {
    const { B, main, hash, opened } = await withTransfer({ mainGone: true, createdAt, net });
    const tracked = B.t.state.pending.some((p) => p.hash === hash && p.from === main.identity);
    await relock(B); // locked and unlocked while Main is still gone
    const still = B.t.state.pending.some((p) => p.hash === hash);
    const again = await B.t.addAccount({ kind: 'seed', name: 'Main', seed: SEED });
    const blocked = B.t.hasOpenTransfer(again.identity);
    const o = await relock(B);
    const back = B.t.hasOpenTransfer(main.identity) && B.t.state.pending.some((p) => p.hash === hash);
    const kept = (await journalled(B, o.key)).includes(hash);
    check(`a journalled transfer whose account has gone is still tracked (${when}), across an unlock: that seed imported again can’t send, nor after the next unlock`,
      opened && tracked && still && blocked && back && kept,
      `tracked ${tracked}, after an unlock ${still}, blocked after import ${blocked}, after the next unlock ${back}, journalled ${kept}`);
  }
  {
    const { B, hash, opened } = await withTransfer({ mainGone: true, legacy: true });
    const kept = opened && (await journalled(B, B.t.state.vault.key)).includes(hash);
    check('an older version’s journal entry whose account has gone is carried into the record when migrated, not dropped',
      kept && localStorage.getItem('qubic-wallet.pending.v1') === null && B.t.state.pending.some((p) => p.hash === hash), `journalled ${kept}`);
  }
  {
    // A tab that removed Main before T's notice arrived from the tab that sent it: T is taken in all the same.
    const { B, main, entry } = await withTransfer({ none: true });
    const out = await removal(B, main.id);
    await settle();
    const rec = JSON.parse(localStorage.getItem(VAULT_KEY));
    rec.pending = await B.t.Vault.encrypt(B.t.state.vault.key, B.t.Vault.pendingAad(B.t.state.vault.header), { v: 1, entries: [entry] });
    localStorage.setItem(VAULT_KEY, JSON.stringify(rec));
    B.t.syncJournal();
    await settle();
    const blocked = B.t.hasOpenTransfer(main.identity);
    check('a transfer journalled in another tab after this one removed its account is taken in by sync: that seed stays blocked',
      out === 'removed' && blocked && B.t.state.pending.some((p) => p.hash === entry.hash), `${out}, blocked ${blocked}`);
  }

  // ── Erase: memory at once, success only once the record is verifiably gone ──────────────────────────────────────
  {
    const { A } = await setup();
    const B = makeTab({ session: A.session });
    await B.t.resumeWallet();
    const C = makeTab();
    const o = await C.t.Vault.open(P1, { resume: false });
    C.t.state.vault = { key: o.key, header: o.header }; C.t.state.mode = 'vault';
    const pause = C.pauseNextEncrypt(); // another tab's save holds the write lock
    const cSave = C.t.persist().catch(() => {});
    await pause.atGate;
    const erasing = B.t.forgetEverything();
    await settle();
    const clearedAtOnce = B.t.state.accounts.length === 0 && B.t.state.vault === null && B.t.state.contacts.length === 0;
    pause.release();
    await cSave;
    const gone = await erasing;
    check('erase clears memory at once (before the delete got the lock) and reports success once the record is gone',
      clearedAtOnce && gone === true && localStorage.getItem(VAULT_KEY) === null && B.t.state.phase === 'welcome', `cleared at once ${clearedAtOnce}, gone ${gone}`);
  }
  {
    const { A } = await setup();
    const B = makeTab({ session: A.session });
    await B.t.resumeWallet();
    shared.failRemove = true;
    const gone = await B.t.forgetEverything();
    shared.failRemove = false;
    check('a delete the browser refuses is reported as not erased; memory is cleared anyway',
      gone === false && B.t.state.accounts.length === 0 && B.t.state.vault === null && localStorage.getItem(VAULT_KEY) !== null && B.t.state.phase === 'locked', `gone ${gone}`);
  }

  // ── Account changes ────────────────────────────────────────────────────────────────────────────────────────────
  // At the account limit, a watch-only account can still be given its seed (that adds no account); a new one can't.
  {
    const T = makeTab();
    const { identity } = T.t.deriveAccount(SEED);
    const watched = (n, id) => ({ id: String(n).padStart(16, '0'), name: `Watched ${n}`, kind: 'watch', identity: id, publicKey: null, createdAt: 1 });
    T.t.state.mode = 'session';
    T.t.state.accounts = [...Array.from({ length: 19 }, (_, i) => watched(i + 1, T.t.Q.publicKeyToIdentity(new Uint8Array(32).fill(i + 1)))),
      watched(20, identity)];
    const upgrade = await T.t.addAccount({ kind: 'seed', name: 'Main', seed: SEED }).then((a) => `${a.kind}${a.seed === SEED ? ' with its seed' : ''}`, (e) => e.code);
    const more = await T.t.addAccount({ kind: 'watch', name: 'One more', identity: OTHER }).then(() => 'added', (e) => e.code);
    check('at the account limit a watch-only account is given its seed; a new account is refused',
      upgrade === 'seed with its seed' && more === 'LIMIT' && T.t.state.accounts.length === 20, `upgrade: ${upgrade}; new account: ${more}`);
  }
  // A removal whose save fails still redraws: the account has already left memory, so no screen may keep showing it.
  {
    const { A } = await setup();
    const B = makeTab({ session: A.session });
    await B.t.resumeWallet();
    B.t.state.accounts.push({ id: 'feedfacecafebeef', name: 'Watched', kind: 'watch', identity: OTHER, publicKey: null, createdAt: 2 });
    await settle();
    let redraws = 0;
    B.t.subscribe(() => { redraws++; });
    shared.failVaultWrites = true;
    const code = await B.t.removeAccount('feedfacecafebeef').then(() => 'none', (e) => e.code);
    shared.failVaultWrites = false;
    await settle();
    check('an account removed while its save fails leaves memory and the screens redraw',
      code === 'STORAGE' && B.t.state.accounts.length === 1 && redraws > 0, `save ${code}, redraws ${redraws}`);
  }
  // Price history is asked for only while market data is on: otherwise no price service hears from this wallet.
  {
    const asked = [];
    const T = makeTab({ fetch: async (url) => { asked.push(url); throw new TypeError('offline'); } });
    T.t.state.prefs = { ...T.t.state.prefs, marketData: false };
    // A day, 100 days and 400 days back: each of the three price series.
    const ages = [1, 100, 400].map((days) => Date.now() - days * 86400000);
    for (const ms of ages) await T.t.priceAt(ms);
    await settle();
    const whileOff = asked.length;
    T.t.state.prefs = { ...T.t.state.prefs, marketData: true };
    await T.t.priceAt(ages[0]);
    await settle();
    check('price history is requested only while market data is on', whileOff === 0 && asked.length > 0, `${whileOff} requests while off, ${asked.length - whileOff} once on`);
  }

  // ── The look-alike check: each seed account's own outgoing transfers, read with the archive's source filter, so
  // dust can neither push a payee out nor become known; an address you know is still flagged, naming both; what isn't
  // read yet, or couldn't be, is waited for or said, never passed in silence ─────────────────────────────
  {
    const ME = makeTab().t.deriveAccount(SEED).identity;
    const ME2 = 'BZBQFLLBNCXEMGLOBHUVFTLUPLVCPQUASSILFABOFFBCADQSSUPNWLZBQEXK'; // the public KAT identity
    const W = 'W'.repeat(60); // a watched address
    const D = OTHER; // the genuine payee
    // An address matching id in exactly its first `lead` and last `trail` letters (the check reads only that shape).
    const twinOf = (id, lead, trail) => id.slice(0, lead) + [...id.slice(lead, 60 - trail)].map((c) => (c === 'A' ? 'B' : 'A')).join('') + id.slice(60 - trail);
    const L = twinOf(D, 4, 4); // the poisoner's look-alike of D
    const E = 'E'.repeat(30) + 'F'.repeat(30); // an address only the watched account pays
    const LE = twinOf(E, 4, 4);
    const X = 'Z'.repeat(60); const UNRELATED = 'Y'.repeat(60);
    const CAP = 10000;
    let n = 0;
    const hashOf = (k) => [...k.toString(26)].map((c) => String.fromCharCode(97 + parseInt(c, 26))).join('').padStart(60, 'q');
    // A transaction as the archive serves it.
    const row = (source, destination, tick) => ({ hash: hashOf(++n), source, destination, amount: '1', tickNumber: tick, timestamp: '1700000000000',
      inputType: 0, inputSize: 0, inputData: '', signature: '', moneyFlew: true });
    const many = (k, source, destination, from) => Array.from({ length: k }, (_, i) => row(source, destination, from + i));
    // getTransactionsForIdentity: the identity's transactions newest first (oldestFirst: the other way round), the
    // source filter applied (honours: false ignores it; a function decides per request), paged, with hits.total
    // (totalCap: reported as at most that, as Elasticsearch's lower-bound totals are) and the archive's tick.
    // fail(body): answer 404. hold(): awaited before answering. Every request body is logged.
    const archive = (ledger, { honours = true, oldestFirst = false, totalCap = Infinity, log = [], fail = null, tick = () => 95000000, hold = null, noTotal = false } = {}) => async (url, init) => {
      if (!url.includes('getTransactionsForIdentity')) return new Response('{"message":"not found"}', { status: 404 });
      const body = JSON.parse(init.body);
      log.push(body);
      if (hold) await hold();
      if (fail && fail(body)) return new Response('{"message":"unavailable"}', { status: 404 });
      const src = body.filters && (typeof honours === 'function' ? honours(body) : honours) ? body.filters.source : null;
      const all = ledger.filter((t) => (t.source === body.identity || t.destination === body.identity) && (!src || t.source === src))
        .sort((a, b) => (oldestFirst ? a.tickNumber - b.tickNumber : b.tickNumber - a.tickNumber));
      const { offset, size } = body.pagination;
      return new Response(JSON.stringify({ hits: noTotal ? { from: offset, size } : { total: Math.min(all.length, totalCap), from: offset, size }, validForTick: tick(),
        transactions: all.slice(offset, offset + size) }), { status: 200 });
    };
    // A request held until open() is called.
    const gate = () => { let opened = false; return { open: () => { opened = true; }, hold: async () => { while (!opened) await new Promise((r) => setTimeout(r, 5)); } }; };
    // Until cond() holds, for at most two seconds.
    const until = async (cond) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10)); };
    // A tab whose wallet holds these accounts ([identity, name, kind]; the first one on screen), with nothing loaded yet.
    const wallet = (accounts, { contacts = [], fetch } = {}) => {
      const T = makeTab(fetch ? { fetch } : {});
      T.t.state.accounts = accounts.map(([identity, name, kind = 'seed'], i) => ({ id: `a${i}`, name, kind, identity, createdAt: 1 }));
      T.t.state.selection = 'a0';
      T.t.state.contacts = contacts;
      T.t.state.phase = 'ready';
      return T.t;
    };
    const twinIs = (got, id) => Boolean(got && got.identity === id && got.lead + got.trail >= 6);
    const levels = (w) => w.lines.map((x) => x.level).join();
    const ends = (a, b) => { let x = 0; while (x < 60 && a[x] === b[x]) x++; let y = 0; while (y < 60 - x && a[59 - y] === b[59 - y]) y++; return x + y; };
    const all = [ME, ME2, W, D, L, E, LE, X, UNRELATED];
    const pairs = all.flatMap((a, i) => all.slice(i + 1).map((b) => [a, b])).filter(([a, b]) => ends(a, b) >= 6).map(([a, b]) => `${a.slice(0, 2)}~${b.slice(0, 2)}`);
    check('look-alike fixtures: only D and L, and E and LE, resemble each other', pairs.length === 2 && ends(D, L) === 8 && ends(E, LE) === 8, pairs.join(' '));

    {
      let now = 0; let most = 0; const g = gate();
      const counting = (inner) => async (url, init) => { now++; most = Math.max(most, now); try { return await inner(url, init); } finally { now--; } };
      const t = wallet([[ME, 'Main'], [ME2, 'Second'], [D, 'Third'], [E, 'Fourth'], [X, 'Fifth']], { fetch: counting(archive([], { hold: g.hold })) });
      const runs = [t.loadKnownAddresses(), t.loadKnownAddresses(), t.loadKnownAddresses()];
      await until(() => now >= 3);
      await new Promise((r) => setTimeout(r, 30)); // and a little longer, for a fourth that shouldn't come
      const during = most;
      g.open(); await Promise.all(runs);
      check('look-alike: calls while a read is going share it, so no more than three reads are ever in flight',
        during === 3 && most === 3 && new Set(runs).size === 1, `${during} during, ${most} at most, ${new Set(runs).size} run(s)`);
    }
    {
      // An account that comes due while a run is going (a seed added) is read in that run.
      const log = []; const g = gate();
      const t = wallet([[ME, 'Main']], { fetch: archive([row(ME, D, 1000)], { log, hold: g.hold }) });
      const run = t.loadKnownAddresses();
      await until(() => log.length >= 1);
      t.state.accounts.push({ id: 'a1', name: 'Second', kind: 'seed', identity: ME2, createdAt: 1 });
      g.open(); await run;
      const lateRead = log.some((b) => b.filters && b.filters.source === ME2);
      check('look-alike: an account that comes due during a run is read in it', lateRead, `late account read ${lateRead}`);
    }
    {
      // An outage where reads fail slowly (every failed account is due again by the time a read ends; a seed is added at
      // the first request): a run tries each account once, the new seed too, and ends. Retries wait for the next call.
      const ids = [ME, ME2, D, E, X, W]; const log = []; let added = false; let t = null;
      const slowly = async () => {
        for (const id of [...ids, LE]) { const d = t.dataFor(id); if (d.sentErr) d.sentErrAt = Date.now() - t.SENT_RETRY_MS - 1; }
        if (!added) { added = true; t.state.accounts.push({ id: 'a9', name: 'Late', kind: 'seed', identity: LE, createdAt: 1 }); }
        await new Promise((r) => setTimeout(r, 2));
      };
      t = wallet(ids.map((id, i) => [id, `A${i}`]), { fetch: archive([], { log, hold: slowly, fail: (b) => b.filters }) });
      let ended = false;
      t.loadKnownAddresses().then(() => { ended = true; });
      await until(() => ended);
      const tries = [...ids, LE].map((id) => log.filter((b) => b.filters && b.filters.source === id).length);
      t.nextSession(); // stops a run that didn't end, so the suite can
      check('look-alike: in an outage where reads fail slowly, a run tries each account once (a seed added meanwhile too) and ends',
        ended && tries.every((k) => k === 1), `ended ${ended}, tries ${tries.join(',')}`);
    }
    {
      // Another tab changes the stored wallet while reads are going (the session goes on, its data kept; a lock is the
      // same with the data dropped): the old run's reads stop at their next page and keep nothing, and the next call's
      // run waits for them, so no more than three are ever in flight; then it reads every account in full.
      let now = 0; let most = 0; const g = gate(); const log = [];
      const counting = (inner) => async (url, init) => { now++; most = Math.max(most, now); try { return await inner(url, init); } finally { now--; } };
      const ledger = [...many(1500, ME, D, 1000), row(ME2, D, 1000), row(D, X, 1000), row(E, X, 1000), row(X, D, 1000)];
      const t = wallet([[ME, 'Main'], [ME2, 'Second'], [D, 'Third'], [E, 'Fourth'], [X, 'Fifth']], { fetch: counting(archive(ledger, { log, hold: g.hold })) });
      const old = t.loadKnownAddresses();
      await until(() => now >= 3);
      t.nextSession();
      const fresh = t.loadKnownAddresses();
      await new Promise((r) => setTimeout(r, 30));
      const during = most;
      g.open(); await Promise.all([old, fresh]);
      const pages = log.filter((b) => b.filters && b.filters.source === ME).length;
      const me = t.dataFor(ME).sent;
      check('look-alike: after another tab’s change or a lock, reads from before stop at their next page and keep nothing, and the new run waits for them (never more than three in flight), then reads every account in full',
        fresh !== old && during === 3 && most === 3 && pages === 3 && Boolean(me) && me.why === null && me.total === 1500 && [ME2, D, E, X].every((id) => t.dataFor(id).sent),
        `new run ${fresh !== old}, ${during} during, ${most} at most, Main read in ${pages} pages, ${me ? `${me.total} / ${me.why}` : 'nothing kept'}`);
      // A read from before that fails keeps no failure either: the new run reads the account rather than waiting out a retry.
      const log2 = []; const g2 = gate();
      const u = wallet([[ME, 'Main']], { fetch: archive([], { log: log2, hold: g2.hold, fail: () => true }) });
      const old2 = u.loadKnownAddresses();
      await until(() => log2.length >= 1);
      u.nextSession();
      const fresh2 = u.loadKnownAddresses();
      g2.open(); await Promise.all([old2, fresh2]);
      check('look-alike: a read from before another tab’s change that fails isn’t kept as this session’s failure', log2.length === 2, `${log2.length} reads`);
    }
    {
      const log = [];
      const t = wallet([[ME, 'Main']], { fetch: archive([row(ME, D, 1000), ...many(CAP + 500, L, ME, 2000)], { log }) });
      await t.loadKnownAddresses();
      const w = t.lookalikeWarnings(X);
      check('look-alike: more dust transfers than the check reads (10,500) can’t push out a payee: only the account’s own outgoing transfers are read',
        twinIs(t.lookalikeOf(L), D) && w.complete && w.lines.length === 0 && log.length === 1 && log.every((b) => b.filters && b.filters.source === ME),
        `${log.length} requests, twin ${Boolean(t.lookalikeOf(L))}, complete ${w.complete}`);
    }
    {
      const t = wallet([[ME, 'Main']], { fetch: archive([row(ME, UNRELATED, 1000), ...many(30, L, ME, 2000)]) });
      const me = t.state.accounts[0];
      await t.loadHistory(me); await t.loadFullHistory(me); await t.loadKnownAddresses();
      check('look-alike: an address that only sent you transfers is never “known”, from any read (pasting the genuine one stays quiet)',
        Boolean(t.dataFor(ME).full) && t.lookalikeOf(D) === null && t.lookalikeOf(L) === null && twinIs(t.lookalikeOf(twinOf(UNRELATED, 3, 3)), UNRELATED));
    }
    {
      // Money arriving while the wallet is open: a transfer in to a seed account that's newer than the first read, once
      // the archive says its QUBIC moved, and only once; nothing for what the first read had, for one between your own
      // accounts, or for a watched address.
      const ledger = [row(L, ME, 1000), row(L, W, 1000)];
      const t = wallet([[ME, 'Main'], [ME2, 'Second'], [W, 'Watched', 'watch']], { fetch: archive(ledger) });
      const [me, , watched] = t.state.accounts;
      await t.loadHistory(me); await t.loadHistory(watched);
      const quiet = t.arrivals.length === 0;
      const pending = { ...row(D, ME, 2000), moneyFlew: null };
      ledger.push(pending, row(ME2, ME, 2001), row(L, W, 2002));
      await t.loadHistory(me); await t.loadHistory(watched);
      const waited = t.arrivals.length === 0;
      pending.moneyFlew = true;
      await t.loadHistory(me); await t.loadHistory(watched); await t.loadHistory(me);
      const said = t.arrivals.length === 1 && t.arrivals[0][0] === 'Main' && t.arrivals[0][1].length === 1 && t.arrivals[0][1][0] === pending.hash;
      check('money arriving is said once the archive says it moved, and once only; not for what was there at first, a move between your accounts, or a watched address',
        quiet && waited && said, `${quiet ? 'quiet' : 'said'} at first, ${waited ? 'waited' : 'said'} while unconfirmed, then ${JSON.stringify(t.arrivals)}`);
    }
    {
      // An archive answer without its total is malformed, not the end of the history: the look-alike check doesn't call
      // itself complete on a first page, and Activity's whole-history read isn't taken as whole.
      const t = wallet([[ME, 'Main']], { fetch: archive([row(ME, D, 1000), ...many(1500, ME, L, 2000)], { noTotal: true }) });
      const me = t.state.accounts[0];
      await t.loadHistory(me); await t.loadFullHistory(me); await t.loadKnownAddresses();
      const w = t.lookalikeWarnings(X);
      check('an archive answer without its total isn’t read as the end of the history', !w.complete && !t.dataFor(ME).full, `complete ${w.complete}, full ${Boolean(t.dataFor(ME).full)}`);
    }
    {
      // A read on its way when the wallet locks lands after it: nothing of it is kept or said, so no arrival (an amount and
      // who sent it) shows over the lock screen.
      const ledger = [row(L, ME, 1000)];
      const t = wallet([[ME, 'Main']], { fetch: archive(ledger) });
      const me = t.state.accounts[0];
      await t.loadHistory(me);
      ledger.push(row(L, ME, 2000));
      const late = t.loadHistory(me);
      t.dropSecrets();
      await late;
      check('a history read that lands after a lock says nothing: no arrival over the lock screen', t.arrivals.length === 0, JSON.stringify(t.arrivals));
    }
    {
      // Send and Review's line about the address: how often this wallet sent there, or that it hasn't, which is said
      // only once every seed account's outgoing transfers are read; nothing for your own accounts.
      const t = wallet([[ME, 'Main'], [ME2, 'Second']], { fetch: archive([row(ME, D, 1000), row(ME, D, 1001), row(ME2, E, 1002)]) });
      const before = t.sentHereText(X);
      await t.loadKnownAddresses();
      const twice = t.sentHereText(D); const once = t.sentHereText(E); const never = t.sentHereText(X); const own = t.sentHereText(ME2);
      check('Send’s line about the address: sent to twice or once as read, “haven’t sent” only once everything is read, nothing for your own accounts',
        before === null && twice === 'You’ve sent to this address twice.' && once === 'You’ve sent to this address once.'
          && never === 'You haven’t sent to this address before.' && own === null,
        [before, twice, once, never, own].map(String).join(' / '));
    }
    {
      // The whole history: transactions the latest page adds are merged in with no full read; past a gap (more
      // new ones than the page holds) it waits for the next full read, which comes at most once a minute.
      const log = [];
      const ledger = many(40, L, ME, 2000);
      const t = wallet([[ME, 'Main']], { fetch: archive(ledger, { log }) });
      const me = t.state.accounts[0];
      await t.loadHistory(me); await t.loadFullHistory(me);
      const d = t.dataFor(ME); const first = log.length;
      ledger.push(...many(3, L, ME, 3000));
      await t.loadHistory(me); await t.loadFullHistory(me);
      const merged = log.length === first + 1 && d.full.total === 43 && new Set(d.full.txs.map((x) => x.hash)).size === 43 && d.history.length === 25;
      ledger.push(...many(30, L, ME, 4000));
      await t.loadHistory(me); await t.loadFullHistory(me);
      const waited = log.length === first + 2 && d.full.total === 43;
      d.full.at -= 60000;
      await t.loadFullHistory(me);
      const again = log.length === first + 3 && d.full.total === 73 && d.full.txs.length === 73;
      check('full history: new transactions on the latest page are merged in without reading it all again; past a gap it’s read again, at most once a minute',
        merged && waited && again, `merged ${merged}, waited ${waited}, read again ${again}, ${log.length - first} requests after the first read`);
    }
    {
      const a = wallet([[ME, 'Main']], { fetch: archive([row(ME, D, 1000), ...many(30, L, ME, 2000)], { honours: false }) });
      await a.loadKnownAddresses();
      let fixed = false; // b's archive applies the filter later on
      const ledgerB = [row(ME, D, 1000), ...many(CAP + 10, L, ME, 2000)];
      const b = wallet([[ME, 'Main']], { fetch: archive(ledgerB, { honours: () => fixed }) });
      await b.loadKnownAddresses();
      // A mixed fleet: the first page ignores the filter, later pages apply it (and so report a far smaller total).
      const c = wallet([[ME, 'Main']], { fetch: archive([row(ME, D, 1000), ...many(CAP + 10, L, ME, 2000)], { honours: (q) => q.pagination.offset > 0 }) });
      await c.loadKnownAddresses();
      const wa = a.lookalikeWarnings(X); const wb = b.lookalikeWarnings(X); const wc = c.lookalikeWarnings(X);
      const bBefore = b.lookalikeOf(L);
      // Then b's archive applies the filter, and a transfer out makes the account due for another read.
      fixed = true; ledgerB.push(row(ME, UNRELATED, 95000001));
      const db = b.dataFor(ME); db.balance = { amount: 5n, validForTick: 95000002, lastInTick: 0, lastOutTick: 95000001 }; db.sent.at -= 20000;
      await b.loadKnownAddresses();
      const wb2 = b.lookalikeWarnings(X);
      const unread = (w) => !w.complete && w.lines.length === 1 && w.lines[0].level === 'warn' && w.lines[0].text.startsWith('Not every address “Main” has sent to could be read');
      check('look-alike: an archive that ignores the outgoing filter (on any page): its incoming rows never count; a short history is read in full, a long one is said to be incomplete until a later read finds the filter applied',
        twinIs(a.lookalikeOf(L), D) && a.lookalikeOf(D) === null && wa.complete && wa.lines.length === 0 && bBefore === null && unread(wb) && unread(wc)
        && twinIs(b.lookalikeOf(L), D) && wb2.complete && wb2.lines.length === 0, `${levels(wa)} | ${levels(wb)} → ${levels(wb2)} | ${levels(wc)}`);
    }
    {
      const held = gate();
      const t = wallet([[ME, 'Main'], [W, 'Cold', 'watch']], { fetch: archive([row(ME, UNRELATED, 1000)], { hold: held.hold }) });
      t.state.pending = [{ hash: hashOf(++n), from: ME, to: D, amount: 5n, status: 'waiting' }];
      const twin = t.lookalikeOf(L);
      const reading = t.loadKnownAddresses();
      const fresh = t.lookalikeWarnings(X);
      const watched = t.lookalikeWarnings(W); // picked from Send's quick-picks: an address you only watch
      const own = t.lookalikeWarnings(ME);
      const late = t.lookalikeWarnings(X, Date.now() - t.LOOKALIKE_WAIT_MS - 1);
      held.open(); await reading;
      const done = t.lookalikeWarnings(X);
      check('look-alike: right after unlock a transfer signed here counts at once; the check is waited for while it loads (a watched address too, not your own), then said to be unfinished, never passed',
        twinIs(twin, D) && t.lookalikeText(twin).includes('like an address you’ve sent to once')
        && fresh.waiting && !fresh.complete && levels(fresh) === 'note' && fresh.lines[0].text.startsWith('Checking this address')
        && watched.waiting && levels(watched) === 'note' && !own.waiting && own.lines.length === 0
        && !late.waiting && levels(late) === 'warn' && late.lines[0].text.startsWith('The addresses “Main” has sent to are still loading')
        && done.complete && !done.waiting && done.lines.length === 0,
        `fresh ${levels(fresh)} waiting ${fresh.waiting}, watched ${watched.waiting}, own ${own.waiting}, late ${levels(late)}, done ${done.lines.length}`);
    }
    {
      const t = wallet([[ME, 'Main'], [ME2, 'Savings']]);
      const d = t.dataFor(ME);
      d.sent = { why: 'capped', newest: 0, total: CAP + 1, filtered: true, validForTick: 0, at: Date.now() };
      const capped = t.lookalikeWarnings(X);
      d.sent = null; d.sentErr = new Error('down'); d.sentErrAt = Date.now();
      const failed = t.lookalikeWarnings(X);
      check('look-alike: one account cut at the cap, or failed, and another still loading: the loading one is still waited for and said, next to the other’s line',
        capped.waiting && levels(capped) === 'note,note' && capped.lines[1].text.startsWith('“Main” has sent 10,000 or more transactions')
        && failed.waiting && levels(failed) === 'note,warn' && failed.lines[1].text.startsWith('Not every address “Main” has sent to could be read'),
        `${levels(capped)} | ${levels(failed)}`);
    }
    {
      const log = [];
      const ledger = [row(ME, UNRELATED, 1000), row(ME2, D, 1001), ...many(29, L, ME2, 2000), row(W, E, 1002)];
      const t = wallet([[ME, 'Main'], [ME2, 'Savings'], [W, 'Cold', 'watch']], { fetch: archive(ledger, { log }) });
      await t.loadKnownAddresses();
      const asked = log.map((b) => b.identity);
      const w = t.lookalikeWarnings(X);
      const cold = t.lookalikeOf(twinOf(W, 3, 3));
      check('look-alike: every seed account’s outgoing transfers are read, on screen or not; a watched account’s aren’t and add no gap, but its own address counts',
        asked.includes(ME) && asked.includes(ME2) && !asked.includes(W) && twinIs(t.lookalikeOf(L), D) && t.lookalikeOf(LE) === null && w.complete && w.lines.length === 0
        && twinIs(cold, W) && t.lookalikeText(cold).includes('like your watched account “Cold”'), `asked ${asked.map((i) => i.slice(0, 4)).join(',')}`);
    }
    {
      const log = [];
      const t = wallet([[ME, 'Main']], { fetch: archive([row(ME, D, 1000), ...many(1500, ME, UNRELATED, 2000)], { log }) });
      await t.loadKnownAddresses();
      const u = t.lookalikeOf(twinOf(UNRELATED, 3, 3));
      check('look-alike: an account that has sent more than a page (1,501 transfers) is read to the end',
        twinIs(t.lookalikeOf(L), D) && t.lookalikeWarnings(X).complete && log.length === 2 && Boolean(u) && t.lookalikeText(u).includes('sent to 1,500 times'), `${log.length} requests`);
    }
    {
      const log = []; let tick = 1500;
      const ledger = [row(ME, UNRELATED, 1000)];
      const t = wallet([[ME, 'Main']], { fetch: archive(ledger, { log, tick: () => tick }) });
      await t.loadKnownAddresses();
      const d = t.dataFor(ME);
      d.balance = { amount: 5n, validForTick: 1600, lastInTick: 1600, lastOutTick: 1000 }; // dust arrived since
      d.sent.at -= 20000;
      await t.loadKnownAddresses();
      const afterDust = log.length;
      ledger.splice(0, ledger.length, row(ME, D, 1700)); // paid since; the archive no longer lists the older one
      tick = 1800;
      d.balance = { ...d.balance, validForTick: 1800, lastOutTick: 1700 };
      await t.loadKnownAddresses();
      const afterPayment = log.length;
      d.balance = { ...d.balance, validForTick: 1900, lastOutTick: 1850 }; // another transfer out, seconds later
      await t.loadKnownAddresses();
      check('look-alike: read again only after a transfer out (Core’s lastOutTick), never after dust, at most every 15 s, from the newest page; nothing read before is forgotten',
        afterDust === 1 && afterPayment === 2 && log.length === 2 && log[1].pagination.offset === 0 && twinIs(t.lookalikeOf(L), D)
        && twinIs(t.lookalikeOf(twinOf(UNRELATED, 3, 3)), UNRELATED), `requests: after dust ${afterDust}, after the payment ${afterPayment}, seconds later ${log.length}`);
    }
    {
      const log = []; let tick = 5000;
      const ledger = many(2500, ME, UNRELATED, 1000);
      const t = wallet([[ME, 'Main']], { fetch: archive(ledger, { log, tick: () => tick }) });
      await t.loadKnownAddresses();
      ledger.push(row(ME, D, 6000)); tick = 6100;
      const d = t.dataFor(ME); d.balance = { amount: 5n, validForTick: 6100, lastInTick: 0, lastOutTick: 6000 }; d.sent.at -= 20000;
      await t.loadKnownAddresses();
      check('look-alike: a refresh reads back only as far as the last read (one page, not three again)', log.length === 4 && twinIs(t.lookalikeOf(L), D) && t.lookalikeWarnings(X).complete, `${log.length} requests`);
    }
    {
      // More than a page of transfers out since the last read, a new payee the oldest of them: served newest first,
      // the refresh reads on to the page that reaches the last read; served oldest first, it can't tell, so it reads on.
      const refresh = async (oldestFirst, before, after) => {
        const log = []; let tick = 5000;
        const ledger = [row(ME, D, 900), ...many(before, ME, UNRELATED, 1000)];
        const t = wallet([[ME, 'Main']], { fetch: archive(ledger, { log, tick: () => tick, oldestFirst }) });
        await t.loadKnownAddresses();
        ledger.push(row(ME, X, 6000), ...many(after, ME, UNRELATED, 6001)); tick = 9000;
        const d = t.dataFor(ME); d.balance = { amount: 5n, validForTick: 9000, lastInTick: 0, lastOutTick: 6000 + after }; d.sent.at -= 20000;
        await t.loadKnownAddresses();
        return { found: twinIs(t.lookalikeOf(twinOf(X, 3, 3)), X), requests: log.length, complete: t.lookalikeWarnings(twinOf(X, 3, 3)).complete };
      };
      const newest = await refresh(false, 10, 1500);
      const oldest = await refresh(true, 1001, 10);
      check('look-alike: a refresh after more than a page of new transfers reads on until it reaches the last read, whichever order the archive serves them in',
        newest.found && newest.requests === 3 && newest.complete && oldest.found && oldest.complete, JSON.stringify({ newest, oldest }));
    }
    {
      const ledger = [row(ME, D, 1000), row(ME, D, 1001), row(ME, D, 1002), row(ME, L, 1003), ...many(24, L, ME, 2000)];
      const t = wallet([[ME, 'Main']], { fetch: archive(ledger) });
      await t.loadKnownAddresses();
      const a = t.lookalikeOf(L); const b = t.lookalikeOf(D);
      const ta = a ? t.lookalikeText(a) : ''; const tb = b ? t.lookalikeText(b) : '';
      check('look-alike: after one payment to the look-alike, it and the genuine address are both flagged, each naming the other and how often it was paid, neither called the fake',
        twinIs(a, D) && twinIs(b, L) && ta.includes('like an address you’ve sent to 3 times') && ta.includes('You know this one too, as an address you’ve sent to once')
        && tb.includes('like an address you’ve sent to once') && tb.includes('You know this one too, as an address you’ve sent to 3 times') && ta.includes('One of the two may be')
        && !ta.includes('Scammers send'), `${ta} | ${tb}`);
    }
    {
      const t = wallet([[ME, 'Main']], { contacts: [{ id: 'c1', name: 'Alex', identity: L, createdAt: 1 }], fetch: archive([row(ME, D, 1000)]) });
      await t.loadKnownAddresses();
      const a = t.lookalikeOf(L); const b = t.lookalikeOf(D);
      check('look-alike: a saved look-alike doesn’t turn the warning onto the genuine address; both are flagged, naming each other',
        twinIs(a, D) && twinIs(b, L) && t.lookalikeText(b).includes('like your saved “Alex”') && t.lookalikeText(b).includes('You know this one too, as an address you’ve sent to once')
        && t.lookalikeText(a).includes('You know this one too, as your saved “Alex”'));
    }
    {
      const t = wallet([[ME, 'Main']], { fetch: archive([row(ME, D, 1000)]) });
      await t.loadKnownAddresses();
      check('look-alike: 6 matching letters at the ends warn (3+3, 0+6, 6+0), 5 don’t (3+2), and the address itself doesn’t',
        twinIs(t.lookalikeOf(twinOf(D, 3, 3)), D) && twinIs(t.lookalikeOf(twinOf(D, 0, 6)), D) && twinIs(t.lookalikeOf(twinOf(D, 6, 0)), D)
        && t.lookalikeOf(twinOf(D, 3, 2)) === null && t.lookalikeOf(D) === null);
    }
    {
      let down = true; const log = [];
      const t = wallet([[ME, 'Main']], { fetch: archive([row(ME, D, 1000), ...many(30, L, ME, 2000)], { log, fail: (b) => down && b.filters }) });
      const me = t.state.accounts[0];
      await t.loadHistory(me); await t.loadFullHistory(me); // Activity's pages load; the outgoing read fails
      await t.loadKnownAddresses();
      const failed = t.lookalikeWarnings(X);
      const twin = t.lookalikeOf(L);
      const own = t.lookalikeWarnings(ME);
      const before = log.length;
      await t.loadKnownAddresses(); // within SENT_RETRY_MS of the failure: not tried again yet
      const backedOff = log.length === before;
      t.dataFor(ME).sentErrAt -= t.SENT_RETRY_MS; down = false;
      const retry = t.loadKnownAddresses();
      const retrying = t.lookalikeWarnings(X);
      await retry;
      const after = t.lookalikeWarnings(X);
      // Activity's first page alone names a payee there too.
      const p = wallet([[ME, 'Main']], { fetch: archive([row(ME, D, 3000), ...many(30, L, ME, 2000)], { fail: (b) => b.filters }) });
      await p.loadHistory(p.state.accounts[0]); await p.loadKnownAddresses();
      check('look-alike: an outgoing read that failed is said, not passed, and tried again only after a while (Activity still names the payee); a retry in flight is waited for; your own account gets no gap line',
        !failed.waiting && !failed.complete && levels(failed) === 'warn' && failed.lines[0].text.startsWith('Not every address “Main” has sent to could be read')
        && twinIs(twin, D) && twinIs(p.lookalikeOf(L), D) && own.lines.length === 0 && backedOff && retrying.waiting && after.complete && after.lines.length === 0,
        `failed ${levels(failed)}, twin ${Boolean(twin)} / ${Boolean(p.lookalikeOf(L))}, backed off ${backedOff}, retrying ${retrying.waiting}`);
    }
    {
      // Elasticsearch reports a total of 10,000 or more as exactly 10,000: that is the cap too.
      const log = [];
      const t = wallet([[ME, 'Main']], { fetch: archive(many(CAP + 5, ME, UNRELATED, 1000), { log, totalCap: CAP }) });
      await t.loadKnownAddresses();
      const w = t.lookalikeWarnings(X);
      check('look-alike: an account that has itself sent more than the check reads (10,005, reported as 10,000) gets a plain note naming it, never a pass; Save asks (incomplete)',
        log.length === 10 && t.dataFor(ME).sent.why === 'capped' && !w.complete && !w.waiting && levels(w) === 'note'
        && w.lines[0].text === '“Main” has sent 10,000 or more transactions, so only the latest 10,000 were checked for look-alikes.', w.lines.map((x) => x.text).join(' | '));
    }
    {
      // Paid from another wallet with the same seed: Core's record of the account shows a transfer out that the last
      // read didn't cover and no transfer signed here explains.
      let tick = 1500; let down = false;
      const ledger = [row(ME, UNRELATED, 1000)];
      const t = wallet([[ME, 'Main']], { fetch: archive(ledger, { tick: () => tick, fail: () => down }) });
      await t.loadKnownAddresses();
      const d = t.dataFor(ME);
      d.balance = { amount: 5n, validForTick: 1800, lastInTick: 0, lastOutTick: 1700 };
      const due = t.lookalikeWarnings(X);
      d.sent.at -= 20000;
      await t.loadKnownAddresses(); // the archive, at 1500, doesn't list it yet
      const lagging = t.lookalikeWarnings(X);
      const late = t.lookalikeWarnings(X, Date.now() - t.LOOKALIKE_WAIT_MS - 1);
      d.sent.at -= 20000; down = true;
      await t.loadKnownAddresses(); // the next read fails
      const failed = t.lookalikeWarnings(X);
      t.state.pending = [{ hash: hashOf(++n), from: ME, to: UNRELATED, amount: 5n, targetTick: 1700, status: 'success' }];
      const signedHere = t.lookalikeWarnings(X);
      t.state.pending = [];
      ledger.push(row(ME, D, 1700)); tick = 1800; down = false; d.sentErrAt -= t.SENT_RETRY_MS; d.sent.at -= 20000;
      await t.loadKnownAddresses();
      const read = t.lookalikeWarnings(L);
      check('look-alike: a transfer out made elsewhere (in Core’s record, past the last read) is waited for, then said, until the archive lists it and it is read; a failed read of it is said; one signed here needs none',
        due.waiting && !due.complete && lagging.waiting && !late.waiting && levels(late) === 'warn' && late.lines[0].text.startsWith('The addresses “Main” has sent to are still loading')
        && !failed.waiting && levels(failed) === 'warn' && failed.lines[0].text.startsWith('Not every address “Main” has sent to could be read')
        && signedHere.complete && signedHere.lines.length === 0 && read.twin && read.complete && levels(read) === 'warn',
        `due ${due.waiting}, lagging ${lagging.waiting}, late ${levels(late)}, failed ${levels(failed)}, signed here ${signedHere.complete}, read ${read.twin}/${read.complete}`);
    }
    {
      // Review (holdForCheck): a hold opened with the check's wait still running, and one opened after it ran out.
      const held = gate();
      const t = wallet([[ME, 'Main']], { fetch: archive([row(ME, D, 1000)], { hold: held.hold }) });
      const button = () => ({ disabled: false, cancels: 0, cancel() { this.cancels++; } });
      const fresh = button(); const late = button();
      const readFresh = t.holdForCheck(fresh, L, Date.now());
      const readLate = t.holdForCheck(late, L, Date.now() - t.LOOKALIKE_WAIT_MS - 1);
      const reading = t.loadKnownAddresses();
      readFresh(); readLate(); readFresh(); readLate(); // nothing changed in between
      const before = { fresh: fresh.disabled, late: late.disabled, cancels: fresh.cancels + late.cancels };
      held.open(); await reading;
      const staleBeforeRepaint = readLate.stale(); // the read landed; the screen hasn't repainted yet
      const landed = readLate(); readFresh();
      const staleAfter = readLate.stale();
      readLate(); // and nothing since
      check('look-alike, Review: Hold to send waits while the check runs; once usable, a hold in progress is cancelled when what the check says changes (a late warning), not otherwise',
        before.fresh && !before.late && before.cancels === 0 && landed.twin && !fresh.disabled && !late.disabled && late.cancels === 1,
        `before ${JSON.stringify(before)}, after: fresh ${fresh.disabled}/${fresh.cancels}, late ${late.disabled}/${late.cancels}`);
      check('look-alike, Review: a hold that completes after a new warning landed but before the screen repainted doesn’t send',
        staleBeforeRepaint === true && staleAfter === false, `before the repaint ${staleBeforeRepaint}, after ${staleAfter}`);
    }
    {
      // Review's Hold to send goes through read.guard: a hold completing while the check says something the screen
      // doesn't show yet resets and repaints instead of sending; the next hold sends.
      const held = gate();
      const t = wallet([[ME, 'Main']], { fetch: archive([row(ME, D, 1000)], { hold: held.hold }) });
      const hold = { disabled: false, cancel() {}, resets: 0, reset() { this.resets++; } };
      const read = t.holdForCheck(hold, L, Date.now() - t.LOOKALIKE_WAIT_MS - 1);
      const reading = t.loadKnownAddresses();
      read(); // as painted: still loading
      held.open(); await reading;
      let sent = 0; let repaints = 0;
      const send = () => { sent++; }; const repaint = () => { repaints++; read(); };
      const first = read.guard(send, repaint);
      const afterFirst = { sent, repaints, resets: hold.resets };
      const second = read.guard(send, repaint);
      check('look-alike, Review: a hold completing before a new warning was painted resets and repaints instead of sending; the next hold sends',
        first === false && afterFirst.sent === 0 && afterFirst.repaints === 1 && afterFirst.resets === 1 && second === true && sent === 1,
        `first ${first} ${JSON.stringify(afterFirst)}, second ${second}, sent ${sent}`);
    }
    {
      // Review's dialog (a short press or a screen reader gets "Send …?" instead of the hold): a warning that lands while
      // it's open stops the send when it's answered, though the screen behind it repainted meanwhile. The dialog hands
      // hold.check's answer to confirmSend, which passes it to the guard (asked).
      const held = gate();
      const t = wallet([[ME, 'Main']], { fetch: archive([row(ME, D, 1000)], { hold: held.hold }) });
      const hold = { disabled: false, cancel() {}, resets: 0, reset() { this.resets++; } };
      const read = t.holdForCheck(hold, L, Date.now() - t.LOOKALIKE_WAIT_MS - 1);
      const reading = t.loadKnownAddresses();
      read(); // as painted when the question is asked: still loading, past the wait
      const asked = typeof hold.check === 'function' ? hold.check() : null;
      held.open(); await reading;
      const landed = read(); // the warning, painted behind the dialog
      let sent = 0;
      const send = () => { sent++; }; const repaint = () => { read(); };
      const answered = asked ? read.guard(send, repaint, asked) : null;
      const stopped = { sent, resets: hold.resets };
      // Asked and answered with nothing new: it sends.
      const quiet = typeof hold.check === 'function' ? read.guard(send, repaint, hold.check()) : null;
      check('look-alike, Review: a warning that lands while the Send dialog is open stops the send when the dialog is answered',
        Boolean(asked) && landed.twin && answered === false && stopped.sent === 0 && stopped.resets === 1 && quiet === true && sent === 1,
        `offered ${Boolean(asked)}, twin ${landed.twin}, answered ${answered} ${JSON.stringify(stopped)}, quiet ${quiet}, sent ${sent}`);
    }
    {
      // Add address (saveAnyway): Save waits while the check runs; after the wait it asks before saving.
      const held = gate();
      const t = wallet([[ME, 'Main']], { fetch: archive([row(ME, D, 1000)], { hold: held.hold }) });
      const here = () => true;
      let seen = 0;
      const next = () => (t.dialogs.length > seen ? t.dialogs[seen++] : null); // the next question asked, if any
      const reading = t.loadKnownAddresses();
      const running = t.saveAnyway(L, Date.now(), here);
      const q0 = next(); // none: Save waits instead of asking
      if (q0) q0.answer(false);
      const whileRunning = await running;
      const askedThen = t.dialogs.length;
      const late = Date.now() - t.LOOKALIKE_WAIT_MS - 1;
      const saving = t.saveAnyway(L, late, here);
      const q1 = next();
      held.open(); await reading; // the look-alike is found while that question is open
      if (q1) q1.answer(true);
      await settle();
      const q2 = next();
      if (q2) q2.answer(true);
      await settle();
      for (let q = next(); q; q = next()) q.answer(false); // anything more is a question too many
      const saved = await saving;
      const asked = t.dialogs.length;
      const cancelling = t.saveAnyway(L, late, here);
      const q3 = next();
      if (q3) q3.answer(false);
      const cancelled = await cancelling;
      const clean = await t.saveAnyway(X, late, here); // complete, nothing like it: no question
      const [first, second, third] = [q1, q2, q3].map((q) => (q ? q.title : null));
      check('look-alike, Add address: Save waits while the check runs; then it asks “Save without a full check?”, and a look-alike found while that is open gets its own question before saving; Cancel saves nothing',
        whileRunning === false && askedThen === 0 && first === 'Save without a full check?' && second === 'This address looks like one you know' && saved === true
        && asked === 2 && third === 'This address looks like one you know' && cancelled === false && clean === true && t.dialogs.length === 3,
        `${whileRunning}, asked ${askedThen}; ${first} → ${second} → ${saved}; ${third} → ${cancelled}; clean ${clean}`);
    }
  }

  // A broken or replaced random generator gives a seed others can guess (all zeros give the public all-"a" seed; all
  // 0xFF kept the bundle's generator looping): no seed is made, and a working one still makes fresh seeds. Each stand-in
  // stops after 200 calls, so a generator that loops ends here instead of hanging the run.
  {
    const T = makeTab();
    const real = T.crypto.getRandomValues;
    const made = (fill) => {
      let calls = 0;
      T.crypto.getRandomValues = (a) => { if (++calls > 200) throw new Error('looping'); fill(a, calls); return a; };
      try { return { got: T.t.generateSeed(), calls }; } catch (e) { return { got: e.code || e.message, calls }; } finally { T.crypto.getRandomValues = real; }
    };
    const zeros = made((a) => a.fill(0));
    const ones = made((a) => a.fill(255));
    const same = made((a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 7) & 255; }); // varied bytes, the same every call
    let n = 0;
    const threeLetters = made((a) => { for (let i = 0; i < a.length; i++) a[i] = n++ % 3; }); // never repeats, only 'a'–'c'
    const high = made((a) => { for (let i = 0; i < a.length; i++) a[i] = 234 + (n++ % 22); }); // varied, only bytes the bundle rejects
    const fine = [T.t.generateSeed(), T.t.generateSeed()];
    const said = (r) => `${r.got.length === 55 ? 'a seed' : r.got} after ${r.calls} call(s)`;
    check('a broken random generator makes no seed: constant (zeros, 0xFF), only bytes the bundle rejects (refused before the generator runs) or the same every call is refused, and so is a seed with few letters; a working one makes fresh seeds',
      zeros.got === 'RANDOM' && ones.got === 'RANDOM' && ones.calls <= 2 && high.got === 'RANDOM' && high.calls <= 2 && same.got === 'RANDOM' && threeLetters.got === 'RANDOM'
        && fine.every((s) => /^[a-z]{55}$/.test(s)) && fine[0] !== fine[1],
      [zeros, ones, high, same, threeLetters].map(said).join('; '));
  }

  // Sign a message checks the message against what the wallet holds (messageSeedScope): every held seed, and the
  // addresses of watch-only accounts, whose seeds are recognised when one appears whole. Held accounts' addresses
  // aren't in it (their seeds are).
  {
    const T = makeTab(); const t = T.t;
    const [s1, s2, s3] = [t.generateSeed(), t.generateSeed(), t.generateSeed()];
    const id = (s) => t.deriveAccount(s).identity;
    t.state.accounts = [{ id: 'a0', kind: 'seed', seed: s1, identity: id(s1) }, { id: 'a1', kind: 'seed', seed: s2, identity: id(s2) },
      { id: 'a2', kind: 'watch', identity: id(s3) }];
    const scope = t.messageSeedScope();
    const signing = (message, seedLikeOk = true) => {
      try { t.signMessage({ seed: s1, account: t.deriveAccount(s1), message, walletSeeds: scope.seeds, walletIds: scope.identities, seedLikeOk }); return 'signed'; } catch (e) { return e.code || e.message; }
    };
    const watched = signing(`backup ${s3} keep safe`);
    const other = signing(`seed ${s2} here`);
    const fragment = `piece ${s2.slice(10, 30)} here`;
    const plain = signing('I control this address');
    check('Sign a message: complete watched and held seeds are refused even when confirmed; held addresses aren’t in the scope',
      watched === 'MESSAGE_SEED' && other === 'MESSAGE_SEED' && plain === 'signed' && scope.seeds.length === 2 && scope.identities.length === 1 && scope.identities[0] === id(s3),
      `watch-only ${watched}, held ${other}, plain ${plain}, scope ${scope.seeds.length} seeds / ${scope.identities.length} addresses`);
    check('Sign a message: fragments receive the generic, confirmable warning',
      signing(fragment, false) === 'MESSAGE_SEEDLIKE' && signing(fragment) === 'signed');
  }
  // ── Encrypted mode: a signed transfer is sealed into the wallet record's journal before it's broadcast. If that write
  // fails, or the wallet locks while it's written or before the broadcast, nothing reaches broadcast-transaction and
  // the transfer isn't kept as open. executeSend and broadcastRecord as Review's Hold to send runs them ─────────────────
  {
    const T0 = 90000700;
    const ID = '0123456789abcdef';
    const sendKit = async () => {
      shared.ls.clear(); shared.idb.clear();
      const A = makeTab();
      const { identity } = A.t.deriveAccount(SEED);
      await A.t.Vault.create(P1, { v: 1, accounts: [{ id: ID, name: 'Main', kind: 'seed', seed: SEED, identity, createdAt: 1 }], selection: ID, contacts: [] },
        { auth: A.t.sessionGuard(), expect: null });
      await settle();
      const seen = { broadcasts: 0, journalled: null };
      const net = networkAt({ tick: T0, archive: T0 - 3 });
      // At the broadcast: is the transfer already in the stored journal?
      const B = makeTab({ session: A.session, fetch: async (url, init) => {
        if (!url.includes('broadcast-transaction')) return net(url, init);
        seen.broadcasts++;
        const sent = JSON.parse(init.body).encodedTransaction;
        const key = B.t.state.vault && B.t.state.vault.key; // none once locked
        const entries = key ? await B.t.Journal.read(key, B.t.Vault.current()).catch(() => []) : [];
        seen.journalled = entries.some((e) => e.encoded === sent);
        return new Response(JSON.stringify({ peersBroadcasted: 3 }), { status: 200 });
      } });
      const resumed = await B.t.resumeWallet();
      const send = async () => {
        B.t.dataFor(identity).balance = { amount: 1000n };
        await B.t.executeSend({}, { fromId: ID, from: identity, to: OTHER, amount: 5n });
        await settle();
        const record = B.t.statusShown.at(-1);
        const kept = B.t.state.pending.includes(record);
        const claim = B.t.claimSend(identity);
        B.t.releaseSend(identity); // this claim, or the send's own: the next kit's tab shares the Web Locks
        return { status: record.status, note: String(record.note || ''), kept, free: Boolean(claim), ...seen };
      };
      return { B, resumed, send };
    };
    const show = (r) => `${r.status}${r.note ? ` (${r.note})` : ''}, broadcasts ${r.broadcasts}, journalled ${r.journalled}, ${r.kept ? 'kept' : 'not kept'}, ${r.free ? 'account free' : 'account blocked'}`;
    const stopped = (r) => r.status === 'error' && r.broadcasts === 0 && !r.kept && r.free;
    {
      const { resumed, send } = await sendKit();
      const r = await send();
      check('control: a transfer sent in encrypted mode is in the stored journal when it is broadcast, and tracked after',
        resumed && r.broadcasts === 1 && r.journalled === true && r.status === 'waiting' && r.kept && !r.free, show(r));
    }
    {
      const { resumed, send } = await sendKit();
      shared.failVaultWrites = true;
      const r = await send();
      shared.failVaultWrites = false;
      check('the journal can’t be written: the transfer isn’t broadcast, and the sender is told nothing left this device',
        resumed && stopped(r) && r.note.includes('Nothing left this device'), show(r));
    }
    {
      const { B, resumed, send } = await sendKit();
      const pause = B.pauseNextEncrypt();
      const sending = send();
      const reached = await Promise.race([pause.atGate.then(() => true), new Promise((r) => setTimeout(() => r(false), 5000))]);
      B.t.lockWallet();
      if (reached) pause.release();
      const r = await sending;
      check('the wallet locks while the journal is written: the transfer isn’t broadcast', resumed && reached && stopped(r) && r.note.includes('Nothing was broadcast'),
        `${reached ? '' : 'no journal write, '}${show(r)}`);
    }
    {
      // The lock comes just after the journal write has landed, before the broadcast.
      const { B, resumed, send } = await sendKit();
      const set = shared.ls.set;
      shared.ls.set = function (k, v) { const out = set.call(this, k, v); if (k === VAULT_KEY) { shared.ls.set = set; B.t.lockWallet(); } return out; };
      const r = await send();
      shared.ls.set = set;
      check('the wallet locks once the journal is written, before the broadcast: the transfer isn’t broadcast', resumed && r.status === 'error' && r.broadcasts === 0
        && r.note.includes('Nothing was broadcast'), show(r));
    }
  }
  // The screens use both. Hold to send's one way to send is confirmSend, the only call of executeSend in src/js, which
  // goes through the check's guard; Review's Hold to send is its only caller, for the hold and the dialog alike
  // (holdButton calls onConfirm on both paths, the dialog handing it hold.check's answer); and Sign a message checks
  // against messageSeedScope as typed and when signing. ui-state.cjs runs the two paths.
  {
    const fs = require('fs'); const path = require('path');
    const js = (f) => fs.readFileSync(path.join(SRC, 'js', f), 'utf8');
    const all = fs.readdirSync(path.join(SRC, 'js')).filter((f) => f.endsWith('.js')).sort().map(js).join('\n');
    const count = (text, s) => text.split(s).length - 1;
    const guarded = pickFunction(SRC, '10a2-send-review.js', 'confirmSend').includes('  return readCheck.guard(() => executeSend(sheet, transfer), repaint, asked);\n');
    const wired = js('10a2-send-review.js').includes("holdButton(tr('Hold to send'), (asked) => confirmSend(sheet, transfer, read, repaint, asked));");
    const hold = pickFunction(SRC, '07-ui.js', 'holdButton');
    const paths = `hold ${count(hold, 'onConfirm();')}, dialog ${count(hold, 'onConfirm(same)')}`;
    const sends = count(all, 'executeSend(');
    const confirms = count(all, 'confirmSend(');
    const scoped = count(js('10-sheets.js'), 'messageSeedScope()');
    check('the screens use them: Hold to send sends only through confirmSend and its guard, from the hold and the dialog alike; Sign a message checks against messageSeedScope as typed and when signing',
      guarded && wired && paths === 'hold 1, dialog 1' && sends === 2 && confirms === 2 && scoped === 2,
      `guarded ${guarded}, wired ${wired}, onConfirm: ${paths}, executeSend ${sends}, confirmSend ${confirms}, messageSeedScope ${scoped}`);
  }

  finish('session');
})().catch(harnessError);
