// ═══════════════════════════════════════════════════════════════════════════
// 6. NETWORK
// One fetch wrapper (timeouts, bounded retries, no credentials, no referrer) and
// strict parsers: anything that doesn't match the expected shape is rejected.
// ═══════════════════════════════════════════════════════════════════════════
// text: the message in English (marked with trLater), translated where it's shown (messageOf); vars fill it in.
class NetError extends Error {
  /** @param {string} kind @param {string} text @param {number} [status] @param {Record<string, unknown> | null} [vars] */
  constructor(kind, text, status = 0, vars = null) {
    super(trEnglish(text, vars));
    this.kind = kind; // network | timeout | http | notfound | ratelimit | invalid | toolarge | unsupported
    this.status = status;
    this.text = text;
    this.vars = vars;
  }
}

/** @type {{ latency: number | null }} */
const netStats = { latency: null };

// The body as text, read as it streams in and refused once it passes MAX_RESPONSE_BYTES (or says up front that it
// will), so an oversized answer never has to be held whole or parsed.
async function readCapped(res, max = MAX_RESPONSE_BYTES) {
  const tooBig = () => new NetError('toolarge', trLater('The server sent far more data than expected.'), res.status);
  const declared = Number(res.headers && res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) { try { await res.body?.cancel(); } catch { /* closing anyway */ } throw tooBig(); }
  // No body at all (204, 304): nothing to read.
  if (res.body === null) return '';
  // Read only as a stream, so the cap holds while the data arrives. A browser that can't stream a response would have
  // to take it in whole before it could be measured, so it isn't read at all.
  if (!res.body || typeof res.body.getReader !== 'function') {
    throw new NetError('unsupported', trLater('This browser can’t read server responses safely. Use an up-to-date browser.'), res.status);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { reader.cancel().catch(() => {}); throw tooBig(); }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

// session: the session it belongs to (see openSession): the current one unless given, null for none. Its end aborts
// the request and stops its retries (what they'd read belongs to a session that's gone, and may name one of its
// addresses), and the request then fails as CANCELLED, never as a network error.
/** @param {string} url @param {{ method?: string, body?: unknown, timeout?: number, retries?: number, session?: Session | null }} [opts] */
async function request(url, { method = 'GET', body, timeout = TIMEOUT_MS, retries, session = state.session } = {}) {
  const maxRetries = retries ?? (method === 'GET' ? 2 : 0);
  const ended = () => session != null && !session.alive();
  const cancelled = () => new AppError('CANCELLED', trLater('Cancelled.'));
  for (let attempt = 0; ; attempt++) {
    if (ended()) throw cancelled();
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeout);
    // Wired by hand, beside the timeout (not every browser has AbortSignal.any).
    const stop = () => ctrl.abort();
    session?.signal.addEventListener('abort', stop);
    const t0 = performance.now();
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        mode: 'cors',
      });
      const text = await readCapped(res);
      let data = null;
      // Only a successful answer has to be JSON: an error page (a proxy's HTML 502, a plain-text 429) is judged by its
      // status.
      if (text) {
        try { data = JSON.parse(text); } catch { if (res.ok) throw new NetError('invalid', trLater('The server sent an unreadable response.'), res.status); }
      }
      if (!res.ok) {
        // Only the status is said: a server's own words would put whatever it likes on the wallet's screen ("Re-import
        // your seed at …"). They're kept on the error, cleaned, for the console and the tests.
        const kind = res.status === 404 ? 'notfound' : res.status === 429 ? 'ratelimit' : 'http';
        const err = new NetError(kind, kind === 'ratelimit' ? trLater('Too many requests. Try again in a moment.') : trLater('Server error {status}'), res.status, { status: String(res.status) });
        err.detail = data && typeof data.message === 'string' ? cleanText(data.message, 160) : '';
        throw err;
      }
      if (url.startsWith(RPC)) netStats.latency = Math.round(performance.now() - t0);
      return data;
    } catch (e) {
      if (ended()) throw cancelled();
      let err = e;
      if (!(err instanceof NetError)) {
        if (timedOut) err = new NetError('timeout', trLater('The request timed out.'));
        else err = new NetError('network', navigator.onLine === false ? trLater('You appear to be offline.') : trLater('Could not reach the server.'));
      }
      const retryable = ['network', 'timeout', 'ratelimit'].includes(err.kind) || (err.kind === 'http' && err.status >= 500);
      if (attempt < maxRetries && retryable) {
        await sleep(500 * 2 ** attempt + randomBytes(1)[0]);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      session?.signal.removeEventListener('abort', stop);
    }
  }
}

// ── Validation helpers ──────────────────────────────────────────────────────
const isUint = (v) => Number.isSafeInteger(v) && v >= 0;
// Ticks are 32-bit unsigned in Qubic Core and in the RPC's and archive's schemas: anything larger is malformed.
const isTick = (v) => isUint(v) && v <= 0xFFFFFFFF;
const tickOr0 = (v) => (isTick(v) ? v : 0);
const isDigits = (v) => typeof v === 'string' && /^\d{1,20}$/.test(v);
const bigOr0 = (v) => (isDigits(v) ? BigInt(v) : 0n);
const uintOr0 = (v) => (isUint(v) ? v : 0);
const invalid = () => new NetError('invalid', trLater('The server sent data in an unexpected format.'));

// ── Live API ────────────────────────────────────────────────────────────────
/** @returns {Promise<TickInfo>} */
async function fetchTickInfo() {
  const d = await request(API.tickInfo, { retries: 1, timeout: 8000 });
  const t = d && d.tickInfo;
  if (!t || !isTick(t.tick) || t.tick === 0) throw invalid();
  return { tick: t.tick, epoch: isUint(t.epoch) && t.epoch <= 0xFFFF ? t.epoch : 0 };
}

async function fetchBalance(identity) {
  const d = await request(API.balance(identity));
  const b = d && d.balance;
  if (!b || b.id !== identity || (b.balance != null && !isDigits(b.balance))) throw invalid();
  return {
    amount: bigOr0(b.balance),
    lastInTick: tickOr0(b.latestIncomingTransferTick),
    lastOutTick: tickOr0(b.latestOutgoingTransferTick),
  };
}

// For settling a transfer: the sending account's live record, strictly read (a missing or malformed field is an error,
// never 0). validForTick: the tick the record describes; lastOutTick and lastInTick: the last ticks at which QUBIC left
// and reached the account; incoming: all it has received (0 when Core holds no record of it).
/** @returns {Promise<LiveBalance>} */
async function fetchOutflow(identity) {
  const d = await request(API.balance(identity), { retries: 1 });
  const b = d && d.balance;
  if (!b || b.id !== identity || !isTick(b.validForTick) || !isTick(b.latestOutgoingTransferTick)
    || !isTick(b.latestIncomingTransferTick) || !isDigits(b.incomingAmount)) throw invalid();
  return { validForTick: b.validForTick, lastOutTick: b.latestOutgoingTransferTick, lastInTick: b.latestIncomingTransferTick, incoming: BigInt(b.incomingAmount) };
}

async function fetchOwnedAssets(identity) {
  const d = await request(API.ownedAssets(identity));
  if (!d || (d.ownedAssets != null && !Array.isArray(d.ownedAssets))) throw invalid();
  const merged = new Map();
  for (const entry of d.ownedAssets || []) {
    const x = entry && entry.data;
    const ia = x && x.issuedAsset;
    if (!x || !ia || x.ownerIdentity !== identity || typeof ia.name !== 'string' || !/^[A-Za-z0-9_]{1,8}$/.test(ia.name)
      || !isId(ia.issuerIdentity) || !isDigits(x.numberOfUnits)) continue;
    const key = `${ia.name}:${ia.issuerIdentity}`;
    const prev = merged.get(key);
    const units = BigInt(x.numberOfUnits);
    const decimals = clamp(uintOr0(ia.numberOfDecimalPlaces), 0, 18);
    if (prev) prev.units += units;
    else merged.set(key, { name: ia.name, issuer: ia.issuerIdentity, units, decimals });
  }
  return [...merged.values()].filter((a) => a.units > 0n).sort((a, b) => a.name.localeCompare(b.name));
}

async function broadcastTransaction(encoded) {
  // Broadcasting identical signed bytes twice is harmless (same hash), but we never auto-retry. A lock doesn't cut one
  // short (session: null): the transfer may already be out, and in encrypted mode its journal entry is checked after
  // unlock.
  const d = await request(API.broadcast, { method: 'POST', body: { encodedTransaction: encoded }, retries: 0, timeout: 15000, session: null });
  if (!d || !isUint(d.peersBroadcasted)) throw invalid();
  return { peers: d.peersBroadcasted, transactionId: typeof d.transactionId === 'string' ? d.transactionId : null };
}

// ── Query (archive) API ─────────────────────────────────────────────────────
// The archive sends every field, zeros included ("amount": "0", "inputType": 0, "inputData": ""); a record missing a
// required one is malformed and dropped, never read as 0, and so is one no valid transaction can have: a tick past
// 32 bits, an amount over Core's MAX_AMOUNT, an input type past 16 bits or an input over MAX_INPUT_SIZE. inputData and
// signature (base64) are kept for matching a transfer signed here.
/** @returns {ArchiveTx | null} */
function parseTx(t) {
  if (!t || !isHash(t.hash) || !isId(t.source) || !isId(t.destination) || !isTick(t.tickNumber)) return null;
  if (!isDigits(t.amount) || BigInt(t.amount) > MAX_AMOUNT || !isUint(t.inputType) || t.inputType > 0xFFFF || !isUint(t.inputSize) || t.inputSize > MAX_INPUT_SIZE) return null;
  return {
    hash: t.hash,
    source: t.source,
    destination: t.destination,
    amount: BigInt(t.amount),
    tick: t.tickNumber,
    timestamp: isDigits(t.timestamp) ? Number(t.timestamp) : null,
    inputType: t.inputType,
    inputSize: t.inputSize,
    inputData: typeof t.inputData === 'string' ? t.inputData : null,
    signature: typeof t.signature === 'string' ? t.signature : null,
    moneyFlew: typeof t.moneyFlew === 'boolean' ? t.moneyFlew : null,
  };
}

async function fetchArchiveTick() {
  const d = await request(API.lastProcessedTick, { retries: 1, timeout: 8000 });
  if (!d || !isTick(d.tickNumber)) throw invalid();
  return d.tickNumber;
}

async function fetchTransaction(hash) {
  const d = await request(API.transactionByHash, { method: 'POST', body: { hash }, retries: 1 });
  // The service returns the transaction at the top level; the SDK schema wraps it. Accept both.
  const tx = parseTx(d && d.transaction ? d.transaction : d);
  if (!tx || tx.hash !== hash) throw invalid();
  return tx;
}

// The archive's processed tick ranges, cached for two minutes.
/** @type {{ at: number, list: { firstTick: number, lastTick: number }[] | null }} */
let intervalsCache = { at: 0, list: null };
async function processedIntervals() {
  if (intervalsCache.list && Date.now() - intervalsCache.at < 120000) return intervalsCache.list;
  const d = await request(API.processedIntervals, { retries: 1 });
  if (!Array.isArray(d)) throw invalid();
  const list = d.filter((iv) => iv && isTick(iv.firstTick) && isTick(iv.lastTick) && iv.firstTick <= iv.lastTick);
  if (!list.length) throw invalid();
  intervalsCache = { at: Date.now(), list };
  return list;
}
// The list as a whole, or null: one malformed or repeated entry, or more than a tick can hold, makes it unusable as
// evidence (a filtered, shorter list would read as "not in this tick").
async function fetchTickHashes(tick) {
  const d = await request(API.tickData, { method: 'POST', body: { tickNumber: tick }, retries: 1 });
  const td = d && d.tickData;
  if (!td || td.tickNumber !== tick || !Array.isArray(td.transactionHashes)) return null;
  const list = td.transactionHashes;
  if (list.length > TRANSACTIONS_PER_TICK || !list.every(isHash) || new Set(list).size !== list.length) return null;
  return list;
}
// Evidence that a transfer was NOT included: the archive has processed its target tick (a processed interval covers
// it) and that tick's own transaction list, every entry of it well-formed, doesn't contain it. 'absent' | 'present' |
// 'unknown'.
async function tickVerdict(hash, tick) {
  try {
    const intervals = await processedIntervals();
    if (!intervals.some((iv) => tick >= iv.firstTick && tick <= iv.lastTick)) return 'unknown';
    const hashes = await fetchTickHashes(tick);
    if (!hashes) return 'unknown';
    return hashes.includes(hash) ? 'present' : 'absent';
  } catch {
    return 'unknown';
  }
}

// Core's own log of this transfer moving QUBIC in its tick (log type 0, a QU transfer), with the same sides and amount.
// The archive's event log is in beta upstream and not guaranteed complete, so this is only ever read as positive
// evidence: finding none proves nothing. A malformed answer is an error.
async function fetchTransferLogged(hash, tick, { source, destination, amount }) {
  const d = await request(API.eventLogs, {
    method: 'POST', body: { filters: { tickNumber: String(tick), transactionHash: hash }, pagination: { offset: 0, size: 20 } }, retries: 1,
  });
  if (!d || (d.eventLogs != null && !Array.isArray(d.eventLogs))) throw invalid();
  return (d.eventLogs || []).some((e) => e && e.logType === 0 && e.transactionHash === hash && e.tickNumber === tick && e.quTransfer
    && e.quTransfer.source === source && e.quTransfer.destination === destination && e.quTransfer.amount === amount.toString());
}

// filters: the archive's exact-match filters (e.g. { source }), or null.
/** @param {string} identity @param {number} [offset] @param {number} [size] @param {{ source: string } | null} [filters] @returns {Promise<HistoryPage>} */
async function fetchHistory(identity, offset = 0, size = HISTORY_PAGE, filters = null) {
  const pagination = { offset, size };
  const d = await request(API.transactionsForIdentity, {
    method: 'POST', body: filters ? { identity, filters, pagination } : { identity, pagination }, retries: 1,
  });
  // Without its total, an answer can't say whether more is left to read: malformed, not "nothing more" (read as 0, a first
  // page passed for a whole history, the look-alike check's included).
  if (!d || !d.hits || !isUint(d.hits.total) || (d.transactions != null && !Array.isArray(d.transactions))) throw invalid();
  const txs = (d.transactions || []).map(parseTx).filter((t) => t && (t.source === identity || t.destination === identity));
  return { txs, total: d.hits.total, validForTick: tickOr0(d.validForTick) };
}

// Every transaction of an account (for Activity and the look-alike check), up to FULL_HISTORY_CAP. Pages can shift if
// a transfer lands mid-read; duplicates are dropped, and the next read fills any gap.
async function fetchFullHistory(identity) {
  const byHash = new Map();
  let total = 0; let validForTick = Infinity; let offset = 0;
  do {
    const r = await fetchHistory(identity, offset, FULL_HISTORY_PAGE);
    for (const t of r.txs) byHash.set(t.hash, t);
    total = r.total;
    validForTick = Math.min(validForTick, r.validForTick);
    offset += FULL_HISTORY_PAGE;
  } while (offset < total && offset < FULL_HISTORY_CAP);
  return { txs: [...byHash.values()].sort((a, b) => b.tick - a.tick), total, validForTick: Number.isFinite(validForTick) ? validForTick : 0, capped: total > FULL_HISTORY_CAP };
}

// An account's own outgoing transactions, newest first, for the look-alike check: read with the archive's source
// filter, so transfers anyone else sends to the account (dust included) are never among them and can't push one out.
// Pages of FULL_HISTORY_PAGE up to SENT_CAP. since: the newest tick an earlier read reached; reading stops at the
// first page that goes back that far (everything older was read then), if the archive returned it newest first. Rows
// the account didn't send are dropped whatever the archive does with the filter; filtered is false if it returned any
// (it ignored the filter, so total also counts transfers to the account). total is the largest any page reported, so
// an archive that applies the filter to some pages only can't cut the read short. end: every row up to total was read.
// alive: false once the read is no longer wanted (the session it was for has ended); no further page is asked for.
async function fetchSentTo(identity, since = null, alive = () => true) {
  const rows = []; let total = 0; let offset = 0; let filtered = true; let overlap = false; let validForTick = Infinity;
  do {
    if (!alive()) break;
    const r = await fetchHistory(identity, offset, FULL_HISTORY_PAGE, { source: identity });
    for (const t of r.txs) if (t.source === identity) rows.push(t); else filtered = false;
    total = Math.max(total, r.total);
    validForTick = Math.min(validForTick, r.validForTick);
    offset += FULL_HISTORY_PAGE;
    const newestFirst = r.txs.every((t, i) => i === 0 || r.txs[i - 1].tick >= t.tick);
    overlap = since != null && newestFirst && r.txs.length > 0 && r.txs[r.txs.length - 1].tick <= since;
  } while (!overlap && offset < total && offset < SENT_CAP);
  return { rows, total, filtered, overlap, end: offset >= total,
    validForTick: Number.isFinite(validForTick) ? validForTick : 0 };
}

// ── Market data ─────────────────────────────────────────────────────────────
async function fetchRpcStats() {
  const d = await request(API.latestStats, { retries: 1 });
  const s = d && d.data;
  if (!s || typeof s.price !== 'number' || !Number.isFinite(s.price) || s.price < 0) throw invalid();
  return {
    price: s.price,
    marketCap: isDigits(s.marketCap) ? Number(s.marketCap) : null,
    circulating: isDigits(s.circulatingSupply) ? Number(s.circulatingSupply) : null,
    burned: isDigits(s.burnedQus) ? Number(s.burnedQus) : null,
    at: isDigits(s.timestamp) ? Number(s.timestamp) * 1000 : Date.now(),
  };
}

async function fetchMarketPrice() {
  const d = await request(MARKET_API.price, { retries: 1 });
  const q = d && d['qubic-network'];
  if (!q || typeof q.usd !== 'number' || !Number.isFinite(q.usd) || q.usd <= 0) throw invalid();
  return {
    price: q.usd,
    change24h: typeof q.usd_24h_change === 'number' && Number.isFinite(q.usd_24h_change) ? q.usd_24h_change : null,
    marketCap: typeof q.usd_market_cap === 'number' && q.usd_market_cap > 0 ? q.usd_market_cap : null,
    at: isUint(q.last_updated_at) ? q.last_updated_at * 1000 : Date.now(),
  };
}

function parsePrices(d) {
  if (!d || !Array.isArray(d.prices)) throw invalid();
  const pts = d.prices.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] > 0);
  if (pts.length < 2) throw invalid();
  return pts.sort((a, b) => a[0] - b[0]);
}
async function fetchMarketChart() {
  return parsePrices(await request(MARKET_API.chart, { retries: 1 }));
}
// Price history: CoinGecko picks the step (hourly for 90 days, daily for 365).
async function fetchPriceHistory(days) {
  return parsePrices(await request(days === 90 ? MARKET_API.history90 : MARKET_API.history365, { retries: 1, timeout: 20000 }));
}

// Before CoinGecko's free year: Gate.io daily candles, [start s, quote volume, close, high, low, open, base volume,
// closed]. Each closed day becomes a point at the next midnight UTC with that day's close, the instant CoinGecko's
// daily points use (so the listing day's stray opening trade is never used).
const DECIMAL_RE = /^\d{1,12}(\.\d{1,18})?$/;
async function fetchOldPrices() {
  const until = Math.floor((Date.now() - 300 * DAY_MS) / 1000);
  const step = GATE_WINDOW_DAYS * 86400;
  const pts = [];
  for (let from = GATE_FROM; from < until; from += step) {
    const d = await request(MARKET_API.gateDaily(from, from + step), { retries: 1, timeout: 20000 });
    if (!Array.isArray(d)) throw invalid();
    for (const c of d) {
      if (!Array.isArray(c) || !isDigits(c[0]) || c[7] !== 'true' || !DECIMAL_RE.test(c[2])) continue;
      const close = Number(c[2]);
      if (close > 0) pts.push([(Number(c[0]) + 86400) * 1000, close]);
    }
  }
  if (pts.length < 2) throw invalid();
  return pts.sort((a, b) => a[0] - b[0]);
}

// ── Exchange order books (opt-in) ───────────────────────────────────────────
// Public QUBIC/USDT books, read strictly: at most 1,000 levels a side, each [price, amount] as plain decimal strings
// above zero, asks rising and bids falling from the best price, and not crossed. Prices in USDT per QUBIC, amounts in
// QUBIC, as plain numbers: for display, never for anything that's signed or sent. deep: as many levels as each exchange
// gives (1,000 on Gate.io and MEXC), for the wider view; otherwise the top 100.
const BOOK_SOURCES = {
  gate: { name: 'Gate.io', url: (deep) => MARKET_API.gateBook(deep ? 1000 : 100), levels: (d) => d },
  mexc: { name: 'MEXC', url: (deep) => MARKET_API.mexcBook(deep ? 1000 : 100), levels: (d) => d },
};
const isDecimal = (v) => typeof v === 'string' && /^\d{1,20}(\.\d{1,20})?$/.test(v);
function parseBook(asks, bids) {
  const side = (list, rising) => {
    if (!Array.isArray(list) || list.length > 1000) throw invalid();
    const out = [];
    for (const lv of list) {
      if (!Array.isArray(lv) || lv.length < 2 || !isDecimal(lv[0]) || !isDecimal(lv[1])) throw invalid();
      const price = Number(lv[0]); const amount = Number(lv[1]);
      if (!(price > 0) || !(amount > 0)) throw invalid();
      const prev = out[out.length - 1];
      if (prev && (rising ? price <= prev.price : price >= prev.price)) throw invalid();
      out.push({ price, amount });
    }
    return out;
  };
  const book = { asks: side(asks, true), bids: side(bids, false) };
  if (!book.asks.length || !book.bids.length || book.bids[0].price >= book.asks[0].price) throw invalid();
  return book;
}
async function fetchOrderBook(id, deep = false) {
  const src = BOOK_SOURCES[id];
  const d = src.levels(await request(src.url(deep), { retries: 1, timeout: 8000 }));
  if (!d) throw invalid();
  return { ...parseBook(d.asks, d.bids), at: Date.now() };
}
// Best bid and ask, the spread, and depth within pct of the book's own mid price. complete: the loaded levels reach
// past that band (otherwise the figure is a lower bound).
function bookStats(book, pct = 0.02) {
  const bid = book.bids[0].price; const ask = book.asks[0].price;
  const mid = (bid + ask) / 2;
  const depth = (levels, inside) => {
    let qty = 0; let usd = 0; let complete = false;
    for (const lv of levels) {
      if (!inside(lv.price)) { complete = true; break; }
      qty += lv.amount; usd += lv.amount * lv.price;
    }
    return { qty, usd, complete };
  };
  return { bid, ask, spread: ask - bid, spreadPct: (ask - bid) / mid,
    bidDepth: depth(book.bids, (p) => p >= mid * (1 - pct)), askDepth: depth(book.asks, (p) => p <= mid * (1 + pct)) };
}
// Selling qty QUBIC into bids, best first: what it fetches, the average price, how far that is below the best bid, and
// whether the loaded levels were enough.
function sellInto(bids, qty) {
  let left = qty; let usd = 0;
  for (const lv of bids) {
    if (left <= 0) break;
    const take = Math.min(left, lv.amount);
    usd += take * lv.price; left -= take;
  }
  const filled = qty - left;
  return { filled, usd, avg: filled > 0 ? usd / filled : null, slip: filled > 0 && bids.length ? usd / filled / bids[0].price - 1 : null, complete: left <= 0 };
}
// Levels grouped into wider price steps, the way exchanges offer fewer decimals: ticks × 1e-10 USDT (the books' finest
// tick), bids rounded down and asks up into their step, amounts in a step added. Levels stay in order.
const BOOK_TICK = 1e-10;
function groupLevels(levels, ticks, up) {
  if (!(ticks > 1)) return levels;
  const out = [];
  for (const lv of levels) {
    const t = Math.round(lv.price / BOOK_TICK);
    const g = (up ? Math.ceil(t / ticks) : Math.floor(t / ticks)) * ticks;
    const last = out[out.length - 1];
    if (last && last.g === g) last.amount += lv.amount; else out.push({ g, price: g * BOOK_TICK, amount: lv.amount });
  }
  return out.map(({ price, amount }) => ({ price, amount }));
}
// Several books' bids as one list, best first (selling on whichever exchange pays more).
const mergedBids = (books) => books.flatMap((b) => b.bids).sort((x, y) => y.price - x.price);

// ── Exchange status ─────────────────────────────────────────────────────────
// Whether an exchange takes QUBIC deposits and withdrawals: { deposits, withdrawals }, each true (open), false (paused)
// or null when the answer doesn't plainly say, and null for an answer about anything but QUBIC on its own chain. Only
// these flags are read; no text from the exchange is ever shown.
function parseGateStatus(d) {
  if (!d || typeof d !== 'object' || d.currency !== 'QUBIC') return null;
  const chain = Array.isArray(d.chains) ? d.chains.find((c) => c && c.name === 'QUBIC') : null;
  const flags = chain || d;
  const open = (disabled) => (typeof disabled === 'boolean' ? !disabled : null);
  return { deposits: open(flags.deposit_disabled), withdrawals: open(flags.withdraw_disabled) };
}
const STATUS_SOURCES = {
  gate: { name: 'Gate.io', url: MARKET_API.gateStatus, parse: parseGateStatus },
};
async function fetchExchangeStatus(id) {
  const src = STATUS_SOURCES[id];
  return src.parse(await request(src.url, { retries: 1, timeout: 8000 }));
}

// ── BPP-9000 calls (opt-in) ─────────────────────────────────────────────────
// The newest epoch the explorer knows, and one epoch's closed hours since go-live: the votes up, down and not sure,
// the explorer's status (correct, incorrect, no consensus, or not scored while it's a test), and what Bitcoin did
// (1 up, 0 down, null not known yet). Also the bar for an official call: how many voters, and what share on one side.
async function fetchBppLatest() {
  const d = await request(BPP_API.epochs, { retries: 1, timeout: 15000 });
  const epochs = Array.isArray(d?.items) ? d.items.map((x) => x?.epoch).filter(isUint) : [];
  if (!epochs.length) throw invalid();
  return Math.max(...epochs);
}
async function fetchBppEpoch(epoch, now) {
  const a = (await request(BPP_API.overview(epoch), { retries: 1, timeout: 15000 }))?.hypotheticalAccuracy;
  if (!a || !Array.isArray(a.hours)) throw invalid();
  const hours = [];
  for (const x of a.hours) {
    if (!x || x.status === 'waiting' || !isUint(x.targetUnix) || x.targetUnix < BPP_FIRST_HOUR || x.targetUnix > now) continue;
    hours.push({ t: x.targetUnix, e: epoch, up: uintOr0(x.up), down: uintOr0(x.down), unsure: uintOr0(x.unknown),
      s: typeof x.status === 'string' ? x.status.toLowerCase() : '', went: x.expected === 0 || x.expected === 1 ? x.expected : null });
  }
  const needed = isUint(a.minimumComputors) && a.minimumComputors > 0 ? a.minimumComputors : null;
  const agree = Number.isFinite(a.agreementPercent) && a.agreementPercent > 50 && a.agreementPercent <= 100 ? a.agreementPercent : null;
  return { hours, needed, agree };
}

// ── Official labels (same static data the Qubic wallets use) ────────────────
async function fetchLabels() {
  /** @type {Map<string, AddressLabel>} */
  const labels = new Map();
  const [contracts, exchanges, misc] = await Promise.allSettled([
    request(LABELS_API.contracts, { retries: 1 }),
    request(LABELS_API.exchanges, { retries: 1 }),
    request(LABELS_API.labels, { retries: 1 }),
  ]);
  const text = (v, max = 48) => cleanText(v, max);
  const each = (r, field, fn) => { if (r.status === 'fulfilled' && Array.isArray(r.value?.[field])) for (const x of r.value[field]) if (x && isId(x.address)) fn(x); };
  // Exchanges and other labels never replace an earlier label for the same address.
  const add = (x, name, kind) => { if (!labels.has(x.address)) labels.set(x.address, { name, kind }); };
  each(contracts, 'smart_contracts', (c) => {
    const procedures = new Map();
    if (Array.isArray(c.procedures)) for (const p of c.procedures) if (p && isUint(p.id)) procedures.set(p.id, text(p.name, 64));
    labels.set(c.address, { name: text(c.label) || text(c.name) || tr('Smart contract'), kind: 'contract', procedures });
  });
  each(exchanges, 'exchanges', (x) => add(x, text(x.name) || tr('Exchange'), 'exchange'));
  each(misc, 'address_labels', (x) => add(x, text(x.label) || tr('Labeled address'), 'label'));
  if (!labels.size) throw invalid();
  return labels;
}
