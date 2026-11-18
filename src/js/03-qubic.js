// ═══════════════════════════════════════════════════════════════════════════
// 4. QUBIC CORE
// Thin, defensive wrappers around the vendored official SDK. Raw library
// errors are never shown or logged: InvalidSeedError carries the seed itself.
// ═══════════════════════════════════════════════════════════════════════════
// The vendored libraries, as src/assemble.py hands them over: VENDORED is the argument of the function that wraps this
// app, in the same script as the bundles, and null if they threw while starting. No global name ever holds them, so
// code that ran before this page can't hand the wallet a library through one, or between two scripts. It can still
// replace the built-ins the libraries use while starting (Object.freeze, Object.defineProperty, accessors on
// Object.prototype) and swap one that way, or replace random numbers or WebCrypto: defence in depth, not isolation
// (see docs/SECURITY.md, "The page").
// Typed as present: when they're missing, boot (src/js/11-main.js) stops before anything that uses them.
const Q = /** @type {QubicLib} */ (VENDORED ? VENDORED.QubicLib : null);
const QR = /** @type {QrCodeGen} */ (VENDORED ? VENDORED.qrcodegen : null);

const SEED_RE = /^[a-z]{55}$/;
const ID_RE = /^[A-Z]{60}$/;
const HASH_RE = /^[a-z]{60}$/;
// For data from outside (the network, stored records): strings only. RegExp.test turns its argument into a string, so
// an array holding a valid hash would pass the pattern alone.
const isHash = (v) => typeof v === 'string' && HASH_RE.test(v);
const isId = (v) => typeof v === 'string' && ID_RE.test(v);

const normalizeSeed = (raw) => String(raw || '').replace(/\s+/g, '').toLowerCase();
const normalizeIdentity = (raw) => String(raw || '').replace(/\s+/g, '').toUpperCase();

function checkSeed(seed) {
  if (!seed) return { state: 'empty' };
  if (/[^a-z]/.test(seed)) return { state: 'invalid', message: tr('Only the letters a–z are allowed.') };
  if (seed.length < 55) return { state: 'incomplete', message: tr('{count, plural, one {# more letter needed.} other {# more letters needed.}}', { count: 55 - seed.length }) };
  if (seed.length > 55) return { state: 'invalid', message: tr('Too long by {count}. A seed has exactly 55 letters.', { count: seed.length - 55 }) };
  if (new Set(seed).size < 8) return { state: 'weak', message: tr('This seed has very few distinct letters. It may be publicly known; funds in it are not safe.') };
  return { state: 'valid' };
}

function checkIdentity(id) {
  if (!id) return { state: 'empty' };
  if (/[^A-Z]/.test(id)) return { state: 'invalid', message: tr('Addresses contain only the letters A–Z.') };
  if (id.length < 60) return { state: 'incomplete', message: tr('{count}/60 characters', { count: id.length }) };
  if (id.length > 60) return { state: 'invalid', message: tr('Too long. A Qubic address has 60 letters.') };
  let ok = false;
  try { ok = Q.isValidIdentityChecksum(id); } catch { ok = false; }
  if (!ok) return { state: 'invalid', message: tr('Checksum mismatch. Check the address for typos.') };
  // Base-26 letters can spell a few 64-bit values two ways; only the canonical spelling of a key is accepted.
  let canonical = false;
  try { canonical = Q.publicKeyToIdentity(Q.identityToPublicKey(id)) === id; } catch { canonical = false; }
  return canonical ? { state: 'valid' } : { state: 'invalid', message: tr('Not a canonical Qubic address. Check where it came from.') };
}

// Returns 'burn' | 'contract' | 'user' for a checksum-valid identity. An address's kind never changes, and Activity
// asks for it a few times a row, so answers are kept (up to 5,000 addresses, then started afresh).
const identityKinds = new Map();
function identityKind(id) {
  let kind = identityKinds.get(id);
  if (kind) return kind;
  let pk = null;
  try { pk = Q.identityToPublicKey(id); } catch { kind = 'user'; }
  if (pk) {
    const index = pk[0] | (pk[1] << 8) | (pk[2] << 16) | (pk[3] << 24);
    kind = !pk.subarray(4).every((b) => b === 0) ? 'user' : index === 0 ? 'burn' : 'contract';
  }
  if (identityKinds.size >= 5000) identityKinds.clear();
  identityKinds.set(id, kind);
  return kind;
}
const contractIdentity = (index) => {
  const pk = new Uint8Array(32);
  new DataView(pk.buffer).setUint32(0, index, true);
  return Q.publicKeyToIdentity(pk);
};

// The browser's random generator, looked at before a seed is made from it: two 32-byte samples that are constant, or
// the same as each other, mean it's broken or was replaced, and would give a seed others can guess (all zeros give the
// public all-"a" seed). A sample of only bytes the bundle's generator rejects (234 and up, so 0xFF too) would keep it
// looping. A real generator fails this about once in 2^113 tries. One that only looks random can't be told apart here.
function randomLooksBroken() {
  const a = randomBytes(32);
  const b = randomBytes(32);
  const flat = (s) => s.every((x) => x === s[0]) || s.every((x) => x >= 234);
  const broken = flat(a) || flat(b) || bytesEqual(a, b);
  wipe(a, b);
  return broken;
}

function generateSeed() {
  if (randomLooksBroken()) throw new AppError('RANDOM');
  let seed;
  try { seed = Q.generateRandomSeed(); } catch { throw new AppError('CRYPTO'); }
  if (!SEED_RE.test(seed)) throw new AppError('CRYPTO');
  // A made seed passes the same check as a typed one: fewer than 8 distinct letters (a real one, about once in 10^25)
  // means the generator only looked random.
  if (checkSeed(seed).state !== 'valid') throw new AppError('RANDOM');
  return seed;
}

// seed → { identity, publicKey }. Private material is wiped before returning.
function deriveAccount(seed) {
  if (!SEED_RE.test(seed)) throw new AppError('INVALID_SEED');
  let keys;
  try {
    keys = Q.deriveKeys(seed);
    const identity = Q.publicKeyToIdentity(keys.publicKey);
    if (!ID_RE.test(identity)) throw new Error('bad identity');
    return { identity, publicKey: keys.publicKey.slice() };
  } catch {
    throw new AppError('CRYPTO');
  } finally {
    if (keys) wipe(keys.subseed, keys.privateKey);
  }
}

// True when keys derived from the seed in memory are exactly the account on screen (public key and identity).
const keysMatch = (keys, account) => bytesEqual(keys.publicKey, account.publicKey) && Q.publicKeyToIdentity(keys.publicKey) === account.identity;

// Builds, signs and independently re-checks a plain QU transfer (inputType 0).
async function signTransfer({ seed, account, destination, amount, targetTick, currentTick }) {
  if (state.selfTest.status !== 'pass') throw new AppError('SELF_TEST');
  if (!SEED_RE.test(seed)) throw new AppError('INVALID_SEED');
  if (checkIdentity(destination).state !== 'valid') throw new AppError('INVALID_IDENTITY');
  if (typeof amount !== 'bigint' || amount <= 0n || amount > MAX_AMOUNT) throw new AppError('CRYPTO', trLater('Invalid amount.'));
  if (!Number.isInteger(targetTick) || targetTick <= currentTick || targetTick > 0xFFFFFFFF) throw new AppError('CRYPTO', trLater('Invalid target tick.'));

  let keys;
  try {
    // 1. The seed held in memory must produce exactly the account shown on screen.
    keys = Q.deriveKeys(seed);
    if (!keysMatch(keys, account)) throw new AppError('KEY_MISMATCH');
    // 2. 80-byte header: source, destination, amount (int64 LE), tick, inputType 0, inputSize 0.
    const unsigned = Q.buildTransaction({ source: keys.publicKey, destination, amount, targetTick, inputType: 0, currentTick });
    // 3. K12 digest → SchnorrQ signature (official SDK).
    const signed = await Q.signTransaction(unsigned, seed);
    wipe(unsigned);
    // 4. Independent checks before anything leaves the device.
    if (!(signed instanceof Uint8Array) || signed.length !== 144) throw new AppError('TX_MISMATCH');
    if (!Q.verifyTransactionSignature(signed)) throw new AppError('SIGNATURE');
    const d = Q.decodeTransaction(signed);
    const matches = bytesEqual(d.sourcePublicKey, account.publicKey)
      && Q.publicKeyToIdentity(d.destinationPublicKey) === destination
      && d.amount === amount && d.targetTick === targetTick && d.inputType === 0 && d.payload.length === 0;
    if (!matches) throw new AppError('TX_MISMATCH');
    const hash = Q.computeTransactionHash(signed);
    if (!HASH_RE.test(hash)) throw new AppError('TX_MISMATCH');
    return { hash, encoded: Q.encodeTransaction(signed) };
  } catch (err) {
    throw err instanceof AppError ? err : new AppError('CRYPTO');
  } finally {
    if (keys) wipe(keys.subseed, keys.privateKey);
  }
}

// ── Signed messages, in the official web wallet's format ────────────────────
// { "identity", "message", "signature" } (JSON, 2-space indent): SchnorrQ over the message's UTF-8 bytes plus one
// checksum byte (K12 of the signature, 1 byte), written as 130 letters A–P, each byte as two 4-bit letters, high first.
// The SDK's sign/verify take a 32-byte digest; these run the same SchnorrQ steps (FourQlib's SchnorrQ_Sign and
// SchnorrQ_Verify) over a message of any length, with the SDK's own K12 and FourQ functions.
// Guard: transactions are signed as a 32-byte K12 digest with the same key, so a signature on a 32-byte message could
// double as a transaction signature. The wallet refuses to sign messages of exactly 32 bytes.
const MESSAGE_MAX_BYTES = 8192;
const leBigInt = (b) => { let x = 0n; for (let i = b.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(b[i]); return x; };
function bigIntLE32(n) {
  const out = new Uint8Array(32);
  let t = n;
  for (let i = 0; i < 32; i++) { out[i] = Number(t & 0xffn); t >>= 8n; }
  return out;
}
const toShiftedHex = (bytes) => Array.from(bytes, (b) => String.fromCharCode(65 + (b >> 4), 65 + (b & 15))).join('');
function fromShiftedHex(text) {
  const up = text.toUpperCase();
  const out = new Uint8Array(up.length / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = up.charCodeAt(2 * i) - 65; const lo = up.charCodeAt(2 * i + 1) - 65;
    if (hi < 0 || hi > 15 || lo < 0 || lo > 15) throw new AppError('CRYPTO');
    out[i] = (hi << 4) | lo;
  }
  return out;
}
// A signature as the official wallet writes it: its 64 bytes plus one checksum byte (K12 of them), as letters A–P.
const signatureText = (sig) => toShiftedHex([...sig, Q.k12(sig, 1)[0]]);

function schnorrqSignBytes(subseed, publicKey, message) {
  const ORDER = Q.SCHNORRQ_ORDER;
  const k = Q.k12(subseed, 64);
  const t1 = new Uint8Array(32 + message.length);
  t1.set(k.subarray(32, 64), 0); t1.set(message, 32);
  const rHash = Q.k12(t1, 64);
  const rBytes = rHash.slice(0, 32);
  const r = leBigInt(rBytes) % ORDER;
  const R = Q.pointMarshal(Q.scalarBaseMult(rBytes));
  const t2 = new Uint8Array(64 + message.length);
  t2.set(R, 0); t2.set(publicKey, 32); t2.set(message, 64);
  const h = leBigInt(Q.k12(t2, 64).slice(0, 32)) % ORDER;
  const a = leBigInt(k.subarray(0, 32)) % ORDER;
  let s = (r - ((h * a) % ORDER)) % ORDER;
  s += ORDER & (s >> 255n);
  const sig = new Uint8Array(64);
  sig.set(R, 0); sig.set(bigIntLE32(s), 32);
  wipe(k, t1, rHash, rBytes);
  return sig;
}

// A public key must be the canonical encoding of a curve point outside the small subgroup. The neutral point and the
// other points whose order divides the cofactor (392 = 8 · 49) satisfy the SchnorrQ equation for "signatures" anyone
// can make, so they never verify (SchnorrQ itself doesn't check this).
function usablePublicKey(publicKey) {
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== 32 || (publicKey[15] & 0x80) !== 0) return null;
  const A = Q.pointUnmarshal(publicKey);
  if (!A || !Q.isOnCurve(A) || !bytesEqual(Q.pointMarshal(A), publicKey)) return null;
  let P = A;
  for (let i = 0; i < 3; i++) P = Q.pointDouble(P);
  let R = P;
  for (const bit of [1, 0, 0, 0, 1]) { R = Q.pointDouble(R); if (bit) R = Q.pointAdd(R, Q.toR2(P)); }
  return bytesEqual(Q.pointMarshal(R), Q.pointMarshal(Q.pointIdentity())) ? null : A;
}

function schnorrqVerifyBytes(publicKey, message, signature) {
  if ((signature[15] & 0x80) !== 0) return false;
  const R = signature.slice(0, 32); const sBytes = signature.slice(32, 64);
  if (leBigInt(sBytes) >= Q.SCHNORRQ_ORDER) return false; // canonical s only, as the SDK's verify
  const A = usablePublicKey(publicKey);
  if (!A) return false;
  const t = new Uint8Array(64 + message.length);
  t.set(R, 0); t.set(publicKey, 32); t.set(message, 64);
  const h = Q.k12(t, 64).slice(0, 32);
  return bytesEqual(Q.pointMarshal(Q.doubleScalarMult(sBytes, A, h)), R);
}

// A seed in a message to sign, which anyone who sees the signed block could use to take its funds. → 'held', 'seedlike'
// or null (neither, as for text that only mentions a seed).
// 'held': one of `seeds` (the seeds the wallet holds), as it is or in capitals, with spaces, line breaks, dashes or
// other separators between its letters, inside other text, or in full-width letters. Only COMPLETE seeds are compared:
// partial matches would let someone with a known prefix recover the rest through the warning or signing result.
// Also a seed of an address in `identities` (every account, watch-only ones too, whose seeds aren't held): the
// message's letters when there are exactly 55 of them, or a run of exactly 55 letters, whose address is one of them.
// 'seedlike': 20 or more letters with nothing between them, possibly a seed or a fragment from any wallet. This
// warning depends only on the message, never on whether a fragment matches a held seed. Exceptions are a
// 60-letter address or transaction ID whose checksum holds (a seed with 5 letters added has the shape, almost never the
// checksum) or a 130-letter signature (letters A–P only, which a seed's 55 almost never are).
// A seed that is rewritten (reversed, reordered, letters added or swapped for look-alikes) isn't recognised: this stops
// a seed pasted or typed as it is, not someone following a scammer's step-by-step instructions.
const SEEDLIKE_RUN = 20;
function checksummedId(run) {
  try { return Q.isValidIdentityChecksum(run.toUpperCase()); } catch { return false; }
}
const notSeedRun = (run) => ((ID_RE.test(run) || HASH_RE.test(run)) && checksummedId(run)) || /^[A-Pa-p]{130}$/.test(run);
// memo: an optional Map from a 55-letter run to the address it derives, so a screen that checks on every keystroke
// derives each run once (deriving keys is slow, and a message can hold many runs). Never capped: a limit would let
// decoy runs hide a seed.
/** @param {string} message @param {{ seeds?: (string | null | undefined)[], identities?: string[], memo?: Map<string, string | null> | null }} [opts] */
function seedInMessage(message, { seeds = [], identities = [], memo = null } = {}) {
  const text = String(message).normalize('NFKC');
  const letters = text.toLowerCase().replace(/[^a-z]/g, '');
  for (const seed of seeds) {
    if (typeof seed !== 'string' || !SEED_RE.test(seed)) continue;
    if (letters.includes(seed)) return 'held';
  }
  const runs = text.match(/[a-z]+/gi) || [];
  const ids = new Set(identities);
  if (ids.size) {
    const candidates = new Set(runs.filter((run) => run.length === 55).map((run) => run.toLowerCase()));
    if (letters.length === 55) candidates.add(letters);
    for (const candidate of candidates) {
      let derived = memo ? memo.get(candidate) : undefined;
      if (derived === undefined) {
        try { derived = deriveAccount(candidate).identity; } catch { derived = null; }
        if (memo) memo.set(candidate, derived);
      }
      if (derived !== null && ids.has(derived)) return 'held';
    }
  }
  return runs.some((run) => run.length >= SEEDLIKE_RUN && !notSeedRun(run)) ? 'seedlike' : null;
}

// Signs `message` with the account's seed and returns the signed-message JSON. Checked before it's shown.
// walletSeeds: the seeds the wallet holds, each refused in the message like the signer's own; walletIds: the addresses
// of its accounts whose seeds it doesn't hold, watch-only ones (see seedInMessage, and messageSeedScope for both). Both
// are spread, so an array or a Set works and null throws rather than skipping the check. seedLikeOk: you confirmed that a seed-shaped run in the message isn't a seed
// (it never lets a seed of these accounts through). The check runs before the signer's keys are derived.
function signMessage({ seed, account, message, walletSeeds = [], walletIds = [], seedLikeOk = false }) {
  if (state.selfTest.status !== 'pass') throw new AppError('SELF_TEST');
  if (!SEED_RE.test(seed)) throw new AppError('INVALID_SEED');
  const bytes = typeof message === 'string' ? utf8(message) : new Uint8Array(0);
  if (!bytes.length) throw new AppError('MESSAGE_EMPTY');
  if (bytes.length === 32) throw new AppError('MESSAGE_32');
  if (bytes.length > MESSAGE_MAX_BYTES) throw new AppError('MESSAGE_LONG');
  const found = seedInMessage(message, { seeds: [seed, ...walletSeeds], identities: [...walletIds] });
  if (found === 'held') throw new AppError('MESSAGE_SEED');
  if (found === 'seedlike' && seedLikeOk !== true) throw new AppError('MESSAGE_SEEDLIKE');
  let keys;
  try {
    keys = Q.deriveKeys(seed);
    if (!keysMatch(keys, account)) throw new AppError('KEY_MISMATCH');
    const sig = schnorrqSignBytes(keys.subseed, keys.publicKey, bytes);
    if (!schnorrqVerifyBytes(keys.publicKey, bytes, sig)) throw new AppError('SIGNATURE');
    return JSON.stringify({ identity: account.identity, message, signature: signatureText(sig) }, null, 2);
  } catch (err) {
    throw err instanceof AppError ? err : new AppError('CRYPTO');
  } finally {
    if (keys) wipe(keys.subseed, keys.privateKey);
  }
}

// Checks a pasted signed-message block → { ok, identity, message, bytes } or { error }.
function verifyMessage(text) {
  if (typeof text !== 'string' || text.length > 4 * MESSAGE_MAX_BYTES + 1024) return { error: tr('That’s too long to be a signed message.') };
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { error: tr('Paste the whole block, from {open} to {close}.', { open: '{', close: '}' }) }; }
  const { identity, message, signature } = parsed && typeof parsed === 'object' ? parsed : {};
  if (![identity, message, signature].every((v) => typeof v === 'string' && v)) return { error: tr('The block needs an identity, a message and a signature.') };
  if (checkIdentity(identity).state !== 'valid') return { error: tr('The identity isn’t a valid Qubic address.') };
  // No seed controls a contract or the burn address, and a key of small order proves nothing: refuse to say they
  // signed.
  if (identityKind(identity) !== 'user') return { error: tr('That’s a smart-contract or burn address. No seed controls it, so it can’t sign messages.') };
  if (!usablePublicKey(Q.identityToPublicKey(identity))) return { error: tr('That address isn’t a usable public key, so no signature can prove it signed anything.') };
  if (!/^[A-Pa-p]{130}$/.test(signature)) return { error: tr('The signature should be 130 letters from A to P.') };
  const raw = fromShiftedHex(signature);
  const sig = raw.slice(0, 64);
  if (Q.k12(sig, 1)[0] !== raw[64]) return { error: tr('The signature’s checksum doesn’t match. It may be cut short or mistyped.') };
  const bytes = utf8(message);
  let ok = false;
  try { ok = schnorrqVerifyBytes(Q.identityToPublicKey(identity), bytes, sig); } catch { ok = false; }
  return { ok, identity, message, bytes: bytes.length };
}

// Known-answer tests. Any failure disables create, import and send.
async function runSelfTest() {
  const started = performance.now();
  const steps = [];
  const check = (name, ok) => { steps.push(name); if (!ok) throw Object.assign(new Error('check'), { check: name }); };
  try {
    check(trLater('Vendored library loaded'), Boolean(Q && QR && typeof Q.deriveKeys === 'function'));
    check(trLater('Secure random generator'), typeof crypto?.getRandomValues === 'function' && typeof BigInt === 'function');
    const keys = Q.deriveKeys(KAT.seed);
    check(trLater('Seed → identity (FourQ, K12)'), Q.publicKeyToIdentity(keys.publicKey) === KAT.identity);
    const digest = Q.k12(utf8(KAT.message), 32);
    check(trLater('KangarooTwelve digest'), toHex(digest) === KAT.digest);
    const sig = await Q.sign(digest, KAT.seed);
    check(trLater('SchnorrQ deterministic signature'), toHex(sig) === KAT.signature);
    check(trLater('SchnorrQ verification'), Q.verify(digest, sig, keys.publicKey) === true);
    const tampered = sig.slice(); tampered[9] ^= 0x01;
    check(trLater('Rejects a tampered signature'), Q.verify(digest, tampered, keys.publicKey) === false);
    check(trLater('Message signing matches the SDK on 32 bytes'), bytesEqual(schnorrqSignBytes(keys.subseed, keys.publicKey, digest), sig));
    const msg = utf8(KAT.signedMessage);
    const msgSig = schnorrqSignBytes(keys.subseed, keys.publicKey, msg);
    check(trLater('Signed message (official wallet format)'), signatureText(msgSig) === KAT.messageSignature);
    check(trLater('Message verification'), schnorrqVerifyBytes(keys.publicKey, msg, msgSig) && !schnorrqVerifyBytes(keys.publicKey, utf8(`${KAT.signedMessage}.`), msgSig));
    // The neutral point as a "public key": R = [1]G with s = 1 satisfies the equation for every message.
    const one = new Uint8Array(32); one[0] = 1;
    const forged = new Uint8Array(64); forged.set(Q.pointMarshal(Q.scalarBaseMult(one))); forged.set(one, 32);
    check(trLater('Rejects degenerate public keys'), !schnorrqVerifyBytes(Q.pointMarshal(Q.pointIdentity()), msg, forged));
    const tx = fromB64(KAT.mainnetTx);
    check(trLater('Verifies a real mainnet transfer'), Q.verifyTransactionSignature(tx) === true);
    check(trLater('Reproduces its transaction hash'), Q.computeTransactionHash(tx) === KAT.mainnetHash);
    const flipped = KAT.identity.slice(0, 59) + (KAT.identity[59] === 'A' ? 'B' : 'A');
    check(trLater('Identity checksum validation'), Q.isValidIdentityChecksum(KAT.identity) && !Q.isValidIdentityChecksum(flipped));
    const a2 = await Q.argon2idAsync(new Uint8Array(32).fill(1), new Uint8Array(16).fill(2), {
      t: 3, m: 32, p: 4, dkLen: 32, key: new Uint8Array(8).fill(3), personalization: new Uint8Array(12).fill(4),
    });
    check(trLater('Argon2id (RFC 9106 vector)'), toHex(a2) === KAT.argon2id);
    wipe(keys.subseed, keys.privateKey);
    state.selfTest = { status: 'pass', steps, ms: Math.round(performance.now() - started) };
  } catch (err) {
    state.selfTest = { status: 'fail', steps, failed: err && err.check ? err.check : trLater('Unexpected error while testing'), ms: Math.round(performance.now() - started) };
  }
}

// QUtil's address (SendMany's contract), worked out once when first needed.
let qutilIdentityCache = null;
const qutilIdentity = () => (qutilIdentityCache ||= contractIdentity(QUTIL_INDEX));
// Anything carrying QUBIC, whatever its input type, counts as moved only when the archive says so (moneyFlew = true).
// Core moves the amount before anything else, ignores the input type at an address that isn't a smart contract, and
// runs a contract's procedure only once the amount has reached it. So: moved → success, or "executed" for a contract
// call (it went through with its QUBIC); otherwise unknown (shown as unconfirmed, never as money received).
// qubic/wallet's transaction-status.helper.ts reads the flag for input type 0 only, which lets anyone holding 1 QU sign
// a transfer to you with another input type that moves nothing and still shows as received. SendMany follows the flag
// whatever its amount. Any other call carrying nothing → "executed": for those the flag says nothing about the call
// itself (it's set when the contract pays its caller). Unlike that helper, moneyFlew = false isn't shown as failed: the
// archive also serves false when it has no status (see transferOutcome), and "failed" on a payment that went through
// invites paying again; a contract call whose QUBIC the contract sent back is flagged false too, so it reads as
// unconfirmed. A missing flag (optional in the archive's schema, "provided by some nodes with the tx status addon",
// marked deprecated) is unknown too. Only this wallet's own settlement of a transfer shows "failed", while this session
// holds it (see txStatus). All of this relies on the flag meaning that the amount moved: an archive that set it on
// inclusion alone would show a transfer that moved nothing as received.
function archivedStatus(tx) {
  const sendMany = tx.destination === qutilIdentity() && tx.inputType === QUTIL_SENDMANY_INPUT;
  if (tx.amount > 0n || sendMany) {
    if (tx.moneyFlew !== true) return 'unknown';
    return tx.inputType !== 0 && !sendMany && identityKind(tx.destination) === 'contract' ? 'executed' : 'success';
  }
  return 'executed';
}

// ── Settling a transfer signed here ─────────────────────────────────────────
// What a signed transfer says about itself, read back from its own bytes (as sent and journalled): both sides, amount,
// tick, type, input and signature.
function signedFields(encoded) {
  const bytes = fromB64(encoded);
  const d = Q.decodeTransaction(bytes);
  const end = 80 + d.payload.length;
  if (bytes.length !== end + 64) throw new Error('length');
  return {
    source: Q.publicKeyToIdentity(d.sourcePublicKey), destination: Q.publicKeyToIdentity(d.destinationPublicKey),
    amount: BigInt(d.amount), tick: Number(d.targetTick), inputType: d.inputType, inputSize: d.payload.length,
    inputData: toB64(d.payload), signature: bytes.slice(end),
  };
}
// The archive's record is exactly that transfer: every field equal, none defaulted. Anything else (another type, size,
// input or signature) contradicts it, and a contradiction settles nothing.
function sameAsSigned(tx, hash, encoded) {
  let s;
  try { s = signedFields(encoded); } catch { return false; }
  let sig = null;
  try { sig = typeof tx.signature === 'string' ? fromB64(tx.signature) : null; } catch { sig = null; }
  return tx.hash === hash && tx.source === s.source && tx.destination === s.destination && tx.amount === s.amount
    && tx.tick === s.tick && tx.inputType === s.inputType && tx.inputSize === s.inputSize && tx.inputData === s.inputData
    && Boolean(sig) && bytesEqual(sig, s.signature);
}
// How a transfer signed here settles. evidence:
//   { included: true, moneyFlew, event }: the archive holds this exact transfer in its tick, so it executed there,
//     moving QUBIC or not. moneyFlew: the archive's flag for it. Only true says anything: the archive also serves
//     false when it has no status for a transaction (go-archiver's getTransactionInfo falls back to false, and the
//     query service keeps the flag as a plain bool), so false, like null (missing), leaves the outcome open. event:
//     whether Core's event log holds it as a QU transfer with the same sides and amount (true; false: none found,
//     which proves nothing, the log being incomplete; null: not looked up yet).
//   { included: false }: that tick's whole transaction list lacks it, so it never executed.
// Sent: moneyFlew true, or the logged transfer. Failed: only Core's own record of the sending account can show it, and
// only while that record runs unbroken from before the transfer's tick. Core stamps the outgoing tick on every send
// that goes through and the incoming tick on every deposit, and drops an emptied account, which only a deposit brings
// back. So a record that still exists (it has received QUBIC), with nothing in or out since before the transfer's
// tick, shows that the transfer moved nothing. Anything else stays unknown, its record and its account's send block
// kept, and is looked at again later.
// The account's live record (live: { validForTick, lastOutTick, lastInTick, incoming }, or null when it couldn't be
// read) otherwise only vetoes: an outcome it contradicts is held for you to check. It never says "sent": the archive
// prunes some zero-amount transactions, so QUBIC leaving at that tick needn't be this transfer. It must describe a
// later tick than the transfer's, and be possible: a transfer after the tick it describes, or a tick far beyond the
// network's (nowTick, as last seen), is not evidence.
// → { status } to settle with; { status: 'wait' } until the live record is past the tick and makes sense;
// { status: 'wait', need: 'event' } to look at Core's log and ask again; or 'unknown' with a note, and hold when
// re-checking can't change it (the evidence disagrees).
// TICK_LEAD_MAX is this wallet's own plausibility bound, not a Qubic rule: how far past the network's last seen tick
// a live record may claim to be before it's treated as not yet consistent.
const TICK_LEAD_MAX = 1000;
const UNSETTLED_NOTES = {
  flowedButNothingSent: trLater('The archive reports this transfer as done, but its account’s current record shows nothing sent at that tick (an emptied account’s record can start afresh). Check it on the explorer.'),
  sentSince: trLater('Its account has sent QUBIC since, so the outcome can’t be confirmed automatically. Check it on the explorer.'),
  absentButSent: trLater('The archive doesn’t list this transfer in its tick, but its account sent QUBIC at that tick. Check it on the explorer.'),
  flagOnly: trLater('The archive marks this transfer as not moved, but it marks transfers it has no status for the same way, and its account’s record can’t confirm it. Looking again; check it on the explorer if it stays like this.'),
  noEvidence: trLater('Nothing yet says whether this transfer moved its QUBIC: the archive doesn’t report it and the network’s event log has no entry. Looking again; check it on the explorer if it stays like this.'),
};
const held = (note) => ({ status: 'unknown', hold: true, note: UNSETTLED_NOTES[note] });
// The account's record has run unbroken since before `tick`: Core still holds it, and nothing has come in since.
const unbrokenSince = (live, tick) => live.incoming > 0n && live.lastInTick < tick;
/** @param {Evidence} evidence @param {LiveBalance | null} live @param {number} targetTick @param {number | null} [nowTick] */
function transferOutcome(evidence, live, targetTick, nowTick = null) {
  if (!live || !Number.isSafeInteger(live.validForTick) || !Number.isSafeInteger(live.lastOutTick) || live.lastOutTick < 0
    || !Number.isSafeInteger(live.lastInTick) || live.lastInTick < 0 || typeof live.incoming !== 'bigint') return { status: 'wait' };
  if (live.lastOutTick > live.validForTick || live.lastInTick > live.validForTick
    || (nowTick != null && Number.isSafeInteger(nowTick) && live.validForTick > nowTick + TICK_LEAD_MAX)) return { status: 'wait' };
  // At its own tick the record may be part-way through it: only a later one has the target tick fully applied.
  if (live.validForTick <= targetTick) return { status: 'wait' };
  const out = live.lastOutTick;
  if (!evidence.included) return out < targetTick ? { status: 'not-executed' } : held(out === targetTick ? 'absentButSent' : 'sentSince');
  if (evidence.moneyFlew === true) return out >= targetTick ? { status: 'success' } : held('flowedButNothingSent');
  // Otherwise Core's log is looked at first: it can confirm a move the archive's flag doesn't.
  if (evidence.event == null) return { status: 'wait', need: 'event' };
  if (evidence.event === true) return out >= targetTick ? { status: 'success' } : held('flowedButNothingSent');
  // Nothing says it moved. Core's own record says it didn't, if that record can't have started afresh since.
  if (out < targetTick && unbrokenSince(live, targetTick)) return { status: 'failed' };
  // Not settled: unknown, looked at again later (not held).
  return { status: 'unknown', note: UNSETTLED_NOTES[evidence.moneyFlew === false ? 'flagOnly' : 'noEvidence'] };
}

function qrSvg(text) {
  const code = QR.QrCode.encodeText(text, QR.QrCode.Ecc.MEDIUM);
  const border = 3; // + the white tile's padding ≈ the 4-module quiet zone scanners expect
  let d = '';
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) if (code.getModule(x, y)) d += `M${x + border} ${y + border}h1v1h-1z`;
  }
  const size = code.size + border * 2;
  return svg('svg', { viewBox: `0 0 ${size} ${size}`, 'shape-rendering': 'crispEdges', role: 'img', 'aria-label': tr('QR code of the address') },
    svg('path', { class: 'mod', d }));
}
