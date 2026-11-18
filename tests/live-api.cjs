// Live-network checks (run with ./test.sh --live): the real Qubic RPC, read through the app's own parsers (src/js 00,
// 01, 03, 05), so a change in the API contract shows up here. Not deterministic: the network answers.
//  1. The confirmation path for a real mainnet transfer (the KAT one): its archive record matches the signed bytes;
//     its tick lists it; Core's event log of it and the account's live record read; and with the archive's moneyFlew
//     removed, or false (the archive's "no status"), it still settles as sent, by the log.
//  2. Real on-chain transactions (contract calls and plain transfers): at least 100 distinct ones, 20 of them plain
//     transfers; every signature verifies in both the vendored bundle and the WASM library, and every hash reproduces.
//  3. The look-alike check's outgoing-only read: the archive applies the source filter, and answers the deepest page it
//     reads.
// Exit 3 (skipped) when the RPC can't be reached at all.
// Usage: node live-api.cjs <build dir> <src dir>
const path = require('path'), vm = require('vm');
const { check, finish, harnessError, skip } = require('./lib/check.cjs');
const { vendored, appScript, runApp, wasmLib } = require('./lib/load.cjs');
const [BUILD, SRC] = process.argv.slice(2).map((p) => path.resolve(p));
const RPC = 'https://rpc.qubic.org';

// The app's request() asks for no-store caching and no redirects; Node's fetch takes those as they are.
const ctx = { console, setTimeout, clearTimeout, TextEncoder, TextDecoder, atob, btoa, AbortController, performance, fetch, Response, Headers, navigator: { onLine: true }, crypto: require('crypto').webcrypto };
ctx.window = ctx;
vm.createContext(ctx);
const app = appScript(SRC, ['00-config.js', '01-util.js', '01b-i18n.js', '03-qubic.js', '05-net.js']);
runApp(`const state = { selfTest: { status: 'pass' }, prefs: {} };\n${app}\n window.__t = { KAT, Q, sameAsSigned, transferOutcome, fetchTransaction, fetchTransferLogged, fetchOutflow, fetchTickInfo, tickVerdict, fetchHistory, fetchSentTo, SENT_CAP, FULL_HISTORY_PAGE };`, vendored(BUILD, ctx), ctx);
const T = ctx.__t;
const tslCrypto = wasmLib(BUILD, 'crypto/index.js').default;

(async () => {
  let info;
  try { info = await T.fetchTickInfo(); } catch (e) { if (e && (e.kind === 'network' || e.kind === 'timeout')) skip(`the Qubic RPC can't be reached (${e.message})`); throw e; }
  check('tick info reads', Number.isSafeInteger(info.tick) && info.tick > 0, `tick ${info.tick}, epoch ${info.epoch}`);

  // 1) The confirmation path, for the real transfer in the app's KAT.
  const hash = T.KAT.mainnetHash;
  const tx = await T.fetchTransaction(hash);
  check('the archive’s record of the KAT transfer matches its signed bytes field by field', T.sameAsSigned(tx, hash, T.KAT.mainnetTx), `tick ${tx.tick}`);
  check('…and says the QUBIC moved (moneyFlew is still served)', tx.moneyFlew === true, String(tx.moneyFlew));
  check('its tick’s whole transaction list contains it', await T.tickVerdict(hash, tx.tick) === 'present');
  const logged = await T.fetchTransferLogged(hash, tx.tick, { source: tx.source, destination: tx.destination, amount: tx.amount });
  check('Core’s event log holds it as a QU transfer with the same sides and amount', logged === true);
  const live = await T.fetchOutflow(tx.source);
  check('the account’s live record reads, and describes a later tick', live.validForTick > tx.tick && live.incoming > 0n,
    `valid for ${live.validForTick}, last out ${live.lastOutTick}, last in ${live.lastInTick}`);
  const outcome = T.transferOutcome({ included: true, moneyFlew: null, event: logged }, live, tx.tick, info.tick);
  check('with moneyFlew taken away it still settles as sent, by Core’s log', outcome.status === 'success', JSON.stringify(outcome));
  const asFalse = T.transferOutcome({ included: true, moneyFlew: false, event: logged }, live, tx.tick, info.tick);
  check('with moneyFlew false instead (the archive’s “no status”) it still settles as sent, by Core’s log', asFalse.status === 'success', JSON.stringify(asFalse));

  // 2) Real on-chain transactions, through both signature implementations.
  const { schnorrq, K12 } = await tslCrypto;
  const Q = T.Q;
  const post = async (body) => {
    const r = await fetch(`${RPC}/query/v1/getTransactionsForIdentity`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`getTransactionsForIdentity ${r.status}`);
    return (await r.json()).transactions || [];
  };
  const txs = [];
  for (const identity of ['BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARMID', 'EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVWRF']) { // QX, QUTIL
    for (const offset of [0, 100]) txs.push(...await post({ identity, pagination: { offset, size: 100 } }));
  }
  for (const identity of [...new Set(txs.map((t) => t.source))].slice(0, 15)) txs.push(...await post({ identity, filters: { inputType: '0' }, pagination: { offset: 0, size: 20 } }));
  const uniq = [...new Map(txs.map((t) => [t.hash, t])).values()];
  const simple = uniq.filter((t) => (t.inputType || 0) === 0).length;
  check('enough real transactions to mean something: at least 100, 20 of them plain transfers', uniq.length >= 100 && simple >= 20, `${uniq.length} distinct, ${simple} plain`);
  const bad = { size: [], ts: [], wasm: [], hash: [] };
  for (const t of uniq) {
    const payload = t.inputData ? new Uint8Array(Buffer.from(t.inputData, 'base64')) : new Uint8Array(0);
    if (payload.length !== (t.inputSize || 0)) { bad.size.push(t.hash); continue; }
    const unsigned = Q.buildTransaction({ source: t.source, destination: t.destination, amount: BigInt(t.amount), targetTick: t.tickNumber, inputType: t.inputType || 0, payload });
    const sig = new Uint8Array(Buffer.from(t.signature, 'base64'));
    const signed = new Uint8Array(unsigned.length + 64); signed.set(unsigned); signed.set(sig, unsigned.length);
    if (!Q.verifyTransactionSignature(signed)) bad.ts.push(t.hash);
    const digest = new Uint8Array(32); K12(unsigned, digest, 32);
    if (schnorrq.verify(unsigned.slice(0, 32), digest, sig) !== 1) bad.wasm.push(t.hash);
    if (Q.computeTransactionHash(signed) !== t.hash) bad.hash.push(t.hash);
  }
  check('every input matches its declared size', bad.size.length === 0, bad.size.slice(0, 2).join(', '));
  check('every signature verifies in the vendored bundle', bad.ts.length === 0, bad.ts.slice(0, 2).join(', '));
  check('every signature verifies in the WASM library', bad.wasm.length === 0, bad.wasm.slice(0, 2).join(', '));
  check('every transaction hash reproduces', bad.hash.length === 0, bad.hash.slice(0, 2).join(', '));

  // 3) The look-alike check's outgoing-only read (fetchSentTo), on the KAT transfer's two sides. The receiver has received
  // at least that transfer, so a filtered read of it must leave something out: an incoming row among its newest, or
  // part of its total (compared only below 10,000, where totals are exact).
  const sender = tx.source; const receiver = tx.destination;
  const sentOnly = await T.fetchHistory(receiver, 0, T.FULL_HISTORY_PAGE, { source: receiver });
  const both = await T.fetchHistory(receiver, 0, T.FULL_HISTORY_PAGE);
  const leftOut = both.txs.some((t) => t.source !== receiver) || (both.total < T.SENT_CAP && sentOnly.total < both.total);
  check('the archive applies the outgoing (source) filter: every row it returns was sent by the account, and what it received is left out',
    sentOnly.txs.every((t) => t.source === receiver) && leftOut, `${sentOnly.txs.length} rows of ${sentOnly.total}, unfiltered ${both.total}`);
  const out = await T.fetchSentTo(sender);
  check('…and fetchSentTo finds it applied for the KAT transfer’s sender (no row it didn’t send)', out.filtered && out.rows.length > 0, `${out.rows.length} rows of ${out.total}`);
  const deep = await T.fetchHistory(sender, T.SENT_CAP - T.FULL_HISTORY_PAGE, T.FULL_HISTORY_PAGE, { source: sender }).catch((e) => e);
  check('…and answers the deepest page the check reads (offset 9,000)', Array.isArray(deep.txs), deep.txs ? `${deep.txs.length} rows` : deep.message);
  finish('live-network');
})().catch(harnessError);
