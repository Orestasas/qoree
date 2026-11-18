// Activity's kind, search and order (src/js/09c-activity-view.js), with how Activity reads a transaction (describeTx
// and txLook, taken from 09-dashboard.js, which needs a page to load whole). What a filtered list reaches (the full
// history joined with the pages read since, each transaction once, without the transfers that have a row of their own,
// and whether that's an account's whole history); what each kind and each search word matches (amounts however they're
// grouped, ticks, addresses cut short or in part, names with or without accents, IDs); the four orders; amounts kept
// out of a search and an order while balances are hidden; and the totals (only money known to have gone through, a
// move between your accounts neither in nor out).
// Usage: node activity-view.cjs <build dir> <src dir>     MUTATE=<name> (the mutation lines below) puts one fixed fault back.
const { appSource, makeTab } = require('./lib/tabs.cjs');
const { check, finish, harnessError } = require('./lib/check.cjs');
const [BUILD, SRC] = process.argv.slice(2);

const app = appSource(BUILD, SRC, ['00-config.js', '01-util.js', '01b-i18n.js', '03-qubic.js', '04-storage.js', '05-net.js', '06-store.js', '09c-activity-view.js'],
  [['09-dashboard.js', 'describeTx'], ['09-dashboard.js', 'txLook']]);
// A kind that lets everything through; a list that reads only Activity's pages (not the full history), keeps the
// transfers that have their own row, or calls a capped history whole; a transfer that's unconfirmed adding to the
// totals, or a move between your accounts counted as sent.
app.mutation('activity-kind-ignored', "(view.kind === 'all' || it.info.dir === view.kind)", 'true');
app.mutation('activity-history-only', '    if (d.full) for (const t of d.full.txs) byHash.set(t.hash, t);\n', '');
app.mutation('activity-no-skip', '    if (skip.has(tx.hash)) continue;\n', '');
app.mutation('activity-capped-whole', '    if (!d.full || d.full.capped) complete = false;', '    if (!d.full) complete = false;');
app.mutation('activity-totals-unconfirmed', '    if (!wentThrough(tx)) continue;\n', '');
app.mutation('activity-totals-self', "    else if (info.dir === 'out' || info.dir === 'call') sent += tx.amount;", '    else sent += tx.amount;');
// Searches: amounts found while balances are hidden, an order by amount kept while they're hidden, grouped digits
// ("2 500") read as two words, addresses cut short the app's way not understood, accents not ignored, and a transfer
// signed here shown under any kind.
app.mutation('activity-amount-when-hidden', '(amounts && tx.amount.toString() === w.digits)', '(tx.amount.toString() === w.digits)');
app.mutation('activity-order-when-hidden', ' || (masked && AMOUNT_ORDERS.has(view.sort)) ? ', ' ? ');
app.mutation('activity-grouped-digits', ".replace(/(\\d)\\s(?=\\d{3}(?!\\d))/g, '$1')", '');
app.mutation('activity-short-id', '    if (cut) return { text, cut: [cut[1], cut[2]] };\n', '');
app.mutation('activity-accents', "s.normalize('NFD').replace(/\\p{M}/gu, '').toLowerCase()", 's.toLowerCase()');
app.mutation('activity-pending-kind', "  if (view.kind !== 'all' && view.kind !== 'out') return false;\n", '');

const STUBS = `
  let flow = null;
  const closeAllSheets = () => {}; const toast = () => {}; const showUnlock = () => {}; const showWelcome = () => {};
  const enterWallet = () => {}; const announceArrivals = () => {}; const confirmDialog = async () => false;
  // How an address is named on screen: its saved name, or cut short.
  const NAMES = new Map();
  const partyName = (identity) => NAMES.get(identity) || shortId(identity);
`;

(async () => {
  const tab = makeTab(app, `
    ${STUBS}
    ${app.text}
    window.__t = { state, dataFor, NAMES, partyName, shortId, activitySource, activitySourceFor, activityList, activitySearch, activitySummary,
      activityPendingMatch, activityFiltered, resetActivityView, moreActivity, view: () => activityView, setView: (v) => { activityView = { ...activityView, ...v }; },
      ACTIVITY_SHOWN };`, { extra: { setInterval, clearInterval, requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), 0) } });
  const t = tab.t;

  const ME = 'M'.repeat(60); const ME2 = 'N'.repeat(60); const JOSE = 'J'.repeat(60); const STRANGER = 'S'.repeat(60);
  const EXCH = 'BZBQFLLBNCXEMGLOBHUVFTLUPLVCPQUASSILFABOFFBCADQSSUPNWLZBQEXK'; // the public KAT identity, here an exchange
  const QX = 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARMID'; // contract 1
  let n = 0;
  const letters = (k) => { let s = ''; do { s = String.fromCharCode(97 + (k % 26)) + s; k = Math.floor(k / 26); } while (k); return s; };
  const tx = (source, destination, amount, tick, extra = {}) => ({ hash: `tx${letters(++n)}`.padEnd(60, 'q'), source, destination, amount: BigInt(amount), tick,
    timestamp: 1700000000000 + tick * 1000, inputType: 0, inputSize: 0, inputData: '', signature: '', moneyFlew: true, ...extra });
  const t1 = tx(EXCH, ME, 2500, 100); // received from the exchange
  const t2 = tx(ME, EXCH, 1000, 110); // sent to it
  const t3 = tx(STRANGER, ME, 1, 120); // dust
  const t4 = tx(ME, ME2, 500, 130); // to the other account
  const t5 = tx(ME, QX, 1000000, 140, { inputType: 2 }); // a contract call
  const t6 = tx(EXCH, ME, 7000, 150, { moneyFlew: null }); // not confirmed (no flag)
  const t7 = tx(JOSE, ME, 2500, 90); // the same amount as t1, older
  const t8 = tx(STRANGER, ME, 3, 95, { moneyFlew: false }); // not confirmed (the archive's false)
  const t9 = tx(EXCH, ME, 42, 160); // read on Activity's latest page only, after the full read
  const all = [t1, t2, t3, t4, t5, t6, t7, t8, t9];
  const name = new Map(all.map((x, i) => [x.hash, `t${i + 1}`]));
  const names = (rows) => rows.map((r) => name.get((r.tx || r).hash)).join(' ');

  t.state.accounts = [{ id: 'a0', name: 'Main', kind: 'seed', identity: ME, createdAt: 1 }, { id: 'a1', name: 'Savings', kind: 'seed', identity: ME2, createdAt: 1 }];
  t.state.labels = new Map([[QX, { name: 'Qx', kind: 'contract', procedures: new Map([[2, 'Transfer shares']]) }]]);
  for (const [id, label] of [[ME, 'Main'], [ME2, 'Savings'], [EXCH, 'Binance'], [JOSE, 'José']]) t.NAMES.set(id, label);
  const full = { txs: [t1, t2, t3, t4, t5, t6, t7, t8], total: 8, validForTick: 155, capped: false, at: 1 };
  Object.assign(t.dataFor(ME), { full, history: [t9, t6], historyTotal: 9 });
  Object.assign(t.dataFor(ME2), { full: { txs: [t4], total: 1, validForTick: 155, capped: false, at: 1 }, history: [t4], historyTotal: 1 });
  const [main, savings] = t.state.accounts;
  const one = t.activitySource([main]);
  const both = t.activitySource([main, savings]);
  const view = (v = {}) => ({ kind: 'all', query: '', sort: 'newest', limit: 50, ...v });
  const list = (v, opts = {}, src = one) => t.activityList(src, view(v), { nameOf: t.partyName, masked: false, ...opts });
  const sorted = (s) => s.split(' ').sort().join(' ');

  // ── What a filtered list reaches ──
  check('source: the full history and Activity’s newer page, each transaction once', sorted(names(one.items)) === sorted('t1 t2 t3 t4 t5 t6 t7 t8 t9'), names(one.items));
  check('source: a transfer with a row of its own is left out', names(t.activitySource([main], new Set([t9.hash])).items).split(' ').length === 8
    && !names(t.activitySource([main], new Set([t9.hash])).items).includes('t9'));
  check('source: a whole history, read and not capped, is complete', one.complete === true && both.complete === true);
  t.dataFor(ME).full = { ...full, capped: true };
  check('source: a history past the cap is not complete', t.activitySource([main]).complete === false);
  t.dataFor(ME).full = null;
  check('source: an account whose history isn’t read yet is not complete', t.activitySource([main, savings]).complete === false);
  t.dataFor(ME).full = full;
  check('source: the kinds an account has (no move between accounts in one account)', [...one.kinds].sort().join() === 'call,in,out');
  check('source: across both accounts, the move between them is one', both.kinds.has('self') && both.items.filter((it) => it.info.dir === 'self').length === 1);

  // ── Kinds ──
  check('kind: received is everything coming in, confirmed or not', sorted(names(list({ kind: 'in' }).rows)) === sorted('t1 t3 t6 t7 t8 t9'), names(list({ kind: 'in' }).rows));
  check('kind: sent', sorted(names(list({ kind: 'out' }).rows)) === 't2 t4');
  check('kind: contract calls', names(list({ kind: 'call' }).rows) === 't5');
  check('kind: between your accounts, across both', names(list({ kind: 'self' }, {}, both).rows) === 't4');

  // ── Search ──
  const found = (query, opts = {}, src = one) => sorted(names(list({ query }, opts, src).rows));
  check('search: a name, any case', found('binance') === sorted('t1 t2 t6 t9') && found('BINANCE') === found('binance'), found('binance'));
  check('search: a name without its accent', found('jose') === 't7' && found('José') === 't7', found('jose'));
  check('search: an amount, grouped any way', ['2500', '2,500', '2.500', '2 500', '2 500'].every((q) => found(q) === 't1 t7'),
    ['2500', '2,500', '2.500', '2 500'].map((q) => `${q}: ${found(q)}`).join('; '));
  check('search: a tick', found('160') === 't9');
  check('search: an address cut short the app’s way', found(t.shortId(EXCH)) === sorted('t1 t2 t6 t9') && found('bzbq...qexk') === found('binance'), found(t.shortId(EXCH)));
  check('search: part of an address', found('FLLBNCXEM') === sorted('t1 t2 t6 t9'));
  check('search: part of a transaction ID', found(t5.hash.slice(0, 6)) === 't5');
  check('search: a contract and its procedure, by the names shown', found('qx') === 't5' && found('transfer shares') === 't5');
  check('search: every word has to match', found('binance 1,000') === 't2', found('binance 1,000'));
  check('search: nothing matches', found('kraken') === '');
  check('search, balances hidden: an amount finds nothing', found('2,500', { masked: true }) === '', found('2,500', { masked: true }));
  check('search, balances hidden: a tick still does', found('160', { masked: true }) === 't9');
  const words = t.activitySearch(' BZBQ…QEXK 1 250 000 0042 ');
  check('search words: a short address, digits joined, leading zeros', words.length === 3 && words[0].cut && words[0].cut.join() === 'bzbq,qexk'
    && words[1].digits === '1250000' && words[2].digits === '42', JSON.stringify(words));
  check('search words: none in an empty search', t.activitySearch('   ').length === 0);

  // ── Orders ──
  check('order: newest first', names(list({}).rows) === 't9 t6 t5 t4 t3 t2 t1 t8 t7', names(list({}).rows));
  check('order: oldest first', names(list({ sort: 'oldest' }).rows) === 't7 t8 t1 t2 t3 t4 t5 t6 t9');
  check('order: largest first, the newer of two equal ones first', names(list({ sort: 'largest' }).rows) === 't5 t6 t1 t7 t2 t4 t9 t8 t3', names(list({ sort: 'largest' }).rows));
  check('order: smallest first', names(list({ sort: 'smallest' }).rows) === 't3 t8 t9 t4 t2 t1 t7 t6 t5', names(list({ sort: 'smallest' }).rows));
  const hiddenLargest = list({ sort: 'largest' }, { masked: true });
  check('order, balances hidden: not by amount (newest first)', hiddenLargest.order === 'newest' && names(hiddenLargest.rows) === names(list({}).rows), hiddenLargest.order);

  // ── Totals ──
  const sum = list({}).totals;
  check('totals: only money known to have gone through', sum.count === 9 && sum.received === 5043n && sum.sent === 1001500n, `${sum.count} ${sum.received} ${sum.sent}`);
  const sumBoth = list({}, {}, both).totals;
  check('totals: a move between your accounts is neither in nor out', sumBoth.count === 9 && sumBoth.received === 5043n && sumBoth.sent === 1001000n, `${sumBoth.received} ${sumBoth.sent}`);
  check('summary: in and out', t.activitySummary(sum, false) === '9 transactions · in +5,043 · out −1,001,500 QUBIC', t.activitySummary(sum, false));
  check('summary: in only, one', t.activitySummary({ count: 1, received: 2500n, sent: 0n }, false) === '1 transaction · in +2,500 QUBIC');
  check('summary: out only', t.activitySummary({ count: 2, received: 0n, sent: 1500n }, false) === '2 transactions · out −1,500 QUBIC');
  check('summary, balances hidden: only how many', t.activitySummary(sum, true) === '9 transactions');

  // ── A transfer signed here, not settled ──
  const p = { hash: 'pending'.padEnd(60, 'q'), from: ME, to: EXCH, amount: 77n, targetTick: 170, status: 'waiting' };
  const pm = (v, masked = false) => t.activityPendingMatch(p, view(v), t.activitySearch(view(v).query), t.partyName, masked);
  check('pending: only under all and sent', pm({}) && pm({ kind: 'out' }) && !pm({ kind: 'in' }) && !pm({ kind: 'call' }));
  check('pending: found by who it’s to, its amount or its tick', pm({ query: 'binance' }) && pm({ query: '77' }) && pm({ query: '170' }) && !pm({ query: 'savings' }));
  check('pending, balances hidden: not by its amount', !pm({ query: '77' }, true) && pm({ query: '170' }, true));

  // ── The view ──
  check('view: plain until something is chosen', !t.activityFiltered(view()) && !t.activityFiltered(view({ query: '   ' }))
    && t.activityFiltered(view({ kind: 'in' })) && t.activityFiltered(view({ query: 'x' })) && t.activityFiltered(view({ sort: 'oldest' })));
  check('view, balances hidden: an order by amount alone leaves it plain (the list is newest first)',
    !t.activityFiltered(view({ sort: 'largest' }), true) && t.activityFiltered(view({ sort: 'largest' }))
    && t.activityFiltered(view({ sort: 'oldest' }), true) && t.activityFiltered(view({ sort: 'largest', kind: 'in' }), true));
  t.setView({ kind: 'in', query: 'binance', sort: 'oldest' });
  t.moreActivity();
  const grown = t.view().limit;
  t.resetActivityView();
  check('view: Show more adds a page; a fresh start is plain', grown === 2 * t.ACTIVITY_SHOWN && !t.activityFiltered(t.view()) && t.view().limit === t.ACTIVITY_SHOWN, `${grown}`);
  const first = t.activitySourceFor('k1', () => ({ made: 1 }));
  check('source kept while its key stays', t.activitySourceFor('k1', () => ({ made: 2 })) === first && t.activitySourceFor('k2', () => ({ made: 3 })).made === 3);

  finish('activity view');
})().catch(harnessError);
