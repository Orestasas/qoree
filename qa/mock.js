// QA-ONLY: a hidden preview pane pauses requestAnimationFrame; fall back to a timer so renders still happen in tests.
(function () {
  const raf = window.requestAnimationFrame.bind(window); const caf = window.cancelAnimationFrame.bind(window);
  const live = new Map(); let n = 0;
  window.requestAnimationFrame = (cb) => { const id = ++n; const fire = (ts) => { const e = live.get(id); if (!e) return; live.delete(id); clearTimeout(e[0]); caf(e[1]); cb(ts); }; live.set(id, [setTimeout(() => fire(performance.now()), 34), raf(fire)]); return id; };
  window.cancelAnimationFrame = (id) => { const e = live.get(id); if (e) { clearTimeout(e[0]); caf(e[1]); live.delete(id); } };
  window.__qaFrames = true;
})();
// QA-ONLY network mock. Never shipped. Fakes balances and the broadcast/status endpoints so the
// send flow can be exercised end-to-end without funds and WITHOUT sending anything to the network.
(function () {
  const realFetch = window.fetch.bind(window);
  // The page's own library: qa/make.py puts this file inside the page's script, where it is in scope as `vendored`.
  const Q = vendored ? vendored.QubicLib : null;
  const sent = new Map(); let walks = 0; const reads = new Map(); const arrivalTick = new Map();
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  // As the archive returns a transfer: every field, the signature in base64. Amount ending in 07: money didn't move
  // (moneyFlew false, which the archive also serves when it has no status).
  const archived = (hash, s) => ({ hash, amount: String(s.d.amount), source: Q.publicKeyToIdentity(s.d.sourcePublicKey), destination: Q.publicKeyToIdentity(s.d.destinationPublicKey),
    tickNumber: s.d.targetTick, timestamp: String(s.at), inputType: 0, inputSize: 0, inputData: '',
    signature: btoa(String.fromCharCode(...s.bytes.subarray(80, 144))), moneyFlew: s.d.amount % 100n !== 7n });
  window.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/live/v1/broadcast-transaction')) {
      const { encodedTransaction } = JSON.parse(init.body);
      const bytes = Uint8Array.from(atob(encodedTransaction), (c) => c.charCodeAt(0));
      const d = Q.decodeTransaction(bytes);
      const hash = Q.computeTransactionHash(bytes);
      sent.set(hash, { d, bytes, sigOk: Q.verifyTransactionSignature(bytes), at: Date.now() });
      console.log('[qa-mock] intercepted broadcast (NOT sent):', hash, 'sigOk', Q.verifyTransactionSignature(bytes), 'amount', String(d.amount), 'tick', d.targetTick);
      // sessionStorage 'qa-broadcast-delay' (ms) holds the answer back, so a test can reload mid-broadcast.
      await new Promise((r) => setTimeout(r, 700 + (Number(sessionStorage.getItem('qa-broadcast-delay')) || 0)));
      return json({ peersBroadcasted: 3, encodedTransaction, transactionId: hash });
    }
    if (url.includes('/query/v1/getTransactionByHash')) {
      const { hash } = JSON.parse(init.body);
      const s = sent.get(hash);
      if (s) {
        if (s.d.amount % 100n === 13n) return json({ code: 5, message: 'transaction not found' }, 404);
        return json(archived(hash, s));
      }
    }
    // sessionStorage 'qa-log-moves' = '1': Core's event log holds each included mocked transfer as a QU transfer, as
    // getEventLogs returns it, whatever the archive's flag says (an amount ending in 07 then reads as the archive
    // having no status for a transfer that went through).
    if (url.includes('/query/v1/getEventLogs') && sessionStorage.getItem('qa-log-moves') === '1') {
      const { filters } = JSON.parse(init.body);
      const s = filters && sent.get(filters.transactionHash);
      if (s && s.d.amount % 100n !== 13n) {
        const a = archived(filters.transactionHash, s);
        return json({ hits: { total: 1, from: 0, size: 20 }, validForTick: s.d.targetTick + 5, eventLogs: [{ epoch: 0, tickNumber: a.tickNumber, timestamp: a.timestamp,
          transactionHash: a.hash, logType: 0, logId: '1', logDigest: '0', categories: [], quTransfer: { source: a.source, destination: a.destination, amount: a.amount } }] });
      }
    }
    // The archive's history lists the mocked transfers it has processed (amount ending in 13: never included).
    if (url.includes('/query/v1/getTransactionsForIdentity')) {
      const body = JSON.parse(init.body);
      const res = await realFetch(input, init);
      const j = await res.clone().json().catch(() => null);
      if (!j || !j.hits || (body.pagination && body.pagination.offset)) return res;
      // The look-alike check's outgoing-only read (filters.source): only what that account sent, as the archive answers it.
      const from = body.filters && body.filters.source;
      const mine = [...sent].filter(([, s]) => s.d.amount % 100n !== 13n && s.d.targetTick <= (j.validForTick || 0)
        && [Q.publicKeyToIdentity(s.d.sourcePublicKey), Q.publicKeyToIdentity(s.d.destinationPublicKey)].includes(body.identity)
        && (!from || Q.publicKeyToIdentity(s.d.sourcePublicKey) === from)).map(([h, s]) => archived(h, s));
      // sessionStorage 'qa-fake-deposits': four transfers of 1,000 QUBIC to this account from an outsider that moved
      // nothing, with input types 0, 1, 7 and 65535. '1': the archive's false on each; '2': false and no flag in turn.
      // Balances stay as they are.
      const fakeMode = sessionStorage.getItem('qa-fake-deposits');
      const fakes = from || (fakeMode !== '1' && fakeMode !== '2') ? [] : [0, 1, 7, 65535].map((inputType, i) => ({
        hash: `qafakedeposit${'abcd'[i]}`.padEnd(60, 'z'), source: 'BZBQFLLBNCXEMGLOBHUVFTLUPLVCPQUASSILFABOFFBCADQSSUPNWLZBQEXK', destination: body.identity,
        amount: '1000', tickNumber: (j.validForTick || 1) - 1 - i, timestamp: String(Date.now() - 60000 * (i + 1)),
        inputType, inputSize: 0, inputData: '', signature: '', ...(fakeMode === '2' && i % 2 ? {} : { moneyFlew: false }) }));
      // sessionStorage 'qa-arrival' = '1': from this account's second read on, a transfer of 2,500 QUBIC to it from an
      // outsider that moved (the arrival toast, and Activity's "Received"). Balances stay as they are.
      reads.set(body.identity, (reads.get(body.identity) || 0) + 1);
      if (!from && sessionStorage.getItem('qa-arrival') === '1' && reads.get(body.identity) >= 2) {
        if (!arrivalTick.has(body.identity)) arrivalTick.set(body.identity, (j.validForTick || 1) - 1);
        fakes.push({ hash: 'qaarrival'.padEnd(60, 'z'), source: 'BZBQFLLBNCXEMGLOBHUVFTLUPLVCPQUASSILFABOFFBCADQSSUPNWLZBQEXK', destination: body.identity,
          amount: '2500', tickNumber: arrivalTick.get(body.identity), timestamp: String(Date.now()), inputType: 0, inputSize: 0, inputData: '', signature: '', moneyFlew: true });
      }
      if (!mine.length && !fakes.length) return res;
      return json({ ...j, hits: { ...j.hits, total: j.hits.total + mine.length + fakes.length }, transactions: [...fakes, ...mine.reverse(), ...(j.transactions || [])] });
    }
    // QA-only: with sessionStorage 'qa-gate-prices' = '1', CoinGecko (rate-limited on this machine after research)
    // is answered with real Gate.io QUBIC/USDT prices reshaped into CoinGecko's response format.
    if (url.startsWith('https://api.coingecko.com/') && sessionStorage.getItem('qa-gate-prices') === '1') {
      const gate = async (interval, from, to) => (await realFetch(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=QUBIC_USDT&interval=${interval}&from=${from}&to=${to}`)).json();
      const now = Math.floor(Date.now() / 1000);
      if (url.includes('/simple/price')) {
        const t = (await (await realFetch('https://api.gateio.ws/api/v4/spot/tickers?currency_pair=QUBIC_USDT')).json())[0];
        return json({ 'qubic-network': { usd: Number(t.last), usd_24h_change: Number(t.change_percentage), usd_market_cap: 0, last_updated_at: now } });
      }
      const days = Number((url.match(/days=(\d+)/) || [])[1] || 1);
      let rows = [];
      if (days === 1) rows = await gate('5m', now - 86400, now);
      else if (days === 90) for (const k of [3, 2, 1]) rows = rows.concat(await gate('1h', now - k * 30 * 86400 + (k < 3 ? 3600 : 0), now - (k - 1) * 30 * 86400));
      else rows = await gate('1d', now - days * 86400, now);
      console.log('[qa-mock] CoinGecko days=' + days + ' answered with ' + rows.length + ' Gate.io candles');
      return json({ prices: rows.map((r) => [Number(r[0]) * 1000, Number(r[2])]) });
    }
    // sessionStorage 'qa-tick-freeze' = a tick number: tick-info answers that tick, as a network stalled there would.
    // Remove it to let the tick move on.
    if (url.includes('/live/v1/tick-info') && sessionStorage.getItem('qa-tick-freeze')) {
      const res = await realFetch(input, init);
      const j = await res.clone().json().catch(() => null);
      if (!j || !j.tickInfo) return res;
      j.tickInfo.tick = Number(sessionStorage.getItem('qa-tick-freeze'));
      return json(j);
    }
    const res = await realFetch(input, init);
    // sessionStorage 'qa-real-balances' = '1' keeps real balances.
    // The live record also shows the intercepted transfers that "moved money" as the account's latest outgoing tick.
    if (url.includes('/live/v1/balances/')) {
      const j = await res.clone().json().catch(() => null);
      if (!j || !j.balance) return res;
      if (sessionStorage.getItem('qa-real-balances') !== '1') {
        // A funded account's whole record: what it received makes up the balance, the last deposit well before now.
        j.balance.balance = '5000000000';
        j.balance.incomingAmount = String(5000000000n + BigInt(j.balance.outgoingAmount || '0'));
        if (!j.balance.latestIncomingTransferTick) j.balance.latestIncomingTransferTick = j.balance.validForTick - 100000;
      }
      // sessionStorage 'qa-record-restarted' = '1': Core dropped the emptied account and a deposit since started its
      // record afresh, so it shows no outgoing tick and a deposit after any transfer here.
      const restarted = sessionStorage.getItem('qa-record-restarted') === '1';
      if (restarted) { j.balance.latestOutgoingTransferTick = 0; j.balance.latestIncomingTransferTick = j.balance.validForTick - 1; }
      // sessionStorage 'qa-balance-walk' = a step in QUBIC: each answer moves the balance by it, twice up then twice
      // down, so a changing number can be watched.
      const walk = Number(sessionStorage.getItem('qa-balance-walk')) || 0;
      if (walk) j.balance.balance = String(5000000000 + [0, 1, 2, 1][++walks % 4] * walk);
      for (const s of sent.values()) {
        const moved = (s.d.amount % 100n !== 7n || sessionStorage.getItem('qa-log-moves') === '1') && s.d.amount % 100n !== 13n;
        if (moved && !restarted && Q.publicKeyToIdentity(s.d.sourcePublicKey) === j.balance.id && s.d.targetTick <= j.balance.validForTick) {
          j.balance.latestOutgoingTransferTick = Math.max(j.balance.latestOutgoingTransferTick || 0, s.d.targetTick);
        }
      }
      return json(j);
    }
    return res;
  };
  window.__qaSent = sent;
})();
