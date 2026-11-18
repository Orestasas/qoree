// ═══════════════════════════════════════════════════════════════════════════
// 11e. ORDER BOOKS (opt-in)
// ═══════════════════════════════════════════════════════════════════════════
// The QUBIC/USDT books of Gate.io and MEXC side by side: best bid and ask and the spread on each, depth within
// 2% of each exchange's own price, the top levels of the one you pick, and what selling your balance would fetch.
// Loaded only once turned on (the exchanges see this device's IP address, nothing else), and only while the sheet is
// open: every 5 s, paused while the tab is hidden; an exchange that can't be reached is tried again every 30 s, not
// every 5. Market data for orientation: before fees, USDT counted as dollars.
const BOOK_REFRESH_MS = 5000;
const BOOK_RETRY_MS = 30000;
const BOOK_ROWS = 8;
const BOOK_BAND = 0.02;
// Price steps for the levels, in the books' finest tick (1e-10 USDT): 10 decimals down to 7 (per billion: $0.10 to
// $100).
const BOOK_STEPS = [1, 10, 100, 1000];
const stepLabel = (ticks) => (perBillion() ? (ticks === 1 ? '$0.10' : `$${ticks / 10}`) : String(10 - Math.log10(ticks)));
// A grouped level's price (steps of 10 ticks and up), to its step: per QUBIC with that many decimals, per billion in
// whole dollars.
const stepPrice = (p, ticks) => (perBillion() ? fmtUsdDecimals(p * 1e9, 0) : fmtUsdDecimals(p, 10 - Math.log10(ticks)));
// One more digit than prices elsewhere, so neighbouring levels read apart.
const bookPrice = (p) => (perBillion() ? fmtUsdDecimals(p * 1e9, 2) : fmtUsdDecimals(p, priceDecimals(p, 3, 16)));
// A share as a percentage to two places, with a sign only when it's below zero.
const bookPct = (x) => fmtPct(x * 100, 2, x < 0);
// What the sheet shows beside the books: the settings (order books, the price unit, hidden balances) and your balance
// (the accounts in view, their balances).
function orderBooksKey() {
  return [versions.wallet, versions.balances, versions.prefs].join('|');
}

function openOrderBooks() {
  const sheet = openSheet({ title: tr('Order books') });
  const ids = Object.keys(BOOK_SOURCES);
  const books = {}; // id → { book, err, failedAt }
  let pick = ids[0];
  let step = BOOK_STEPS[0];
  let timer = 0;
  const holder = h('div', { class: 'pane-holder' });

  let loading = false; // one load at a time: an exchange that hangs mustn't get a new request every 5 s
  const load = async () => {
    if (loading || !state.prefs.orderBooks || document.hidden) return;
    loading = true;
    const toLoad = ids.filter((id) => !(books[id] && books[id].failedAt && Date.now() - books[id].failedAt < BOOK_RETRY_MS));
    const deep = step > 1;
    const alive = sessionGuard();
    const got = await Promise.allSettled(toLoad.map((id) => fetchOrderBook(id, deep)));
    loading = false;
    if (!holder.isConnected || !alive()) return;
    // A failure stands whatever the depth, so that exchange waits BOOK_RETRY_MS before it's asked again.
    toLoad.forEach((id, i) => {
      if (got[i].status === 'rejected') books[id] = { book: books[id] && books[id].book, err: got[i].reason, failedAt: Date.now() };
    });
    // The decimals moved to the other depth meanwhile: these books are the wrong depth, so load that one now.
    if (deep !== (step > 1)) { load(); return; }
    toLoad.forEach((id, i) => { if (got[i].status === 'fulfilled') books[id] = { book: got[i].value }; });
    paint();
  };
  const start = () => { clearInterval(timer); load(); timer = setInterval(load, BOOK_REFRESH_MS); };

  const optIn = () => notice('info', 'book', tr('QUBIC/USDT order books'),
    tr('Best bid and ask, spread and depth from Gate.io and MEXC, refreshed while this is open. Off until you turn it on: those exchanges would see this device’s IP address. Nothing else is sent.'),
    button(tr('Turn on order books'), { onClick: () => setPref('orderBooks', true) }));

  // One tile per exchange: its best bid and ask and spread; picking one shows its levels below.
  const tile = (id) => {
    const s = books[id]; const b = s && s.book;
    const st = b ? bookStats(b, BOOK_BAND) : null;
    return h('button', { type: 'button', class: 'book-tile', role: 'radio', 'aria-checked': String(pick === id), onClick: () => { pick = id; paint(); } },
      h('span', { class: 'book-tile-name', text: BOOK_SOURCES[id].name }),
      st ? h('span', { class: 'book-tile-prices' }, h('span', { class: 'bid', text: bookPrice(st.bid) }), h('span', { class: 'ask', text: bookPrice(st.ask) }))
        : h('span', { class: 'book-tile-sub', text: s && s.err ? tr('Unavailable') : tr('Loading…') }),
      st ? h('span', { class: 'book-tile-sub', text: tr('Spread {percent}', { percent: bookPct(st.spreadPct) }) }) : null);
  };

  // Two markets overlapping (one's best bid above another's best ask) is worth saying.
  const overlap = (loaded) => {
    if (loaded.length < 2) return null;
    const hi = loaded.reduce((a, b) => (b.book.bids[0].price > a.book.bids[0].price ? b : a));
    const lo = loaded.reduce((a, b) => (b.book.asks[0].price < a.book.asks[0].price ? b : a));
    if (hi.id === lo.id || hi.book.bids[0].price <= lo.book.asks[0].price) return null;
    return notice('info', 'info', null, tr('{bidExchange}’s best bid is {percent} above {askExchange}’s best ask: the two markets overlap right now.',
      { bidExchange: BOOK_SOURCES[hi.id].name, percent: bookPct(hi.book.bids[0].price / lo.book.asks[0].price - 1), askExchange: BOOK_SOURCES[lo.id].name }));
  };

  // A request the browser couldn't complete (blocked on this network, or the exchange doesn't let web pages read it)
  // says so plainly; other failures give the server's own reason.
  const unreachable = (id, err) => (err && err.kind === 'network'
    ? tr('{exchange} couldn’t be reached from this browser: it may be blocked on this network, or not let web pages read its data. Trying again every 30 seconds.', { exchange: BOOK_SOURCES[id].name })
    : tr('{exchange}: {error}', { exchange: BOOK_SOURCES[id].name, error: messageOf(err) }));
  const depthText = (d) => `${d.complete ? '' : '≥ '}${fmtCompact(d.qty)} QUBIC · ${fmtUsd(d.usd, { compact: true })}`;

  // Fewer decimals group the levels into wider price steps, for the bigger picture.
  const steps = () => h('div', { class: 'book-controls' },
    h('span', { class: 'book-controls-label', text: perBillion() ? tr('Price step') : tr('Decimals') }),
    segmented(BOOK_STEPS.map((t) => [t, stepLabel(t)]), step, (v) => {
      // Wider steps want the deeper book: load it now (or as soon as the load under way ends) rather than at the next
      // refresh.
      const deeper = (v > 1) !== (step > 1);
      step = v;
      paint();
      if (deeper) load();
    }, perBillion() ? tr('Price step') : tr('Decimals')));

  // A level's price. Grouped bids round down, so the ones below the first step land on zero: that row reads "< step".
  const levelPrice = (l) => (step === 1 ? bookPrice(l.price) : l.price > 0 ? stepPrice(l.price, step) : `< ${stepPrice(step * BOOK_TICK, step)}`);

  // The top levels: asks above (highest first), the spread, bids below; each row's bar is the running total.
  const ladder = (b, st) => {
    const asks = groupLevels(b.asks, step, true).slice(0, BOOK_ROWS); const bids = groupLevels(b.bids, step, false).slice(0, BOOK_ROWS);
    let run = 0; const askRun = asks.map((l) => (run += l.amount));
    run = 0; const bidRun = bids.map((l) => (run += l.amount));
    const most = Math.max(askRun[askRun.length - 1] || 0, bidRun[bidRun.length - 1] || 0) || 1;
    const row = (l, total, side) => {
      const el = h('div', { class: ['book-row', side], role: 'row' },
        h('span', { class: 'book-price', role: 'cell', text: levelPrice(l) }), h('span', { role: 'cell', text: fmtCompact(l.amount) }), h('span', { role: 'cell', text: fmtCompact(total) }));
      el.style.setProperty('--depth', `${((total / most) * 100).toFixed(1)}%`);
      return el;
    };
    return h('div', { class: 'book', role: 'table', 'aria-label': tr('{exchange} order book, top levels', { exchange: BOOK_SOURCES[pick].name }) },
      h('div', { class: 'book-head', role: 'row' }, h('span', { role: 'columnheader', text: perBillion() ? tr('Price per billion') : tr('Price (USDT)') }), h('span', { role: 'columnheader', text: 'QUBIC' }), h('span', { role: 'columnheader', text: tr('Total') })),
      asks.map((l, i) => row(l, askRun[i], 'ask')).reverse(),
      h('div', { class: 'book-mid', role: 'row' }, h('span', { role: 'cell', 'aria-colspan': 3, text: tr('Spread {price} · {percent}', { price: bookPrice(st.spread), percent: bookPct(st.spreadPct) }) })),
      bids.map((l, i) => row(l, bidRun[i], 'bid')));
  };

  // Your balance (the account or accounts on screen), sold at once into the bids: on this exchange, and across all
  // loaded ones.
  const selling = (b, loaded) => {
    const qty = Number(scopeBalance().total);
    if (hidden() || !(qty > 0)) return null;
    const here = sellInto(b.bids, qty);
    const both = loaded.length > 1 ? sellInto(mergedBids(loaded.map((x) => x.book)), qty) : null;
    const name = BOOK_SOURCES[pick].name;
    const lines = [here.complete
      ? tr('Selling your {quantity} QUBIC on {exchange} now: ≈ {amount}, an average of {price} ({percent} below the best bid).',
        { quantity: fmtCompact(qty), exchange: name, amount: fmtUsd(here.usd), price: bookPrice(here.avg), percent: bookPct(-here.slip) })
      : tr('{count, plural, one {{exchange}’s top {levels} bid holds {filled} of your {quantity} QUBIC: ≈ {amount} for that part.} '
        + 'other {{exchange}’s top {levels} bids hold {filled} of your {quantity} QUBIC: ≈ {amount} for that part.}}',
      { count: b.bids.length, levels: String(b.bids.length), exchange: name, filled: fmtCompact(here.filled), quantity: fmtCompact(qty), amount: fmtUsd(here.usd) })];
    if (both) {
      lines.push(both.complete ? tr('{count, plural, =2 {Across both exchanges: ≈ {amount}.} other {Across all # exchanges: ≈ {amount}.}}', { count: loaded.length, amount: fmtUsd(both.usd) })
        : tr('{count, plural, =2 {Across both exchanges, the loaded bids hold {filled}: ≈ {amount}.} other {Across all # exchanges, the loaded bids hold {filled}: ≈ {amount}.}}',
          { count: loaded.length, filled: fmtCompact(both.filled), amount: fmtUsd(both.usd) }));
    }
    return notice('plain', 'chart', tr('If you sold everything now'), joinSentences(...lines));
  };

  const content = () => {
    const loaded = ids.filter((id) => books[id] && books[id].book).map((id) => ({ id, book: books[id].book }));
    const sel = books[pick];
    const b = sel && sel.book;
    const st = b ? bookStats(b, BOOK_BAND) : null;
    const age = b ? Math.max(0, Math.round((Date.now() - b.at) / 1000)) : null;
    const details = tr('From each exchange’s public API (the top 100 levels a side, or as many as it gives with fewer decimals), refreshed every 5 seconds while this is open. Before fees.');
    const loadedVars = b && { exchange: BOOK_SOURCES[pick].name, seconds: String(age), askCount: b.asks.length, asks: fmtInt(b.asks.length), bidCount: b.bids.length, bids: fmtInt(b.bids.length), details };
    return [
      h('div', { class: 'book-tiles', role: 'radiogroup', 'aria-label': tr('Exchange') }, ids.map(tile)),
      overlap(loaded),
      sel && sel.err ? notice(b ? 'warn' : 'error', 'alert', null, b ? tr('{problem} Showing the last book received.', { problem: unreachable(pick, sel.err) }) : unreachable(pick, sel.err)) : null,
      b ? steps() : null,
      b ? ladder(b, st) : null,
      st ? kv([
        [tr('Best bid'), bookPrice(st.bid)],
        [tr('Best ask'), bookPrice(st.ask)],
        [tr('Spread'), `${bookPrice(st.spread)} · ${bookPct(st.spreadPct)}`],
        [tr('Bids within {percent}', { percent: fmtPct(BOOK_BAND * 100, 0, false) }), depthText(st.bidDepth)],
        [tr('Asks within {percent}', { percent: fmtPct(BOOK_BAND * 100, 0, false) }), depthText(st.askDepth)],
      ]) : (!sel || !sel.err ? h('div', { class: 'card' }, skeletonRows(3)) : null),
      b ? selling(b, loaded) : null,
      h('p', { class: 'fine', text: !b ? details : age < 2
        ? tr('{exchange}, updated just now, {askCount, plural, one {{asks} ask} other {{asks} asks}} and '
          + '{bidCount, plural, one {{bids} bid} other {{bids} bids}} loaded. {details}', loadedVars)
        : tr('{exchange}, updated {seconds} s ago, {askCount, plural, one {{asks} ask} other {{asks} asks}} and '
          + '{bidCount, plural, one {{bids} bid} other {{bids} bids}} loaded. {details}', loadedVars) }),
    ];
  };

  const paint = () => fill(holder, state.prefs.orderBooks ? content() : optIn());
  sheet.onCleanup(() => clearInterval(timer));
  // The setting, price unit, hidden balances or your balance changed: redraw (and start or stop loading with the
  // setting; this is also how the opt-in button starts loading and redraws). Other changes leave the sheet as it is, so
  // a tap never lands on a row being replaced.
  let on = state.prefs.orderBooks;
  let shown = orderBooksKey();
  sheet.onCleanup(subscribe(() => {
    if (state.prefs.orderBooks !== on) { on = state.prefs.orderBooks; if (on) start(); else clearInterval(timer); }
    const k = orderBooksKey();
    if (k !== shown) { shown = k; paint(); }
  }));
  paint();
  if (state.prefs.orderBooks) start();
  sheet.setPane([holder], { title: tr('Order books') });
}
