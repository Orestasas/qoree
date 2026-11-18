// Runs the wallet's own signing path (src/js 00–03 + vendored bundle) and compares each result byte for byte with
// the production web wallet library building the same transfer: encoded bytes, transaction id, and a WASM signature
// check. Then every refusal, each with the reason it must give, against a control the same inputs do sign.
// Deterministic: seeds, amounts and ticks come from a fixed pseudo-random sequence.
// Usage: node app-sign.cjs <build dir> <src dir>
// TEST_FAULT: tx-bytes | tx-hash | tx-signature (corrupt one expected result) | refusal (expects a refusal the app
//   doesn't give)
const path = require('path');
const { check, fault, finish, harnessError, prng, seedFrom } = require('./lib/check.cjs');
const { vendored, appScript, runApp, wasmLib, mutable } = require('./lib/load.cjs');
const [BUILD, SRC] = process.argv.slice(2).map((p) => path.resolve(p));
globalThis.window = globalThis;
const app = mutable(appScript(SRC, ['00-config.js', '01-util.js', '01b-i18n.js', '03-qubic.js']));
// The decoded transfer no longer compared with the confirmed one; the self-test no longer checking signatures.
app.mutation('decode-unchecked', "    if (!matches) throw new AppError('TX_MISMATCH');\n", '');
app.mutation('selftest-sign-unchecked', "    check(trLater('SchnorrQ deterministic signature'), toHex(sig) === KAT.signature);\n", '');
runApp(`const state = { selfTest: { status: 'running' } };\n${app.text}\n globalThis.__app = { signTransfer, deriveAccount, runSelfTest, archivedStatus, state };`, vendored(BUILD));
const A = globalThis.__app;
const { QubicTransaction } = wasmLib(BUILD, 'qubic-types/QubicTransaction.js');
const { PublicKey } = wasmLib(BUILD, 'qubic-types/PublicKey.js');
const { Long } = wasmLib(BUILD, 'qubic-types/Long.js');
const tslCrypto = wasmLib(BUILD, 'crypto/index.js').default;

(async () => {
  await A.runSelfTest();
  check('the app’s startup self-test passes', A.state.selfTest.status === 'pass', `${A.state.selfTest.steps.length} steps${A.state.selfTest.failed ? `, failed at: ${A.state.selfTest.failed}` : ''}`);
  const { schnorrq, K12 } = await tslCrypto;

  const rand = prng(0x51c0);
  const n = 60;
  const bad = { bytes: [], id: [], sig: [] };
  for (let i = 0; i < n; i++) {
    const seed = seedFrom(rand);
    const account = A.deriveAccount(seed);
    const dest = A.deriveAccount(seedFrom(rand)).identity;
    const amount = BigInt(1 + Math.floor(rand() * 1e12)) * (i % 3 === 0 ? 1000n : 1n);
    const currentTick = 85_600_000 + Math.floor(rand() * 100000);
    const targetTick = currentTick + [5, 10, 20, 40][i % 4];
    const mine = await A.signTransfer({ seed, account, destination: dest, amount, targetTick, currentTick });
    const ref = new QubicTransaction().setSourcePublicKey(new PublicKey(account.identity)).setDestinationPublicKey(new PublicKey(dest))
      .setAmount(new Long(amount)).setTick(targetTick).setInputType(0).setInputSize(0);
    const refBytes = Buffer.from(await ref.build(seed));
    let refId = ref.getId();
    if (fault('tx-bytes') && i === 7) refBytes[40] ^= 1;
    if (fault('tx-hash') && i === 7) refId = `${refId[0] === 'a' ? 'b' : 'a'}${refId.slice(1)}`;
    const bytes = Buffer.from(mine.encoded, 'base64');
    if (!bytes.equals(refBytes)) bad.bytes.push(i);
    if (mine.hash !== refId) bad.id.push(i);
    const sig = new Uint8Array(bytes.subarray(80, 144));
    if (fault('tx-signature') && i === 7) sig[5] ^= 1;
    const digest = new Uint8Array(32); K12(new Uint8Array(bytes.subarray(0, 80)), digest, 32);
    if (schnorrq.verify(new Uint8Array(bytes.subarray(0, 32)), digest, sig) !== 1) bad.sig.push(i);
  }
  check(`signed bytes identical to the production web-wallet library (${n} transfers)`, bad.bytes.length === 0, bad.bytes.length ? `differ at #${bad.bytes.join(', #')}` : '');
  check(`transaction ids identical (${n})`, bad.id.length === 0, bad.id.length ? `differ at #${bad.id.join(', #')}` : '');
  check(`signatures verify with the library’s WASM SchnorrQ (${n})`, bad.sig.length === 0, bad.sig.length ? `fail at #${bad.sig.join(', #')}` : '');

  // Refusals, each before anything is signed and with its own reason; the same inputs, unchanged, do sign.
  const seed = seedFrom(rand); const account = A.deriveAccount(seed); const other = A.deriveAccount(seedFrom(rand));
  const attempt = async (args) => {
    try { await A.signTransfer({ seed, account, destination: other.identity, amount: 5n, targetTick: 100, currentTick: 90, ...args }); return 'signed'; }
    catch (e) { return e.code || `uncoded: ${e.message}`; }
  };
  check('control: the unchanged inputs sign', await attempt({}) === 'signed');
  const wrongCheck = other.identity.slice(0, 59) + (other.identity[59] === 'A' ? 'B' : 'A');
  const cases = [
    ['wrong account for the seed', { account: other }, 'KEY_MISMATCH'],
    ['destination with a bad checksum', { destination: wrongCheck }, 'INVALID_IDENTITY'],
    ['zero amount', { amount: 0n }, 'CRYPTO'],
    ['negative amount', { amount: -5n }, 'CRYPTO'],
    ['amount past int64', { amount: 1n << 63n }, 'CRYPTO'],
    ['amount over Core’s MAX_AMOUNT (10^15 + 1)', { amount: 1000000000000001n }, 'CRYPTO'],
    ['target tick not after the current tick', { targetTick: 90 }, 'CRYPTO'],
    ['seed that isn’t 55 lowercase letters', { seed: 'A'.repeat(55) }, 'INVALID_SEED'],
  ];
  if (fault('refusal')) cases.push(['(fault) a valid amount expected to be refused', { amount: 6n }, 'CRYPTO']);
  for (const [label, args, code] of cases) {
    const got = await attempt(args);
    check(`refused: ${label} → ${code}`, got === code, got === code ? '' : `got ${got}`);
  }
  A.state.selfTest.status = 'fail';
  const afterFail = await attempt({});
  check('refused: self-test failed → SELF_TEST', afterFail === 'SELF_TEST', afterFail === 'SELF_TEST' ? '' : `got ${afterFail}`);

  // How archived records read (history and outcome display).
  const st = (tx) => A.archivedStatus({ destination: other.identity, ...tx });
  const QX = 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARMID'; // contract 1
  check('archived status: a moved transfer is a success, one flagged unmoved stays unknown (that flag is also "no status"); a contract call carrying QUBIC executed once moved, unknown otherwise; one carrying nothing executed',
    st({ inputType: 0, amount: 5n, moneyFlew: true }) === 'success' && st({ inputType: 0, amount: 5n, moneyFlew: false }) === 'unknown'
    && st({ destination: QX, inputType: 2, amount: 100n, moneyFlew: true }) === 'executed' && st({ destination: QX, inputType: 2, amount: 100n, moneyFlew: false }) === 'unknown'
    && st({ destination: QX, inputType: 2, amount: 0n, moneyFlew: false }) === 'executed');
  check('archived status: QUBIC to an address that isn’t a contract is a transfer whatever its input type (Core ignores it there): success on the flag, unknown without',
    [1, 2, 7, 0xFFFF].every((inputType) => st({ inputType, amount: 5n, moneyFlew: true }) === 'success' && st({ inputType, amount: 5n, moneyFlew: false }) === 'unknown'
      && st({ inputType, amount: 5n, moneyFlew: null }) === 'unknown'));
  check('archived status: a transfer the archive says nothing about stays unknown', st({ inputType: 0, amount: 5n, moneyFlew: null }) === 'unknown');

  // The checks between signing and broadcast, on a library that misbehaves, each with its reason: signed bytes of the
  // wrong length, a signature that doesn't verify, and a transfer signed correctly that isn't the one confirmed (one
  // bit of its amount changed before signing). And a library whose signatures are wrong fails the startup self-test at
  // that step, and signing is then refused.
  {
    const real = vendored(BUILD);
    const withLib = (patch, status = 'pass') => {
      runApp(`const state = { selfTest: { status: '${status}' } };\n${app.text}\n globalThis.__bad = { signTransfer, runSelfTest, state };`,
        { ...real, QubicLib: { ...real.QubicLib, ...patch } });
      return globalThis.__bad;
    };
    const seed = 'abcdefghijklmnopqrstuvwxyz'.repeat(3).slice(0, 55);
    const transfer = { seed, account: A.deriveAccount(seed), destination: A.deriveAccount('z'.repeat(55)).identity, amount: 1000n, targetTick: 90000010, currentTick: 90000000 };
    const sign = (lib) => lib.signTransfer(transfer).then(() => 'signed', (e) => e.code);
    const short = await sign(withLib({ signTransaction: async () => new Uint8Array(143) }));
    const forged = await sign(withLib({ signTransaction: async (u, s) => { const b = await real.QubicLib.signTransaction(u, s); b[143] ^= 1; return b; } }));
    const other = await sign(withLib({ signTransaction: async (u, s) => { const c = u.slice(); c[64] ^= 1; return real.QubicLib.signTransaction(c, s); } }));
    const control = await sign(withLib({}));
    check('decoded back before broadcast: wrong length → TX_MISMATCH, bad signature → SIGNATURE, another transfer → TX_MISMATCH; the real library signs',
      short === 'TX_MISMATCH' && forged === 'SIGNATURE' && other === 'TX_MISMATCH' && control === 'signed', `${short}, ${forged}, ${other}, ${control}`);
    const broken = withLib({ sign: async (d, s) => { const x = await real.QubicLib.sign(d, s); x[0] ^= 1; return x; } }, 'running');
    await broken.runSelfTest();
    const refused = await sign(broken);
    check('a library that signs wrongly fails the self-test at that step, and signing is refused',
      broken.state.selfTest.status === 'fail' && broken.state.selfTest.failed === 'SchnorrQ deterministic signature' && refused === 'SELF_TEST',
      `${broken.state.selfTest.status} at ${broken.state.selfTest.failed}, signing ${refused}`);
  }
  finish('signing');
})().catch(harnessError);
