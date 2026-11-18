// Cross-checks the vendored pure-JS Qubic bundle (qubic-lib.iife.js, built from @qubic.org/crypto + @qubic.org/tx)
// against the production web wallet's WASM crypto (@qubic-lib/qubic-ts-library): K12, seed → keys → identity,
// signatures both ways, and identity checksum validation. Deterministic inputs; offline. Real on-chain transactions
// are checked in live-api.cjs. Last, the seed generators (the bundle's and the app's): a statistical check with a
// one-in-a-million false-alarm rate, since their output is meant to be unpredictable.
// Usage: node crosscheck.cjs <build dir> <src dir>
// TEST_FAULT: xc-k12 | xc-identity | xc-signature (corrupt one implementation's result)
const path = require('path');
const { check, fault, finish, harnessError, prng, bytesFrom, seedFrom } = require('./lib/check.cjs');
const { vendored, appScript, runApp, wasmLib } = require('./lib/load.cjs');
const [BUILD, SRC] = process.argv.slice(2).map((p) => path.resolve(p));
globalThis.window = globalThis;
const VENDORED = vendored(BUILD);
const Q = VENDORED.QubicLib;
const app = appScript(SRC, ['00-config.js', '01-util.js', '01b-i18n.js', '03-qubic.js']);
runApp(`const state = { selfTest: { status: 'pass' } };\n${app}\n globalThis.__app = { generateSeed };`, VENDORED);
const tslCrypto = wasmLib(BUILD, 'crypto/index.js').default;
const { QubicHelper } = wasmLib(BUILD, 'qubicHelper.js');

const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

(async () => {
  const { schnorrq, K12 } = await tslCrypto;
  const helper = new QubicHelper();
  const wasmK12 = (inp, len) => { const o = new Uint8Array(len); K12(inp, o, len); return o; };
  const rand = prng(0xc2055);

  // 1) K12, the bundle's against the WASM one's, including inputs past 8192 bytes (tree mode).
  const lens = [0, 1, 3, 31, 32, 33, 55, 64, 80, 96, 144, 1167, 8191, 8192, 8193, 16384, 20000];
  const k12Bad = [];
  for (const len of lens) for (const out of [3, 32, 64]) {
    const inp = bytesFrom(rand, len);
    const mine = Q.k12(inp, out);
    if (fault('xc-k12') && len === 8193 && out === 32) mine[0] ^= 1;
    if (!eq(mine, wasmK12(inp, out))) k12Bad.push(`${len}/${out}`);
  }
  check(`K12 agrees on ${lens.length * 3} input/output lengths`, k12Bad.length === 0, k12Bad.join(', '));

  // 2) Seed → identity, and deterministic signatures, both ways.
  const N = 300; const bad = { id: [], pk: [], subseed: [], sig: [], verify: [], forged: [] };
  for (let i = 0; i < N; i++) {
    const seed = seedFrom(rand);
    const keys = Q.deriveKeys(seed);
    let id = Q.publicKeyToIdentity(keys.publicKey);
    if (fault('xc-identity') && i === 11) id = `${id[0] === 'A' ? 'B' : 'A'}${id.slice(1)}`;
    const pkg = await helper.createIdPackage(seed);
    if (id !== pkg.publicId) bad.id.push(i);
    if (!eq(keys.publicKey, pkg.publicKey)) bad.pk.push(i);
    // The library's "privateKey" is the subseed (K12 of the seed bytes): the same input Core's sign() takes.
    if (!eq(keys.subseed, pkg.privateKey)) bad.subseed.push(i);
    const digest = bytesFrom(rand, 32);
    const sigTs = await Q.sign(digest, seed);
    if (fault('xc-signature') && i === 13) sigTs[0] ^= 1;
    const sigWasm = schnorrq.sign(pkg.privateKey, keys.publicKey, digest);
    if (!eq(sigTs, sigWasm)) bad.sig.push(i);
    if (!(schnorrq.verify(keys.publicKey, digest, sigTs) === 1 && Q.verify(digest, sigWasm, keys.publicKey) === true)) bad.verify.push(i);
    const bent = new Uint8Array(sigWasm); bent[i % 64] ^= 1 << (i % 8);
    if (!(Q.verify(digest, bent, keys.publicKey) === false && schnorrq.verify(keys.publicKey, digest, bent) === 0)) bad.forged.push(i);
  }
  check(`identities agree (${N} seeds)`, bad.id.length === 0, bad.id.join(', '));
  check('public keys agree byte for byte', bad.pk.length === 0, bad.pk.join(', '));
  check('subseeds agree byte for byte', bad.subseed.length === 0, bad.subseed.join(', '));
  check('signatures byte-identical', bad.sig.length === 0, bad.sig.join(', '));
  check('each implementation verifies the other’s signatures', bad.verify.length === 0, bad.verify.join(', '));
  check('both reject a signature with one bit changed', bad.forged.length === 0, bad.forged.join(', '));

  // 3) Identity checksum validation against the WASM helper, on valid and corrupted identities.
  const disagree = [];
  for (let i = 0; i < 400; i++) {
    const id = Q.publicKeyToIdentity(bytesFrom(rand, 32));
    const pos = i % 60; const c = String.fromCharCode(65 + ((id.charCodeAt(pos) - 65 + 1 + (i % 25)) % 26));
    const wrong = id.slice(0, pos) + c + id.slice(pos + 1);
    for (const s of [id, wrong]) if (Q.isValidIdentityChecksum(s) !== await helper.verifyIdentity(s)) disagree.push(s);
  }
  check('identity validation agrees on 800 valid and corrupted identities', disagree.length === 0, disagree.slice(0, 2).join(', '));
  // A first group worth 2^64 or more is no identity: it must not validate.
  check('an overflowing identity ("ZZZ…") is refused', Q.isValidIdentityChecksum('Z'.repeat(14) + 'A'.repeat(46)) === false);

  // 4) The seed generators: letter counts over 20,000 seeds each, chi-square with 25 degrees of freedom. 74.5 is the
  // p ≈ 1e-6 cut-off, so a sound generator trips it about once in a million runs.
  const chi2 = (gen) => {
    const counts = new Array(26).fill(0); const S = 20000;
    for (let i = 0; i < S; i++) {
      const s = gen();
      if (!/^[a-z]{55}$/.test(s)) return Infinity;
      for (const ch of s) counts[ch.charCodeAt(0) - 97]++;
    }
    const exp = (S * 55) / 26;
    return counts.reduce((a, c) => a + (c - exp) ** 2 / exp, 0);
  };
  const lib = chi2(() => Q.generateRandomSeed());
  const own = chi2(() => globalThis.__app.generateSeed());
  check('the bundle’s seed generator: 55 letters a–z, no letter favoured', lib < 74.5, `chi-square ${lib.toFixed(1)}`);
  check('the app’s seed generator: 55 letters a–z, no letter favoured', own < 74.5, `chi-square ${own.toFixed(1)}`);
  finish('cross-implementation');
})().catch(harnessError);
