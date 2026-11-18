// Regression checks for edits that overlap a slow save, encryption after its pane is left, and Activity refreshing
// an existing transaction. The production state, storage, handlers and row builder run with the shared tab harness;
// only DOM construction and unrelated screen chrome are stood in. Crypto can be paused to make each race repeatable.
// Also the redraw versions (every change moves the key of the sections showing it) and reads a lock overtook (aborted,
// and nothing they bring back is kept, said or redrawn), against a stand-in network; and Review's Hold to send, whose
// hold and dialog both send through confirmSend.
const path = require('path');
const { appSource, makeTab, shared, localStorage, VAULT_KEY } = require('./lib/tabs.cjs');
const { check, finish, harnessError } = require('./lib/check.cjs');
const { pickFunction, runApp, mutable } = require('./lib/load.cjs');
const [BUILD, SRC] = process.argv.slice(2).map((p) => path.resolve(p));

const app = appSource(BUILD, SRC,
  ['00-config.js', '01-util.js', '01b-i18n.js', '03-qubic.js', '04-storage.js', '05-net.js', '06-store.js', '09c-activity-view.js'],
  [['10-sheets.js', 'enableEncryptionPane'], ['09-dashboard.js', 'paintIf'], ['09-dashboard.js', 'describeTx'],
    ['09-dashboard.js', 'txLook'], ['09-dashboard.js', 'txRow'], ['09-dashboard.js', 'renderActivity'], ['09-dashboard.js', 'activitySourceKey'],
    ['09-dashboard.js', 'heroKey'], ['09-dashboard.js', 'marketKey'], ['09-dashboard.js', 'netKey'], ['09-dashboard.js', 'activityKey'],
    ['09-dashboard.js', 'assetsKey'], ['09-dashboard.js', 'toolkitKey'], ['10-sheets.js', 'accountsKey'], ['10-sheets.js', 'rerunSelfTest'],
    ['10b-whatif.js', 'whatIfKey'], ['10e-orderbook.js', 'orderBooksKey'],
    ['10a3-send-execute.js', 'executeSend'], ['10a3-send-execute.js', 'broadcastRecord']]);
app.mutation('encryption-outlives-pane', '    const auth = () => open && alive();', '    const auth = alive;');
app.mutation('edit-writes-only', '  const done = walletEditChain.then(() => {', '  const done = Promise.resolve().then(() => {');
app.mutation('activity-source-language', "  return [versions.wallet, versions.history, versions.pending, versions.labels, versions.prefs].join('|');",
  "  return [versions.wallet, versions.history, versions.pending, versions.labels].join('|');");
app.mutation('save-after-lock-ok', "    if (!auth()) throw new AppError('CANCELLED', trLater('Cancelled. Nothing was changed.'));\n  } catch (e) {\n    if (auth()) undo();", '  } catch (e) {\n    if (auth()) undo();');
app.mutation('activity-list-unread', "  return [activitySourceKey(), versions.filters, day, inProgress].join('|');", "  return [versions.filters, day, inProgress].join('|');");
// Redraw versions not moved where their data changes: a setting, an account edit, another account picked, a lock, a
// balance (or moved when a read changed nothing), prices, the chart, transactions, the whole history, a transfer
// restored, settled or marked as checked, labels, the tick.
app.mutation('prefs-unbumped', '  versions.prefs++;\n', '');
app.mutation('wallet-edit-unbumped', '  }).finally(() => { versions.wallet++; });', '  });');
app.mutation('scope-unbumped', '  state.selection = selection;\n  versions.wallet++;\n', '  state.selection = selection;\n');
app.mutation('lock-unbumped', '  nextSession();\n  versions.wallet++;\n', '  nextSession();\n');
app.mutation('balance-unbumped', '    if ((d.balance ? d.balance.amount : Boolean(d.balanceErr)) !== shown) versions.balances++;\n', '');
app.mutation('balance-bumped-always', '    if ((d.balance ? d.balance.amount : Boolean(d.balanceErr)) !== shown) versions.balances++;', '    versions.balances++;');
app.mutation('market-unbumped', '  if (!alive()) return;\n  versions.market++;\n', '  if (!alive()) return;\n');
app.mutation('chart-unbumped', 'if (chart) { state.market.chart = chart; versions.market++; }', 'if (chart) { state.market.chart = chart; }');
const HISTORY_BUMP = '      if (!sameTxs(before.txs, d.history) || before.total !== d.historyTotal) versions.history++;';
const FULL_BUMP = '      if (!before || !sameTxs(before.txs, d.full.txs) || before.total !== d.full.total || before.capped !== d.full.capped) versions.history++;';
app.mutation('history-unbumped', `${HISTORY_BUMP}\n`, '');
app.mutation('history-bumped-always', HISTORY_BUMP, '      versions.history++;');
app.mutation('full-unbumped', `${FULL_BUMP}\n`, '');
app.mutation('full-bumped-always', FULL_BUMP, '      versions.history++;');
app.mutation('restore-unbumped', '      versions.pending++;\n    } catch { /* unreadable entry: skipped */ }', '    } catch { /* unreadable entry: skipped */ }');
app.mutation('settle-unbumped', '  p.status = status;\n  versions.pending++;\n', '  p.status = status;\n');
app.mutation('dismiss-unbumped', "  p.status = 'dismissed';\n  versions.pending++;\n", "  p.status = 'dismissed';\n");
app.mutation('labels-unbumped', 'state.labelsLoaded = true; versions.labels++; }', 'state.labelsLoaded = true; }');
app.mutation('tick-unbumped', '    versions.net++;\n    changed();\n    trackPending();', '    changed();\n    trackPending();');
// Assets read (or moved when a read changed nothing), Load more starting and ending, transactions failing (or moved by
// a failure that changes nothing on screen), an address sent to noted, Activity's filters picked, extended or reset,
// and the self-test run again.
app.mutation('assets-unbumped', '    if (assetsShown(d) !== shown) versions.assets++;\n', '');
app.mutation('assets-bumped-always', '    if (assetsShown(d) !== shown) versions.assets++;', '    versions.assets++;');
app.mutation('more-unbumped', '{ d.loadingMore = true; versions.history++; changed(); }', '{ d.loadingMore = true; changed(); }');
app.mutation('more-done-unbumped', '      if (more) { d.loadingMore = false; versions.history++; }', '      if (more) d.loadingMore = false;');
app.mutation('history-error-unbumped', 'if (!d.history && (d.historyErr && d.historyErr.kind) !== e.kind) versions.history++; ', '');
app.mutation('history-error-bumped-always', 'if (!d.history && (d.historyErr && d.historyErr.kind) !== e.kind) versions.history++; ', 'versions.history++; ');
app.mutation('sent-unbumped', '{ d.sentTo.set(t.destination, (hashes = new Set())); versions.history++; }', 'd.sentTo.set(t.destination, (hashes = new Set()));');
app.mutation('filters-set-unbumped', '...change, limit: ACTIVITY_SHOWN }; versions.filters++; }', '...change, limit: ACTIVITY_SHOWN }; }');
app.mutation('filters-more-unbumped', 'limit: activityView.limit + ACTIVITY_SHOWN }; versions.filters++; }', 'limit: activityView.limit + ACTIVITY_SHOWN }; }');
app.mutation('filters-reset-unbumped', "sort: 'newest', limit: ACTIVITY_SHOWN }; versions.filters++; }", "sort: 'newest', limit: ACTIVITY_SHOWN }; }");
app.mutation('selftest-unbumped', '  await runSelfTest();\n  versions.wallet++;\n', '  await runSelfTest();\n');
// A transfer sent: joining the open transfers, leaving them when its journal write failed, its broadcast answered, a
// broadcast retried.
app.mutation('send-unbumped', '    state.pending.unshift(record);\n    versions.pending++;\n', '    state.pending.unshift(record);\n');
app.mutation('send-undo-unbumped', '      state.pending = state.pending.filter((x) => x !== record);\n      versions.pending++;\n',
  '      state.pending = state.pending.filter((x) => x !== record);\n');
app.mutation('broadcast-unbumped', "  record.status = 'waiting';\n  versions.pending++;\n", "  record.status = 'waiting';\n");
app.mutation('retry-unbumped', "  record.status = 'broadcasting';\n  versions.pending++;\n", "  record.status = 'broadcasting';\n");
// What a read keeps, says or redraws once a lock ended its session: each loader's answer, its failure, or its redraw.
app.mutation('redraw-after-lock', '  const p = fn().finally(() => { d.inflight[key] = null; if (alive()) changed(); });', '  const p = fn().finally(() => { d.inflight[key] = null; changed(); });');
app.mutation('balance-kept-after-lock', '      const b = await fetchBalance(account.identity);\n      if (!alive()) return;\n', '      const b = await fetchBalance(account.identity);\n');
app.mutation('balance-error-after-lock', '    } catch (e) { if (!alive()) return; d.balanceErr = e; }', '    } catch (e) { d.balanceErr = e; }');
app.mutation('assets-kept-after-lock', '      if (alive()) { d.assets = assets; d.assetsErr = null; }', '      d.assets = assets; d.assetsErr = null;');
app.mutation('assets-error-after-lock', '    } catch (e) { if (alive()) d.assetsErr = e; }', '    } catch (e) { d.assetsErr = e; }');
app.mutation('full-kept-after-lock', '        const full = await fetchFullHistory(account.identity);\n        if (!alive()) return;\n', '        const full = await fetchFullHistory(account.identity);\n');
app.mutation('full-error-after-lock', '{ if (alive()) { d.fullErr = e; d.fullErrAt = Date.now(); } }', '{ d.fullErr = e; d.fullErrAt = Date.now(); }');
app.mutation('tick-kept-after-lock', '      const t = await fetchTickInfo();\n      if (!alive()) return;\n', '      const t = await fetchTickInfo();\n');
app.mutation('tick-error-after-lock', '    } catch (e) {\n      if (!alive()) return;\n      state.net.tickErr = e;', '    } catch (e) {\n      state.net.tickErr = e;');
app.mutation('market-kept-after-lock', '(r) => { if (alive()) ok(r); }', '(r) => { ok(r); }');
app.mutation('market-error-after-lock', '(e) => { if (alive()) failed(e); }', '(e) => { failed(e); }');
app.mutation('market-redrawn-after-lock', '  await Promise.all(jobs);\n  if (!alive()) return;\n', '  await Promise.all(jobs);\n');
app.mutation('exchanges-after-lock', '  const read = await Promise.all(ids.map((id) => fetchExchangeStatus(id).catch(() => null)));\n  if (!alive()) return;\n',
  '  const read = await Promise.all(ids.map((id) => fetchExchangeStatus(id).catch(() => null)));\n');
app.mutation('chart-after-lock', '  try { chart = await fetchMarketChart(); } catch { /* the card keeps the chart it had, if any */ }\n  if (!alive()) return;\n',
  '  try { chart = await fetchMarketChart(); } catch { /* the card keeps the chart it had, if any */ }\n');
app.mutation('prices-after-lock', '.then((pts) => { if (alive()) priceHistory[key] = { at: Date.now(), pts }; return pts; })', '.then((pts) => { priceHistory[key] = { at: Date.now(), pts }; return pts; })');
app.mutation('labels-after-lock', '    if (alive() && state.prefs.labels) {', '    if (state.prefs.labels) {');
app.mutation('labels-redrawn-after-lock', '  if (alive()) changed();\n}', '  changed();\n}');
app.mutation('archive-after-lock', '(t) => { archive = alive() ? { tick: t, at: Date.now(), inflight: null } : { ...archive, inflight: null }; return t; }',
  '(t) => { archive = { tick: t, at: Date.now(), inflight: null }; return t; }');

// Hold to confirm (07-ui.js), on a small stand-in for the page: the click that ends a hold that completed and was reset
// (a warning landed in its last frame) opens no dialog. On it, Review's Hold to send (sendHold, confirmSend and
// holdForCheck from 10a2-send-review.js), with the look-alike check and the send stood in: the hold and the dialog a
// short press gets both send through confirmSend, and neither sends when the check changed under it.
const hold = mutable([pickFunction(SRC, '07-ui.js', 'holdButton'),
  ...['holdForCheck', 'confirmSend', 'sendHold'].map((name) => pickFunction(SRC, '10a2-send-review.js', name))].join('\n'));
hold.mutation('hold-release-click', '    if (held) { held = false; return; }\n', '');
// The dialog not handing its check to onConfirm; Hold to send sending around confirmSend, or not passing that check on;
// confirmSend sending without the guard; the guard not looking at the dialog's check.
hold.mutation('dialog-unchecked', '    if (onConfirm(same) === false && q.changed)', '    if (onConfirm() === false && q.changed)');
hold.mutation('hold-bypasses-confirm', "holdButton(tr('Hold to send'), (asked) => confirmSend(sheet, transfer, read, repaint, asked));",
  "holdButton(tr('Hold to send'), () => executeSend(sheet, transfer));");
hold.mutation('confirm-asked-dropped', '(asked) => confirmSend(sheet, transfer, read, repaint, asked)', '() => confirmSend(sheet, transfer, read, repaint)');
hold.mutation('confirm-unguarded', '  return readCheck.guard(() => executeSend(sheet, transfer), repaint, asked);', '  executeSend(sheet, transfer);\n  return true;');
hold.mutation('guard-asked-ignored', 'if (read.stale() || (asked && !asked())) {', 'if (read.stale()) {');
const holdKit = () => runApp(`
  const window = { addEventListener() {}, removeEventListener() {} };
  const document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const navigator = {};
  class MutationObserver { observe() {} }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const tr = (s) => s; const icon = () => null;
  const toasts = []; const toast = (m) => { toasts.push(m); };
  const asked = []; let answer = null;
  const confirmDialog = (q) => { asked.push(q.title); return new Promise((r) => { answer = r; }); };
  const anims = [];
  function h(tag, props = {}) {
    return { tag, ...props, isConnected: true, disabled: false, events: {}, classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }, setAttribute() {}, setPointerCapture() {},
      fire(name, e = {}) { for (const fn of this.events[name] || []) fn({ preventDefault() {}, button: 0, key: '', repeat: false, ...e }); },
      animate() { const a = { cancel() {}, currentTime: 0, onfinish: null }; anims.push(a); return a; } };
  }
  // Review's: the look-alike check says what look holds, and each send and each call of confirmSend is counted.
  let look = { waiting: false, lines: [] };
  const lookalikeWarnings = () => look;
  const sends = [];
  const executeSend = (sheet, transfer) => { sends.push(transfer); };
  const hidden = () => false; const fmtInt = String; const shortId = (s) => s;
  ${hold.text}
  let confirms = 0;
  const confirmOnce = confirmSend;
  confirmSend = (...args) => { confirms++; return confirmOnce(...args); };
  return { holdButton, sendHold, toasts, asked, anims, answer: (v) => answer(v), sends, confirms: () => confirms, look: (l) => { look = l; } };`, null);

const PASSWORD = 'amber river cloud lantern';
const SEED = 'abcdefghijklmnopqrstuvwxyz'.repeat(3).slice(0, 55);
const SECOND_SEED = 'zyxwvutsrqponmlkjihgfedcba'.repeat(3).slice(0, 55);
const OTHER = 'BZBQFLLBNCXEMGLOBHUVFTLUPLVCPQUASSILFABOFFBCADQSSUPNWLZBQEXK';
const codeOf = (p) => p.then(() => 'saved', (e) => e.code);
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }

// Focus back on what opened a sheet once a redraw replaced it (placeOf and standIn, 07-ui.js), on a small stand-in for
// the page: a section's card of rows drawn again while the sheet was open. Faults: nothing found, or only by position.
const opener = mutable(['saysOf', 'placeOf', 'standIn'].map((name) => pickFunction(SRC, '07-ui.js', name)).join('\n'));
opener.mutation('opener-not-found', '  const found = same(at) ? at : like.length === 1 ? like[0] : kind(at) ? at : null;', '  const found = null;');
opener.mutation('opener-place-only', '  const found = same(at) ? at : like.length === 1 ? like[0] : kind(at) ? at : null;', '  const found = kind(at) ? at : null;');
const openerKit = () => runApp(`
  class El {
    constructor(tag, says = '', children = []) { this.tagName = tag.toUpperCase(); this.says = says; this.children = []; this.parentElement = null; children.forEach((c) => this.add(c)); }
    add(c) { c.parentElement = this; this.children.push(c); }
    replaceChildren(...cs) { this.children.forEach((c) => { c.parentElement = null; }); this.children = []; cs.forEach((c) => this.add(c)); }
    getAttribute() { return null; }
    get textContent() { return this.says + this.children.map((c) => c.textContent).join(''); }
    querySelectorAll(tag) { return this.children.flatMap((c) => [...(c.tagName === tag ? [c] : []), ...c.querySelectorAll(tag)]); }
  }
  const page = new El('main');
  const document = { contains(el) { for (let at = el; at; at = at.parentElement) if (at === page) return true; return false; } };
  ${opener.text}
  // The tools section: its heading, and a card of rows (each a button saying what it opens).
  const tools = new El('section');
  page.add(tools);
  const draw = (...rows) => { const buttons = rows.map((r) => new El('button', r)); tools.replaceChildren(new El('h2', 'Tools'), new El('div', '', buttons)); return buttons; };
  return { draw, placeOf, standIn };`, null);

function newTab() {
  shared.ls.clear();
  // The network: offline until a check gives it answers (see answers).
  const net = { answer: async () => { throw new TypeError('offline'); } };
  const tab = makeTab(app, `
    let flow = null;
    const toasts = [];
    const closeAllSheets = () => {};
    const toast = (...args) => toasts.push(args);
    const showUnlock = () => {}; const showWelcome = () => {}; const enterWallet = () => {};
    const announceArrivals = () => {};
    const partyName = (id) => accountByIdentity(id)?.name || shortId(id);
    let statusOf = null;
    const sendStatus = (sheet, record) => { statusOf = record; };
    ${app.text}
    refreshAll = async () => {};
    let changes = 0;
    changed = () => { changes++; };
    h = (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat(Infinity).filter(Boolean),
      value: props?.value || '', events: {}, addEventListener(name, cb) { this.events[name] = cb; } });
    fill = (el, ...children) => { el.children = children.flat(Infinity).filter(Boolean); el.paints = (el.paints || 0) + 1; };
    const button = (text, props = {}) => h('button', { text, ...props });
    const busy = () => () => {}; const walletUsername = () => null; const notice = () => null;
    let fields;
    const passwordFields = () => {
      const f = { pw: { value: ${JSON.stringify(PASSWORD)} }, pw2: { value: ${JSON.stringify(PASSWORD)} },
        check: () => null, clear: () => { f.pw.value = ''; f.pw2.value = ''; } };
      fields = f; return f;
    };
    const makeSheet = () => ({ cleanup: [], closed: false,
      setPane(nodes) { this.nodes = nodes; }, onPaneLeave(fn) { this.cleanup.push(fn); },
      close() { this.closed = true; this.cleanup.splice(0).forEach((fn) => fn()); } });
    const renderKeys = new WeakMap(); const activityParts = new WeakMap();
    const WIDE_DASH = { matches: false }; const hidden = () => state.prefs.privacy;
    const activityHead = () => null; const updateActivityToggle = () => {}; const pendingRow = () => null;
    const txLead = () => null; const txArt = () => null; const icon = () => null; const qoreeFace = () => null;
    const qubicText = (n, { sign = '' } = {}) => sign + fmtInt(n);
    const emptyState = (art, title) => h('p', { text: title });
    const skeletonRows = () => null;
    let opened = null;
    const openTxSheet = (tx) => { opened = tx; };
    activityBar = () => ({ el: {}, update(options) { this.options = options; } });
    window.__t = { state, Vault, vaultPayload, buildAccount, addAccount, renameAccount, setAccountAvatar, removeAccount,
      addContact, renameContact, removeContact, selectScope, dropSecrets, enableEncryptionPane, makeSheet, toasts,
      renderActivity, activityParts, dataFor, opened: () => opened, kept: () => activityKept.source,
      // A language picked as Settings picks it (setLanguage), without the page.
      setLang(id) { setPref('lang', id); lang = pickLanguage(state.prefs.lang); },
      setPersist(fn) { persist = fn; },
      setView(v) { activityView = { kind: 'all', query: '', sort: 'newest', limit: 50, ...v }; },
      Q, setPref, versions, heroKey, marketKey, netKey, activitySourceKey, activityKey, assetsKey, toolkitKey, accountsKey, whatIfKey, orderBooksKey,
      priceHistory, archive: () => archive, changes: () => changes, noteSent, setActivityView, moreActivity, resetActivityView, rerunSelfTest,
      loadBalance, loadAssets, loadHistory, loadFullHistory, loadMarket, loadChart, loadLabels, loadTick, loadExchangeStatus, loadPriceHistory,
      archiveTick, restorePending, finalizePending, dismissTransfer, executeSend, broadcastRecord, releaseSend, sent: () => statusOf };
  `, { extra: { requestAnimationFrame: () => {}, setInterval, clearInterval, fetch: (url, init) => net.answer(url, init) } });
  tab.net = net;
  return tab;
}
// A network that answers every read the wallet makes, well formed: the tick, balances, assets, transactions, the
// archive's tick, prices, the chart and price history, labels and exchange status.
function answers() {
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status });
  return async (url, init) => {
    if (url.includes('tick-info')) return json({ tickInfo: { tick: 6000, epoch: 200 } });
    const balance = url.match(/\/balances\/([A-Z]{60})$/);
    if (balance) return json({ balance: { id: balance[1], balance: '7', latestIncomingTransferTick: 100, latestOutgoingTransferTick: 0 } });
    if (url.includes('/owned')) return json({ ownedAssets: [] });
    if (url.includes('getTransactionsForIdentity')) {
      const { identity, pagination } = JSON.parse(init.body);
      return json({ hits: { total: 1, from: 0, size: pagination.size }, validForTick: 100, transactions: [{ hash: 'd'.repeat(60), source: OTHER,
        destination: identity, amount: '10', tickNumber: 100, timestamp: '1700000000000', inputType: 0, inputSize: 0, inputData: '', signature: '', moneyFlew: true }] });
    }
    if (url.includes('getLastProcessedTick')) return json({ tickNumber: 5000, epoch: 200 });
    if (url.includes('latest-stats')) return json({ data: { price: 0.000002, marketCap: '1000', circulatingSupply: '100', burnedQus: '10', timestamp: '1700000000' } });
    if (url.includes('simple/price')) return json({ 'qubic-network': { usd: 0.000002, usd_24h_change: 1.5, usd_market_cap: 1000, last_updated_at: 1700000000 } });
    if (url.includes('market_chart')) return json({ prices: [[1700000000000, 0.000001], [1700003600000, 0.000002]] });
    if (url.includes('smart_contracts')) return json({ smart_contracts: [{ address: OTHER, name: 'Contract', label: 'Contract' }] });
    if (url.includes('exchanges.json')) return json({ exchanges: [] });
    if (url.includes('address_labels')) return json({ address_labels: [] });
    if (url.includes('currencies/QUBIC')) return json({ currency: 'QUBIC', deposit_disabled: false, withdraw_disabled: false });
    return json({ message: 'not found' }, 404);
  };
}
// A journal entry for a transfer of 5 QUBIC from SEED to OTHER with that target tick.
async function signedEntry(Q, targetTick) {
  const signed = await Q.signTransaction(Q.buildTransaction({ source: Q.deriveKeys(SEED).publicKey, destination: OTHER, amount: 5n, targetTick, inputType: 0,
    currentTick: targetTick - 10 }), SEED);
  return { hash: Q.computeTransactionHash(signed), encoded: Q.encodeTransaction(signed), startTick: targetTick - 10, createdAt: Date.now() };
}
const idle = () => new Promise((r) => setTimeout(r, 20));

function session(t) {
  t.state.phase = 'ready'; t.state.mode = 'session'; t.state.selfTest.status = 'pass';
  const account = t.buildAccount({ kind: 'seed', name: 'Original', seed: SEED });
  t.state.accounts = [account]; t.state.selection = account.id;
  return account;
}
async function vault(t) {
  const account = session(t);
  const made = await t.Vault.create(PASSWORD, t.vaultPayload(), { auth: () => true });
  t.state.vault = { key: made.key, header: made.header }; t.state.mode = 'vault';
  return account;
}
const saved = async (t) => (await t.Vault.openWithKey(t.state.vault.key)).payload;
function encrypt(t) {
  const sheet = t.makeSheet();
  t.enableEncryptionPane(sheet, null);
  const submit = () => sheet.nodes[1].events.submit({ preventDefault() {} });
  return { sheet, submit };
}
function find(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node?.children || []) { const hit = find(child, predicate); if (hit) return hit; }
  return null;
}
const byClass = (node, cls) => find(node, (n) => {
  const value = n?.props?.class;
  return (Array.isArray(value) ? value : typeof value === 'string' ? value.split(' ') : []).includes(cls);
});

(async () => {
  // Leaving encryption during KDF cancels it before a vault can be committed. A newly added seed remains session-only;
  // a later, explicit encryption must include it. Submitting twice must not start two password derivations.
  {
    const tab = newTab(); const t = tab.t; session(t);
    const derive = t.Vault.deriveRaw; const atKdf = deferred(); const resume = deferred(); let derivations = 0;
    t.Vault.deriveRaw = async (...args) => { derivations++; atKdf.resolve(); await resume.promise; return derive(...args); };
    const flow = encrypt(t); const saving = flow.submit();
    await atKdf.promise;
    await flow.submit();
    flow.sheet.close();
    const adding = t.addAccount({ kind: 'seed', name: 'Added later', seed: SECOND_SEED });
    resume.resolve(); await Promise.all([saving, adding]);
    check('encryption: leaving during KDF keeps the wallet session-only and saves no outdated snapshot',
      t.state.mode === 'session' && localStorage.getItem(VAULT_KEY) === null && t.state.accounts.length === 2
      && !t.toasts.some(([text]) => text === 'Encrypted and saved on this device'));
    check('encryption: duplicate submit starts only one derivation', derivations === 1, String(derivations));
    await encrypt(t).submit();
    const payload = await saved(t);
    check('encryption: retry includes both seeds and reports success', t.state.mode === 'vault' && payload.accounts.length === 2
      && payload.accounts[1].seed === SECOND_SEED && t.toasts.some(([text]) => text === 'Encrypted and saved on this device'));
  }
  // The pane guard must still hold at the actual write, after AES-GCM has finished.
  {
    const tab = newTab(); const t = tab.t; session(t);
    const gate = tab.pauseNextEncrypt(); const flow = encrypt(t); const saving = flow.submit();
    await gate.atGate; flow.sheet.close(); gate.release(); await saving;
    check('encryption: leaving during AES-GCM also cancels the saved record', t.state.mode === 'session' && localStorage.getItem(VAULT_KEY) === null);
  }
  // An edit requested during encryption runs after it commits, using encrypted persistence rather than disappearing
  // from a snapshot taken before KDF. This also checks that the edit queue and the storage queue do not deadlock.
  {
    const tab = newTab(); const t = tab.t; session(t);
    const gate = tab.pauseNextEncrypt(); const flow = encrypt(t); const saving = flow.submit();
    await gate.atGate;
    const adding = t.addAccount({ kind: 'seed', name: 'Queued account', seed: SECOND_SEED });
    gate.release(); await Promise.all([saving, adding]);
    const payload = await saved(t);
    check('encryption: an overlapping account edit is saved after encryption commits',
      t.state.accounts.length === 2 && payload.accounts.length === 2 && payload.accounts[1].seed === SECOND_SEED);
  }
  // One transient failure, followed by a successful rename. The old code saved the second name but rolled memory back
  // to the original one; another ordinary save would then silently replace the successful name on disk.
  {
    const tab = newTab(); const t = tab.t; const account = await vault(t);
    const write = t.Vault.write; let writes = 0;
    t.Vault.write = (...args) => { if (++writes === 1) { const e = new Error('quota'); e.code = 'STORAGE'; throw e; } return write(...args); };
    const gate = tab.pauseNextEncrypt(); const first = codeOf(t.renameAccount(account.id, 'First rename'));
    await gate.atGate;
    const second = codeOf(t.renameAccount(account.id, 'Second rename'));
    gate.release(); const outcomes = await Promise.all([first, second]);
    check('edits: failed rename rolls back before a newer successful rename starts', outcomes.join() === 'STORAGE,saved'
      && account.name === 'Second rename' && (await saved(t)).accounts[0].name === 'Second rename', outcomes.join());
    await t.setAccountAvatar(account.id, { color: 2, finish: 'aqua' });
    check('edits: an unrelated later save preserves the successful name', (await saved(t)).accounts[0].name === 'Second rename');
  }
  // Validation and list snapshots must happen inside the edit queue too: a rejected addition must not leak into the
  // next addition's successful write, and two successful additions must build on each other.
  {
    const tab = newTab(); const t = tab.t; await vault(t);
    const gate = tab.pauseNextEncrypt();
    const first = codeOf(t.addContact({ name: 'Rejected', identity: OTHER }));
    await gate.atGate;
    const nextIdentity = t.buildAccount({ kind: 'seed', name: 'External', seed: SECOND_SEED }).identity;
    const second = codeOf(t.addContact({ name: 'Kept', identity: nextIdentity }));
    // Refuse just the next write, rather than every later edit.
    const write = t.Vault.write; let writes = 0;
    t.Vault.write = (...args) => { if (++writes === 1) { const e = new Error('quota'); e.code = 'STORAGE'; throw e; } return write(...args); };
    gate.release(); const outcomes = await Promise.all([first, second]);
    const payload = await saved(t);
    check('edits: failed contact addition is absent from memory and the next successful save', outcomes.join() === 'STORAGE,saved'
      && t.state.contacts.length === 1 && t.state.contacts[0].name === 'Kept' && payload.contacts.length === 1 && payload.contacts[0].name === 'Kept');
    await Promise.all([t.addContact({ name: 'Another', identity: OTHER }), t.renameContact(t.state.contacts[0]?.id, 'Renamed')]);
    check('edits: overlapping successful contact edits build on the latest list', t.state.contacts.length === 2
      && t.state.contacts[0].name === 'Renamed' && (await saved(t)).contacts.length === 2);
  }
  // Queued edits from a locked session cannot run against a newer session, even when it has the same account ID.
  {
    const tab = newTab(); const t = tab.t; const account = await vault(t); const kept = t.state.vault;
    const gate = tab.pauseNextEncrypt(); const first = codeOf(t.renameAccount(account.id, 'Old in flight'));
    await gate.atGate; const second = codeOf(t.renameAccount(account.id, 'Old queued'));
    t.dropSecrets();
    const replacement = { ...account, name: 'New session', seed: SEED };
    t.state.accounts = [replacement]; t.state.selection = replacement.id; t.state.vault = kept;
    const current = codeOf(t.renameAccount(replacement.id, 'Current edit'));
    gate.release(); const outcomes = await Promise.all([first, second, current]);
    check('edits: locking cancels old queued changes without undoing the new session', outcomes.join() === 'CANCELLED,CANCELLED,saved'
      && replacement.name === 'Current edit' && (await saved(t)).accounts[0].name === 'Current edit', outcomes.join());
  }
  // Removing the final account deliberately ends its own session. That successful operation must still resolve,
  // while any edit queued behind it is cancelled and cannot recreate the removed account or vault.
  for (const mode of ['session', 'vault']) {
    const tab = newTab(); const t = tab.t; const account = mode === 'vault' ? await vault(t) : session(t);
    const removal = codeOf(t.removeAccount(account.id));
    const lateRename = codeOf(t.renameAccount(account.id, 'Too late'));
    const outcomes = await Promise.all([removal, lateRename]);
    check('edits: removing the final ' + mode + ' account succeeds and cancels later edits', outcomes.join() === 'saved,CANCELLED'
      && t.state.accounts.length === 0 && t.state.mode === 'none' && localStorage.getItem(VAULT_KEY) === null, outcomes.join());
  }
  // Keep the history count, first hash and full-history timestamp unchanged, as happens when a capped full read is
  // still cached. Both the plain list and the filtered source must pick up the latest page's changed status.
  for (const [name, view] of [['plain', {}], ['filtered', { kind: 'in' }], ['searched', { query: 'received' }]]) {
    const tab = newTab(); const t = tab.t; const account = session(t); t.setView(view);
    const tx = { hash: 'a'.repeat(60), source: OTHER, destination: account.identity, amount: 10n,
      tick: 100, timestamp: Date.now() - 10000, inputType: 0, inputSize: 0, inputData: '', moneyFlew: null };
    const d = t.dataFor(account.identity);
    d.history = [tx]; d.historyTotal = 1; d.full = { at: 1, txs: [tx], capped: true };
    const el = {}; t.renderActivity(el);
    const list = t.activityParts.get(el).list; const initialPaints = list.paints;
    if (name !== 'searched') check('activity ' + name + ': starts unconfirmed', byClass(list, 'row-title')?.props.text === 'Transfer to you'
      && byClass(list, 'row-note')?.props.text === 'Unconfirmed');
    // Taken in as loadHistory takes a read in (its version: see the redraw checks).
    const took = (txs) => { d.history = txs; t.versions.history++; };
    const confirmed = { ...tx, moneyFlew: true }; took([confirmed]);
    t.renderActivity(el);
    const row = byClass(list, 'row'); row?.props.onClick();
    check('activity ' + name + ': confirmation updates the row and its details without changing the hash', list.paints > initialPaints
      && byClass(list, 'row-title')?.props.text === 'Received' && byClass(list, 'row-note')?.props.text !== 'Unconfirmed' && t.opened() === confirmed);
    const stablePaints = list.paints; t.renderActivity(el);
    check('activity ' + name + ': unchanged data keeps the same row', list.paints === stablePaints);
    const corrected = { ...confirmed, timestamp: confirmed.timestamp + 60000 }; took([corrected]); t.renderActivity(el);
    byClass(list, 'row')?.props.onClick();
    check('activity ' + name + ': corrected details replace the click handler too', t.opened() === corrected);
  }
  // A filtered list can show the same transaction from either account's perspective. A shared hash must not keep
  // the other scope's direction or wording.
  {
    const tab = newTab(); const t = tab.t; const account = session(t);
    const other = t.buildAccount({ kind: 'watch', name: 'Other account', identity: OTHER });
    t.state.accounts.push(other); t.setView({ sort: 'oldest' });
    const tx = { hash: 'b'.repeat(60), source: OTHER, destination: account.identity, amount: 10n,
      tick: 100, timestamp: Date.now() - 10000, inputType: 0, inputSize: 0, inputData: '', moneyFlew: true };
    for (const a of [account, other]) Object.assign(t.dataFor(a.identity), { history: [tx], historyTotal: 1, full: { at: 1, txs: [tx], capped: false } });
    const el = {}; t.renderActivity(el); const list = t.activityParts.get(el).list;
    const incoming = byClass(list, 'row-title')?.props.text;
    t.selectScope(other.id); t.renderActivity(el);
    check('activity filtered: switching scope updates the direction of the same transaction', incoming === 'Received'
      && byClass(list, 'row-title')?.props.text === 'Sent');
  }
  {
    const k = holdKit();
    let confirms = 0;
    const btn = k.holdButton('Hold to send', () => { confirms++; btn.reset(); }); // the guard resets: a warning landed
    btn.ask = () => ({ title: 'Send?', message: '', confirmLabel: 'Send' });
    btn.fire('pointerdown'); k.anims[k.anims.length - 1].onfinish(); btn.fire('pointerup'); btn.fire('click');
    check('hold: the click that ends a completed hold opens no dialog, even when the hold was reset', confirms === 1 && k.asked.length === 0, `confirms ${confirms}, asked ${k.asked.length}`);
    btn.fire('click');
    check('hold: after it, a short press asks as before', k.asked.length === 1, `asked ${k.asked.length}`);
  }
  // Review's Hold to send: the completed hold and the dialog send the same way, through confirmSend and the look-alike
  // check's guard. Each path once with nothing new (it sends), and once with a new line from the check: one that lands
  // in the hold's last frame, before the screen repainted, and one that lands while the dialog is open and is painted
  // behind it (neither sends; the button stays usable).
  {
    const QUIET = { waiting: false, lines: [{ text: 'Not like any address you know' }] };
    const WARNED = { waiting: false, twin: true, lines: [{ text: 'Looks like an address you sent to' }] };
    const CHANGED = 'Not sent: the address check changed. Look it over, then confirm again.';
    const settle = () => new Promise((r) => setTimeout(r, 0));
    const review = () => {
      const k = holdKit(); k.look(QUIET);
      let repaints = 0;
      const sheet = { onPaneLeave() {} };
      const transfer = Object.freeze({ fromId: 'a', from: 'FROM', to: 'TO', amount: 5n });
      const parts = k.sendHold(sheet, transfer, { from: { name: 'Main' }, known: null, since: 0, repaint: () => { repaints++; parts.read(); } });
      parts.read(); // as Review paints it
      return { k, btn: parts.hold, paint: parts.read, repaints: () => repaints };
    };
    const shown = (r) => `sent ${r.k.sends.length}, confirmSend ${r.k.confirms()}, asked ${r.k.asked.length}, repaints ${r.repaints()}, toasts ${JSON.stringify(r.k.toasts)}`;
    {
      const r = review();
      r.btn.fire('pointerdown'); r.k.anims.at(-1).onfinish(); r.btn.fire('pointerup'); r.btn.fire('click');
      check('Hold to send: a completed hold sends, once, through confirmSend', r.k.sends.length === 1 && r.k.confirms() === 1 && r.k.asked.length === 0, shown(r));
    }
    {
      const r = review();
      r.btn.fire('click'); r.k.answer(true); await settle(); // a short press, or a screen reader's click
      check('Hold to send: the dialog, answered with nothing new, sends, once, through confirmSend', r.k.asked.length === 1 && r.k.sends.length === 1 && r.k.confirms() === 1, shown(r));
    }
    {
      const r = review();
      r.btn.fire('pointerdown'); r.k.look(WARNED); // lands in the hold's last frame: not painted yet
      r.k.anims.at(-1).onfinish(); r.btn.fire('pointerup'); r.btn.fire('click');
      check('Hold to send: a hold that completes as a new look-alike line lands, before the screen repainted, doesn’t send; it resets and repaints',
        r.k.sends.length === 0 && r.k.confirms() === 1 && r.repaints() === 1 && r.k.asked.length === 0, shown(r));
    }
    {
      const r = review();
      r.btn.fire('click'); r.k.look(WARNED); r.paint(); // lands while the dialog is open, painted behind it
      r.k.answer(true); await settle();
      const stopped = r.k.sends.length === 0 && r.k.confirms() === 1 && r.k.toasts.includes(CHANGED);
      const first = shown(r);
      r.btn.fire('click'); r.k.answer(true); await settle(); // asked again, with nothing new since
      check('Hold to send: a look-alike line that lands while the dialog is open stops the send when it’s answered; asked again, it sends',
        stopped && r.k.asked.length === 2 && r.k.sends.length === 1 && r.k.confirms() === 2, `${first}; then ${shown(r)}`);
    }
  }
  {
    // persist() writes nothing once a lock ended the session while it waited on the vault: the edit is reported as
    // cancelled, not saved (no "Address saved" over the lock screen).
    const tab = newTab(); const t = tab.t; await vault(t);
    t.setPersist(async () => { t.dropSecrets(); });
    const code = await codeOf(t.addContact({ name: 'Friend', identity: OTHER }));
    check('edits: a save that a lock overtook while it waited is reported as cancelled, not saved', code === 'CANCELLED', code);
  }
  // Transactions are described in the language in use, once per change of the list: a change of language describes them
  // again, so a search matches the words on screen, not the ones of the language before.
  {
    const tab = newTab(); const t = tab.t; const account = session(t); t.setView({ query: 'received' });
    const tx = { hash: 'c'.repeat(60), source: OTHER, destination: account.identity, amount: 10n,
      tick: 100, timestamp: Date.now() - 10000, inputType: 0, inputSize: 0, inputData: '', moneyFlew: true };
    Object.assign(t.dataFor(account.identity), { history: [tx], historyTotal: 1, full: { at: 1, txs: [tx], capped: false } });
    const el = {}; t.renderActivity(el);
    const before = t.kept();
    t.setLang('fr-FR'); t.renderActivity(el);
    check('activity: a change of language describes the transactions again, so a search reads what the screen shows', Boolean(before) && t.kept() !== before);
  }
  // Redraw versions: wherever data a section shows changes, as the app changes it (the reads answered by a stand-in
  // network), that section's key moves (heroKey, marketKey, netKey, activitySourceKey for Activity's filters and
  // activityKey for its list, assetsKey, accountsKey for the accounts sheet, toolkitKey, whatIfKey for the price
  // calculator, orderBooksKey), so a version missed at any of those places leaves the section as it was. A balance or
  // assets read again unchanged, or transactions failing again the same way, move nothing.
  {
    const tab = newTab(); const t = tab.t; const account = session(t);
    const other = t.buildAccount({ kind: 'watch', name: 'Other', identity: OTHER }); t.state.accounts.push(other);
    tab.net.answer = answers();
    const keys = () => ({ hero: t.heroKey(), market: t.marketKey(null), net: t.netKey('live', 0, 0), activity: t.activitySourceKey(),
      list: t.activityKey('day', 0), assets: t.assetsKey(), accounts: t.accountsKey(), tools: t.toolkitKey(), calculator: t.whatIfKey(null, 'unit'),
      books: t.orderBooksKey() });
    const everyWallet = ['list', 'assets', 'accounts', 'tools', 'calculator', 'books'];
    const redraws = async (what, change, expected) => {
      await idle(); // what the last change set going has landed
      const before = keys(); await change(); const after = keys();
      const moved = Object.keys(before).filter((k) => before[k] !== after[k]);
      check(`redraw: ${what} ${expected.length ? `draws ${expected.join(' and ')} again` : 'draws nothing again'}`,
        expected.length ? expected.every((k) => moved.includes(k)) : !moved.length, `moved: ${moved.join(', ') || 'nothing'}`);
    };
    await redraws('a setting changed', () => t.setPref('privacy', true), ['hero', 'market', 'activity', ...everyWallet]);
    await redraws('an account renamed', () => t.renameAccount(account.id, 'Renamed'), ['hero', 'activity', ...everyWallet]);
    await redraws('another account picked', () => t.selectScope(other.id), ['hero', 'activity', ...everyWallet]);
    await redraws('a balance read', () => t.loadBalance(account), ['hero', 'assets', 'accounts', 'calculator', 'books']);
    await redraws('the same balance read again', () => t.loadBalance(account), []);
    await redraws('assets read', () => t.loadAssets(account), ['assets']);
    await redraws('the same assets read again', () => t.loadAssets(account), []);
    await redraws('prices read', () => t.loadMarket(), ['hero', 'market', 'assets', 'accounts', 'calculator']);
    await redraws('the chart read', () => t.loadChart(), ['market']);
    await redraws('transactions read', () => t.loadHistory(account), ['activity', 'list']);
    await redraws('the same transactions read again', () => t.loadHistory(account), []);
    await redraws('the whole history read', () => t.loadFullHistory(account), ['activity', 'list']);
    await redraws('the whole history read again, unchanged', () => {
      Object.assign(t.dataFor(account.identity).full, { at: 0, validForTick: 0 }); // due again
      return t.loadFullHistory(account);
    }, []);
    // Load more, held until it's let go, then failing (a success also moves it as transactions read).
    let letGo; // the first try held; its retry fails at once
    tab.net.answer = () => (letGo ? Promise.reject(new TypeError('offline')) : new Promise((_, no) => { letGo = () => no(new TypeError('offline')); }));
    let more;
    await redraws('Load more starting', () => { more = t.loadHistory(account, { more: true }); }, ['list']);
    await redraws('Load more ending', () => { letGo(); return more; }, ['list']);
    tab.net.answer = async () => { throw new TypeError('offline'); };
    await redraws('transactions failing to load', () => t.loadHistory(other), ['list']);
    await redraws('transactions failing again the same way', () => t.loadHistory(other), []);
    tab.net.answer = answers();
    await redraws('an address sent to noted', () => t.noteSent(t.dataFor(account.identity), account,
      [{ hash: 'e'.repeat(60), source: account.identity, destination: t.Q.publicKeyToIdentity(new Uint8Array(32).fill(7)) }]), ['list']);
    await redraws('a filter picked', () => t.setActivityView({ kind: 'in' }), ['list']);
    await redraws('more matches shown', () => t.moreActivity(), ['list']);
    await redraws('the filters reset', () => t.resetActivityView(), ['list']);
    await redraws('the self-test run again', () => t.rerunSelfTest(() => {}), ['tools', 'accounts']);
    const entry = await signedEntry(t.Q, 1000);
    await redraws('a transfer restored', () => t.restorePending([entry]), ['activity', 'list']);
    const p = t.state.pending[0];
    await redraws('a transfer settled', () => t.finalizePending(p, 'unknown'), ['activity', 'list']);
    await t.archiveTick(); t.state.net.tick = 5000; // both past its tick, so it can be marked as checked
    await redraws('a transfer marked as checked', () => t.dismissTransfer(p), ['activity', 'list']);
    await redraws('address labels read', () => t.loadLabels(), ['activity', 'list', 'assets']);
    await redraws('the tick read', () => t.loadTick(), ['net']);
    await redraws('a lock', () => t.dropSecrets(), ['activity', ...everyWallet]);
  }
  // And where a transfer is sent (executeSend, broadcastRecord), each step looked at as it happens: as it joins the open
  // transfers (while its journal write is held), as it leaves them when that write failed, as its broadcast goes out
  // and once that's answered, and as a retried broadcast starts.
  {
    const sending = async (failWrite) => {
      const tab = newTab(); const t = tab.t; const account = await vault(t);
      const key = () => t.activitySourceKey();
      const seen = {}; const net = answers();
      tab.net.answer = async (url, init) => {
        if (!url.includes('broadcast-transaction')) return net(url, init);
        seen.broadcast = key();
        return new Response(JSON.stringify({ peersBroadcasted: 3 }), { status: 200 });
      };
      t.dataFor(account.identity).balance = { amount: 1000n };
      await idle();
      seen.before = key();
      const pause = tab.pauseNextEncrypt();
      const sent = t.executeSend({}, { fromId: account.id, from: account.identity, to: OTHER, amount: 5n });
      await Promise.race([pause.atGate, sent]); seen.writing = key();
      shared.failVaultWrites = failWrite; pause.release(); await sent; shared.failVaultWrites = false;
      seen.after = key();
      const record = t.sent();
      return { t, account, seen, record, kept: t.state.pending.includes(record), key };
    };
    {
      const { seen, record, kept } = await sending(true);
      check('redraw: a transfer whose journal write failed draws activity again as it leaves the open transfers',
        record.status === 'error' && !kept && seen.writing !== seen.before && seen.after !== seen.writing, `${record.status}, ${kept ? 'kept' : 'not kept'}, ${JSON.stringify(seen)}`);
    }
    {
      const { t, account, seen, record, kept, key } = await sending(false);
      check('redraw: a transfer signed here draws activity again as it joins the open transfers, before its journal is written',
        record.status === 'waiting' && kept && seen.writing !== seen.before, `${record.status}, ${kept ? 'kept' : 'not kept'}, ${JSON.stringify(seen)}`);
      check('redraw: a broadcast answered draws activity again', seen.after !== seen.broadcast, JSON.stringify(seen));
      const before = key(); seen.broadcast = null;
      await t.broadcastRecord(record);
      check('redraw: a retried broadcast draws activity again as it starts, and once it’s answered',
        record.status === 'waiting' && seen.broadcast !== null && seen.broadcast !== before && key() !== seen.broadcast, `${record.status}, before ${before}, ${JSON.stringify(seen)}, after ${key()}`);
      t.releaseSend(account.identity);
    }
  }
  // A lock while reads are out aborts them (every fetch sees it), and whatever comes back anyway (an answer the abort
  // didn't stop, or a failure) writes, says and redraws nothing: no balance, assets, transactions, tick, prices, chart,
  // labels, exchange status, price history or archive tick, and no error in their place.
  for (const late of ['answer', 'failure']) {
    const tab = newTab(); const t = tab.t; const account = session(t);
    const d = t.dataFor(account.identity);
    Object.assign(d, { history: [], historyTotal: 30, historyTick: 1 }); // more than a page: the whole history is read
    const signals = []; const gate = deferred(); const answer = answers();
    tab.net.answer = async (url, init) => { signals.push(init.signal); await gate.promise; return late === 'answer' ? answer(url, init) : new Response('{}', { status: 503 }); };
    const plain = (k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Error ? `${v.name}: ${v.message}` : v);
    const shot = () => JSON.stringify([t.state.net, t.state.market, [...t.state.labels.keys()], t.state.labelsLoaded, t.state.exchanges,
      ['balance', 'balanceErr', 'assets', 'assetsErr', 'history', 'historyErr', 'full', 'fullErr'].map((k) => d[k]), t.priceHistory[90], t.archive(),
      ['balances', 'history', 'market', 'net', 'labels'].map((k) => t.versions[k])], plain);
    const before = shot(); const changes = t.changes();
    const reads = [t.loadTick(), t.loadBalance(account), t.loadAssets(account), t.loadHistory(account), t.loadFullHistory(account), t.loadMarket(),
      t.loadChart(), t.loadLabels(), t.loadExchangeStatus(), t.loadPriceHistory(90).catch(() => null), t.archiveTick().catch(() => null)];
    await idle();
    t.dropSecrets(); // what a lock does first
    const sent = signals.length; const aborted = signals.filter((s) => s.aborted).length;
    gate.resolve(); await Promise.all(reads); await idle();
    const kept = shot() !== before;
    check(`a lock while reads are out aborts them, and a late ${late} writes, says and redraws nothing`,
      sent === 14 && aborted === sent && !kept && t.toasts.length === 0 && t.changes() === changes,
      `${aborted} of ${sent} aborted, ${kept ? 'kept something' : 'kept nothing'}, ${t.toasts.length} toasts, ${t.changes() - changes} redraws`);
  }
  // A sheet opened from a tool, then the tools drawn again while it was open (a rename, a setting): focus goes back to the
  // same tool, also when it moved, or to what's in its place when it now says something else.
  {
    const k = openerKit();
    const book = k.draw('Price calculator', 'Order books', 'Address book')[2];
    const place = k.placeOf(book);
    const again = k.draw('Price calculator', 'Order books', 'Address book');
    check('focus: a redraw while a sheet is open sends focus back to the new copy of the tool that opened it', k.standIn(place) === again[2]);
    const moved = k.draw('Price calculator', 'Address book', 'Order books');
    check('focus: …to that tool where it moved to', k.standIn(place) === moved[1]);
    const renamed = k.draw('Price calculator', 'Order books', 'Address book (2 saved)');
    check('focus: …or to what is in its place when it says something else', k.standIn(place) === renamed[2]);
  }
  finish('UI state');
})().catch(harnessError);
