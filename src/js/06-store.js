// ═══════════════════════════════════════════════════════════════════════════
// 7. STATE & DATA
// ═══════════════════════════════════════════════════════════════════════════
// A session: alive() until it ends, when its signal aborts. Each opened wallet has one, ended by a lock, an erase,
// another tab's change to the stored wallet or finding it gone (see nextSession): its requests are aborted (see
// request), and nothing it started writes, says or draws after that. The next one starts at once. While no wallet is
// open (boot, welcome, the lock screen), the current one is the one the next wallet opens in, so an unlock, create or
// import begun there carries on into it. Every read is in a session, the tick and prices too (read only while a wallet
// is open: a lock stops them, and opening one reads them again).
let endCurrentSession = () => {};
/** @returns {Session} */
function openSession() {
  const ctrl = new AbortController();
  endCurrentSession = () => ctrl.abort();
  return { alive: () => !ctrl.signal.aborted, signal: ctrl.signal };
}

/** @type {AppState} */
const state = {
  phase: 'boot',          // boot | welcome | locked | ready
  mode: 'none',           // none | session | vault
  vault: null,            // { key: CryptoKey (non-extractable), header } while unlocked
  accounts: [],           // { id, name, kind: 'seed'|'watch', identity, publicKey, seed?, avatar?, createdAt }
  contacts: [],           // address book: { id, name, identity, createdAt }, sealed with the accounts
  selection: null,        // account id | 'all'
  prefs: Prefs.load(),
  selfTest: { status: 'running', steps: [] },
  // tickAt: the last answer; movedAt: the last answer with a higher tick (see tickStall).
  net: { tick: null, epoch: null, tickAt: 0, movedAt: 0, tickErr: null, msPerTick: null, samples: [] },
  data: new Map(),        // identity → per-account cache
  market: { cg: null, cgErr: null, rpc: null, rpcErr: null, chart: null },
  labels: new Map(),
  labelsLoaded: false,
  exchanges: { gate: null }, // QUBIC deposit and withdrawal status per exchange (see parseGateStatus)
  pending: [],            // signed transfers being tracked: this tab's, plus journalled ones (on unlock or resume, or from other tabs)
  refreshing: false,
  lastActivity: Date.now(),
  session: openSession(), // see openSession
  journalProblem: false,  // the stored journal couldn't be read: sending waits until you've checked
};
// Ends the session (see openSession) and starts the next.
function nextSession() { const end = endCurrentSession; state.session = openSession(); end(); }
// For async work: true while the session it started in is still the current one.
const sessionGuard = () => state.session.alive;

const accountById = (id) => state.accounts.find((a) => a.id === id) || null;
const accountByIdentity = (identity) => state.accounts.find((a) => a.identity === identity) || null;
const currentAccount = () => (state.selection === 'all' ? null : accountById(state.selection));
const scopeAccounts = () => (state.selection === 'all' ? state.accounts : state.accounts.filter((a) => a.id === state.selection));
const seedAccounts = () => state.accounts.filter((a) => a.kind === 'seed');
const canSign = () => state.selfTest.status === 'pass' && trustedContext();

function dataFor(identity) {
  let d = state.data.get(identity);
  if (!d) {
    d = {
      balance: null, balanceErr: null,
      assets: null, assetsErr: null,
      history: null, historyErr: null, historyTotal: 0, historyTick: 0, historyTriedAt: 0, loadingMore: false,
      arrivedFrom: null, announced: new Set(), // money arriving (see noteArrivals)
      full: null, fullErr: null, fullErrAt: 0,
      stale: false, inflight: {},
      sentTo: new Map(), sent: null, sentErr: null, sentErrAt: 0, // the look-alike check's (see loadSent)
    };
    state.data.set(identity, d);
  }
  return d;
}

// ── Change notifications (coalesced to one per frame) ───────────────────────
const listeners = new Set();
function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
let frameQueued = false;
function changed() {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    for (const fn of [...listeners]) {
      try { fn(); } catch (e) { console.error('[wallet] render error:', e && e.message); }
    }
  });
}
// Redraw versions: each counts the changes to one kind of data and is moved where that data changes. A section is drawn
// again when a version it reads has moved (see heroKey and the others in 09-dashboard.js). filters: Activity's kind,
// search, order and how many it shows (09c-activity-view.js).
const versions = { wallet: 0, balances: 0, assets: 0, history: 0, pending: 0, market: 0, net: 0, labels: 0, prefs: 0, filters: 0 };

function setPref(key, value) {
  state.prefs = { ...state.prefs, [key]: value };
  versions.prefs++;
  Prefs.save(state.prefs);
  changed();
}

// ── Accounts ────────────────────────────────────────────────────────────────
/** @returns {Account} */
function buildAccount({ kind, name, seed, identity }) {
  if (kind === 'seed') {
    const d = deriveAccount(seed);
    return { id: randomId(), name: cleanName(name), kind: 'seed', seed, identity: d.identity, publicKey: d.publicKey, createdAt: Date.now() };
  }
  if (checkIdentity(identity).state !== 'valid') throw new AppError('INVALID_IDENTITY');
  return { id: randomId(), name: cleanName(name), kind: 'watch', identity, publicKey: Q.identityToPublicKey(identity), createdAt: Date.now() };
}

function defaultAccountName(kind) {
  if (!state.accounts.length) return kind === 'watch' ? tr('Watched') : tr('Main');
  const n = state.accounts.length + 1;
  return kind === 'watch' ? tr('Watched {number}', { number: n }) : tr('Account {number}', { number: n });
}

// First account of a new wallet; chooses session-only or encrypted storage. auth: the screen that asked for it is still
// there (not backed out of, no lock or erase meanwhile). If it isn't, nothing is kept: the vault is not written, or a
// record already written is deleted again, with its reload key, and the wallet doesn't open.
async function startWallet({ draft, mode, password, auth = sessionGuard() }) {
  const account = buildAccount(draft);
  const abandon = () => { account.seed = null; if (state.accounts.includes(account)) { state.accounts = []; state.selection = null; } };
  if (!auth()) { abandon(); throw new AppError('CANCELLED', trLater('Cancelled.')); }
  state.accounts = [account];
  state.selection = account.id;
  if (mode === 'vault') {
    let made;
    try {
      made = await Vault.create(password, vaultPayload(), { auth, expect: null });
    } catch (e) {
      abandon();
      throw e;
    }
    if (!auth()) {
      abandon();
      Resume.drop(made.resumeTag);
      await leaveCreated(made.header);
      throw new AppError('CANCELLED', trLater('Cancelled.'));
    }
    state.vault = { key: made.key, header: made.header };
    state.mode = 'vault';
  } else {
    state.mode = 'session';
  }
  enterWallet();
}

// A new wallet's record, saved and then given up on: deleted again only if it is still exactly the record written. If
// it stays (another tab opened and changed it, or the browser didn't delete it), that is said, and this tab shows it as
// any saved wallet is shown, locked: none of it is held here.
async function leaveCreated(record) {
  const left = await Vault.discard(record);
  if (left !== 'kept' && left !== 'failed') return;
  if (state.phase !== 'ready') { state.mode = 'vault'; state.phase = 'locked'; showUnlock(); }
  toast(errorText(left === 'failed' ? 'DISCARD_FAILED' : 'DISCARD_KEPT'), left === 'failed' ? 'err' : 'info', 8000);
}

// Account and contact edits run one at a time, including their save and rollback. Queuing only the storage write
// would let a failed earlier edit undo a newer one, or let that newer write capture a change that was just refused.
// A queued edit belongs to the session that requested it; it cannot change a wallet opened after a lock or erase.
let walletEditChain = Promise.resolve();
function editWallet(change) {
  const auth = sessionGuard();
  const done = walletEditChain.then(() => {
    if (!auth()) throw new AppError('CANCELLED', trLater('Cancelled.'));
    return change();
  }).finally(() => { versions.wallet++; });
  walletEditChain = done.catch(() => {});
  return done;
}

// Used inside editWallet: a failed save puts back the change before the next edit starts, unless the session ended.
async function persistOrUndo(undo) {
  const auth = sessionGuard();
  try {
    await persist();
    // persist() writes nothing once the session has ended (a lock while it waited on the vault): that's no save.
    if (!auth()) throw new AppError('CANCELLED', trLater('Cancelled. Nothing was changed.'));
  } catch (e) {
    if (auth()) undo();
    throw e;
  } finally {
    changed();
  }
}

// A save that fails leaves the wallet as it was, so trying again isn't refused as a duplicate. Giving a watch-only
// account its seed adds no account, so the account limit doesn't stop it.
async function addAccount(draft) {
  return editWallet(async () => {
    const account = buildAccount(draft);
    const existing = accountByIdentity(account.identity);
    const { selection, contacts } = state;
    if (existing) {
      if (existing.kind === 'watch' && account.kind === 'seed') {
        existing.kind = 'seed';
        existing.seed = account.seed;
        state.selection = existing.id;
        await persistOrUndo(() => { existing.kind = 'watch'; delete existing.seed; state.selection = selection; });
        return existing;
      }
      throw new AppError('DUPLICATE', trLater('This address is already in your wallet as “{name}”.'), { name: existing.name });
    }
    if (state.accounts.length >= MAX_ACCOUNTS) throw new AppError('LIMIT', trLater('{count, plural, one {A wallet can hold up to # account.} other {A wallet can hold up to # accounts.}}'), { count: MAX_ACCOUNTS });
    state.accounts.push(account);
    state.selection = account.id;
    // Saved in the address book until now: it's one of your accounts instead.
    state.contacts = state.contacts.filter((c) => c.identity !== account.identity);
    await persistOrUndo(() => {
      account.seed = null;
      state.accounts = state.accounts.filter((x) => x !== account);
      state.selection = selection;
      state.contacts = contacts;
    });
    refreshAll();
    return account;
  });
}

async function renameAccount(id, name) {
  return editWallet(async () => {
    const a = accountById(id);
    if (!a) return;
    const before = a.name;
    a.name = cleanName(name, a.name);
    await persistOrUndo(() => { a.name = before; });
  });
}

// Saved with the account; if the save fails, the avatar it had stays.
async function setAccountAvatar(id, look) {
  return editWallet(async () => {
    const a = accountById(id);
    if (!a) return;
    const before = a.avatar;
    a.avatar = cleanAvatar(look);
    await persistOrUndo(() => { a.avatar = before; });
  });
}

// Refused while a transfer from the account is unsettled (or being sent): its send block stays on an account you can
// see and clear, and removing the last account would erase the journal with everything else.
async function removeAccount(id) {
  return editWallet(async () => {
    const i = state.accounts.findIndex((a) => a.id === id);
    if (i < 0) return;
    if (hasOpenTransfer(state.accounts[i].identity)) throw new AppError('REMOVE_BUSY');
    const [gone] = state.accounts.splice(i, 1);
    gone.seed = null;
    state.data.delete(gone.identity);
    // The last account: an encrypted wallet is erased; a session-only one just ends (a wallet another tab saved
    // meanwhile isn't its to erase).
    if (!state.accounts.length) { if (state.mode === 'vault') await forgetEverything(); else endSession(); return; }
    if (state.selection === id || (state.selection === 'all' && state.accounts.length < 2)) state.selection = state.accounts[0].id;
    // Redrawn even when the save fails: the account has already left memory, its seed with it, so there is nothing to
    // put back.
    try { await persist(); } finally { changed(); }
  });
}

// The account in view is kept with the preferences (encrypted mode; session mode saves nothing), not sealed with the
// accounts: rewriting the vault on every switch made every other open tab take it for a change elsewhere, and lock.
function selectScope(selection) {
  state.selection = selection;
  versions.wallet++;
  if (state.mode === 'vault') setPref('selection', selection); else changed();
  refreshAll();
}

// ── Address book ────────────────────────────────────────────────────────────
// Addresses saved under your own names (an exchange deposit address, a friend). Sealed with the accounts in encrypted
// mode, kept in this tab's memory in session mode. Your own accounts and the burn address can't be saved.
const contactById = (id) => state.contacts.find((c) => c.id === id) || null;
const contactByIdentity = (identity) => state.contacts.find((c) => c.identity === identity) || null;
function contactProblem(identity) {
  if (checkIdentity(identity).state !== 'valid') return { text: ERROR_TEXT.INVALID_IDENTITY };
  const own = accountByIdentity(identity);
  if (own) return { text: trLater('That’s your own account “{name}”.'), vars: { name: own.name } };
  if (identityKind(identity) === 'burn') return { text: trLater('That’s the burn address. Anything sent there is destroyed.') };
  const saved = contactByIdentity(identity);
  if (saved) return { text: trLater('Already saved as “{name}”.'), vars: { name: saved.name } };
  return null;
}
// Each change replaces the list, so a save that fails puts back exactly what was there (unless the wallet locked).
async function saveContacts(next) {
  const before = state.contacts;
  state.contacts = next;
  await persistOrUndo(() => { state.contacts = before; });
}
async function addContact({ name, identity }) {
  return editWallet(async () => {
    if (state.contacts.length >= MAX_CONTACTS) throw new AppError('LIMIT', trLater('{count, plural, one {The address book holds up to # address.} other {The address book holds up to # addresses.}}'), { count: MAX_CONTACTS });
    const problem = contactProblem(identity);
    if (problem) throw new AppError('CONTACT', problem.text, problem.vars);
    const contact = { id: randomId(), name: cleanName(name, tr('Saved address')), identity, createdAt: Date.now() };
    await saveContacts([...state.contacts, contact]);
    return contact;
  });
}
async function renameContact(id, name) {
  return editWallet(async () => {
    if (!contactById(id)) return;
    await saveContacts(state.contacts.map((c) => (c.id === id ? { ...c, name: cleanName(name, c.name) } : c)));
  });
}
async function removeContact(id) {
  return editWallet(async () => {
    await saveContacts(state.contacts.filter((c) => c.id !== id));
  });
}
// A saved name that starts with a known exchange's name ("Bitget deposit", "MEXC", "Gate.io") borrows its logo.
const LOGO_ALIASES = { gate: 'gateio' };
function contactLogo(name) {
  const words = String(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (let n = 1; n <= Math.min(3, words.length); n++) {
    const key = logoKey(words.slice(0, n).join(''));
    const logo = exchangeLogo(Object.hasOwn(LOGO_ALIASES, key) ? LOGO_ALIASES[key] : key);
    if (logo) return logo;
  }
  return null;
}

// ── Lock / clear ────────────────────────────────────────────────────────────
// The create/import draft goes, its seed first.
function dropFlow() { if (flow) flow.seed = null; flow = null; }
// JavaScript strings cannot be zeroed; we drop every reference so they become unreachable. That includes a seed
// still held by a create/import flow, and any async work started before: its session ends (see openSession).
function dropSecrets() {
  nextSession();
  versions.wallet++;
  walletEditChain = Promise.resolve();
  Resume.clear();
  dropFlow();
  state.journalProblem = false;
  state.contacts = [];
  for (const a of state.accounts) a.seed = null;
  state.accounts = [];
  state.selection = null;
  state.vault = null;
  state.data.clear();
  state.pending = [];
  closeAllSheets(true);
}

// Another tab changed the stored wallet (accounts or password) under this one: stop and ask for the password again.
function staleTab() { lockWallet(errorText('STALE')); }

function lockWallet(reason) {
  if (state.mode !== 'vault' || state.phase !== 'ready') return;
  dropSecrets();
  state.phase = 'locked';
  showUnlock();
  if (reason) toast(reason, 'info');
}

// The stored wallet was erased or replaced under this open tab (its notice, or a write that found it gone): erased →
// forget it here too, rather than offer to unlock something that's gone; replaced → lock, to stay in sync.
function vaultLost() {
  if (state.mode !== 'vault' || state.phase !== 'ready') return;
  if (!Vault.exists()) { endSession(); toast(tr('The wallet was erased in another tab.'), 'info'); } else lockWallet(tr('The wallet changed in another tab. Locked to stay in sync.'));
}

function endSession() {
  dropSecrets();
  if (Vault.exists()) { state.mode = 'vault'; state.phase = 'locked'; showUnlock(); }
  else { state.mode = 'none'; state.phase = 'welcome'; showWelcome(); }
}

// Erase. The secrets leave memory first, and everything in flight in this tab is cancelled with them (an unlock, a
// password change, a send's journal write). Then the record is deleted under the same cross-tab lock as every write
// (see eraseStored), so no write, here or in another tab, can bring it back. Returns whether it is verifiably gone; if
// the browser kept it, that is said, not reported as erased.
async function forgetEverything() {
  dropSecrets();
  state.phase = 'welcome';
  await eraseStored();
  Resume.purge();
  const gone = Vault.absent();
  if (gone) { state.mode = 'none'; showWelcome(); } else { state.mode = 'vault'; showUnlock(); toast(errorText('ERASE_FAILED'), 'err', 8000); }
  return gone;
}

// An opened vault (an unlock, or a resume after a reload) becomes this tab's wallet: accounts, address book, key and
// journal. Right before taking it in, and again after the journal (an older one is migrated here, which waits on a
// write), the stored record must still be the one opened and the session still current: an erase or a change in
// another tab whose notice hasn't arrived yet is caught here. Any way out short of success drops everything taken in,
// the reload key included, so a locked screen never keeps secrets. Throws (CANCELLED when superseded).
async function adoptVault(opened, auth) {
  let taken = null;
  try {
    const { accounts, selection, contacts } = restoreAccounts(opened.payload);
    if (!auth() || !Vault.still(opened.header)) throw new AppError('CANCELLED', trLater('Cancelled.'));
    taken = accounts;
    state.vault = { key: opened.key, header: opened.header };
    state.accounts = accounts;
    // The account last in view (see selectScope), if it's still there; else the one sealed with the accounts.
    const viewed = state.prefs.selection;
    state.selection = viewed === 'all' || accounts.some((a) => a.id === viewed) ? viewed : selection;
    state.contacts = contacts;
    state.mode = 'vault';
    await adoptJournal(opened, auth);
    if (!auth() || !Vault.still(opened.header)) throw new AppError('CANCELLED', trLater('Cancelled.'));
  } catch (e) {
    // Its own leftovers only: dropped while the wallet in memory is still the one this took in (the same accounts
    // list); if a lock or erase already cleared it, or a newer session is open by now, that is left alone.
    if (taken && state.accounts === taken) dropSecrets();
    Resume.drop(opened.resumeTag);
    throw e;
  }
}

// A reload in the same tab, inside the auto-lock window: reopen the vault with the kept key, no password.
async function resumeWallet() {
  const auth = sessionGuard();
  const kept = await Resume.take();
  if (!kept) return false;
  try {
    await adoptVault({ ...(await Vault.openWithKey(kept.key)), resumeTag: kept.tag }, auth);
  } catch {
    Resume.drop(kept.tag);
    return false;
  }
  enterWallet({ reveal: true });
  state.lastActivity = kept.lastActivity;
  return true;
}

// ── Loading ─────────────────────────────────────────────────────────────────
// Each loader keeps nothing that arrives after its session ended (a lock, an erase, another tab's change): see
// openSession.
function once(d, key, fn) {
  if (d.inflight[key]) return d.inflight[key];
  const alive = sessionGuard();
  const p = fn().finally(() => { d.inflight[key] = null; if (alive()) changed(); });
  d.inflight[key] = p;
  return p;
}

function loadBalance(account) {
  const d = dataFor(account.identity);
  const alive = sessionGuard();
  return once(d, 'balance', async () => {
    const shown = d.balance ? d.balance.amount : Boolean(d.balanceErr);
    try {
      const b = await fetchBalance(account.identity);
      if (!alive()) return;
      if (d.balance && (d.balance.lastInTick !== b.lastInTick || d.balance.lastOutTick !== b.lastOutTick)) d.stale = true;
      d.balance = b; d.balanceErr = null;
    } catch (e) { if (!alive()) return; d.balanceErr = e; }
    // Moved only when what a balance shows changes (its amount, or whether it could be read), so a refresh that reads
    // the same doesn't draw the balance again (and a Retry button keeps its focus).
    if ((d.balance ? d.balance.amount : Boolean(d.balanceErr)) !== shown) versions.balances++;
  });
}

function loadAssets(account) {
  const d = dataFor(account.identity);
  const alive = sessionGuard();
  return once(d, 'assets', async () => {
    const shown = assetsShown(d);
    try {
      const assets = await fetchOwnedAssets(account.identity);
      if (alive()) { d.assets = assets; d.assetsErr = null; }
    } catch (e) { if (alive()) d.assetsErr = e; }
    // As with balances, moved only when what they show changes, so a refresh that reads the same draws nothing again.
    if (assetsShown(d) !== shown) versions.assets++;
  });
}
// What an account's assets show (see scopeAssets): each asset held, or none read yet, and whether the last read failed.
const assetsShown = (d) => `${d.assets ? d.assets.map((x) => `${x.name}:${x.issuer}:${x.units}:${x.decimals}`).join() : 'none'}|${Boolean(d.assetsErr)}`;

// Whether two reads of transactions show the same in Activity: the same rows, in order, each the same in what its row
// and details show (its status comes from moneyFlew).
const TX_SHOWN = /** @type {const} */ (['hash', 'moneyFlew', 'source', 'destination', 'amount', 'tick', 'timestamp', 'inputType', 'inputSize', 'inputData']);
/** @param {ArchiveTx[] | null | undefined} a @param {ArchiveTx[] | null | undefined} b */
const sameTxs = (a, b) => Boolean(a && b && a.length === b.length && a.every((t, i) => TX_SHOWN.every((k) => t[k] === b[i][k])));

function loadHistory(account, { more = false } = {}) {
  const d = dataFor(account.identity);
  const alive = sessionGuard();
  return once(d, more ? 'historyMore' : 'history', async () => {
    if (more) { d.loadingMore = true; versions.history++; changed(); } else d.historyTriedAt = Date.now();
    try {
      // A refresh reads again as many rows as are loaded (up to FULL_HISTORY_PAGE), so what "Load more" added stays.
      const offset = more && d.history ? d.history.length : 0;
      const size = more || !d.history ? HISTORY_PAGE : clamp(d.history.length, HISTORY_PAGE, FULL_HISTORY_PAGE);
      const r = await fetchHistory(account.identity, offset, size);
      // A read that lands after a lock (or another tab's change) belongs to a session that's gone: nothing of it is kept
      // or said, so no arrival shows over the lock screen.
      if (!alive()) return;
      const before = { txs: d.history, total: d.historyTotal };
      if (more && d.history) {
        const seen = new Set(d.history.map((t) => t.hash));
        d.history = d.history.concat(r.txs.filter((t) => !seen.has(t.hash)));
      } else {
        // Loaded rows older than all it read stay, as many as were loaded: those past FULL_HISTORY_PAGE, and those a
        // Load more added while this was on its way. New transactions push the oldest out, so the list (and the next
        // refresh) doesn't grow. A short page is the whole history, so nothing older is left to keep.
        const read = new Set(r.txs.map((t) => t.hash));
        const oldest = r.txs.reduce((m, t) => Math.min(m, t.tick), Infinity);
        const older = d.history && r.txs.length >= size ? d.history.filter((t) => !read.has(t.hash) && t.tick <= oldest) : [];
        const loaded = d.history ? d.history.length : 0;
        d.history = r.txs.concat(older).sort((a, b) => b.tick - a.tick).slice(0, Math.max(r.txs.length, loaded));
      }
      d.history.sort((a, b) => b.tick - a.tick);
      noteSent(d, account, r.txs);
      if (!more && state.accounts.includes(account)) noteArrivals(account, d, r.txs);
      d.historyTotal = r.total; d.historyTick = r.validForTick; d.historyErr = null; d.stale = false;
      // As with balances, moved only when what Activity shows changes, so a refresh that reads the same draws nothing.
      if (!sameTxs(before.txs, d.history) || before.total !== d.historyTotal) versions.history++;
    } catch (e) {
      if (!alive()) return;
      // Activity shows a failure only while nothing has been read (a refresh that fails keeps the list): moved then, for a
      // new kind of failure.
      if (!more) { if (!d.history && (d.historyErr && d.historyErr.kind) !== e.kind) versions.history++; d.historyErr = e; }
      else toast(messageOf(e), 'err');
    } finally {
      if (more) { d.loadingMore = false; versions.history++; }
    }
  });
}

// Money arriving while the wallet is open: a transfer in to a seed account from an address that isn't yours, newer than
// anything this session first read for it, said once the archive says its QUBIC moved (see wentThrough), and only
// once. The first read just sets where to start, so nothing from before shows as new; a lock starts it over.
function noteArrivals(account, d, txs) {
  if (account.kind !== 'seed') return;
  if (d.arrivedFrom === null) { d.arrivedFrom = txs.reduce((m, t) => Math.max(m, t.tick), 0); return; }
  const fresh = txs.filter((t) => t.destination === account.identity && t.tick > d.arrivedFrom && t.amount > 0n
    && !d.announced.has(t.hash) && !accountByIdentity(t.source) && wentThrough(t));
  for (const t of fresh) d.announced.add(t.hash);
  // The notice is a nicety: if it fails, the history this read brought in still counts.
  if (fresh.length) try { announceArrivals(account, fresh); } catch { /* nothing to undo */ }
}

// The whole history, for Activity and the payees the look-alike check knows, brought up to date when the latest page
// is newer than it. What the page covers is added in place (fullTopUp); a gap means reading it all again, at most once
// a minute: a busy address (an exchange's, say) changes all the time, and was read in full again and again. One with
// more transactions than FULL_HISTORY_CAP waits ten minutes between reads.
/** @param {AccountData} d @returns {d is AccountData & { history: ArchiveTx[] }} */
function fullHistoryDue(d) {
  if (!d.history || d.inflight.full) return false;
  if (d.fullErr && Date.now() - d.fullErrAt < 60000) return false;
  if (!d.full) return true;
  if (d.full.total === d.historyTotal && d.full.validForTick >= d.historyTick) return false;
  return Boolean(fullTopUp(d)) || Date.now() - d.full.at >= (d.full.capped ? FULL_HISTORY_CAPPED_MS : FULL_HISTORY_MIN_MS);
}
// The whole history with the latest page merged in, or null when the page doesn't reach back into it (there may be
// transactions between them) or the counts don't add up. Rows it already had take the page's copy, which may say by
// now whether the funds moved.
function fullTopUp(d) {
  const full = d.full;
  if (!full || full.capped || !d.history || d.historyTotal < full.total) return null;
  const byHash = new Map(full.txs.map((t) => [t.hash, t]));
  let added = 0;
  for (const t of d.history) { if (!byHash.has(t.hash)) added++; byHash.set(t.hash, t); }
  if (added === d.history.length || full.total + added !== d.historyTotal) return null;
  return { txs: [...byHash.values()].sort((a, b) => b.tick - a.tick), total: d.historyTotal, validForTick: Math.max(full.validForTick, d.historyTick), capped: false, at: Date.now() };
}
function loadFullHistory(account) {
  const d = dataFor(account.identity);
  if (!fullHistoryDue(d)) return Promise.resolve();
  const alive = sessionGuard();
  return once(d, 'full', async () => {
    try {
      const before = d.full;
      const topped = fullTopUp(d);
      // A short history is already all on the activity page.
      if (d.history.length >= d.historyTotal && d.historyTotal <= HISTORY_PAGE) {
        d.full = { txs: d.history.slice(), total: d.historyTotal, validForTick: d.historyTick, capped: false, at: Date.now() };
      } else if (topped) {
        d.full = topped;
      } else {
        const full = await fetchFullHistory(account.identity);
        if (!alive()) return;
        d.full = { ...full, at: Date.now() };
      }
      if (!before || !sameTxs(before.txs, d.full.txs) || before.total !== d.full.total || before.capped !== d.full.capped) versions.history++;
      noteSent(d, account, d.full.txs);
      d.fullErr = null;
    } catch (e) { if (alive()) { d.fullErr = e; d.fullErrAt = Date.now(); } }
  });
}
// The archive trails the live network by a few ticks: while it was behind an account's latest balance change when the
// page was read, the page is read again every HISTORY_BEHIND_MS until it has caught up.
const historyBehind = (d) => Boolean(d.history && d.balance) && Date.now() - d.historyTriedAt >= HISTORY_BEHIND_MS
  && Math.max(d.balance.lastInTick, d.balance.lastOutTick) > d.historyTick;
const loadHistories = (a) => Promise.all([loadAssets(a), loadHistory(a).then(() => state.accounts.includes(a) && loadFullHistory(a))]);

// fn over the accounts, limit at a time; one no longer in the wallet (locked, erased or removed meanwhile) is skipped.
async function limited(accounts, limit, fn) {
  const queue = accounts.slice();
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) { const a = queue.shift(); if (state.accounts.includes(a)) await fn(a); }
  });
  await Promise.all(workers);
}

// ── Look-alikes (address poisoning) ─────────────────────────────────────────
// A scammer makes an address that starts and ends like one you pay and sends you a dust transfer from it, hoping you
// copy it from your history. Between different addresses, LOOKALIKE_LETTERS or more matching letters at the start and
// end together is that pattern (by chance roughly 1 in 15 million per known address: the last letters vary less than
// the first).
const LOOKALIKE_LETTERS = 6;
function sharedEnds(a, b) {
  let lead = 0;
  while (lead < a.length && a[lead] === b[lead]) lead++;
  let trail = 0;
  while (trail < a.length - lead && a[a.length - 1 - trail] === b[b.length - 1 - trail]) trail++;
  return { lead, trail };
}
// The addresses a seed account has sent to, from every read of its transactions this session (its outgoing-only read,
// its Activity pages and its whole history): d.sentTo, address → hashes of the transfers to it. Only rows the account
// sent count, and only a seed account's (a watched address's payees aren't yours). The list only grows until the
// wallet locks, so a later read that lacks a row can't take it out.
function noteSent(d, account, rows) {
  if (account.kind !== 'seed') return;
  for (const t of rows) {
    if (t.source !== account.identity) continue;
    let hashes = d.sentTo.get(t.destination);
    // A new address: Activity's look-alike check knows it now (see knownIdentities).
    if (!hashes) { d.sentTo.set(t.destination, (hashes = new Set())); versions.history++; }
    hashes.add(t.hash);
  }
}
// Core's record of the account shows a transfer out after what the last read of its outgoing transactions covered.
const outSinceRead = (d) => Boolean(d.sent && d.balance)
  && d.balance.lastOutTick > Math.max(d.sent.validForTick, d.sent.newest);
// A seed account's outgoing transactions, for the look-alike check (see fetchSentTo). Read in full the first time,
// then again only when Core's record of the account shows a transfer out after what was read (lastOutTick: a transfer
// to the account, dust included, never causes a read), at most every 15 s, and then only back to the newest tick read
// before. A failed read is tried again after SENT_RETRY_MS. d.sent: what the reads covered. why: null when every
// outgoing transaction was read; 'capped' when the account has sent SENT_CAP or more (only the newest were read);
// 'partial' when the archive ignored the filter and the account has SENT_CAP or more transactions in all, so transfers
// to it may have pushed a payee out of what was read.
function sentDue(d) {
  if (d.inflight.sent) return false;
  if (d.sentErr && Date.now() - d.sentErrAt < SENT_RETRY_MS) return false;
  return !d.sent || (outSinceRead(d) && Date.now() - d.sent.at > 15000);
}
function loadSent(account) {
  const d = dataFor(account.identity);
  if (!sentDue(d)) return Promise.resolve();
  const since = d.sent ? d.sent.newest : null;
  const alive = sessionGuard();
  return once(d, 'sent', async () => {
    try {
      const r = await fetchSentTo(account.identity, since, alive);
      if (!alive()) return; // a lock or another tab's change since: a read cut short at a page isn't this session's
      noteSent(d, account, r.rows);
      let newest = d.sent ? d.sent.newest : 0;
      for (const t of r.rows) if (t.tick > newest) newest = t.tick;
      // A read that reached the end of the history settles it; a refresh that stopped at the last read keeps its verdict.
      const why = r.end && r.total < SENT_CAP ? null : r.overlap && d.sent ? d.sent.why : r.filtered ? 'capped' : 'partial';
      d.sent = { why, newest, total: r.total, filtered: r.filtered, validForTick: r.validForTick, at: Date.now() };
      d.sentErr = null;
    } catch (e) { if (alive()) { d.sentErr = e; d.sentErrAt = Date.now(); } }
  });
}
// Every seed account's outgoing transactions, whichever accounts are on screen, three at a time. Watch-only accounts
// aren't read: this wallet doesn't pay from them, and a busy watched address's payees aren't yours. One run per session
// at a time: calls while it's going (Send asks on every change) share it. Its three readers take the next account that
// is due and that the run hasn't tried yet, so one that comes due meanwhile (a new seed) is read in the same run, and
// the run always ends: an account due again (a failed read, a transfer out seen since) waits for the next call. A run
// from before a lock is never joined; its reads stop at their next page, and the new run starts once they have, so no
// more than three reads are ever in flight.
let knownRun = null;
function loadKnownAddresses() {
  if (knownRun && knownRun.session === state.session) return knownRun.done;
  const prev = knownRun;
  const run = { session: state.session, tried: new Set() };
  const next = () => seedAccounts().find((a) => !run.tried.has(a.identity) && sentDue(dataFor(a.identity)));
  const reader = async () => {
    for (let a = next(); a && run.session.alive(); a = next()) { run.tried.add(a.identity); await loadSent(a); }
  };
  const start = () => Promise.all([reader(), reader(), reader()]);
  run.done = (prev ? prev.done.then(start) : start()).finally(() => { if (knownRun === run) knownRun = null; });
  knownRun = run;
  return run.done;
}

// What a message to sign is checked against (see seedInMessage), the same for the live note and for signing: the seeds
// this wallet holds, and the addresses of its accounts whose seeds it doesn't hold (watch-only ones), whose seeds are
// recognised by deriving each 55-letter run.
function messageSeedScope() {
  return { seeds: seedAccounts().map((a) => a.seed).filter(Boolean), identities: state.accounts.filter((a) => !a.seed).map((a) => a.identity) };
}

// Every address you know: your accounts, your saved addresses, every address a seed account has sent to (as read so
// far), and every address a transfer signed here is going to (pending or journalled: the archive may not list it yet).
function knownIdentities() {
  const ids = new Set();
  for (const a of state.accounts) ids.add(a.identity);
  for (const c of state.contacts) ids.add(c.identity);
  for (const a of seedAccounts()) for (const id of dataFor(a.identity).sentTo.keys()) ids.add(id);
  for (const p of state.pending) if (p.hash) ids.add(p.to);
  return ids;
}
// How you know one address, or null: account (its name), watch, contact (its name), sent (how many transfers to it).
function knowledgeOf(identity) {
  const acct = accountByIdentity(identity);
  const contact = contactByIdentity(identity);
  const hashes = new Set();
  for (const a of seedAccounts()) for (const hash of dataFor(a.identity).sentTo.get(identity) || []) hashes.add(hash);
  for (const p of state.pending) if (p.hash && p.to === identity) hashes.add(p.hash);
  if (!acct && !contact && !hashes.size) return null;
  return { identity, account: acct ? acct.name : null, watch: Boolean(acct && acct.kind === 'watch'),
    contact: contact ? contact.name : null, sent: hashes.size };
}
// The known address this one most resembles: how you know it, lead and trail (the letters that match at each end), and
// self (how you know this address itself, or null). Knowing an address doesn't clear it: after one mistaken payment to
// a look-alike, or saving one, it is known too, and then it and the genuine one are each flagged, naming the other.
// null when it resembles none. ids: knownIdentities(), when the caller checks many addresses at once.
function lookalikeOf(identity, ids = knownIdentities()) {
  if (!isId(identity)) return null;
  let best = null;
  for (const k of ids) {
    if (k === identity) continue;
    const { lead, trail } = sharedEnds(identity, k);
    if (lead + trail >= LOOKALIKE_LETTERS && (!best || lead + trail > best.lead + best.trail)) {
      best = { identity: k, lead, trail };
    }
  }
  return best && { identity: best.identity, ...knowledgeOf(best.identity), lead: best.lead, trail: best.trail,
    self: knowledgeOf(identity) };
}
// For Send and Review: how often this wallet has sent to the address, as one line, so a paste that isn't the usual
// address stands out. null for your own accounts, and while not every account's outgoing transfers are read (saying
// "first" would then be a guess).
function sentHereText(identity) {
  if (!isId(identity) || accountByIdentity(identity)) return null;
  const k = knowledgeOf(identity);
  if (k && k.sent) {
    return tr('{count, plural, =1 {You’ve sent to this address once.} =2 {You’ve sent to this address twice.} '
      + 'other {You’ve sent to this address # times.}}', { count: k.sent });
  }
  return sentGaps().length ? null : tr('You haven’t sent to this address before.');
}
// A look-alike's first sentence: the ends it shares with an address you know (where: both, start or end), and how you
// know that one (k, see knowledgeOf).
function likeText(k, where) {
  const vars = { where, name: k.account != null ? k.account : k.contact, count: k.sent };
  if (k.account != null) {
    return k.watch
      ? tr('This address {where, select, both {starts and ends} start {starts} other {ends}} like your watched account “{name}”, '
        + 'but it’s a different address.', vars)
      : tr('This address {where, select, both {starts and ends} start {starts} other {ends}} like your account “{name}”, '
        + 'but it’s a different address.', vars);
  }
  if (k.contact != null) {
    return k.sent
      ? tr('This address {where, select, both {starts and ends} start {starts} other {ends}} like your saved “{name}”, '
        + 'sent to {count, plural, =1 {once} =2 {twice} other {# times}}, but it’s a different address.', vars)
      : tr('This address {where, select, both {starts and ends} start {starts} other {ends}} like your saved “{name}”, '
        + 'but it’s a different address.', vars);
  }
  return tr('This address {where, select, both {starts and ends} start {starts} other {ends}} like an address you’ve sent to '
    + '{count, plural, =1 {once} =2 {twice} other {# times}}, but it’s a different address.', vars);
}
// How you know the address itself too (k, see knowledgeOf), as a sentence.
function alsoKnownText(k) {
  const vars = { name: k.account != null ? k.account : k.contact, count: k.sent };
  if (k.account != null) {
    return k.watch ? tr('You know this one too, as your watched account “{name}”.', vars)
      : tr('You know this one too, as your account “{name}”.', vars);
  }
  if (k.contact != null) {
    return k.sent ? tr('You know this one too, as your saved “{name}”, sent to {count, plural, =1 {once} =2 {twice} other {# times}}.', vars)
      : tr('You know this one too, as your saved “{name}”.', vars);
  }
  return tr('You know this one too, as an address you’ve sent to {count, plural, =1 {once} =2 {twice} other {# times}}.', vars);
}
// Neither address is called the fake one when you know both.
function lookalikeText(twin) {
  const where = twin.lead >= 3 && twin.trail >= 3 ? 'both' : twin.lead >= twin.trail ? 'start' : 'end';
  const first = likeText(twin, where);
  if (!twin.self) return tr('{lookalike} Scammers send from look-alike addresses so you’ll copy theirs. {compare}', { lookalike: first, compare: tr(COMPARE) });
  return tr('{lookalike} {alsoKnown} One of the two may be a scammer’s look-alike that '
    + 'was used by mistake. Compare every letter of both with where they really come from.', { lookalike: first, alsoKnown: alsoKnownText(twin.self) });
}
// A transfer out after what was read that no transfer signed here explains (one made with the same seed elsewhere):
// its payee isn't known until the archive lists it and it is read again.
const unexplainedOut = (a, d) => outSinceRead(d)
  && !state.pending.some((p) => p.hash && p.from === a.identity && /** @type {number} */ (p.targetTick) >= d.balance.lastOutTick);
// Seed accounts whose outgoing transactions the check hasn't all seen: { account, why }, why being 'loading' (not read
// yet, a retry included, or an unexplained transfer out since the last read: read again, or waiting for the archive to
// list it), 'failed' (that read failed), or 'capped' or 'partial' (see loadSent).
function sentGaps() {
  const out = [];
  for (const a of seedAccounts()) {
    const d = dataFor(a.identity);
    const why = d.sent && !unexplainedOut(a, d) ? d.sent.why : d.sentErr && !d.inflight.sent ? 'failed' : 'loading';
    if (why) out.push({ account: a, why });
  }
  return out;
}
// The accounts a line names: one or two by name, more by how many.
const namesVars = (accounts) => ({ count: accounts.length, account: accounts[0].name, otherAccount: accounts.length > 1 ? accounts[1].name : '' });
const COMPARE = trLater('Compare every letter with where the address really comes from.');
// The check as Send, Review and Add address show it. since: when that screen started waiting for it.
// { lines: [{ level 'warn' | 'note', icon, text }], twin, waiting, complete }:
//   - a look-alike: a 'warn' line naming both addresses, always first;
//   - accounts whose outgoing transactions are still loading, for up to LOOKALIKE_WAIT_MS after since: a 'note', and
//     waiting (Review's hold and Add address's Save wait); after that they count as unread;
//   - accounts read in part or not at all: a 'warn' line, or a 'note' when the only gap is the owner's own cap.
// complete: every seed account was read in full. Sending to one of your own seed accounts gets only the look-alike
// line.
function lookalikeWarnings(identity, since = Date.now()) {
  /** @type {LookalikeWarnings} */
  const out = { lines: [], twin: false, waiting: false, complete: true };
  if (!isId(identity)) return out;
  const twin = lookalikeOf(identity);
  if (twin) { out.twin = true; out.lines.push({ level: 'warn', icon: 'alert', text: lookalikeText(twin) }); }
  const own = accountByIdentity(identity);
  if (own && own.kind === 'seed') return out;
  const gaps = sentGaps();
  out.complete = !gaps.length;
  const fresh = Date.now() - since < LOOKALIKE_WAIT_MS;
  const loading = gaps.filter((g) => g.why === 'loading');
  const unread = gaps.filter((g) => g.why !== 'loading' || !fresh);
  if (loading.length && fresh) {
    out.waiting = true;
    out.lines.push({ level: 'note', icon: 'hourglass', text: tr('Checking this address against the addresses you’ve sent to…') });
  }
  const cut = unread.filter((g) => g.why === 'capped');
  const missing = unread.filter((g) => g.why !== 'capped');
  if (missing.length) {
    const who = { ...namesVars(missing.map((g) => g.account)), compare: tr(COMPARE) };
    const slow = missing.every((g) => g.why === 'loading');
    out.lines.push({ level: 'warn', icon: 'alert', text: slow
      ? tr('{count, plural, =1 {The addresses “{account}” has sent to are still loading, so this address hasn’t been checked against them yet.} '
        + '=2 {The addresses “{account}” and “{otherAccount}” have sent to are still loading, so this address hasn’t been checked against them yet.} '
        + 'other {The addresses # of your accounts have sent to are still loading, so this address hasn’t been checked against them yet.}} {compare}', who)
      : tr('{count, plural, =1 {Not every address “{account}” has sent to could be read, so this address wasn’t checked against all of them.} '
        + '=2 {Not every address “{account}” and “{otherAccount}” have sent to could be read, so this address wasn’t checked against all of them.} '
        + 'other {Not every address # of your accounts have sent to could be read, so this address wasn’t checked against all of them.}} {compare}', who) });
  }
  if (cut.length) {
    const cap = fmtInt(SENT_CAP);
    out.lines.push({ level: 'note', icon: 'info',
      text: tr('{count, plural, =1 {“{account}” has sent {cap} or more transactions, so only the latest {cap} were checked for look-alikes.} '
        + '=2 {“{account}” and “{otherAccount}” have sent {cap} or more transactions, so only the latest {cap} of each were checked for look-alikes.} '
        + 'other {# of your accounts have sent {cap} or more transactions, so only the latest {cap} of each were checked for look-alikes.}}',
      { ...namesVars(cut.map((g) => g.account)), cap }) });
  }
  return out;
}

let tickInflight = null;
function loadTick() {
  if (tickInflight) return tickInflight;
  const alive = sessionGuard();
  tickInflight = (async () => {
    try {
      const t = await fetchTickInfo();
      if (!alive()) return;
      const now = Date.now();
      const n = state.net;
      if (n.tick != null && t.tick < n.tick) n.samples = [];
      // Only a higher tick is movement: the same tick answered again, or a lower one, is not (see tickStall).
      if (n.tick == null || t.tick > n.tick) n.movedAt = now;
      n.samples.push([t.tick, now]);
      n.samples = n.samples.filter((s) => now - s[1] < 180000).slice(-40);
      const [t0, w0] = n.samples[0];
      if (t.tick > t0 && now - w0 > 8000) n.msPerTick = (now - w0) / (t.tick - t0);
      n.tick = t.tick; n.epoch = t.epoch; n.tickAt = now; n.tickErr = null;
    } catch (e) {
      if (!alive()) return;
      state.net.tickErr = e;
    } finally {
      tickInflight = null;
    }
    versions.net++;
    changed();
    trackPending();
  })();
  return tickInflight;
}

async function loadMarket() {
  const m = state.market;
  const alive = sessionGuard();
  const read = (p, ok, failed) => p.then((r) => { if (alive()) ok(r); }, (e) => { if (alive()) failed(e); });
  const jobs = [read(fetchRpcStats(), (r) => { m.rpc = r; m.rpcErr = null; }, (e) => { m.rpcErr = e; })];
  if (state.prefs.marketData) jobs.push(read(fetchMarketPrice(), (r) => { m.cg = r; m.cgErr = null; }, (e) => { m.cgErr = e; }));
  await Promise.all(jobs);
  if (!alive()) return;
  versions.market++;
  changed();
}

// Gate.io's QUBIC deposit and withdrawal status, while Exchange status is on. A read that fails says nothing about
// that exchange, rather than keeping an older answer.
async function loadExchangeStatus() {
  if (!state.prefs.exchangeStatus) return;
  const ids = Object.keys(STATUS_SOURCES);
  const alive = sessionGuard();
  const read = await Promise.all(ids.map((id) => fetchExchangeStatus(id).catch(() => null)));
  if (!alive()) return;
  state.exchanges = Object.fromEntries(ids.map((id, i) => [id, read[i]]));
  changed();
}

async function loadChart() {
  if (!state.prefs.marketData) return;
  const alive = sessionGuard();
  let chart;
  try { chart = await fetchMarketChart(); } catch { /* the card keeps the chart it had, if any */ }
  if (!alive()) return;
  if (chart) { state.market.chart = chart; versions.market++; }
  changed();
}

// USD price history for "Value when sent": CoinGecko's hourly 90 days and daily year, then
// Gate.io's daily closes before that. Every series is generic, cached, and only requested while market data is on,
// so no price service learns which transaction or account you're looking at.
const priceHistory = { 90: null, 365: null, old: null, pending: {} };
const PRICE_TTL = { 90: 3600000, 365: 3600000, old: 6 * 3600000 };
function loadPriceHistory(key) {
  const cached = priceHistory[key];
  if (cached && Date.now() - cached.at < PRICE_TTL[key]) return Promise.resolve(cached.pts);
  if (!priceHistory.pending[key]) {
    const alive = sessionGuard();
    priceHistory.pending[key] = (key === 'old' ? fetchOldPrices() : fetchPriceHistory(key))
      .then((pts) => { if (alive()) priceHistory[key] = { at: Date.now(), pts }; return pts; })
      .finally(() => { delete priceHistory.pending[key]; });
  }
  return priceHistory.pending[key];
}
// Index of the first point at or after ms (pts sorted by time).
function pointIndex(pts, ms) {
  let lo = 0; let hi = pts.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid][0] < ms) lo = mid + 1; else hi = mid; }
  return lo;
}
async function priceAt(ms) {
  const age = Date.now() - ms;
  if (!state.prefs.marketData || !(age >= 0)) return null;
  const key = age < 89 * DAY_MS ? 90 : age < 364 * DAY_MS ? 365 : 'old';
  const pts = await loadPriceHistory(key).catch(() => null);
  if (!pts) return null;
  const i = pointIndex(pts, ms);
  const near = [pts[i - 1], pts[i]].filter(Boolean).sort((a, b) => Math.abs(a[0] - ms) - Math.abs(b[0] - ms))[0];
  const tolerance = key === 90 ? 2 * 3600000 : 36 * 3600000;
  return near && Math.abs(near[0] - ms) <= tolerance ? { price: near[1] } : null;
}

async function loadLabels() {
  if (!state.prefs.labels || state.labelsLoaded) return;
  const alive = sessionGuard();
  try {
    const labels = await fetchLabels();
    // Turned off while they loaded: not taken in.
    if (alive() && state.prefs.labels) { state.labels = labels; state.labelsLoaded = true; versions.labels++; }
  } catch { /* labels are optional */ }
  if (alive()) changed();
}

// Price shown everywhere: CoinGecko when enabled (has 24h change), else the Qubic RPC stats price.
function priceInfo() {
  const m = state.market;
  if (state.prefs.marketData && m.cg) return { price: m.cg.price, change24h: m.cg.change24h, marketCap: m.cg.marketCap ?? m.rpc?.marketCap ?? null, source: 'CoinGecko', at: m.cg.at };
  if (m.rpc) return { price: m.rpc.price, change24h: null, marketCap: m.rpc.marketCap, source: 'Qubic RPC', at: m.rpc.at };
  return null;
}

const due = { tick: 0, balances: 0, otherBalances: 0, history: 0, market: 0, chart: 0, labels: 0, exchanges: 0 };

async function refreshAll({ manual = false } = {}) {
  if (state.phase !== 'ready') return;
  const now = Date.now();
  due.tick = due.balances = due.otherBalances = due.history = now;
  const scope = scopeAccounts();
  const balances = limited(state.accounts, 4, loadBalance);
  const jobs = [
    loadTick(),
    balances,
    limited(scope, 3, loadHistories),
  ];
  // The look-alike check's outgoing transactions (see loadSent), once the balances are in: read once per account, then
  // only after a transfer out. Not one of the jobs, so the refresh spinner doesn't wait for it.
  balances.then(loadKnownAddresses);
  if (manual || now - due.market > 30000) { due.market = now; jobs.push(loadMarket()); }
  if (state.prefs.marketData && (manual || !state.market.chart)) { due.chart = now; jobs.push(loadChart()); }
  if (state.prefs.labels && !state.labelsLoaded) { due.labels = now; jobs.push(loadLabels()); }
  if (state.prefs.exchangeStatus && (manual || now - due.exchanges >= POLL_MS.exchanges)) { due.exchanges = now; loadExchangeStatus(); }
  state.refreshing = true;
  changed();
  await Promise.allSettled(jobs);
  state.refreshing = false;
  changed();
}

function heartbeat() {
  if (state.phase !== 'ready') return;
  autoLockCheck();
  if (document.hidden || state.phase !== 'ready') return;
  const now = Date.now();
  const busy = state.pending.some((p) => !FINAL.has(p.status));
  if (now - due.tick >= (busy ? POLL_MS.tickFast : POLL_MS.tick)) { due.tick = now; loadTick(); }
  const scope = scopeAccounts();
  if (now - due.balances >= POLL_MS.balances) {
    due.balances = now;
    const all = now - due.otherBalances >= POLL_MS.otherBalances;
    if (all) due.otherBalances = now;
    limited(all ? state.accounts : scope, 4, loadBalance);
  }
  if (now - due.history >= POLL_MS.history) {
    due.history = now;
    limited(scope, 3, loadHistories);
  } else {
    for (const a of scope) {
      const d = dataFor(a.identity);
      if (d.stale) { d.stale = false; loadHistories(a); } else if (historyBehind(d)) loadHistory(a).then(() => state.accounts.includes(a) && loadFullHistory(a));
      else if (fullHistoryDue(d)) loadFullHistory(a);
    }
  }
  if (now - due.market >= POLL_MS.price) { due.market = now; loadMarket(); }
  if (state.prefs.marketData && now - due.chart >= POLL_MS.chart) { due.chart = now; loadChart(); }
  if (state.prefs.labels && !state.labelsLoaded && now - due.labels >= 300000) { due.labels = now; loadLabels(); }
  if (state.prefs.exchangeStatus && now - due.exchanges >= POLL_MS.exchanges) { due.exchanges = now; loadExchangeStatus(); }
}

// ── Auto-lock (encrypted mode) ──────────────────────────────────────────────
// Activity moves the auto-lock deadline, but only while it hasn't passed: input arriving after a long sleep (before
// the heartbeat noticed) locks instead of renewing the session.
function noteActivity() {
  if (autoLockCheck()) return;
  state.lastActivity = Date.now();
  Resume.touch();
}
// Before anything that uses a seed: lock first if the deadline passed; true if the wallet is still open.
function ensureUnlocked() {
  autoLockCheck();
  return state.phase === 'ready';
}
function autoLockCheck() {
  if (state.mode !== 'vault' || state.phase !== 'ready') return false;
  if (Date.now() - state.lastActivity <= autoLockMs()) return false;
  lockWallet(tr('Locked after inactivity'));
  return true;
}

// ── Outgoing transfers ──────────────────────────────────────────────────────
// FINAL: nothing more is expected from the network. SETTLED: also nothing left to reconcile. An unconfirmed outcome
// ('unknown') is final for the progress screen but not settled: it keeps its journal entry and blocks its account until
// a later lookup settles it or you mark it as checked ('dismissed').
const SETTLED = new Set(['success', 'failed', 'not-executed', 'dismissed']);
const FINAL = new Set([...SETTLED, 'unknown']);
/** @type {{ tick: number | null, at: number, inflight: Promise<number> | null }} */
let archive = { tick: null, at: 0, inflight: null };
function archiveTick() {
  if (archive.tick != null && Date.now() - archive.at < POLL_MS.archive) return Promise.resolve(archive.tick);
  if (!archive.inflight) {
    const alive = sessionGuard();
    archive.inflight = fetchArchiveTick().then(
      (t) => { archive = alive() ? { tick: t, at: Date.now(), inflight: null } : { ...archive, inflight: null }; return t; },
      (e) => { archive.inflight = null; throw e; });
  }
  return archive.inflight;
}
// A transfer can execute only in its target tick. It is over once the live tick is past that tick and the archive (what
// the explorer shows) has processed it. Until both say so it may still go through, so it is never given up on as
// unknown or marked as checked, however long the network stalls. Tick numbers keep rising across epochs, so this holds
// through an epoch change too.
const pastTarget = (p) => Number.isSafeInteger(p.targetTick) && state.net.tick != null && state.net.tick > p.targetTick
  && archive.tick != null && archive.tick >= p.targetTick;
// How long the tick has gone without moving up, once that's over TICK_STALL_MS (otherwise 0). Counted to the last
// answer while answers come, and to now while the feed fails, so a gap in polling alone (a hidden tab) isn't a stall.
function tickStall() {
  const n = state.net;
  if (!n.movedAt) return 0;
  const ms = (n.tickErr ? Date.now() : n.tickAt) - n.movedAt;
  return ms > TICK_STALL_MS ? ms : 0;
}

let tracking = false;
async function trackPending() {
  if (tracking) return;
  tracking = true;
  const auth = sessionGuard();
  try {
    for (const p of state.pending) {
      if (!auth()) break;
      if (SETTLED.has(p.status) || p.status === 'error' || p.status === 'signing' || p.status === 'broadcasting') continue;
      // An unconfirmed outcome is looked up again once a minute, unless it is held (p.mismatch: the archive's record
      // differs from the transfer, its tick list contradicts its lookup, or the account's live record can't settle it
      // against the archive): you check those.
      const unknown = p.status === 'unknown';
      if (unknown && (p.mismatch || Date.now() - (p.checkedAt || 0) < 60000)) continue;
      if (unknown) p.checkedAt = Date.now();
      const stale = !unknown && Date.now() - p.createdAt > PENDING_GIVE_UP_MS;
      const tick = state.net.tick;
      if (tick == null || tick <= /** @type {number} */ (p.targetTick)) {
        if (!unknown) p.status = 'waiting';
      } else {
        if (!unknown) p.status = 'confirming';
        await checkPending(p, auth);
        if (!auth()) break;
      }
      // Past the give-up time, whatever can't be settled from the archive is reported as unknown, never as failed; but
      // only once the live tick is past its tick and the archive has processed it (see pastTarget). Until then it
      // waits, however long the network or the archive stalls.
      if (stale && pastTarget(p)) finalizePending(p, 'unknown');
    }
  } finally {
    tracking = false;
    changed();
  }
}

// One lookup of a transfer whose tick has passed, once the archive has processed that tick: settled when the evidence
// allows, unknown when it contradicts the transfer, and otherwise left for the next round.
async function checkPending(p, auth) {
  const processed = await archiveTick().catch(() => null);
  if (!auth() || processed == null || processed < p.targetTick) return;
  let tx = null; let lookup = null;
  try { tx = await fetchTransaction(p.hash); } catch (e) { lookup = e; }
  if (!auth()) return;
  if (tx) {
    // The archive's record has to be the transfer signed here, field by field and byte for byte (see sameAsSigned),
    // and its outcome has to agree with the sending account's live record (see transferOutcome).
    if (!sameAsSigned(tx, p.hash, p.encoded)) {
      p.mismatch = true;
      finalizePending(p, 'unknown', trLater('The network archive returned different details for this transaction. Check it on the explorer.'));
      return;
    }
    // It is in its tick, so it executed there. Whether it moved QUBIC: sent on the archive's moneyFlew = true or
    // Core's event log of it; failed only on Core's own record of the account, when it can't have started afresh
    // since (see transferOutcome). The archive's false alone settles nothing: it also means "no status".
    await settleTransfer(p, { included: true, moneyFlew: tx.moneyFlew, event: null }, auth);
  } else if (lookup && lookup.kind === 'notfound') {
    // "Not found" proves nothing alone. It counts as not executed only when the archive has processed the target
    // tick, that tick's own transaction list (all of it well-formed) doesn't contain this hash, and the account's
    // live record shows nothing sent from that tick on; a list that does contain it contradicts the lookup, and
    // anything less stays unresolved.
    const verdict = await tickVerdict(p.hash, p.targetTick);
    if (!auth()) return;
    if (verdict === 'absent') await settleTransfer(p, { included: false }, auth);
    else if (verdict === 'present') { p.mismatch = true; finalizePending(p, 'unknown', trLater('The archive lists this transaction in its tick but couldn’t return it. Check it on the explorer.')); }
  }
}

// Settles a transfer from the evidence (see transferOutcome): the sending account's live record, then, when the rule
// asks, Core's event log of this transfer. A log that can't be read counts as nothing found.
async function settleTransfer(p, evidence, auth) {
  const live = await fetchOutflow(p.from).catch(() => null);
  if (!auth()) return;
  let r = transferOutcome(evidence, live, p.targetTick, state.net.tick);
  if (r.need === 'event') {
    const logged = await fetchTransferLogged(p.hash, p.targetTick, { source: p.from, destination: p.to, amount: p.amount }).catch(() => false);
    if (!auth()) return;
    r = transferOutcome({ ...evidence, event: logged }, live, p.targetTick, state.net.tick);
  }
  if (r.status === 'wait') return;
  if (r.hold) p.mismatch = true;
  finalizePending(p, r.status, r.note || null);
}

function finalizePending(p, status, note = null) {
  if (SETTLED.has(p.status)) return;
  if (p.status === status) { if (note && p.note !== note) { p.note = note; changed(); } return; }
  p.status = status;
  versions.pending++;
  if (note || SETTLED.has(status)) p.note = note;
  p.resolvedAt = Date.now();
  const text = {
    success: tr('Transfer confirmed on the network'),
    failed: tr('Transfer failed: the network did not move the funds'),
    'not-executed': tr('Transfer not found in its tick. Check the explorer before sending again.'),
    unknown: tr('Couldn’t confirm the transfer. Check it on the explorer; its account won’t send until it’s settled.'),
  }[status];
  if (text) toast(text, status === 'success' ? 'ok' : status === 'unknown' ? 'info' : 'err');
  if (SETTLED.has(status)) releaseSend(p.from);
  saveJournal();
  for (const a of state.accounts) if (a.identity === p.from || a.identity === p.to) { loadBalance(a); loadHistory(a); }
  changed();
}

// After checking an unconfirmed transfer on the explorer: settled by you, so its account can send again. Only once the
// network has passed its tick (see pastTarget): before that it could still execute, and the explorer can't show it.
// true if it was marked.
function dismissTransfer(p) {
  if (p.status !== 'unknown' || !pastTarget(p)) return false;
  p.status = 'dismissed';
  versions.pending++;
  p.note = null;
  p.resolvedAt = Date.now();
  releaseSend(p.from);
  saveJournal();
  changed();
  return true;
}

// One transfer in flight per account. Claimed synchronously, before anything is awaited, so a second confirmation
// can't slip through while the first is still fetching the tick or signing; and, where the browser has Web Locks,
// across this browser's tabs too. Renewed every PENDING_GIVE_UP_MS while this tab tracks the transfer and it can still
// execute; released when it settles, or at the first backstop after it no longer can or a lock forgot it (see
// armBackstop).
const sendClaims = new Map();
function claimSend(identity) {
  if (hasOpenTransfer(identity)) return null;
  /** @type {SendClaim} */
  const claim = { release: () => {}, done: false };
  sendClaims.set(identity, claim);
  armBackstop(identity, claim);
  claim.ready = !locksAvailable() ? Promise.resolve(true) : new Promise((resolve) => {
    navigator.locks.request(`qubic-wallet-send:${identity}`, { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(false); return undefined; }
      resolve(true);
      return new Promise((/** @type {(v?: unknown) => void} */ release) => { claim.release = release; if (claim.done) release(); });
    }).catch(() => resolve(true));
  });
  return claim;
}
// The claim's backstop: one whose transfer never got a record, or whose record went with a lock, is released after
// PENDING_GIVE_UP_MS. While this tab tracks an open transfer from the account that can still execute (the network
// hasn't passed its tick, see pastTarget) it is renewed instead: the claim's lock keeps a tab without this one's
// journal (a session-only wallet with the same seed) from sending meanwhile. Past its tick it can't execute any more,
// so the lock goes even while the record stays unsettled here; this tab's own send block comes from the record.
function armBackstop(identity, claim) {
  claim.backstop = setTimeout(() => {
    if (state.pending.some((p) => p.from === identity && isOpenTransfer(p) && !pastTarget(p))) armBackstop(identity, claim);
    else releaseSend(identity);
  }, PENDING_GIVE_UP_MS);
}
function releaseSend(identity) {
  const claim = sendClaims.get(identity);
  if (!claim) return;
  sendClaims.delete(identity);
  claim.done = true;
  clearTimeout(claim.backstop);
  claim.release();
}

// Encrypted mode: unsettled signed transfers are sealed into the wallet record (see Journal). strict (before a
// broadcast): any failure is thrown, so the transfer isn't sent. Otherwise a failure is reported, and an unreadable
// journal blocks sending until you've checked.
const journalEntries = () => state.pending.filter((p) => p.encoded && isOpenTransfer(p))
  .map((p) => ({ hash: p.hash, encoded: p.encoded, startTick: p.startTick, createdAt: p.createdAt }));
const settledHashes = () => new Set(state.pending.filter((p) => p.hash && SETTLED.has(p.status)).map((p) => p.hash));
function saveJournal({ strict = false } = {}) {
  if (state.mode !== 'vault' || !state.vault || !state.vault.key) return Promise.resolve();
  const auth = sessionGuard();
  const done = Journal.save(() => state.vault, journalEntries, settledHashes, auth);
  const handled = done.catch((e) => {
    // A write from a session that has since ended must not lock, flag or alarm the one now open.
    if (!auth()) throw e;
    if (e.code === 'STALE') staleTab();
    else if (e.code === 'JOURNAL') { state.journalProblem = true; changed(); } else if (!strict && e.code !== 'CANCELLED' && e.code !== 'LOCKED') toast(messageOf(e), 'err');
    throw e;
  });
  return strict ? handled : handled.catch(() => {});
}
// Each entry is decoded and checked again (hash, signature) before it's trusted. One whose sender is no longer among
// these accounts (removed in another tab, or by an earlier version) is tracked all the same: it stays in the journal
// until it settles, and that seed, if imported again, can't send before then.
function restorePending(entries) {
  for (const e of entries) {
    try {
      const bytes = fromB64(e.encoded);
      const d = Q.decodeTransaction(bytes);
      const hash = Q.computeTransactionHash(bytes);
      const from = Q.publicKeyToIdentity(d.sourcePublicKey);
      const to = Q.publicKeyToIdentity(d.destinationPublicKey);
      const acct = accountByIdentity(from);
      if (hash !== e.hash || !Q.verifyTransactionSignature(bytes) || state.pending.some((p) => p.hash === hash)) continue;
      const amount = BigInt(d.amount);
      // Only what this wallet signs: a plain transfer of 1 to MAX_AMOUNT QUBIC (a zero amount would move nothing and
      // still move the account's latest outgoing tick, so it could never be settled honestly).
      if (amount <= 0n || amount > MAX_AMOUNT || d.inputType !== 0 || d.payload.length) continue;
      state.pending.push({
        hash, encoded: e.encoded, from, to, amount, targetTick: Number(d.targetTick), startTick: Number(e.startTick) || null,
        createdAt: Number(e.createdAt) || Date.now(), status: 'waiting', peers: null,
        note: trLater('Restored after the wallet was reopened: checking whether it executed.'),
        draft: acct ? { fromId: acct.id, to, amountRaw: amount.toString() } : null,
      });
      versions.pending++;
    } catch { /* unreadable entry: skipped */ }
  }
  if (state.pending.length) trackPending();
}
// On unlock or resume: the record's journal, plus any left under the previous version's separate key.
async function adoptJournal(opened, auth) {
  if (opened.pending === 'unreadable') state.journalProblem = true;
  else if (opened.pending) restorePending(opened.pending);
  let hasLegacy = false;
  try { hasLegacy = localStorage.getItem(STORAGE_KEYS.journal) != null; } catch { /* storage unreadable: nothing to migrate */ }
  if (!hasLegacy) return;
  // After each wait, only while this is still the session it was started for: a newer one is left alone.
  try {
    const legacy = await Journal.legacy(opened.key);
    if (!auth()) return;
    restorePending(legacy);
    await saveJournal({ strict: true });
    if (!auth()) return;
    localStorage.removeItem(STORAGE_KEYS.journal);
  } catch { if (auth()) state.journalProblem = true; }
}
// Another tab changed only the journal part: take in its entries (accounts unchanged, so no need to lock). Only from
// the record this session holds (same key and accounts part: one stored since under another key or other accounts is
// for that change's own notice to handle), and only into this same session once the entries are read: a lock, an
// erase or a newer session meanwhile leaves the result unused, so it never restores or flags anything there.
function syncJournal() {
  if (state.mode !== 'vault' || !state.vault || state.phase !== 'ready') return;
  let record;
  try { record = Vault.readHeader(); } catch { return; }
  if (!record.pending || !sameAccounts(record, state.vault.header)) return;
  const auth = sessionGuard();
  const vault = state.vault;
  const ours = () => auth() && state.vault === vault;
  Journal.read(vault.key, record).then(
    (entries) => { if (!ours()) return; restorePending(entries); changed(); },
    () => { if (!ours() || !Vault.still(record)) return; state.journalProblem = true; changed(); });
}
// After you've checked recent transfers on the explorer: the unreadable journal is removed so sending can resume.
// If it can't be removed, sending stays paused.
async function clearJournalProblem() {
  const auth = sessionGuard();
  try {
    await vaultUpdate(async (stored) => {
      if (!stored || !auth() || !state.vault || !sameKey(stored, state.vault.header)) return;
      const next = { ...stored };
      delete next.pending;
      Vault.write(next, auth);
    });
  } catch (e) {
    if (auth()) toast(messageOf(e), 'err');
    return;
  }
  if (!auth()) return;
  try { localStorage.removeItem(STORAGE_KEYS.journal); } catch { /* storage blocked: the old key stays and is read again at the next unlock */ }
  state.journalProblem = false;
  changed();
}

const isOpenTransfer = (p) => Boolean(p.hash) && !SETTLED.has(p.status) && p.status !== 'error';
const hasOpenTransfer = (identity) => sendClaims.has(identity) || state.pending.some((p) => p.from === identity && isOpenTransfer(p));
// How a transaction shows in Activity: a transfer this session settled as sent or failed shows that; anything else
// shows the archive's status, where only moneyFlew = true counts (see archivedStatus). A lock or a reload forgets the
// settlement, so a transfer the archive doesn't report as moved then shows as unconfirmed, never as failed.
function txStatus(tx) {
  const own = state.pending.find((p) => p.hash === tx.hash && (p.status === 'success' || p.status === 'failed'));
  return own ? own.status : archivedStatus(tx);
}
// Whether a transaction is known to have gone through: confirmed (the archive's flag, or this session's settlement) or
// executed (a contract call the flag confirms, or a call carrying nothing). Money coming in shows as received (a plus,
// a green amount, its dollar values, the icon lit green) only then; unconfirmed or failed, it's only a transfer to you.
// The UI reads it through describeTx and txLook (09-dashboard.js); it's here so the suites can load and check it.
const wentThrough = (tx) => ['success', 'executed'].includes(txStatus(tx));
