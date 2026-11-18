// ═══════════════════════════════════════════════════════════════════════════
// 11g. BPP-9000 (opt-in)
// ═══════════════════════════════════════════════════════════════════════════
// Qubic's computors run BPP-9000, a network that calls Bitcoin's next hour, up or down; the side with more votes is
// the call. Guessing gets 50%, so the score means something only once it holds far from 50% over many calls. One dot
// per hour, by day or by epoch, and a tap on a dot shows its votes. From the Jetski ANN Explorer, loaded only once
// turned on (the explorer sees this device's IP address, nothing else) and only while the sheet is open: on open, then
// every 5 minutes, paused while the tab is hidden. Kept in memory for this visit; a finished epoch isn't asked again.
const BPP_REFRESH_MS = 5 * 60 * 1000;
const bpp = { epochs: new Map(), latest: 0, needed: 100, agree: 55, at: 0 };

// What's known since go-live: every epoch's hours, an hour two epochs both report kept once (the one with more voters).
async function loadBpp() {
  const now = Math.floor(Date.now() / 1000);
  const latest = await fetchBppLatest();
  if (latest < BPP_FIRST_EPOCH) throw new NetError('invalid', trLater('The server sent data in an unexpected format.'));
  const want = [];
  for (let e = BPP_FIRST_EPOCH; e <= latest; e++) if (!bpp.epochs.get(e)?.done) want.push(e);
  const got = await Promise.allSettled(want.map((e) => fetchBppEpoch(e, now)));
  let failed = null;
  got.forEach((g, i) => {
    const e = want[i];
    if (g.status === 'rejected') { failed = failed || g.reason; return; }
    // Two epochs back is finished and settled.
    bpp.epochs.set(e, { hours: g.value.hours, done: e < latest - 1 });
    if (e === latest) { bpp.needed = g.value.needed || bpp.needed; bpp.agree = g.value.agree || bpp.agree; }
  });
  if (failed && got.every((g) => g.status === 'rejected')) throw failed;
  bpp.latest = latest;
  bpp.at = Date.now();
}

// One hour: who voted, which side won, whether it's official, and how it turned out. Official once the explorer has
// scored it, or once enough voters take part; an official call also needs enough of them on one side. Before that
// it's a test call. null: closed, but what Bitcoin did isn't known yet.
function bppJudge(x) {
  const voters = x.up + x.down + x.unsure;
  const scored = x.s.includes('consensus') ? 'none' : x.s.includes('incorrect') ? 'wrong' : x.s.includes('correct') ? 'right' : null;
  if (x.went === null && voters && scored === null) return null;
  const official = scored !== null || voters >= bpp.needed;
  let call = x.up > x.down ? 1 : x.down > x.up ? 0 : null;
  if (official && (scored === 'none' || (scored === null && (100 * Math.max(x.up, x.down)) / voters < bpp.agree))) call = null;
  // right, wrong, miss (official, no majority), tie (test, an even split), none (nobody voted)
  const result = !voters ? 'none' : call === null ? (official ? 'miss' : 'tie') : scored === 'right' || scored === 'wrong' ? scored : call === x.went ? 'right' : 'wrong';
  const opened = new Date((x.t - 3600) * 1000);
  return { ...x, voters, call, official, result, opened: opened.getTime(), hour: opened.getHours(),
    day: opened.getFullYear() * 10000 + (opened.getMonth() + 1) * 100 + opened.getDate() };
}
function bppRows() {
  const byTime = new Map();
  for (const e of [...bpp.epochs.keys()].sort((a, b) => a - b)) {
    for (const x of bpp.epochs.get(e).hours) {
      const had = byTime.get(x.t);
      if (!had || x.up + x.down + x.unsure >= had.up + had.down + had.unsure) byTime.set(x.t, x);
    }
  }
  return [...byTime.values()].map(bppJudge).filter(Boolean).sort((a, b) => a.t - b.t);
}

// The score up to one hour. Official calls count once there are any; before that, test calls stand in.
function bppScore(rows, last = rows.length - 1) {
  const test = { n: 0, right: 0 }; const official = { n: 0, right: 0 };
  for (let i = 0; i <= last; i++) {
    const r = rows[i];
    if (r.result === 'none' || r.result === 'tie') continue;
    const b = r.official ? official : test;
    b.n++;
    if (r.result === 'right') b.right++;
  }
  const use = official.n ? official : test;
  const p = use.n ? (100 * use.right) / use.n : 50;
  return { n: use.n, right: use.right, test: !official.n, p, level: bppLevel(use.n, p) };
}
// How much a score proves. 0 not yet, 1 significant (further from 50% than luck gets 19 times in 20: 98 / √calls
// points, with at least 30 calls), 2 proven (five sigma: 250 / √calls), 3 groundbreaking (70% or better, or 30% or
// lower, over 1,000 calls: far past 57%, the best published out-of-sample result on Bitcoin's direction).
function bppLevel(n, p) {
  const gap = Math.abs(p - 50);
  if (n >= 1000 && gap >= 20) return 3;
  if (n >= 30 && gap > 250 / Math.sqrt(n)) return 2;
  if (n >= 30 && gap > 98 / Math.sqrt(n)) return 1;
  return 0;
}
const BPP_LEVELS = [['Not significant yet', ''], ['Significant', 'accent'], ['Proven', 'ok'], ['Groundbreaking', 'top']];
const bppLevelName = (level) => [tr('Not significant yet'), tr('Significant'), tr('Proven'), tr('Groundbreaking')][level];
// Calls needed for a gap to pass a bar, rounded to hundreds past 1,000.
const bppCallsFor = (points, gap) => { const n = Math.max(30, Math.ceil((points / gap) ** 2)); return fmtInt(n >= 1000 ? Math.round(n / 100) * 100 : n); };

function bppExplain(s) {
  if (!s.n) return tr('No calls yet.');
  const gap = Math.abs(s.p - 50); const rate = fmtPct(Math.round(s.p), 0, false); const high = s.p >= 50 ? 'high' : 'low';
  if (s.level === 3) return tr('{side, select, high {70% or better} other {30% or lower}} over 1,000 calls. The best published Bitcoin model reaches 57%.', { side: high });
  if (s.level === 2) return tr('Luck is ruled out: under 1 chance in a million. Groundbreaking takes {side, select, high {70% or better} other {30% or lower}} over 1,000 calls.', { side: high });
  if (s.level === 1) return tr('A first sign, not proof: luck gets this far 1 time in 20. If it holds {rate}, it’s proven at about {calls} calls.', { rate, calls: bppCallsFor(250, gap) });
  if (s.n < 30) {
    return gap >= 1 ? tr('Too few calls to tell skill from luck. If it holds {rate}, it turns significant at about {calls} calls.', { rate, calls: bppCallsFor(98, gap) })
      : tr('Too few calls to tell skill from luck. It takes at least 30.');
  }
  return gap >= 1 ? tr('Luck alone gets this score. If it holds {rate}, it turns significant at about {calls} calls.', { rate, calls: bppCallsFor(98, gap) })
    : tr('Luck alone gets this score, and this close to 50% it stays that way.');
}

// A dot's colour: right, wrong (a miss counts as wrong), or quiet; fainter with fewer voters, solid at the number an
// official call needs.
const bppStrength = (voters) => `${Math.round(100 * (0.35 + 0.65 * Math.min(1, voters / bpp.needed)))}%`;
const bppDotKind = (r) => (r.result === 'right' ? 'right' : r.result === 'wrong' || r.result === 'miss' ? 'wrong' : 'quiet');
const bppResult = (r) => ({ right: ['ok', tr('Right')], wrong: ['err', tr('Wrong')], miss: ['err', tr('Miss')], tie: ['', tr('Tie')], none: ['', tr('No call')] })[r.result];

function openBpp() {
  const title = 'BPP-9000';
  const sheet = openSheet({ title });
  const holder = h('div', { class: 'pane-holder' });
  let rows = []; let err = null; let loading = false; let timer = 0;
  let mode = 'epoch'; let back = 0; let picked = -1;

  const load = async () => {
    if (loading || !state.prefs.bpp || document.hidden) return;
    loading = true;
    const alive = sessionGuard();
    try { await loadBpp(); err = null; } catch (e) { err = e; }
    loading = false;
    if (!alive()) return;
    // New hours only ever join at the end, so the dot being looked at keeps its place.
    rows = bppRows();
    if (picked >= rows.length) picked = -1;
    if (holder.isConnected) paint();
  };
  const start = () => { clearInterval(timer); load(); timer = setInterval(load, BPP_REFRESH_MS); };
  const onVisible = () => { if (!document.hidden && state.prefs.bpp && Date.now() - bpp.at > 60000) load(); };
  document.addEventListener('visibilitychange', onVisible);
  sheet.onCleanup(() => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); });

  const optIn = () => notice('info', 'chart', tr('BPP-9000 calls'),
    tr('Qubic’s computors run BPP-9000, a network that calls Bitcoin’s next hour, up or down. See how often it’s right, live from the Jetski ANN Explorer. Off until you turn it on: the explorer would see this device’s IP address. Nothing else is sent.'),
    button(tr('Turn on BPP-9000'), { onClick: () => setPref('bpp', true) }));

  // The periods to page through: days or epochs, oldest first.
  const periods = () => [...new Set(rows.map((r) => (mode === 'day' ? r.day : r.e)))];

  const score = () => {
    const s = bppScore(rows);
    const [, kind] = BPP_LEVELS[s.level];
    return h('div', { class: 'bpp-score' },
      h('div', { class: 'bpp-score-top' },
        h('div', { class: 'bpp-score-main' },
          h('span', { class: 'stat-k', text: s.test ? tr('{right} of {count, plural, one {# test call} other {# test calls}} right', { right: fmtInt(s.right), count: s.n })
            : tr('{right} of {count, plural, one {# call} other {# calls}} right', { right: fmtInt(s.right), count: s.n }) }),
          h('span', { class: 'bpp-rate', text: fmtPct(s.n ? Math.round(s.p) : 0, 0, false) })),
        badge(bppLevelName(s.level), kind)),
      h('p', { class: 'bpp-why', text: bppExplain(s) }));
  };

  // A dot grid: a day is 2 rows of 12 hours, an epoch one row of 24 a day. Tap or drag across it to look at an hour;
  // with the keyboard, the arrow keys move along it.
  const grid = (list, current) => {
    const isDay = mode === 'day';
    const cells = new Map();
    if (isDay) rows.forEach((r, i) => { if (r.day === current) cells.set(r.hour, i); });
    else {
      const days = [];
      rows.forEach((r, i) => { if (r.e === current) { if (!days.includes(r.day)) days.push(r.day); cells.set(days.indexOf(r.day) * 24 + r.hour, i); } });
    }
    const total = isDay ? 24 : (Math.floor(Math.max(0, ...cells.keys()) / 24) + 1) * 24;
    const dots = [];
    for (let c = 0; c < total; c++) {
      const i = cells.get(c);
      const r = i === undefined ? null : rows[i];
      const dot = h('span', { class: ['bpp-dot', r && bppDotKind(r), i === picked && 'on'] });
      if (r) { dot.dataset.i = String(i); dot.style.setProperty('--p', bppStrength(r.voters)); }
      dots.push(dot);
    }
    const order = [...cells.values()].sort((a, b) => a - b);
    const el = h('div', { class: ['bpp-grid', isDay && 'day'], tabindex: '0', role: 'group',
      'aria-label': tr('One dot per hour. Use the arrow keys to look at each hour.') }, dots);
    const pickAt = (x, y) => {
      let best = null; let dist = 24 * 24;
      for (const d of el.querySelectorAll('[data-i]')) {
        const b = d.getBoundingClientRect(); const dx = b.left + b.width / 2 - x; const dy = b.top + b.height / 2 - y;
        if (dx * dx + dy * dy < dist) { dist = dx * dx + dy * dy; best = d; }
      }
      if (best && Number(best.dataset.i) !== picked) { picked = Number(best.dataset.i); paint(); }
    };
    el.addEventListener('pointerdown', (e) => pickAt(e.clientX, e.clientY));
    el.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) pickAt(e.clientX, e.clientY); });
    el.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: isDay ? 12 : 24, ArrowLeft: -1, ArrowUp: isDay ? -12 : -24 }[e.key];
      if (!step || !order.length) return;
      e.preventDefault();
      const at = order.indexOf(picked);
      const to = at < 0 ? (step > 0 ? 0 : order.length - 1) : Math.max(0, Math.min(order.length - 1, at + step));
      picked = order[to];
      paint();
      holder.querySelector('.bpp-grid')?.focus();
    });
    return el;
  };

  // The hour looked at: its time, result, call, voters and the score up to it.
  const hourCard = () => {
    const r = rows[picked];
    if (!r) return h('p', { class: 'bpp-hint', text: tr('Tap a dot to see that hour’s votes.') });
    const [kind, label] = bppResult(r);
    const s = bppScore(rows, picked);
    return h('div', { class: 'bpp-hour', role: 'status' },
      h('div', { class: 'bpp-hour-head' },
        h('div', { class: 'bpp-hour-when' },
          h('b', { text: tr('{from} to {to}', { from: fmtTime(r.opened), to: fmtTime(r.t * 1000) }) }),
          h('span', { text: fmtDay(r.opened) })),
        badge(label, kind)),
      kv([
        [tr('Call'), r.call === 1 ? tr('Up') : r.call === 0 ? tr('Down') : r.voters ? tr('Split') : tr('None')],
        [tr('Voters'), tr('{voters} of {needed}', { voters: fmtInt(r.voters), needed: fmtInt(bpp.needed) })],
        r.voters ? [tr('Votes'), r.unsure ? tr('{up} up, {down} down, {unsure} not sure', { up: fmtInt(r.up), down: fmtInt(r.down), unsure: fmtInt(r.unsure) })
          : tr('{up} up, {down} down', { up: fmtInt(r.up), down: fmtInt(r.down) })] : null,
        r.went !== null ? [tr('Bitcoin'), r.went ? tr('Up') : tr('Down')] : null,
        [tr('Score so far'), tr('{right} of {count}', { right: fmtInt(s.right), count: fmtInt(s.n) })],
      ]));
  };

  const dotsCard = () => {
    const list = periods();
    back = Math.max(0, Math.min(list.length - 1, back));
    const current = list[list.length - 1 - back];
    const first = rows.find((r) => (mode === 'day' ? r.day === current : r.e === current));
    const step = (name, label, d, off) => { const b = iconButton(name, label, () => { back += d; picked = -1; paint(); }, 'bpp-step'); b.disabled = off; return b; };
    return h('div', { class: 'bpp-card' },
      h('div', { class: 'bpp-controls' },
        segmented([['day', tr('Day')], ['epoch', tr('Epoch')]], mode, (v) => { mode = v; back = 0; picked = -1; paint(); }, tr('Show')),
        h('div', { class: 'bpp-period' },
          h('span', { text: mode === 'day' ? fmtDay(first.opened) : tr('Epoch {number}', { number: String(current) }) }),
          step('back', tr('Earlier'), 1, back >= list.length - 1),
          step('chevronRight', tr('Later'), -1, back <= 0))),
      grid(list, current),
      hourCard());
  };

  const legend = () => h('div', { class: 'bpp-key' },
    [['right', tr('Right'), tr('The call matched what Bitcoin did.')], ['wrong', tr('Wrong'), tr('The call missed.')], ['quiet', tr('No call'), tr('Nobody voted, or the vote was tied.')]]
      .map(([k, name, text]) => h('div', { class: 'bpp-key-row' }, h('span', { class: ['bpp-dot', 'solid', k] }), h('span', null, h('b', { text: name }), ' ', text))));

  const guidePane = () => {
    const fade = h('div', { class: 'bpp-fade' }, [0.05, 0.3, 0.65, 1].map((share) => {
      const dot = h('span', { class: 'bpp-dot right' });
      dot.style.setProperty('--p', bppStrength(share * bpp.needed));
      return h('span', null, dot, fmtInt(Math.round(share * bpp.needed)));
    }));
    sheet.setPane([
      h('p', { class: 'sheet-lead', text: tr('One dot is one hour of Bitcoin. Tap a dot to see its votes.') }),
      legend(),
      h('div', { class: 'bpp-card' },
        h('b', { class: 'bpp-card-title', text: tr('Fainter means fewer voters') }),
        fade,
        h('p', { class: 'bpp-why', text: tr('A dot is solid when {needed} voters take part.', { needed: fmtInt(bpp.needed) }) })),
      h('div', { class: 'bpp-card' },
        h('b', { class: 'bpp-card-title', text: tr('Test calls and official calls') }),
        h('p', { class: 'bpp-why', text: tr('Each voter is a Qubic computor running its own copy of the network, and the side with more votes is the call. Until {needed} voters take part in an hour, the call is a test. An official call needs {needed} voters and {agree}% of them on one side.', { needed: fmtInt(bpp.needed), agree: String(bpp.agree) }) })),
    ], { title: tr('How to read the dots'), back: home, direction: 'forward' });
  };

  const ladderPane = () => {
    const rung = (pct, level, text) => h('div', { class: ['bpp-rung', level < 0 && 'base'] },
      h('span', { class: 'bpp-rung-pct', text: fmtPct(pct, 0, false) }),
      h('div', { class: 'bpp-rung-text' }, level < 0 ? badge(tr('Coin flip')) : badge(bppLevelName(level), BPP_LEVELS[level][1]), h('p', { text })));
    sheet.setPane([
      h('p', { class: 'sheet-lead', text: tr('Guessing gets 50%. The further the score holds from 50%, the more it means.') }),
      h('div', { class: 'bpp-card bpp-ladder' },
        rung(50, -1, tr('What guessing gets. A score near it means nothing.')),
        rung(55, 1, tr('Held for 385 calls, about 2 weeks. Luck does this 1 time in 20.')),
        rung(60, 2, tr('Held for 625 calls, about 4 weeks. Luck does this 1 time in a million.')),
        rung(70, 3, tr('Held for 1,000 calls, about 6 weeks. The best published model reaches 57%.'))),
      h('p', { class: 'fine', text: tr('The same goes below 50%: 30% is as strong as 70%. A score closer to 50% needs more calls to count.') }),
    ], { title: tr('What the score means'), back: home, direction: 'forward' });
  };

  const content = () => {
    if (!rows.length) {
      if (err) return [notice('error', 'alert', null, tr('Couldn’t load BPP-9000’s calls: {error} Trying again in 5 minutes.', { error: messageOf(err) }))];
      if (loading || !bpp.at) return [h('div', { class: 'card' }, skeletonRows(3))];
      return [emptyState('chart', tr('No hours yet'), tr('The first calls show up here once an hour closes.'))];
    }
    const most = rows.reduce((m, r) => Math.max(m, r.voters), 0);
    const tested = !rows.some((r) => r.official && r.voters);
    return [
      h('p', { class: 'sheet-lead', text: tr('Qubic’s computors call Bitcoin’s next hour, up or down. Guessing gets 50%; proof means staying far from it over hundreds of calls.') }),
      err ? notice('warn', 'alert', null, tr('Couldn’t reach the explorer: {error} Showing what was loaded before.', { error: messageOf(err) })) : null,
      score(),
      dotsCard(),
      tested ? notice('info', 'info', null, tr('A test run so far. Official calls start at {needed} voters an hour; the most so far is {most}.', { needed: fmtInt(bpp.needed), most: fmtInt(most) })) : null,
      h('div', { class: 'group' },
        menuItem('info', tr('How to read the dots'), null, guidePane),
        menuItem('chart', tr('What the score means'), null, ladderPane)),
      h('p', { class: 'fine' },
        tr('Live from the Jetski ANN Explorer, checked at {time}. Times are in your time zone. An experiment, not financial advice.', { time: fmtTime(bpp.at) }), ' ',
        h('a', { href: BPP_API.page(bpp.latest || BPP_FIRST_EPOCH), target: '_blank', rel: 'noopener noreferrer', text: tr('Open the explorer') })),
    ];
  };

  const paint = () => fill(holder, state.prefs.bpp ? content() : optIn());
  function home() { paint(); sheet.setPane([holder], { title, direction: 'back' }); }

  // Turned on or off (here, or in Settings while this is open): start or stop loading, and redraw.
  let on = state.prefs.bpp;
  sheet.onCleanup(subscribe(() => {
    if (state.prefs.bpp === on) return;
    on = state.prefs.bpp;
    if (on) start(); else clearInterval(timer);
    if (holder.isConnected) paint();
  }));
  rows = bppRows();
  paint();
  if (state.prefs.bpp) start();
  sheet.setPane([holder], { title });
}
