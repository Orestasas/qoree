// Known answers, checked independently of the app's own startup self-test. The expected values are written out here
// (they were produced with, and cross-checked against, the production web wallet's WASM crypto), and the app's KAT in
// src/js/00-config.js must hold the same ones. The vendored bundle and the WASM library must each reproduce them:
// identity, K12 digest, SchnorrQ signature, the real mainnet transfer's signature and hash, and the RFC 9106 Argon2id
// vector. Offline and deterministic.
// Usage: node kat.cjs <build dir> <src dir>
// TEST_FAULT: kat-identity | kat-digest | kat-signature | kat-txhash | kat-argon2 (each corrupts one expected value)
const path = require('path'), vm = require('vm');
const { check, fault, finish, harnessError, altered } = require('./lib/check.cjs');
const { vendored, appScript, runApp, wasmLib } = require('./lib/load.cjs');
const [BUILD, SRC] = process.argv.slice(2).map((p) => path.resolve(p));
globalThis.window = globalThis;
const Q = vendored(BUILD).QubicLib;
const tslCrypto = wasmLib(BUILD, 'crypto/index.js').default;
const { QubicHelper } = wasmLib(BUILD, 'qubicHelper.js');
const APP_KAT = runApp(`${appScript(SRC, ['00-config.js', '01b-i18n.js'])}\nreturn KAT;`, null, vm.createContext({}));

const WANT = {
  seed: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  identity: 'BZBQFLLBNCXEMGLOBHUVFTLUPLVCPQUASSILFABOFFBCADQSSUPNWLZBQEXK',
  message: 'qubic-wallet self-test v1',
  digest: '6f5ce5d79393404f8ec30cd87031ca8a7779665613f1bc98fec2259560d46c65',
  signature: 'b4bbb5b33951da04fa656d61fb3c5141c7a5341ca23fe2678d48e7d82949a9fa35c08309c12beb6c0034a1eb22a480da7b93c77aaaf61b93d06e59f35cdc1d00',
  mainnetTx: '2viIZ8s8tz45iOdP3XMAU1xIDseruf91nujBGglPSsMX5IYFhV8EdNgv8/k9a4VpIjVssPYLXFtf6C0NRdVk7QDh9QUAAAAA07ESBQAAAABQ52hJqYEtCH24tyNuCSFUVR4mkt0xprqfQbQGFqXJFMHDjuEioUITxM/s6bja/KXualEVIZ9TdMiS3nho4xMA',
  mainnetHash: 'jkowcxdyisixqdyusvbulvothgchctwgfnuvwbdfdfinzhnvrfewhepeszyi',
  argon2id: '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659', // RFC 9106 §5.3
};
const want = { ...WANT };
if (fault('kat-identity')) want.identity = altered(want.identity, 10);
if (fault('kat-digest')) want.digest = altered(want.digest, 4);
if (fault('kat-signature')) want.signature = altered(want.signature, 6);
if (fault('kat-txhash')) want.mainnetHash = altered(want.mainnetHash, 3);
if (fault('kat-argon2')) want.argon2id = altered(want.argon2id, 2);
const hex = (u) => Buffer.from(u).toString('hex');

(async () => {
  for (const k of Object.keys(WANT)) check(`the app’s KAT holds the same ${k}`, APP_KAT[k] === WANT[k]);

  const { schnorrq, K12 } = await tslCrypto;
  const keys = Q.deriveKeys(want.seed);
  const pkg = await new QubicHelper().createIdPackage(want.seed);
  check('identity: vendored bundle', Q.publicKeyToIdentity(keys.publicKey) === want.identity);
  check('identity: WASM library', pkg.publicId === want.identity);

  const msg = new TextEncoder().encode(want.message);
  const digest = Q.k12(msg, 32);
  const digestW = new Uint8Array(32); K12(msg, digestW, 32);
  check('K12 digest: vendored bundle', hex(digest) === want.digest);
  check('K12 digest: WASM library', hex(digestW) === want.digest);

  const sig = await Q.sign(digest, want.seed);
  const sigW = schnorrq.sign(pkg.privateKey, keys.publicKey, digest);
  check('SchnorrQ signature: vendored bundle', hex(sig) === want.signature);
  check('SchnorrQ signature: WASM library', hex(sigW) === want.signature);
  const expectedSig = Uint8Array.from(Buffer.from(want.signature, 'hex'));
  check('the expected signature verifies in both', Q.verify(digest, expectedSig, keys.publicKey) === true && schnorrq.verify(keys.publicKey, digest, expectedSig) === 1);
  const bent = new Uint8Array(expectedSig); bent[9] ^= 4;
  check('a changed signature fails in both', Q.verify(digest, bent, keys.publicKey) === false && schnorrq.verify(keys.publicKey, digest, bent) === 0);

  const tx = Uint8Array.from(Buffer.from(want.mainnetTx, 'base64'));
  check('mainnet transfer: 144 bytes', tx.length === 144, String(tx.length));
  const txDigest = new Uint8Array(32); K12(tx.subarray(0, 80), txDigest, 32);
  check('mainnet transfer signature: vendored bundle', Q.verifyTransactionSignature(tx) === true);
  check('mainnet transfer signature: WASM library', schnorrq.verify(tx.subarray(0, 32), txDigest, tx.subarray(80, 144)) === 1);
  check('mainnet transfer hash', Q.computeTransactionHash(tx) === want.mainnetHash, Q.computeTransactionHash(tx));
  const fullW = new Uint8Array(32); K12(tx, fullW, 32);
  check('the hash input digests the same in both', hex(Q.k12(tx, 32)) === hex(fullW));

  const a2 = await Q.argon2idAsync(new Uint8Array(32).fill(1), new Uint8Array(16).fill(2), {
    t: 3, m: 32, p: 4, dkLen: 32, key: new Uint8Array(8).fill(3), personalization: new Uint8Array(12).fill(4),
  });
  check('Argon2id: RFC 9106 vector', hex(a2) === want.argon2id);
  finish('known-answer');
})().catch(harnessError);
