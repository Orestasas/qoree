// Message signing: the wallet's signMessage/verifyMessage (src/js 00–03 + vendored bundle) against the official web
// wallet's own code path (@qubic-lib/qubic-ts-library's WASM SchnorrQ, K12 and QubicHelper, plus the official
// src/app/utils/shifted-hex.utils.ts) building the exact JSON its sign-message component outputs. Every check below
// counts toward the result: identical output, verification both ways, tampering and wrong-identity rejection, every
// signing guard with its reason (a seed in the message among them), malformed input, degenerate keys. Deterministic
// inputs.
// Usage: node msg-sign.cjs <build dir> <src dir> <official wallet repo dir>
// TEST_FAULT: msg-output (corrupts one expected official JSON) | msg-identity (claims the signer's own identity as
//   "another") | msg-malformed (lists a valid block as malformed) | msg-guard (expects a guard that isn't there)
// MUTATE=<name> (the mutation lines below) puts one fixed fault back in the app's own code.
const fs = require('fs'), path = require('path'), os = require('os');
const { check, fault, finish, harnessError, prng, seedFrom } = require('./lib/check.cjs');
const { vendored, appScript, runApp, wasmLib, mutable } = require('./lib/load.cjs');
const [BUILD, SRC, OFFICIAL] = process.argv.slice(2).map((p) => path.resolve(p));
globalThis.window = globalThis;
const VENDORED = vendored(BUILD);
const app = mutable(appScript(SRC, ['00-config.js', '01-util.js', '01b-i18n.js', '03-qubic.js']));
// A seed in a message to sign: signed anyway; looked for only as the signer's own or exactly as stored;
// never as a watch-only account's. Also: missing generic warnings, partial-seed matching that reveals guesses,
// unconfirmed seed-shaped text, or an exemption based only on an address's shape.
app.mutation('msg-seed', "  if (found === 'held') throw new AppError('MESSAGE_SEED');\n", '');
app.mutation('msg-seed-signer-only', 'seeds: [seed, ...walletSeeds]', 'seeds: [seed]');
app.mutation('msg-seed-exact', "  const letters = text.toLowerCase().replace(/[^a-z]/g, '');", '  const letters = String(message);');
app.mutation('msg-fragment-warning', 'const SEEDLIKE_RUN = 20;', 'const SEEDLIKE_RUN = 55;');
app.mutation('msg-fragment-oracle', "    if (letters.includes(seed)) return 'held';",
  "    for (let i = 0; i + 20 <= seed.length; i++) if (letters.includes(seed.slice(i, i + 20))) return 'held';");
app.mutation('msg-seed-watch', "      if (derived !== null && ids.has(derived)) return 'held';\n", '');
app.mutation('msg-seedlike', "  if (found === 'seedlike' && seedLikeOk !== true) throw new AppError('MESSAGE_SEEDLIKE');\n", '');
app.mutation('msg-seed-shape-exempt', 'const notSeedRun = (run) => ((ID_RE.test(run) || HASH_RE.test(run)) && checksummedId(run))',
  'const notSeedRun = (run) => (ID_RE.test(run) || HASH_RE.test(run))');
runApp(`const state = { selfTest: { status: 'pass' } };\n${app.text}\n globalThis.__app = { signMessage, verifyMessage, deriveAccount, seedInMessage, state };`, VENDORED);
const A = globalThis.__app;
const QL = VENDORED.QubicLib;

const tslCrypto = wasmLib(BUILD, 'crypto/index.js').default;
const { QubicHelper } = wasmLib(BUILD, 'qubicHelper.js');
const { KeyHelper } = wasmLib(BUILD, 'keyHelper.js');
// The official encoder, compiled from its TypeScript source unchanged.
const esbuild = require(path.join(BUILD, 'node_modules/esbuild'));
const tsSrc = fs.readFileSync(path.join(OFFICIAL, 'src/app/utils/shifted-hex.utils.ts'), 'utf8');
const tmp = path.join(os.tmpdir(), `shifted-hex-${process.pid}.cjs`);
fs.writeFileSync(tmp, esbuild.transformSync(tsSrc, { loader: 'ts', format: 'cjs' }).code);
const { encodeShiftedHex, decodeShiftedHex } = require(tmp);
fs.unlinkSync(tmp);

// Exactly what sign-message.component.ts onSign() does.
async function officialSign(seed, message) {
  const { schnorrq, K12 } = await tslCrypto;
  const idPackage = await new QubicHelper().createIdPackage(seed);
  const signature = schnorrq.sign(idPackage.privateKey, idPackage.publicKey, new TextEncoder().encode(message));
  const checksumOut = new Uint8Array(1);
  K12(signature, checksumOut, 1);
  const sigWithChecksum = new Uint8Array(65);
  sigWithChecksum.set(signature);
  sigWithChecksum[64] = checksumOut[0];
  return JSON.stringify({ identity: idPackage.publicId, message, signature: encodeShiftedHex(sigWithChecksum) }, null, 2);
}
// Exactly what onVerify() does, returning 'valid' | 'invalid' | an error tag.
async function officialVerify(input) {
  let parsed;
  try { parsed = JSON.parse(input); } catch { return 'parseError'; }
  const { identity, message, signature } = parsed;
  if (!identity || !message || !signature) return 'parseError';
  if (!/^[A-Z]{60}$/.test(identity)) return 'invalidIdentity';
  if (!(await new QubicHelper().verifyIdentity(identity))) return 'invalidIdentity';
  if (!/^[A-Pa-p]{130}$/.test(signature)) return 'invalidSignature';
  const decoded = decodeShiftedHex(signature);
  const sigBytes = decoded.slice(0, 64);
  const { schnorrq, K12 } = await tslCrypto;
  const checksumOut = new Uint8Array(1);
  K12(sigBytes, checksumOut, 1);
  if (checksumOut[0] !== decoded[64]) return 'checksumMismatch';
  return schnorrq.verify(KeyHelper.getIdentityBytes(identity), new TextEncoder().encode(message), sigBytes) === 1 ? 'valid' : 'invalid';
}

const ALPHA = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789', ' .,;:!?-_()[]{}"\'\\/', '\n\t', 'éüñçøåßłž', 'ΩЖ中文日本語한국어', '😀🚀🔑✅', '\u200b\u202e'];
const rand = prng(0x5196);
const rnd = (n) => Math.floor(rand() * n);
function randomMessage(maxChars) {
  const pools = ALPHA.filter(() => rand() < 0.6);
  const pool = Array.from((pools.length ? pools : [ALPHA[0]]).join(''));
  let s = '';
  const len = 1 + rnd(maxChars);
  for (let i = 0; i < len; i++) s += pool[rnd(pool.length)];
  return s;
}
const bytesOf = (s) => new TextEncoder().encode(s).length;
const flipLetter = (sig, at) => { const c = sig.split(''); c[at] = c[at] === 'A' ? 'B' : 'A'; return c.join(''); };

(async () => {
  const seeds = Array.from({ length: 40 }, () => seedFrom(rand)).concat(['a'.repeat(55)]);
  const fixed = ['a', 'Hello, Qubic!', 'x'.repeat(31), 'x'.repeat(33), 'y'.repeat(64), 'z'.repeat(1000), 'line one\nline two\r\n\ttabbed', ' leading and trailing ', '{"json":"inside"}', 'q'.repeat(8192)];
  const cases = [];
  for (const m of fixed) cases.push([seeds[rnd(seeds.length)], m]);
  for (let i = 0; i < 300; i++) cases.push([seeds[rnd(seeds.length)], randomMessage(i % 3 === 0 ? 400 : 60)]);

  const tally = { n: 0, same: 0, oursVerifyOfficial: 0, officialVerifyOurs: 0, tampered: 0, tamperedRejected: 0, wrongId: 0, wrongIdRejected: 0, seedRuns: 0 };
  const lengths = new Set(); const firstBad = [];
  // Every message is also signed as the wallet would, with all the test seeds held and their addresses listed: none is
  // taken for a seed, and only runs of 20 or more letters need the confirmation.
  const heldIds = seeds.map((s) => A.deriveAccount(s).identity);
  const longRun = (m) => (m.match(/[A-Za-z]+/g) || []).some((r) => r.length >= 20);
  const misread = [];
  for (const [seed, message] of cases) {
    if (bytesOf(message) === 32) continue;
    tally.n++; lengths.add(bytesOf(message));
    const account = A.deriveAccount(seed);
    let official = await officialSign(seed, message);
    if (fault('msg-output') && tally.n === 5) official = official.replace(/"signature": "./, (m) => `${m.slice(0, -1)}${m.endsWith('A') ? 'B' : 'A'}`);
    // The cross-check is about the format, so runs of 20 or more letters ('z' × 1000, 'q' × 8192) are confirmed as no
    // seed here.
    const ours = A.signMessage({ seed, account, message, seedLikeOk: true });
    let plain;
    try { plain = A.signMessage({ seed, account, message, walletSeeds: seeds, walletIds: heldIds }) === ours ? 'signed' : 'different'; } catch (e) { plain = e.code || 'uncoded'; }
    if (longRun(message)) tally.seedRuns++;
    if (plain !== (longRun(message) ? 'MESSAGE_SEEDLIKE' : 'signed') && misread.length < 3) misread.push(`${JSON.stringify(message).slice(0, 30)} → ${plain}`);
    if (ours === official) tally.same++; else if (firstBad.length < 3) firstBad.push(JSON.stringify(message).slice(0, 40));
    const v = A.verifyMessage(official);
    if (v.ok === true && v.message === message) tally.oursVerifyOfficial++;
    if (await officialVerify(ours) === 'valid') tally.officialVerifyOurs++;
    // Tampering: one more character, or one changed signature letter.
    const obj = JSON.parse(ours);
    for (const t of [JSON.stringify({ ...obj, message: `${message}.` }, null, 2), JSON.stringify({ ...obj, signature: flipLetter(obj.signature, rnd(128)) }, null, 2)]) {
      tally.tampered++;
      if (A.verifyMessage(t).ok !== true && await officialVerify(t) !== 'valid') tally.tamperedRejected++;
    }
    // The same block claimed for another address.
    const other = fault('msg-identity') && tally.n === 3 ? obj.identity : A.deriveAccount(seeds[(seeds.indexOf(seed) + 1) % seeds.length]).identity;
    tally.wrongId++;
    const t3 = JSON.stringify({ ...obj, identity: other }, null, 2);
    if (A.verifyMessage(t3).ok === false && await officialVerify(t3) === 'invalid') tally.wrongIdRejected++;
  }
  const { n } = tally;
  check(`signed-message JSON identical to the official wallet’s (${n} messages, ${Math.min(...lengths)}–${Math.max(...lengths)} bytes)`, tally.same === n, firstBad.join(' | '));
  check('ours verifies every official block', tally.oursVerifyOfficial === n, `${tally.oursVerifyOfficial}/${n}`);
  check('the official verifier accepts every block of ours', tally.officialVerifyOurs === n, `${tally.officialVerifyOurs}/${n}`);
  check('a changed message or signature letter is rejected by both', tally.tamperedRejected === tally.tampered, `${tally.tamperedRejected}/${tally.tampered}`);
  check('a block claimed for another address is rejected by both', tally.wrongIdRejected === tally.wrongId, `${tally.wrongIdRejected}/${tally.wrongId}`);
  check(`no message here is taken for a seed; only the ${tally.seedRuns} with 20+ letters in a row need a confirmation (${n} messages, ${seeds.length} seeds held)`,
    misread.length === 0 && tally.seedRuns > 0, misread.join(' | '));

  // Every signing guard, with its reason; the control signs.
  const seed = seeds[0]; const account = A.deriveAccount(seed);
  const tryMsg = (args) => { try { A.signMessage({ seed, account, message: 'ok', ...args }); return 'signed'; } catch (e) { return e.code || `uncoded: ${e.message}`; } };
  check('control: an ordinary message signs', tryMsg({}) === 'signed');
  const guards = [
    ['32 ASCII bytes (could pass for a transaction digest)', { message: 'x'.repeat(32) }, 'MESSAGE_32'],
    ['32 bytes as 16 × é', { message: 'é'.repeat(16) }, 'MESSAGE_32'],
    ['empty message', { message: '' }, 'MESSAGE_EMPTY'],
    ['not a string', { message: 42 }, 'MESSAGE_EMPTY'],
    ['over 8 KB', { message: 'q'.repeat(8193) }, 'MESSAGE_LONG'],
    ['another account’s seed', { account: A.deriveAccount(seeds[1]) }, 'KEY_MISMATCH'],
    ['a seed that isn’t 55 lowercase letters', { seed: 'A'.repeat(55) }, 'INVALID_SEED'],
  ];
  if (fault('msg-guard')) guards.push(['(fault) 31 bytes expected to be refused', { message: 'x'.repeat(31) }, 'MESSAGE_32']);
  for (const [label, args, code] of guards) { const got = tryMsg(args); check(`refused: ${label} → ${code}`, got === code, got === code ? '' : `got ${got}`); }
  A.state.selfTest.status = 'fail';
  const failedSelfTest = tryMsg({});
  A.state.selfTest.status = 'pass';
  check('refused: self-test failed → SELF_TEST', failedSelfTest === 'SELF_TEST', failedSelfTest === 'SELF_TEST' ? '' : `got ${failedSelfTest}`);
  // A seed in the message. A seed the wallet holds, as it is or in capitals, with separators, inside a sentence,
  // in full-width letters, is refused, and confirming it isn't a seed doesn't change that; so is a watch-only
  // account's seed written alone. Runs of 20+ letters need the same confirmation regardless of any fragment match, unless they
  // are a checksummed address or transaction ID, or a signature. Text that mentions seeds, addresses, transaction IDs,
  // signatures and hex digests still signs.
  const groups = (s, n, sep) => s.match(new RegExp(`.{1,${n}}`, 'g')).join(sep);
  const fullWidth = (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xFEE0));
  const up = seed.toUpperCase();
  const stranger = seeds[3];
  const strangerId = A.deriveAccount(stranger).identity;
  const txId = QL.computeTransactionHash(Uint8Array.from({ length: 144 }, () => rnd(256))); // a real transaction ID's form
  const sigText = JSON.parse(A.signMessage({ seed, account, message: 'countersign this' })).signature;
  const seedCases = [
    ['its own seed', { message: seed }, 'MESSAGE_SEED'],
    ['its own seed in capitals, in groups of five on two lines', { message: `${groups(up.slice(0, 30), 5, ' ')}\n${groups(up.slice(30), 5, ' ')}` }, 'MESSAGE_SEED'],
    ['its own seed inside a sentence', { message: `To verify my wallet, my seed is ${seed}. Thanks!` }, 'MESSAGE_SEED'],
    ['its own seed in full-width letters, with dashes', { message: groups(fullWidth(seed), 11, '-') }, 'MESSAGE_SEED'],
    ['its first 20 letters', { message: `the first part: ${seed.slice(0, 20)}` }, 'MESSAGE_SEEDLIKE'],
    ['20 letters from its middle', { message: `the middle part: ${seed.slice(20, 40)}` }, 'MESSAGE_SEEDLIKE'],
    ['its last 20 letters', { message: `the last part: ${seed.slice(35)}` }, 'MESSAGE_SEEDLIKE'],
    ['its own seed plus five letters (60 letters, a transaction ID’s shape)', { message: `${seed}hello` }, 'MESSAGE_SEED'],
    ['another account’s seed in this wallet', { message: `seed ${seeds[1]}`, walletSeeds: [seeds[2], seeds[1]] }, 'MESSAGE_SEED'],
    ['another account’s seed, the wallet’s seeds given as a Set', { message: `seed ${seeds[1]}`, walletSeeds: new Set([seeds[1]]) }, 'MESSAGE_SEED'],
    ['its own seed, confirmed as no seed', { message: seed, seedLikeOk: true }, 'MESSAGE_SEED'],
    ['another account’s seed, confirmed as no seed', { message: seeds[1], walletSeeds: [seeds[1]], seedLikeOk: true }, 'MESSAGE_SEED'],
    ['its own seed, with the wrong account (looked for before any key is derived)', { message: seed, account: A.deriveAccount(seeds[1]) }, 'MESSAGE_SEED'],
    ['a watch-only account’s seed (its address listed, its seed not held)', { message: stranger, walletIds: [strangerId] }, 'MESSAGE_SEED'],
    ['the same in groups of five', { message: groups(stranger, 5, ' '), walletIds: [strangerId] }, 'MESSAGE_SEED'],
    ['the same in a sentence, confirmed as no seed', { message: `My savings: ${stranger}`, walletIds: [strangerId], seedLikeOk: true }, 'MESSAGE_SEED'],
    ['55 letters in a row, not a seed held here', { message: `Verify: ${stranger}` }, 'MESSAGE_SEEDLIKE'],
    ['the same in capitals', { message: stranger.toUpperCase() }, 'MESSAGE_SEEDLIKE'],
    ['56 letters in a row', { message: `${stranger}q` }, 'MESSAGE_SEEDLIKE'],
    ['a seed not held here plus five letters (60 letters, a transaction ID’s shape)', { message: `${stranger}hello` }, 'MESSAGE_SEEDLIKE'],
    ['the same in capitals (an address’s shape)', { message: `${stranger}hello`.toUpperCase() }, 'MESSAGE_SEEDLIKE'],
    ['its own seed with a letter added after every 11 (60 letters)', { message: seed.match(/.{11}/g).map((g) => `${g}x`).join('') }, 'MESSAGE_SEEDLIKE'],
    ['55 letters in a row, with a confirmation that isn’t true', { message: stranger, seedLikeOk: 'yes' }, 'MESSAGE_SEEDLIKE'],
    ['55 letters in a row, confirmed as no seed', { message: stranger, seedLikeOk: true }, 'signed'],
    ['19 letters of its seed in a row', { message: `the middle part: ${seed.slice(20, 39)}` }, 'signed'],
    ['54 letters in a row', { message: stranger.slice(0, 54) }, 'MESSAGE_SEEDLIKE'],
    ['text about seeds', { message: 'I own this address. I will never share my seed or type it anywhere.' }, 'signed'],
    ['its own address (60 capitals)', { message: `I control ${account.identity}` }, 'signed'],
    ['a watch-only account’s address, its seed not in the message', { message: `I watch ${strangerId}`, walletIds: [strangerId] }, 'signed'],
    ['a transaction ID (60 lowercase letters)', { message: `Paid in ${txId}` }, 'signed'],
    ['a signed message’s signature (130 letters A–P)', { message: `I saw ${sigText}` }, 'signed'],
    ['a SHA-256 in hex', { message: 'SHA-256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }, 'signed'],
  ];
  for (const [label, args, code] of seedCases) {
    const got = tryMsg(args);
    check(`${code === 'signed' ? 'signs' : 'refused'}: ${label}${code === 'signed' ? '' : ` → ${code}`}`, got === code, got === code ? '' : `got ${got}`);
  }

  // The old rolling-prefix attack: every possible next letter must give exactly the same finding and signing
  // outcome, even for matching fragments elsewhere in the seed, normalization, and a different account's seed.
  let probes = 0; const leaks = [];
  for (const held of [seed, seeds[1]]) for (const start of [0, 18, 35]) {
    const prefix = held.slice(start, start + 19);
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
      const candidate = prefix + letter;
      for (const message of [candidate, candidate.toUpperCase(), fullWidth(candidate), groups(candidate, 5, '-')]) {
        probes++;
        const scope = { seeds: [seed, seeds[1]] };
        const finding = A.seedInMessage(message, scope);
        const publicFinding = A.seedInMessage(message);
        const outcome = tryMsg({ message, walletSeeds: [seeds[1]] });
        const expected = publicFinding === 'seedlike' ? 'MESSAGE_SEEDLIKE' : 'signed';
        if (finding !== publicFinding || outcome !== expected) leaks.push({ start, outcome, finding });
      }
    }
  }
  check(`partial-seed probes disclose no matching letters (${probes} probes)`, leaks.length === 0, JSON.stringify(leaks.slice(0, 3)));
  check('confirming a fragment warning is independent of whether it matches',
    tryMsg({ message: seed.slice(0, 20), seedLikeOk: true }) === 'signed'
    && tryMsg({ message: stranger.slice(0, 20), seedLikeOk: true }) === 'signed');

  // The guard is on signing only: a 32-byte message signed elsewhere still verifies.
  check('an official 32-byte signature still verifies here', A.verifyMessage(await officialSign(seed, 'x'.repeat(32))).ok === true);

  // Malformed input gives an error, never ok; a well-formed block is the control.
  const good = A.signMessage({ seed, account, message: 'well formed' });
  check('control: a well-formed block verifies', A.verifyMessage(good).ok === true);
  const malformed = ['', 'not json', '{}', '[1,2]', 'null', '"text"', JSON.stringify({ identity: 'A', message: 'm', signature: 'B' }),
    JSON.stringify({ identity: account.identity, message: 'm', signature: 'Q'.repeat(130) }),
    JSON.stringify({ identity: account.identity, message: 'm', signature: 'A'.repeat(129) }),
    JSON.stringify({ identity: account.identity.toLowerCase(), message: 'm', signature: JSON.parse(good).signature }),
    JSON.stringify({ identity: account.identity, message: 7, signature: JSON.parse(good).signature }),
    'x'.repeat(40000)];
  if (fault('msg-malformed')) malformed.push(good);
  const notFlagged = malformed.filter((bad) => { const r = A.verifyMessage(bad); return r.ok === true || !r.error; });
  check(`malformed input is flagged as an error (${malformed.length} kinds)`, notFlagged.length === 0, notFlagged.map((s) => s.slice(0, 30)).join(' | '));

  // Degenerate keys: the neutral point and a point of order 2 accept forged "signatures" in plain SchnorrQ; both, and
  // the burn address, must be refused here (the official verifier is not asked: it accepts them).
  const one = new Uint8Array(32); one[0] = 1;
  const forgedSig = new Uint8Array(65); forgedSig.set(QL.pointMarshal(QL.scalarBaseMult(one))); forgedSig.set(one, 32); forgedSig[64] = QL.k12(forgedSig.slice(0, 64), 1)[0];
  const neutral = QL.pointMarshal(QL.pointIdentity());
  const orderTwo = new Uint8Array(32); orderTwo.set([0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]); // y = -1 (x = 0)
  const shifted = encodeShiftedHex(forgedSig);
  let refusedDegenerate = 0;
  for (const pk of [neutral, orderTwo]) for (const m of ['I own this address', 'and this one too']) {
    if (A.verifyMessage(JSON.stringify({ identity: QL.publicKeyToIdentity(pk), message: m, signature: shifted }, null, 2)).ok !== true) refusedDegenerate++;
  }
  check('forgeries for degenerate public keys are refused', refusedDegenerate === 4, `${refusedDegenerate}/4`);
  check('a claim for the burn address is refused', Boolean(A.verifyMessage(JSON.stringify({ identity: QL.publicKeyToIdentity(new Uint8Array(32)), message: 'burn', signature: 'A'.repeat(130) }, null, 2)).error));
  finish('message-signing');
})().catch(harnessError);
