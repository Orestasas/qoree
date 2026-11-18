// Transfer outcomes and inputs (src/js 00–03 + 05): what counts as evidence. A missing or false moneyFlew is not a
// failure on its own (the archive serves false when it has no status); only Core's unbroken record of the account is;
// "not found" only means "not executed" when the archive has processed the target tick and that tick's own list of
// transactions doesn't contain it. Also: canonical identities only; responses read with a size cap, and error pages
// judged by their status; exchange order books read strictly, with their spread, depth and sell figures; exchange
// deposit and withdrawal status read only from plain flags about QUBIC (and the dashboard's note built from them).
// Tips go to the address we were given, a valid identity, with dollars turned into whole QUBIC at the price. Text on
// an accent fill is white or near-black by one rule, which the presets in the config and in the styles follow.
// Usage: node outcomes.cjs <build dir> <src dir>     MUTATE=<name> (the mutation lines below) puts one fault back.
const vm = require('vm');
const { check, finish, harnessError } = require('./lib/check.cjs');
const { vendorScript, appScript, runApp, pickFunction, mutable, SESSIONS } = require('./lib/load.cjs');
const [BUILD, SRC] = process.argv.slice(2);
const vendor = vendorScript(BUILD);
const app = mutable(`${appScript(SRC, ['00-config.js', '01-util.js', '01b-i18n.js', '03-qubic.js', '05-net.js'])}\n${pickFunction(SRC, '09-dashboard.js', 'exchangePauseText')}`);
// Exchange status read loosely: any value taken as a flag, another coin's answer taken for QUBIC's, or an exchange
// whose status isn't known named as having paused.
app.mutation('status-loose-flags', "const open = (disabled) => (typeof disabled === 'boolean' ? !disabled : null);", 'const open = (disabled) => !disabled;');
// Accent text chosen by WCAG 2's 4.5:1 ratio again, which gives mid-tone oranges near-black.
// A server's words on screen again (in its error), and text from a server keeping the marks that reorder it.
app.mutation('server-words-shown', "trLater('Server error {status}'), res.status, { status: String(res.status) });",
  "trLater('Server error {status}: {detail}'), res.status, { status: String(res.status), detail: data && typeof data.message === 'string' ? data.message.slice(0, 160) : '' });");
app.mutation('bidi-kept', '\\u007f-\\u009f\\u061c\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]', '\\u007f]');
// A failed request retried after its session ended (a lock in between); a session's end that doesn't reach the
// request in flight, or reaches it as a network error.
app.mutation('retry-after-lock', '      if (ended()) throw cancelled();\n      let err = e;', '      let err = e;');
app.mutation('retry-after-lock', '    if (ended()) throw cancelled();\n    const ctrl = new AbortController();', '    const ctrl = new AbortController();');
app.mutation('abort-unwired', "    session?.signal.addEventListener('abort', stop);\n", '');
app.mutation('abort-as-network-error', '      if (ended()) throw cancelled();\n      let err = e;', '      let err = e;');
app.mutation('ink-wcag', "  return onWhite > onDark ? '#FFFFFF' : INK_DARK;", "  return 1.05 / (y(fill) + 0.05) >= 4.5 ? '#FFFFFF' : INK_DARK;");
// Tips: a typo in the donation address, or dollars turned into QUBIC the wrong way round.
app.mutation('donation-address-typo', "const DONATION_ADDRESS = 'SCSGABTBOJFGTBFQVBFFWNYLHIRCXMIJUJMHSCFRVFHGYCBHMEVWEMCCHRUH';",
  "const DONATION_ADDRESS = 'SCSGABTBOJFGTBFQVBFFWNYLHIRCYMIJUJMHSCFRVFHGYCBHMEVWEMCCHRUH';");
app.mutation('tip-usd-inverted', 'const n = Math.round(usd / price);', 'const n = Math.round(usd * price);');
app.mutation('status-unknown-paused', "s.deposits === false && 'deposits', s.withdrawals === false && 'withdrawals'", "s.deposits !== true && 'deposits', s.withdrawals !== true && 'withdrawals'");

// A fresh context per case, with fetch answering from `routes` (a part of the URL → [status, body] as JSON, or a
// function of the URL returning a Response), as real Response objects.
function load(routes = {}) {
  const fetch = async (url, init) => {
    const hit = Object.keys(routes).find((k) => url.includes(k));
    if (!hit) return new Response(JSON.stringify({ code: 5, message: 'not found' }), { status: 404 });
    if (typeof routes[hit] === 'function') return routes[hit](url, init);
    const [status, body] = routes[hit];
    return new Response(JSON.stringify(body), { status });
  };
  const ctx = { console, setTimeout, clearTimeout, TextEncoder, TextDecoder, atob, btoa, AbortController, performance, fetch, Response, navigator: { onLine: true }, crypto: require('crypto').webcrypto };
  ctx.window = ctx;
  vm.createContext(ctx);
  runApp(`${SESSIONS}\nconst state = { selfTest: { status: 'pass' }, prefs: {}, session: openSession() };\n${app.text}\n window.__t = { nextSession, request, API, messageOf, cleanText, ACCENTS, inkFor, DONATION_ADDRESS, usdToQubic, parseGateStatus, fetchExchangeStatus, exchangePauseText, parseTx, archivedStatus, tickVerdict, checkIdentity, Q, signTransfer, deriveAccount, sameAsSigned, transferOutcome, fetchOutflow, KAT, fetchTickInfo, fetchTransferLogged, parseBook, fetchOrderBook, bookStats, sellInto, mergedBids, groupLevels };`, vm.runInContext(vendor, ctx), ctx);
  return ctx.__t;
}

(async () => {
  const T = load();
  const kat = 'BZBQFLLBNCXEMGLOBHUVFTLUPLVCPQUASSILFABOFFBCADQSSUPNWLZBQEXK';
  const other = 'IVLONFAFVZIRMEBQALCHIUREXODDLDMSZHPQTSIUJGMQUNZCYNXBZHQGYHTO';
  const raw = { hash: 'a'.repeat(60), source: kat, destination: other, amount: '5', tickNumber: 100, timestamp: '1', inputType: 0, inputSize: 0, inputData: '' };

  // V3-04
  const missing = T.parseTx(raw);
  check('V3-04 a missing moneyFlew is kept as unknown', missing.moneyFlew === null && T.archivedStatus(missing) === 'unknown', `${missing.moneyFlew} → ${T.archivedStatus(missing)}`);
  check('moneyFlew true → success; false → unknown, never failed (the archive also serves false when it has no status)',
    T.archivedStatus(T.parseTx({ ...raw, moneyFlew: true })) === 'success' && T.archivedStatus(T.parseTx({ ...raw, moneyFlew: false })) === 'unknown');
  check('a non-boolean moneyFlew is not trusted', T.parseTx({ ...raw, moneyFlew: 'false' }).moneyFlew === null);
  check('ticks past 32 bits and amounts over Core’s MAX_AMOUNT are malformed',
    T.parseTx({ ...raw, tickNumber: 2 ** 32 }) === null && T.parseTx({ ...raw, tickNumber: 2 ** 32 - 1 }) !== null
    && T.parseTx({ ...raw, amount: '1000000000000001' }) === null && T.parseTx({ ...raw, amount: '1000000000000000' }) !== null);

  // V3-05
  const hash = 'b'.repeat(60);
  const intervals = [200, [{ epoch: 236, firstTick: 86000000, lastTick: 86001000 }]];
  const tick = (hashes) => [200, { tickData: { tickNumber: 86000500, epoch: 236, transactionHashes: hashes } }];
  const listed = (hashes) => load({ getProcessedTickIntervals: intervals, getTickData: tick(hashes) }).tickVerdict(hash, 86000500);
  const v1 = await load({ getProcessedTickIntervals: [200, [{ epoch: 235, firstTick: 85000000, lastTick: 85999999 }]], getTickData: tick([]) }).tickVerdict(hash, 86000500);
  check('V3-05 a target tick outside the processed intervals stays unknown', v1 === 'unknown', v1);
  const v2 = await listed(['c'.repeat(60)]);
  check('V3-05 covered tick, hash absent from its list → absent (not executed)', v2 === 'absent', v2);
  const v3 = await listed([hash]);
  check('V3-05 covered tick listing the hash contradicts "not found" → present', v3 === 'present', v3);
  const v4 = await load({ getProcessedTickIntervals: intervals, getTickData: [200, { tickData: null }] }).tickVerdict(hash, 86000500);
  check('V3-05 no tick data (empty tick or gap) stays unknown', v4 === 'unknown', v4);
  const v5 = await load({ getProcessedTickIntervals: [500, { message: 'down' }], getTickData: tick([]) }).tickVerdict(hash, 86000500);
  check('V3-05 the intervals request failing stays unknown', v5 === 'unknown', v5);
  const v6 = await load({ getProcessedTickIntervals: intervals, getTickData: [200, { tickData: { tickNumber: 86000499, transactionHashes: [] } }] }).tickVerdict(hash, 86000500);
  check('V3-05 tick data for a different tick is not accepted', v6 === 'unknown', v6);


  // V4-03: the tick's list must be well-formed as a whole; a filtered subset is never evidence of absence.
  {
    const up = await listed([hash.toUpperCase()]);
    check('V4-03 the tracked hash listed in another spelling (uppercase) voids the list → unknown', up === 'unknown', up);
    const bad = await listed(['c'.repeat(60), 'not-a-hash', 'd'.repeat(60)]);
    check('V4-03 one malformed entry voids the whole list → unknown', bad === 'unknown', bad);
    const dup = await listed(['c'.repeat(60), 'c'.repeat(60)]);
    check('V4-03 a repeated entry voids the list → unknown', dup === 'unknown', dup);
    const many = await listed(Array.from({ length: 4097 }, (_, i) => i.toString(26).padStart(60, '0').replace(/[0-9]/g, (d) => 'klmnopqrst'[d])));
    check('V4-03 more entries than a tick can hold → unknown', many === 'unknown', many);
    const nonString = await listed([7]);
    check('V4-03 a non-string entry → unknown', nonString === 'unknown', nonString);
    const fine = await listed(['c'.repeat(60), 'd'.repeat(60)]);
    check('V4-03 a well-formed list without the hash still means absent', fine === 'absent', fine);
  }

  // V5-3: values that aren't strings never pass a pattern check (an array holding a valid hash would, as text).
  {
    const nested = await listed([[hash], ['c'.repeat(60)]]);
    check('V5-3 a tick list of nested arrays is malformed → unknown', nested === 'unknown', nested);
    const mixed = await listed(['c'.repeat(60), ['d'.repeat(60)]]);
    check('V5-3 one nested entry voids the list → unknown', mixed === 'unknown', mixed);
    check('V5-3 an archive record with an array for its hash, source or destination is dropped',
      T.parseTx({ ...raw, hash: [raw.hash] }) === null && T.parseTx({ ...raw, source: [raw.source] }) === null && T.parseTx({ ...raw, destination: [raw.destination] }) === null);
  }

  // V4-04: the archive's record must be the signed transfer itself, byte for byte; nothing defaults.
  {
    const seed = 'qwertyuiopasdfghjklzxcvbnmqwertyuiopasdfghjklzxcvbnmqwe';
    const account = T.deriveAccount(seed);
    const targetTick = 86000500;
    const signed = await T.signTransfer({ seed, account, destination: other, amount: 1234n, targetTick, currentTick: targetTick - 10 });
    const bytes = Buffer.from(signed.encoded, 'base64');
    const record = { hash: signed.hash, source: account.identity, destination: other, amount: '1234', tickNumber: targetTick, timestamp: '1792597509000',
      inputType: 0, inputSize: 0, inputData: '', signature: bytes.subarray(80).toString('base64'), moneyFlew: true };
    const same = (r) => { const tx = T.parseTx(r); return Boolean(tx) && T.sameAsSigned(tx, signed.hash, signed.encoded); };
    check('V4-04 the archive’s exact record of the signed transfer matches', same(record));
    check('V4-04 the review’s fixture (inputType 99, inputSize 17, no moneyFlew) does not match', !same({ ...record, inputType: 99, inputSize: 17, moneyFlew: undefined }));
    check('V4-04 another input type alone does not match', !same({ ...record, inputType: 1 }));
    check('V4-04 an input payload does not match an empty one', !same({ ...record, inputSize: 1, inputData: 'AA==' }));
    const sig = Buffer.from(bytes.subarray(80)); sig[5] ^= 1;
    check('V4-04 another signature does not match', !same({ ...record, signature: sig.toString('base64') }));
    check('V4-04 a missing signature or input does not match', !same({ ...record, signature: undefined }) && !same({ ...record, inputData: undefined }));
    check('V4-04 another amount, tick or destination does not match', !same({ ...record, amount: '1235' }) && !same({ ...record, tickNumber: targetTick + 1 }) && !same({ ...record, destination: kat }));
    check('V4-04 required fields missing are malformed, not 0', T.parseTx({ ...record, inputType: undefined }) === null && T.parseTx({ ...record, inputSize: undefined }) === null && T.parseTx({ ...record, amount: undefined }) === null);
  }

  // A real mainnet transfer: the archive's own record of it (getTransactionByHash, fetched 21 Oct 2026) matches the
  // signed bytes in the self-test vector, so genuine transfers aren't held as mismatches.
  {
    const real = {"hash": "jkowcxdyisixqdyusvbulvothgchctwgfnuvwbdfdfinzhnvrfewhepeszyi", "amount": "100000000", "source": "CONDGELDQTGJVBZYCTPEMPZONRKCCZQOARNNJPPCLDGUUGVIOWMIAMRFQOXH", "destination": "HEEXKBJXIZRPJDQUMMXQVFYKQRBDWCIHSWJOHTPZQCNTHZWBGUBUPGXGTFCB", "tickNumber": 85111251, "timestamp": "1792155969000", "inputType": 0, "inputSize": 0, "inputData": "", "signature": "UOdoSamBLQh9uLcjbgkhVFUeJpLdMaa6n0G0BhalyRTBw47hIqFCE8TP7Om42vyl7mpRFSGfU3TIkt54aOMTAA==", "moneyFlew": true};
    const tx = T.parseTx(real);
    check('a real archive record matches its signed transfer byte for byte', Boolean(tx) && T.sameAsSigned(tx, T.KAT.mainnetHash, T.KAT.mainnetTx) && T.archivedStatus(tx) === 'success');
    // Its account's live record (22 Oct 2026) and Core's log of it (21 Oct 2026), as the RPC answered.
    const live = { validForTick: 86062148, lastOutTick: 85621182, lastInTick: 86000610, incoming: 2817092137n };
    const logs = { hits: { total: 1, from: 0, size: 10 }, validForTick: 86049104, eventLogs: [{ epoch: 235, tickNumber: 85111251, timestamp: '1792155969000',
      transactionHash: real.hash, logType: 0, logId: '12255587', logDigest: '622addb5d1a86f78', categories: [], quTransfer: { source: real.source, destination: real.destination, amount: real.amount } }] };
    const outcome = (e) => T.transferOutcome(e, live, tx.tick).status;
    check('…and settles as sent with moneyFlew and the account’s live record (it has sent since)', outcome({ included: true, moneyFlew: true }) === 'success');
    const logged = await load({ getEventLogs: [200, logs] }).fetchTransferLogged(real.hash, tx.tick, { source: real.source, destination: real.destination, amount: 100000000n });
    check('…the real answer from Core’s event log reads as this transfer moving the QUBIC', logged === true);
    check('…so with no moneyFlew at all it still settles as sent, by that log',
      outcome({ included: true, moneyFlew: null, event: null }) === 'wait' && outcome({ included: true, moneyFlew: null, event: true }) === 'success');
    check('…and with the archive’s false (also its “no status”) that log still settles it as sent',
      outcome({ included: true, moneyFlew: false, event: null }) === 'wait' && outcome({ included: true, moneyFlew: false, event: true }) === 'success');
  }

  // Outcomes come from the network's own records (see transferOutcome); disagreement holds the transfer.
  {
    const t = 86000500;
    // The sending account's live record. By default Core holds it (it has received QUBIC) and its last deposit came
    // well before the transfer's tick, so it has run unbroken since.
    const live = (lastOutTick, validForTick = t + 9, { lastInTick = t - 400, incoming = 5000n } = {}) => ({ validForTick, lastOutTick, lastInTick, incoming });
    const out = (e, l, now) => { const r = T.transferOutcome(e, l, t, now); return `${r.status}${r.need ? `:${r.need}` : ''}${r.hold ? '+hold' : ''}`; };
    const inc = (moneyFlew, more = {}) => ({ included: true, moneyFlew, event: null, ...more });
    // Records that may have started afresh since the tick: a deposit since, none held at all, a deposit in that tick.
    const afresh = [live(0, t + 9, { lastInTick: t + 3 }), live(0, t + 9, { lastInTick: 0, incoming: 0n }), live(t - 50, t + 9, { lastInTick: t })];
    check('sent by moneyFlew needs QUBIC to have left the account at the target tick or later',
      out(inc(true), live(t)) === 'success' && out(inc(true), live(t + 3)) === 'success' && out(inc(true), live(t - 50)) === 'unknown+hold');
    check('without moneyFlew, only Core’s log of this transfer says sent (and the account’s record mustn’t contradict it)',
      out(inc(null), live(t)) === 'wait:event' && out(inc(null, { event: true }), live(t)) === 'success' && out(inc(null, { event: true }), live(t + 2)) === 'success'
      && out(inc(null, { event: true }), live(t - 50)) === 'unknown+hold');
    check('the archive’s false is also its “no status”: Core’s log of the transfer still settles it as sent',
      out(inc(false), live(t)) === 'wait:event' && out(inc(false, { event: true }), live(t)) === 'success' && out(inc(false, { event: true }), live(t - 50)) === 'unknown+hold');
    check('finding 2: QUBIC gone at exactly that tick proves nothing alone (a pruned zero-amount transaction moves it too): unknown, not sent',
      out(inc(null, { event: false }), live(t)) === 'unknown' && out(inc(null, { event: false }), live(t + 2)) === 'unknown');
    check('failed needs Core’s own record, unbroken since before the tick, to show nothing sent from that tick on, whatever the archive’s flag',
      out(inc(false), live(t - 50)) === 'wait:event' && out(inc(false, { event: false }), live(t - 50)) === 'failed'
      && out(inc(null, { event: false }), live(t - 50)) === 'failed' && out(inc(null, { event: false }), live(0)) === 'failed');
    check('finding 1 and the review of 21 Oct: a record that may have started afresh proves nothing, even with the archive’s false: unknown, not failed',
      afresh.every((l) => out(inc(null, { event: false }), l) === 'unknown' && out(inc(false, { event: false }), l) === 'unknown'),
      afresh.map((l) => out(inc(false, { event: false }), l)).join(', '));
    check('the archive’s false with QUBIC gone from the account at or after the tick: unknown, not failed',
      out(inc(false, { event: false }), live(t)) === 'unknown' && out(inc(false, { event: false }), live(t + 2)) === 'unknown');
    check('unknown without evidence is looked at again later, not held',
      [inc(null, { event: false }), inc(false, { event: false })].every((e) => T.transferOutcome(e, live(t), t).hold !== true && T.transferOutcome(e, afresh[0], t).hold !== true));
    check('not executed likewise', out({ included: false }, live(0)) === 'not-executed' && out({ included: false }, live(t)) === 'unknown+hold');
    check('the live record must describe a later tick than the transfer’s: at that tick it may be part-way through',
      out(inc(false, { event: false }), live(t - 50, t)) === 'wait' && out({ included: false }, live(0, t)) === 'wait');
    check('V5-3 a transfer in or out after the tick the record describes is impossible: not evidence',
      out(inc(true), live(t + 500)) === 'wait' && out(inc(false), live(t + 10)) === 'wait' && out(inc(false, { event: false }), live(t - 50, t + 9, { lastInTick: t + 10 })) === 'wait');
    check('V5-3 a record far beyond the network’s tick is not evidence', out(inc(true), live(t + 4000000, t + 5000000), t + 20) === 'wait'
      && out(inc(false, { event: false }), live(0, t + 5000000), t + 20) === 'wait' && out(inc(true), live(t, t + 25), t + 20) === 'success');
    check('a live record that hasn’t passed the tick, or none, or one missing a field, waits',
      out(inc(false), live(0, t - 1)) === 'wait' && out(inc(true), null) === 'wait' && out(inc(false), { validForTick: t + 9 }) === 'wait'
      && out(inc(false, { event: false }), { validForTick: t + 9, lastOutTick: t - 50, incoming: 5000n }) === 'wait'
      && out(inc(false, { event: false }), { validForTick: t + 9, lastOutTick: t - 50, lastInTick: t - 400, incoming: 5000 }) === 'wait');
    const note = (e, l) => T.transferOutcome(e, l, t).note || '';
    check('unsettled transfers say what the records show', /marks transfers it has no status for the same way/.test(note(inc(false, { event: false }), live(t)))
      && /Nothing yet says whether this transfer moved/.test(note(inc(null, { event: false }), live(t + 2))) && /current record shows nothing sent/.test(note(inc(true), live(t - 50))));
    // Core's log, read strictly.
    const ev = { tickNumber: 100, transactionHash: raw.hash, logType: 0, quTransfer: { source: kat, destination: other, amount: '5' } };
    const logFor = (eventLogs) => load({ getEventLogs: [200, { hits: { total: eventLogs.length }, eventLogs }] })
      .fetchTransferLogged(raw.hash, 100, { source: kat, destination: other, amount: 5n });
    check('Core’s log counts only as this exact transfer: a QU transfer with the same hash, tick, sides and amount',
      await logFor([ev]) === true && await logFor([{ ...ev, quTransfer: { ...ev.quTransfer, amount: '6' } }]) === false
      && await logFor([{ ...ev, logType: 8 }]) === false && await logFor([{ ...ev, tickNumber: 101 }]) === false && await logFor([]) === false);
    const id = kat;
    const bal = (b) => load({ [`balances/${id}`]: [200, { balance: { id, balance: '10', validForTick: 86000600, ...b } }] }).fetchOutflow(id).then((r) => r, () => 'error');
    const zero = { latestOutgoingTransferTick: 0, latestIncomingTransferTick: 0, incomingAmount: '0' };
    const ok = await bal(zero);
    const real = await bal({ latestOutgoingTransferTick: 85621182, latestIncomingTransferTick: 86000610, incomingAmount: '2817092137' });
    const broken = await Promise.all([{}, { ...zero, latestIncomingTransferTick: undefined }, { ...zero, incomingAmount: undefined },
      { ...zero, incomingAmount: 5 }, { ...zero, incomingAmount: '-5' }, { ...zero, latestIncomingTransferTick: '7' }].map(bal));
    check('the live record is read strictly: 0 is 0, a missing or malformed field is an error',
      ok.lastOutTick === 0 && ok.lastInTick === 0 && ok.incoming === 0n && ok.validForTick === 86000600
      && real.lastInTick === 86000610 && real.incoming === 2817092137n && broken.every((r) => r === 'error'), broken.map((r) => (r === 'error' ? 'error' : 'read')).join(', '));
    const huge = await bal({ ...zero, latestOutgoingTransferTick: 2 ** 32 });
    const hugeIn = await bal({ ...zero, latestIncomingTransferTick: 2 ** 32 });
    const info = await load({ 'tick-info': [200, { tickInfo: { tick: 2 ** 32, epoch: 200, initialTick: 1 } }] }).fetchTickInfo().then(() => 'accepted', (e) => e.kind);
    check('ticks past 32 bits in the live record or the tick info are malformed', huge === 'error' && hugeIn === 'error' && info === 'invalid', `${huge}, ${hugeIn}, ${info}`);
  }


  // Responses are read with a size cap: an oversized answer is refused while it streams in (or as soon as its declared
  // length says so), and a normal one still works.
  {
    const MB = 1024 * 1024;
    let streamed = 0;
    const flood = () => new Response(new ReadableStream({
      pull(ctrl) { if (streamed >= 64 * MB) { ctrl.close(); return; } streamed += MB; ctrl.enqueue(new Uint8Array(MB).fill(48)); },
    }), { status: 200 });
    const big = await load({ 'tick-info': flood }).fetchTickInfo().then(() => 'accepted', (e) => e.kind);
    check('an endless stream is refused once it passes the cap, without reading the rest', big === 'toolarge' && streamed <= 6 * MB, `${big}, read ${streamed / MB} MB`);
    const declared = await load({ 'tick-info': () => new Response('{}', { status: 200, headers: { 'content-length': String(64 * MB) } }) }).fetchTickInfo().then(() => 'accepted', (e) => e.kind);
    check('a declared length over the cap is refused before reading', declared === 'toolarge', declared);
    const normal = await load({ 'tick-info': [200, { tickInfo: { tick: 86000000, epoch: 236, initialTick: 85000000 } }] }).fetchTickInfo().then((t) => t.tick, (e) => e.kind);
    check('a normal response still reads', normal === 86000000, String(normal));
    let textCalled = false;
    const noStream = () => ({ ok: true, status: 200, headers: new Headers(), body: {}, text: async () => { textCalled = true; return 'x'.repeat(8 * MB); } });
    const ns = await load({ 'tick-info': noStream }).fetchTickInfo().then(() => 'accepted', (e) => e.kind);
    check('a response the browser can’t stream is refused unread: no whole-body fallback', ns === 'unsupported' && !textCalled, ns);
    const empty = await load({ 'tick-info': () => new Response(null, { status: 200 }) }).fetchTickInfo().then(() => 'accepted', (e) => e.kind);
    check('a response without a body reads as empty (so as unusable data)', empty === 'invalid', empty);
  }

  // Only a successful answer has to be JSON: an error page that isn't (a proxy's HTML 503, a plain-text 429) is judged
  // by its status, so it is retried like any 5xx or 429. The tick info is asked for twice at most.
  {
    const tries = async (status, body) => {
      let n = 0;
      const kind = await load({ 'tick-info': () => { n++; return new Response(body, { status }); } }).fetchTickInfo().then(() => 'accepted', (e) => e.kind);
      return `${kind} after ${n}`;
    };
    const [html, limited, garbled] = await Promise.all([tries(503, '<html><body>Service Unavailable</body></html>'), tries(429, 'Too Many Requests'), tries(200, '<html>ok</html>')]);
    check('an error page that isn’t JSON is judged by its status and retried; a 200 that isn’t JSON is unreadable',
      html === 'http after 2' && limited === 'ratelimit after 2' && garbled === 'invalid after 1', `${html}, ${limited}, ${garbled}`);
  }


  // Exchange order books: read strictly, as a whole; and the spread, depth and sell figures computed from them.
  {
    const lv = (pairs) => pairs.map(([p, q]) => [String(p), String(q)]);
    const asks = lv([['0.0000004552', '9746639.1'], ['0.0000004560', '100'], ['0.0000004600', '200']]);
    const bids = lv([['0.0000004542', '7270551518.1'], ['0.0000004500', '300'], ['0.0000004400', '400']]);
    const gate = await load({ order_book: [200, { current: 1, update: 1, asks, bids }] }).fetchOrderBook('gate').then((b) => b, (e) => e.kind);
    check('order books: Gate.io’s response reads', gate.asks && gate.asks.length === 3 && gate.bids[0].amount === 7270551518.1 && gate.bids.length === 3);
    const bad = (a, b) => { try { T.parseBook(a, b); return 'accepted'; } catch (e) { return e.kind; } };
    check('order books: shuffled, repeated, zero, crossed, nested, exponent or oversized levels are refused',
      bad([asks[1], asks[0]], bids) === 'invalid' && bad([asks[0], asks[0]], bids) === 'invalid' && bad(lv([['0.00000046', '0']]), bids) === 'invalid'
      && bad(lv([['0.0000004500', '5']]), bids) === 'invalid' && bad([[asks[0]]], bids) === 'invalid' && bad(lv([['4.6e-7', '5']]), bids) === 'invalid'
      && bad(Array.from({ length: 1001 }, (_, i) => [String(1 + i), '1']), bids) === 'invalid' && bad([], bids) === 'invalid');
    const mexc = await load({ 'api/v3/depth': [200, { lastUpdateId: 1, bids, asks }] }).fetchOrderBook('mexc').then((b) => b, (e) => e.kind);
    const mexcBad = await load({ 'api/v3/depth': [400, { code: -1121, msg: 'Invalid symbol.' }] }).fetchOrderBook('mexc').then(() => 'accepted', (e) => e.kind);
    const mexcOdd = await load({ 'api/v3/depth': [200, { lastUpdateId: 1, data: { bids, asks } }] }).fetchOrderBook('mexc').then(() => 'accepted', (e) => e.kind);
    check('order books: MEXC’s depth response reads; its error and other shapes are refused', mexc.asks && mexc.asks.length === 3 && mexcBad === 'http' && mexcOdd === 'invalid', `${mexcBad}, ${mexcOdd}`);
    const asked = [];
    const answer = (body) => (url) => { asked.push(url); return new Response(JSON.stringify(body), { status: 200 }); };
    const spy = load({ order_book: answer({ asks, bids }), 'api/v3/depth': answer({ asks, bids }) });
    for (const id of ['gate', 'mexc']) { await spy.fetchOrderBook(id); await spy.fetchOrderBook(id, true); }
    const limits = asked.map((u) => new URL(u).searchParams.get('limit')).join(',');
    check('order books: the top 100 levels a side, or the deepest each exchange gives for the wider view', limits === '100,1000,100,1000', limits);
    const book = T.parseBook(lv([[1.02, 5], [1.03, 5], [1.1, 5]]), lv([[0.98, 10], [0.97, 10], [0.9, 10]]));
    const st = T.bookStats(book, 0.02);
    check('order books: best bid/ask, spread and depth within 2% (complete when the levels reach past it)',
      st.bid === 0.98 && st.ask === 1.02 && Math.abs(st.spreadPct - 0.04) < 1e-12 && st.bidDepth.qty === 10 && st.bidDepth.complete
      && st.askDepth.qty === 5 && st.askDepth.complete && Math.abs(st.bidDepth.usd - 9.8) < 1e-9);
    const thin = T.bookStats(T.parseBook(lv([[1.01, 1]]), lv([[0.995, 1], [0.99, 1]])), 0.02);
    check('order books: depth is marked partial when the loaded levels end inside the band', !thin.bidDepth.complete && !thin.askDepth.complete);
    const sold = T.sellInto(book.bids, 15);
    const short = T.sellInto(book.bids, 50);
    check('order books: selling walks the bids best first (average, slip below the best bid, enough or not)',
      Math.abs(sold.usd - (10 * 0.98 + 5 * 0.97)) < 1e-9 && sold.complete && Math.abs(sold.avg - 14.65 / 15) < 1e-12 && sold.slip < 0
      && short.filled === 30 && !short.complete);
    const near = T.parseBook(lv([['0.0000004552', 5], ['0.0000004558', 5], ['0.0000004561', 7]]), lv([['0.0000004549', 1], ['0.0000004541', 2], ['0.0000004539', 4]]));
    const ga = T.groupLevels(near.asks, 10, true).map((l) => `${Math.round(l.price / 1e-10)}:${l.amount}`).join(',');
    const gb = T.groupLevels(near.bids, 10, false).map((l) => `${Math.round(l.price / 1e-10)}:${l.amount}`).join(',');
    check('order books: fewer decimals group levels (asks rounded up, bids down, amounts added)', ga === '4560:10,4570:7' && gb === '4540:3,4530:4' && T.groupLevels(near.asks, 1, true) === near.asks, `${ga} | ${gb}`);
    const merged = T.mergedBids([book, T.parseBook(lv([[1.5, 1]]), lv([[0.985, 2], [0.5, 1]]))]).map((l) => l.price).join(',');
    check('order books: both books’ bids merge best first', merged === '0.985,0.98,0.97,0.9,0.5', merged);
  }

  // Tips (Settings → Support qoree): the address is the one we were given and a valid identity, so a typo in the config
  // can't send anyone's QUBIC to an address nobody holds; dollars become whole QUBIC at the price, or no amount at all.
  check('tips: the donation address is a valid identity', T.checkIdentity(T.DONATION_ADDRESS).state === 'valid', T.DONATION_ADDRESS);
  check('tips: the donation address is the one given', T.DONATION_ADDRESS === 'SCSGABTBOJFGTBFQVBFFWNYLHIRCXMIJUJMHSCFRVFHGYCBHMEVWEMCCHRUH');
  check('tips: $5 at $0.000000451 is 11,086,475 QUBIC', T.usdToQubic(5, 0.000000451) === 11086475n, String(T.usdToQubic(5, 0.000000451)));
  check('tips: $10 at $0.000000451 is 22,172,949 QUBIC', T.usdToQubic(10, 0.000000451) === 22172949n, String(T.usdToQubic(10, 0.000000451)));
  const noTip = [[5, null], [5, 0], [5, NaN], [0, 1e-6], [-5, 1e-6], [NaN, 1e-6], [1, 3], [1e20, 1e-9]].filter(([u, p]) => T.usdToQubic(u, p) !== null);
  check('tips: no amount without a price, a positive sum or a whole coin', noTip.length === 0, JSON.stringify(noTip));

  // Text on the accent: one rule (inkFor) for the presets and picked colours. The config's and the styles' preset inks
  // must be the rule's, and mid-tone oranges and reds get white.
  const presetsOff = T.ACCENTS.filter((a) => T.inkFor(a.fill) !== a.ink.toUpperCase()).map((a) => a.id);
  check('accent ink: every preset’s ink is the rule’s', presetsOff.length === 0, presetsOff.join(', '));
  const css = require('fs').readFileSync(require('path').join(SRC, 'styles.css'), 'utf8');
  const cssPairs = [...css.matchAll(/--brand-fill: (#[0-9a-f]{6}); --brand-ink: (#[0-9a-f]{6});/gi)];
  const cssOff = cssPairs.filter(([, fill, ink]) => T.inkFor(fill) !== ink.toUpperCase()).map(([, fill]) => fill);
  check('accent ink: the styles give every preset the rule’s ink', cssPairs.length === T.ACCENTS.length && cssOff.length === 0,
    `${cssPairs.length} presets; off: ${cssOff.join(', ') || 'none'}`);
  const inks = ['#f97316', '#ee4f2d', '#e11d48', '#2563eb', '#000000', '#1bdef5', '#fac515', '#ffffff'].map((c) => T.inkFor(c)).join(' ');
  check('accent ink: white on orange, red-orange, rose, blue and black; near-black on teal, gold and white',
    inks === '#FFFFFF #FFFFFF #FFFFFF #FFFFFF #FFFFFF #292524 #292524 #292524', inks);

  // Canonical identities: rebuild each 14-letter group of a valid identity from its value + 2^64 (always 14 base-26
  // letters, since 2^65 < 26^14); it decodes to the same 64-bit value, so it passes the checksum.
  check('a canonical identity is valid', T.checkIdentity(kat).state === 'valid');
  const pk = T.Q.identityToPublicKey(kat);
  let made = 0; let refused = 0;
  for (let g = 0; g < 4; g++) {
    const v = new DataView(pk.buffer, pk.byteOffset + g * 8, 8).getBigUint64(0, true) + (1n << 64n);
    let w = v; let letters = '';
    for (let j = 0; j < 14; j++) { letters += String.fromCharCode(65 + Number(w % 26n)); w /= 26n; }
    const alias = kat.slice(0, g * 14) + letters + kat.slice(g * 14 + 14);
    let samekey = false;
    try { samekey = Buffer.from(T.Q.identityToPublicKey(alias)).equals(Buffer.from(pk)); } catch { samekey = false; }
    if (!samekey) continue;
    made++;
    if (T.checkIdentity(alias).state !== 'valid') refused++;
  }
  check('noncanonical aliases of a valid identity are refused', made === 4 && refused === made, `${refused}/${made} aliases refused`);

  // Exchange status: Gate.io's answer as it really comes (22 Oct 2026: paused), open, and odd.
  {
    const gate = (dep, wd, extra = {}) => ({ currency: 'QUBIC', delisted: false, deposit_disabled: dep, withdraw_disabled: wd, trade_disabled: false, chain: 'QUBIC',
      chains: [{ name: 'QUBIC', addr: '', deposit_disabled: dep, withdraw_disabled: wd, withdraw_delayed: false }], ...extra });
    const said = (s) => (s ? `${s.deposits}/${s.withdrawals}` : 'null');
    const g = { paused: T.parseGateStatus(gate(true, true)), open: T.parseGateStatus(gate(false, false)), strings: T.parseGateStatus(gate('true', 'false')),
      missing: T.parseGateStatus({ currency: 'QUBIC' }), other: T.parseGateStatus(gate(true, true, { currency: 'QUBICX' })), html: T.parseGateStatus('<html>') };
    check('exchange status: Gate.io’s booleans say paused or open; strings, missing flags and another coin say nothing',
      said(g.paused) === 'false/false' && said(g.open) === 'true/true' && said(g.strings) === 'null/null' && said(g.missing) === 'null/null' && g.other === null && g.html === null,
      Object.entries(g).map(([k, v]) => `${k} ${said(v)}`).join(', '));
    const text = (gs) => T.exchangePauseText({ gate: gs });
    const both = text({ deposits: false, withdrawals: false });
    const deposits = text({ deposits: false, withdrawals: true });
    const withdrawals = text({ deposits: null, withdrawals: false });
    const open = text({ deposits: true, withdrawals: true });
    const unknown = text(null);
    check('exchange status: the note names what Gate.io paused, and nothing for open or unknown',
      both === 'Gate.io has paused QUBIC deposits and withdrawals.' && deposits === 'Gate.io has paused QUBIC deposits.'
        && withdrawals === 'Gate.io has paused QUBIC withdrawals.' && open === null && unknown === null, [both, deposits, withdrawals, open, unknown].join(' | '));
    const L = load({ 'spot/currencies/QUBIC': [200, gate(true, false)] });
    const fromGate = await L.fetchExchangeStatus('gate');
    const D = load({ 'spot/currencies/QUBIC': [500, { msg: 'down' }] });
    let gateDown = null; try { await D.fetchExchangeStatus('gate'); gateDown = 'answered'; } catch (e) { gateDown = e.kind; }
    check('exchange status: read through the capped request; a failed answer is an error, never a status', said(fromGate) === 'false/true' && gateDown === 'http', `${said(fromGate)}, gate ${gateDown}`);
  }

  // A server's own words never reach the screen: its error says only the status (the words stay on the error, cleaned).
  // Text a server sends for display loses control characters and the marks that reorder it.
  {
    const lure = 'Your wallet is out of sync.\u202e Re-import your seed at evil.example\u0007';
    const L = load({ 'tick-info': [400, { message: lure }] });
    const e = await L.fetchTickInfo().then(() => null, (x) => x);
    const shown = e ? L.messageOf(e) : '';
    check('a server’s error text never reaches the screen: only its status does', Boolean(e) && shown.includes('400')
      && !/sync|seed|evil/i.test(shown) && /Re-import/.test(e.detail || '') && !/[\u202e\u0007]/.test(e.detail || ''), shown);
    const cleaned = T.cleanText('a\u202eb\u2066c\u0085d\u200f\u061ce', 20);
    check('text from a server loses control characters and the marks that reorder it', cleaned === 'abcde', JSON.stringify(cleaned));
  }
  // A request that failed isn't retried once its session ended (a lock in between): the retry would read for a session
  // that's gone, and may name one of its addresses. It fails as cancelled, not as the server's error.
  {
    let calls = 0; let R = null;
    R = load({ 'tick-info': () => { calls++; R.nextSession(); return new Response('{}', { status: 503 }); } });
    const r = await R.fetchTickInfo().then(() => 'read', (e) => e.code || e.kind);
    check('a failed request isn’t retried once its session ended (a lock in between), and fails as cancelled', calls === 1 && r === 'CANCELLED', `${calls} sent, ${r}`);
  }
  // A session that ends while a request is out aborts it at once (the fetch sees the abort), and the request fails as
  // cancelled, never as a network error, so nothing says or keeps it.
  {
    let calls = 0; let signal = null; let R = null;
    R = load({ 'tick-info': (url, init) => {
      calls++; signal = init.signal;
      return new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError'))); });
    } });
    const out = R.request(R.API.tickInfo, { retries: 0, timeout: 1000 }).then(() => 'read', (e) => e.code || e.kind);
    await new Promise((r) => setTimeout(r, 0));
    R.nextSession();
    const atOnce = Boolean(signal && signal.aborted);
    const r = await out;
    check('a session that ends mid-request aborts it at once, and the request fails as cancelled, not as a network error',
      calls === 1 && atOnce && r === 'CANCELLED', `${calls} sent, aborted at once ${atOnce}, ${r}`);
  }

  finish('outcome');
})().catch(harnessError);
