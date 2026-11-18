// ═══════════════════════════════════════════════════════════════════════════
// 10c. ACTIVITY: KIND, SEARCH, ORDER
// Which transactions Activity lists, and in what order: one kind (received, sent, between your accounts, contract
// calls), what a search finds, newest, oldest, largest or smallest first, and what the list adds up to. It all runs
// here, over what the wallet already holds: each account's transactions up to FULL_HISTORY_CAP,
// joined with the pages read since. The archive can filter but can't sort, so past that cap the list says how far back
// it reaches instead of guessing. With nothing chosen, Activity is the list it always was (its pages, Load more).
// ═══════════════════════════════════════════════════════════════════════════
const ACTIVITY_SHOWN = 50; // rows a filtered list shows, and adds with each "Show more"
const AMOUNT_ORDERS = new Set(['largest', 'smallest']);
// The view: kind ('all', or describeTx's dir: 'in', 'out', 'self', 'call'), the search as typed, the order and how many
// matches are shown. For this session only: arriving at the wallet afresh starts it plain (see showDashboard).
let activityView = { kind: 'all', query: '', sort: 'newest', limit: ACTIVITY_SHOWN };
// masked: balances are hidden, so an order by amount doesn't count (the list is newest first then, see activityList).
const activityFiltered = (v = activityView, masked = false) => v.kind !== 'all' || v.query.trim() !== ''
  || (v.sort !== 'newest' && !(masked && AMOUNT_ORDERS.has(v.sort)));
// Each change to activityView moves versions.filters (see activityKey).
function resetActivityView() { activityView = { kind: 'all', query: '', sort: 'newest', limit: ACTIVITY_SHOWN }; versions.filters++; }
function moreActivity() { activityView = { ...activityView, limit: activityView.limit + ACTIVITY_SHOWN }; versions.filters++; }
// A kind, search or order picked: the list starts again from its first page.
function setActivityView(change) { activityView = { ...activityView, ...change, limit: ACTIVITY_SHOWN }; versions.filters++; }

// Ties keep the newer first. Amounts are bigints, so they're compared, not subtracted.
const byAmount = (a, b) => (a.amount > b.amount ? 1 : a.amount < b.amount ? -1 : 0);
const ACTIVITY_ORDERS = {
  newest: (a, b) => b.tick - a.tick,
  oldest: (a, b) => a.tick - b.tick,
  largest: (a, b) => byAmount(b, a) || b.tick - a.tick,
  smallest: (a, b) => byAmount(a, b) || b.tick - a.tick,
};

// ── Search ──────────────────────────────────────────────────────────────────
// Text as a search compares it: lower case, without accents (so "jose" finds "José").
const foldText = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
// A search as its words, every one of which has to match. Digits, grouped the way any language writes them ("2,500",
// "2.500", "2 500"): an amount to the QUBIC, a tick, or part of a name. An address cut short the way the app shows it
// ("BZBQ…QEXK"): an address with that start and end. Anything else: part of a name, a title, an address or a
// transaction ID.
function activitySearch(query) {
  const words = foldText(query.trim()).replace(/(\d)\s(?=\d{3}(?!\d))/g, '$1').split(/\s+/).filter(Boolean);
  return words.map((text) => {
    const cut = text.match(/^([a-z]{2,})(?:…|\.\.\.)([a-z]{2,})$/);
    if (cut) return { text, cut: [cut[1], cut[2]] };
    if (/\d/.test(text) && /^[\d,.'’]+$/.test(text)) return { text, digits: text.replace(/\D/g, '').replace(/^0+(?=\d)/, '') };
    return { text };
  });
}
// What a search looks through for one transaction: its title and line as Activity shows them, the names of both sides,
// both addresses and its ID. Made on the first search over it, and kept with it.
function activityHay(item, nameOf) {
  if (item.hay == null) {
    const { tx, info } = item;
    item.hay = foldText([info.title, info.counterparty, nameOf(tx.source), nameOf(tx.destination), tx.source, tx.destination, tx.hash].join('\n'));
  }
  return item.hay;
}
// Whether a transaction matches every word. amounts: false while balances are hidden, so a search can't tell what an
// amount is (digits then match a tick, or part of a name).
function activityMatch(words, item, nameOf, amounts) {
  const { tx } = item;
  return words.every((w) => {
    if (w.cut) return [tx.source, tx.destination].some((id) => { const x = id.toLowerCase(); return x.startsWith(w.cut[0]) && x.endsWith(w.cut[1]); });
    if (w.digits != null && ((amounts && tx.amount.toString() === w.digits) || String(tx.tick) === w.digits)) return true;
    return activityHay(item, nameOf).includes(w.text);
  });
}
// The same for a transfer signed here that hasn't settled (its own row, at the top of the list): always one sent.
function activityPendingMatch(p, view, words, nameOf, masked) {
  if (view.kind !== 'all' && view.kind !== 'out') return false;
  if (!words.length) return true;
  const tx = { source: p.from, destination: p.to, amount: p.amount, tick: p.targetTick || 0, hash: p.hash || '' };
  return activityMatch(words, { tx, info: { title: tr('Sending'), counterparty: '' }, hay: null }, nameOf, !masked);
}

// ── The list ────────────────────────────────────────────────────────────────
// Everything the filters can reach in the accounts in view: each account's whole history, joined with the pages
// Activity read since (newer ones, or older ones from Load more), each transaction once and described (describeTx).
// skip: hashes with a row of their own (transfers signed here that haven't settled). complete: every account's whole
// history is here (read, and not past FULL_HISTORY_CAP). kinds: the kinds among them (the chips for moves between your
// accounts and for contract calls show only when there are some).
function activitySource(scope, skip = new Set()) {
  const perspective = new Set(scope.map((a) => a.identity));
  const byHash = new Map();
  let complete = true;
  for (const a of scope) {
    const d = dataFor(a.identity);
    if (!d.full || d.full.capped) complete = false;
    if (d.full) for (const t of d.full.txs) byHash.set(t.hash, t);
    if (d.history) for (const t of d.history) byHash.set(t.hash, t);
  }
  const items = []; const kinds = new Set();
  for (const tx of byHash.values()) {
    if (skip.has(tx.hash)) continue;
    const info = describeTx(tx, perspective);
    kinds.add(info.dir);
    items.push({ tx, info, hay: null });
  }
  return { items, kinds, complete };
}
// The last source made, kept while nothing it was made from has changed (its key: see renderActivity), so a search
// being typed doesn't describe every transaction again at each key.
let activityKept = { key: null, source: null };
function activitySourceFor(key, make) {
  if (activityKept.key !== key) activityKept = { key, source: make() };
  return activityKept.source;
}
// The rows a view shows, in its order (newest first while balances are hidden: an order by amount would tell them), and
// what they add up to. order: the order used; words: the search, read.
function activityList(source, view, { nameOf, masked = false }) {
  const words = activitySearch(view.query);
  const rows = source.items.filter((it) => (view.kind === 'all' || it.info.dir === view.kind) && (!words.length || activityMatch(words, it, nameOf, !masked)));
  const order = !ACTIVITY_ORDERS[view.sort] || (masked && AMOUNT_ORDERS.has(view.sort)) ? 'newest' : view.sort;
  rows.sort((a, b) => ACTIVITY_ORDERS[order](a.tx, b.tx));
  return { rows, order, words, totals: activityTotals(rows) };
}
// How many transactions a list holds, and the QUBIC that came in and went out in them: only what's known to have gone
// through (wentThrough), so a transfer that's unconfirmed or failed adds nothing, and a move between two accounts in
// view is neither.
function activityTotals(rows) {
  let received = 0n; let sent = 0n;
  for (const { tx, info } of rows) {
    if (!wentThrough(tx)) continue;
    if (info.dir === 'in') received += tx.amount;
    else if (info.dir === 'out' || info.dir === 'call') sent += tx.amount;
  }
  return { count: rows.length, received, sent };
}
// The line over a filtered list: how many, and what came in and went out (only how many while balances are hidden).
function activitySummary({ count, received, sent }, masked) {
  if (masked || (!received && !sent)) return tr('{count, plural, one {# transaction} other {# transactions}}', { count });
  const amountIn = `+${fmtInt(received)}`;
  const amountOut = `${MINUS}${fmtInt(sent)}`;
  if (!sent) return tr('{count, plural, one {# transaction} other {# transactions}} · in {amountIn} QUBIC', { count, amountIn });
  if (!received) return tr('{count, plural, one {# transaction} other {# transactions}} · out {amountOut} QUBIC', { count, amountOut });
  return tr('{count, plural, one {# transaction} other {# transactions}} · in {amountIn} · out {amountOut} QUBIC', { count, amountIn, amountOut });
}

// ── The bar ─────────────────────────────────────────────────────────────────
// Over Activity's list: a search and the order on one line, the kinds as chips under them, and what the list adds up
// to. Made once per Activity section and kept through its redraws, so a search being typed keeps its place; update()
// sets it from the view at each redraw (its words too, so a change of language reaches them). onChange: the view
// changed.
function activityBar(onChange) {
  const set = (change) => { setActivityView(change); onChange(); };
  const search = h('input', { class: 'input', type: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search', 'data-1p-ignore': '', 'data-lpignore': 'true' });
  search.addEventListener('input', () => set({ query: search.value }));
  // The phone keyboard's Search key puts the keyboard away, so the list can be seen.
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') search.blur(); });
  const order = h('select', null, Object.keys(ACTIVITY_ORDERS).map((value) => h('option', { value })));
  order.addEventListener('change', () => set({ sort: order.value }));
  const chips = Object.fromEntries(['all', 'in', 'out', 'self', 'call'].map((kind) => [kind, h('button', { type: 'button', class: 'chip-btn', onClick: () => set({ kind }) })]));
  const kinds = h('div', { class: 'activity-kinds', role: 'group' }, Object.values(chips));
  const sum = h('p', { class: 'activity-sum', id: 'activity-sum' });
  // Read out once the list has settled after a change, not at every key pressed.
  const said = h('p', { class: 'sr-only', role: 'status' });
  let saying = 0; let toSay = '';
  const controls = h('div', { class: 'activity-controls', id: 'activity-controls' },
    h('div', { class: 'activity-find' }, search, h('span', { class: 'activity-order' }, order, icon('chevronDown', 14))), kinds);
  const el = h('div', { class: 'activity-bar' }, controls, sum, said);
  // open: show the controls and the summary; hiding them keeps the view (the filter button marks it). present: the kinds
  // the list has; summary: the line over the list, or ''; announce: what's read out once the list settles (the line, or
  // that nothing matches), or ''.
  function update({ open, present, masked, summary, announce }) {
    const view = activityView;
    el.hidden = !open;
    search.placeholder = tr('Name, address or amount');
    search.setAttribute('aria-label', tr('Search activity'));
    if (search.value !== view.query) search.value = view.query;
    const orders = { newest: tr('Newest first'), oldest: tr('Oldest first'), largest: tr('Largest first'), smallest: tr('Smallest first') };
    for (const o of order.options) { o.textContent = orders[o.value]; o.disabled = masked && AMOUNT_ORDERS.has(o.value); }
    order.value = masked && AMOUNT_ORDERS.has(view.sort) ? 'newest' : view.sort;
    order.setAttribute('aria-label', tr('Order'));
    const labels = { all: trc('Activity filter', 'All'), in: trc('Activity filter', 'Received'), out: trc('Activity filter', 'Sent'), self: tr('Between accounts'), call: tr('Contracts') };
    for (const [kind, chip] of Object.entries(chips)) {
      const on = view.kind === kind;
      chip.textContent = labels[kind];
      chip.hidden = !on && (kind === 'self' || kind === 'call') && !present.has(kind);
      chip.classList.toggle('brand', on);
      chip.setAttribute('aria-pressed', String(on));
    }
    kinds.setAttribute('aria-label', tr('Transaction type'));
    sum.textContent = summary;
    sum.hidden = !summary;
    if (announce !== toSay) {
      toSay = announce;
      clearTimeout(saying);
      saying = setTimeout(() => { said.textContent = toSay; }, 700);
    }
  }
  return { el, update };
}
