var QubicLib = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // entry.js
  var entry_exports = {};
  __export(entry_exports, {
    SCHNORRQ_ORDER: () => ORDER2,
    argon2idAsync: () => argon2idAsync,
    buildTransaction: () => buildTransaction,
    computeTransactionHash: () => computeTransactionHash,
    decodeTransaction: () => decodeTransaction,
    deriveKeys: () => deriveKeys,
    doubleScalarMult: () => doubleScalarMult2,
    encodeTransaction: () => encodeTransaction,
    generateRandomSeed: () => generateRandomSeed,
    identityToPublicKey: () => identityToPublicKey,
    isOnCurve: () => isOnCurve2,
    isValidIdentityChecksum: () => isValidIdentityChecksum,
    k12: () => k12,
    pointAdd: () => pointAdd2,
    pointDouble: () => pointDouble2,
    pointIdentity: () => pointIdentity2,
    pointMarshal: () => pointMarshal2,
    pointUnmarshal: () => pointUnmarshal2,
    publicKeyToIdentity: () => publicKeyToIdentity,
    scalarBaseMult: () => scalarBaseMult2,
    sign: () => sign2,
    signTransaction: () => signTransaction,
    toR2: () => toR22,
    verify: () => verify2,
    verifyTransactionSignature: () => verifyTransactionSignature
  });

  // node_modules/@qubic.org/crypto/dist/index.js
  var QubicError = class extends Error {
    constructor(message, context) {
      super(message);
      __publicField(this, "context");
      this.name = this.constructor.name;
      if (context !== void 0)
        this.context = context;
      if ("captureStackTrace" in Error) {
        Error.captureStackTrace(this, this.constructor);
      }
    }
  };
  var InvalidIdentityError = class extends QubicError {
    constructor(identity) {
      super(`Invalid identity: expected 60 uppercase letters, got ${identity.length} chars`);
      __publicField(this, "identity");
      __publicField(this, "code", "INVALID_IDENTITY");
      this.identity = identity;
    }
  };
  var InvalidSeedError = class extends QubicError {
    constructor(seed) {
      super("Invalid seed: expected 55 lowercase letters");
      __publicField(this, "seed");
      __publicField(this, "code", "INVALID_SEED");
      this.seed = seed;
    }
  };
  var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
  var _32n = /* @__PURE__ */ BigInt(32);
  function fromBig(n, le = false) {
    if (le)
      return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
    return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
  }
  function split(lst, le = false) {
    const len = lst.length;
    let Ah = new Uint32Array(len);
    let Al = new Uint32Array(len);
    for (let i = 0; i < len; i++) {
      const { h, l } = fromBig(lst[i], le);
      [Ah[i], Al[i]] = [h, l];
    }
    return [Ah, Al];
  }
  var rotlSH = (h, l, s) => h << s | l >>> 32 - s;
  var rotlSL = (h, l, s) => l << s | h >>> 32 - s;
  var rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s;
  var rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;
  function isBytes(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
  }
  function anumber(n, title = "") {
    if (typeof n !== "number") {
      const prefix = title && `"${title}" `;
      throw new TypeError(`${prefix}expected number, got ${typeof n}`);
    }
    if (!Number.isSafeInteger(n) || n < 0) {
      const prefix = title && `"${title}" `;
      throw new RangeError(`${prefix}expected integer >= 0, got ${n}`);
    }
  }
  function abytes(value, length, title = "") {
    const bytes = isBytes(value);
    const len = value?.length;
    const needsLen = length !== void 0;
    if (!bytes || needsLen && len !== length) {
      const prefix = title && `"${title}" `;
      const ofLen = needsLen ? ` of length ${length}` : "";
      const got = bytes ? `length=${len}` : `type=${typeof value}`;
      const message = prefix + "expected Uint8Array" + ofLen + ", got " + got;
      if (!bytes)
        throw new TypeError(message);
      throw new RangeError(message);
    }
    return value;
  }
  function copyBytes(bytes) {
    return Uint8Array.from(abytes(bytes));
  }
  function aexists(instance, checkFinished = true) {
    if (instance.destroyed)
      throw new Error("Hash instance has been destroyed");
    if (checkFinished && instance.finished)
      throw new Error("Hash#digest() has already been called");
  }
  function aoutput(out, instance) {
    abytes(out, void 0, "digestInto() output");
    const min = instance.outputLen;
    if (out.length < min) {
      throw new RangeError('"digestInto() output" expected to be of length >=' + min);
    }
  }
  function u32(arr) {
    return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
  }
  function clean(...arrays) {
    for (let i = 0; i < arrays.length; i++) {
      arrays[i].fill(0);
    }
  }
  var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
  function byteSwap(word) {
    return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
  }
  function byteSwap32(arr) {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = byteSwap(arr[i]);
    }
    return arr;
  }
  var swap32IfBE = isLE ? (u) => u : byteSwap32;
  function createHasher(hashCons, info = {}) {
    const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
    const tmp = hashCons(void 0);
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.canXOF = tmp.canXOF;
    hashC.create = (opts) => hashCons(opts);
    Object.assign(hashC, info);
    return Object.freeze(hashC);
  }
  var _0n = BigInt(0);
  var _1n = BigInt(1);
  var _2n = BigInt(2);
  var _7n = BigInt(7);
  var _256n = BigInt(256);
  var _0x71n = BigInt(113);
  var SHA3_PI = [];
  var SHA3_ROTL = [];
  var _SHA3_IOTA = [];
  for (let round = 0, R = _1n, x = 1, y = 0; round < 24; round++) {
    [x, y] = [y, (2 * x + 3 * y) % 5];
    SHA3_PI.push(2 * (5 * y + x));
    SHA3_ROTL.push((round + 1) * (round + 2) / 2 % 64);
    let t = _0n;
    for (let j = 0; j < 7; j++) {
      R = (R << _1n ^ (R >> _7n) * _0x71n) % _256n;
      if (R & _2n)
        t ^= _1n << (_1n << BigInt(j)) - _1n;
    }
    _SHA3_IOTA.push(t);
  }
  var IOTAS = split(_SHA3_IOTA, true);
  var SHA3_IOTA_H = IOTAS[0];
  var SHA3_IOTA_L = IOTAS[1];
  var rotlH = (h, l, s) => s > 32 ? rotlBH(h, l, s) : rotlSH(h, l, s);
  var rotlL = (h, l, s) => s > 32 ? rotlBL(h, l, s) : rotlSL(h, l, s);
  function keccakP(s, rounds = 24) {
    anumber(rounds, "rounds");
    if (rounds < 1 || rounds > 24)
      throw new Error('"rounds" expected integer 1..24');
    const B = new Uint32Array(5 * 2);
    for (let round = 24 - rounds; round < 24; round++) {
      for (let x = 0; x < 10; x++)
        B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
      for (let x = 0; x < 10; x += 2) {
        const idx1 = (x + 8) % 10;
        const idx0 = (x + 2) % 10;
        const B0 = B[idx0];
        const B1 = B[idx0 + 1];
        const Th = rotlH(B0, B1, 1) ^ B[idx1];
        const Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];
        for (let y = 0; y < 50; y += 10) {
          s[x + y] ^= Th;
          s[x + y + 1] ^= Tl;
        }
      }
      let curH = s[2];
      let curL = s[3];
      for (let t = 0; t < 24; t++) {
        const shift = SHA3_ROTL[t];
        const Th = rotlH(curH, curL, shift);
        const Tl = rotlL(curH, curL, shift);
        const PI = SHA3_PI[t];
        curH = s[PI];
        curL = s[PI + 1];
        s[PI] = Th;
        s[PI + 1] = Tl;
      }
      for (let y = 0; y < 50; y += 10) {
        const b0 = s[y], b1 = s[y + 1], b2 = s[y + 2], b3 = s[y + 3];
        s[y] ^= ~s[y + 2] & s[y + 4];
        s[y + 1] ^= ~s[y + 3] & s[y + 5];
        s[y + 2] ^= ~s[y + 4] & s[y + 6];
        s[y + 3] ^= ~s[y + 5] & s[y + 7];
        s[y + 4] ^= ~s[y + 6] & s[y + 8];
        s[y + 5] ^= ~s[y + 7] & s[y + 9];
        s[y + 6] ^= ~s[y + 8] & b0;
        s[y + 7] ^= ~s[y + 9] & b1;
        s[y + 8] ^= ~b0 & b2;
        s[y + 9] ^= ~b1 & b3;
      }
      s[0] ^= SHA3_IOTA_H[round];
      s[1] ^= SHA3_IOTA_L[round];
    }
    clean(B);
  }
  var Keccak = class _Keccak {
    constructor(blockLen, suffix, outputLen, enableXOF = false, rounds = 24) {
      __publicField(this, "state");
      __publicField(this, "pos", 0);
      __publicField(this, "posOut", 0);
      __publicField(this, "finished", false);
      __publicField(this, "state32");
      __publicField(this, "destroyed", false);
      __publicField(this, "blockLen");
      __publicField(this, "suffix");
      __publicField(this, "outputLen");
      __publicField(this, "canXOF");
      __publicField(this, "enableXOF", false);
      __publicField(this, "rounds");
      this.blockLen = blockLen;
      this.suffix = suffix;
      this.outputLen = outputLen;
      this.enableXOF = enableXOF;
      this.canXOF = enableXOF;
      this.rounds = rounds;
      anumber(outputLen, "outputLen");
      if (!(0 < blockLen && blockLen < 200))
        throw new Error("only keccak-f1600 function is supported");
      this.state = new Uint8Array(200);
      this.state32 = u32(this.state);
    }
    clone() {
      return this._cloneInto();
    }
    keccak() {
      swap32IfBE(this.state32);
      keccakP(this.state32, this.rounds);
      swap32IfBE(this.state32);
      this.posOut = 0;
      this.pos = 0;
    }
    update(data) {
      aexists(this);
      abytes(data);
      const { blockLen, state } = this;
      const len = data.length;
      for (let pos = 0; pos < len; ) {
        const take = Math.min(blockLen - this.pos, len - pos);
        for (let i = 0; i < take; i++)
          state[this.pos++] ^= data[pos++];
        if (this.pos === blockLen)
          this.keccak();
      }
      return this;
    }
    finish() {
      if (this.finished)
        return;
      this.finished = true;
      const { state, suffix, pos, blockLen } = this;
      state[pos] ^= suffix;
      if ((suffix & 128) !== 0 && pos === blockLen - 1)
        this.keccak();
      state[blockLen - 1] ^= 128;
      this.keccak();
    }
    writeInto(out) {
      aexists(this, false);
      abytes(out);
      this.finish();
      const bufferOut = this.state;
      const { blockLen } = this;
      for (let pos = 0, len = out.length; pos < len; ) {
        if (this.posOut >= blockLen)
          this.keccak();
        const take = Math.min(blockLen - this.posOut, len - pos);
        out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
        this.posOut += take;
        pos += take;
      }
      return out;
    }
    xofInto(out) {
      if (!this.enableXOF)
        throw new Error("XOF is not possible for this instance");
      return this.writeInto(out);
    }
    xof(bytes) {
      anumber(bytes);
      return this.xofInto(new Uint8Array(bytes));
    }
    digestInto(out) {
      aoutput(out, this);
      if (this.finished)
        throw new Error("digest() was already called");
      this.writeInto(out.subarray(0, this.outputLen));
      this.destroy();
    }
    digest() {
      const out = new Uint8Array(this.outputLen);
      this.digestInto(out);
      return out;
    }
    destroy() {
      this.destroyed = true;
      clean(this.state);
    }
    _cloneInto(to) {
      const { blockLen, suffix, outputLen, rounds, enableXOF } = this;
      to || (to = new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds));
      to.blockLen = blockLen;
      to.state32.set(this.state32);
      to.pos = this.pos;
      to.posOut = this.posOut;
      to.finished = this.finished;
      to.rounds = rounds;
      to.suffix = suffix;
      to.outputLen = outputLen;
      to.enableXOF = enableXOF;
      to.canXOF = this.canXOF;
      to.destroyed = this.destroyed;
      return to;
    }
  };
  var _8n = /* @__PURE__ */ BigInt(8);
  var _ffn = /* @__PURE__ */ BigInt(255);
  function chooseLen(opts, outputLen) {
    return opts.dkLen === void 0 ? outputLen : opts.dkLen;
  }
  function rightEncodeK12(n) {
    n = BigInt(n);
    const res = [];
    for (; n > 0; n >>= _8n)
      res.unshift(Number(n & _ffn));
    res.push(res.length);
    return Uint8Array.from(res);
  }
  var EMPTY_BUFFER = /* @__PURE__ */ Uint8Array.of();
  var _KangarooTwelve = class __KangarooTwelve extends Keccak {
    constructor(blockLen, leafLen, outputLen, rounds, opts) {
      super(blockLen, 7, outputLen, true, rounds);
      __publicField(this, "chunkLen", 8192);
      __publicField(this, "leafHash");
      __publicField(this, "leafLen");
      __publicField(this, "personalization");
      __publicField(this, "chunkPos", 0);
      __publicField(this, "chunksDone", 0);
      if (outputLen < 1)
        throw new Error('"dkLen" must be >= 1');
      this.leafLen = leafLen;
      this.personalization = opts.personalization === void 0 ? EMPTY_BUFFER : copyBytes(abytes(opts.personalization, void 0, "personalization"));
    }
    update(data) {
      abytes(data);
      const { chunkLen, blockLen, leafLen, rounds } = this;
      for (let pos = 0, len = data.length; pos < len; ) {
        if (this.chunkPos == chunkLen) {
          if (this.leafHash)
            super.update(this.leafHash.digest());
          else {
            this.suffix = 6;
            super.update(Uint8Array.from([3, 0, 0, 0, 0, 0, 0, 0]));
          }
          this.leafHash = new Keccak(blockLen, 11, leafLen, false, rounds);
          this.chunksDone++;
          this.chunkPos = 0;
        }
        const take = Math.min(chunkLen - this.chunkPos, len - pos);
        const chunk = data.subarray(pos, pos + take);
        if (this.leafHash)
          this.leafHash.update(chunk);
        else
          super.update(chunk);
        this.chunkPos += take;
        pos += take;
      }
      return this;
    }
    finish() {
      if (this.finished)
        return;
      const { personalization } = this;
      this.update(personalization).update(rightEncodeK12(personalization.length));
      if (this.leafHash) {
        super.update(this.leafHash.digest());
        super.update(rightEncodeK12(this.chunksDone));
        super.update(Uint8Array.from([255, 255]));
      }
      super.finish.call(this);
    }
    destroy() {
      super.destroy.call(this);
      if (this.leafHash)
        this.leafHash.destroy();
      if (this.personalization !== EMPTY_BUFFER)
        clean(this.personalization);
      this.personalization = EMPTY_BUFFER;
    }
    _cloneInto(to) {
      const { blockLen, leafLen, leafHash, outputLen, rounds } = this;
      const personalization = this.personalization === EMPTY_BUFFER ? EMPTY_BUFFER : copyBytes(this.personalization);
      to || (to = new __KangarooTwelve(blockLen, leafLen, outputLen, rounds, {
        personalization
      }));
      super._cloneInto(to);
      if (leafHash)
        to.leafHash = leafHash._cloneInto(to.leafHash);
      else if (to.leafHash) {
        to.leafHash.destroy();
        to.leafHash = void 0;
      }
      to.personalization = personalization;
      to.leafLen = this.leafLen;
      to.chunkPos = this.chunkPos;
      to.chunksDone = this.chunksDone;
      return to;
    }
    clone() {
      return this._cloneInto();
    }
  };
  var kt128 = /* @__PURE__ */ createHasher((opts = {}) => new _KangarooTwelve(168, 32, chooseLen(opts, 32), 12, opts));
  function k12(input, outputLength = 32) {
    return kt128(input, { dkLen: outputLength });
  }
  function getRandomBytes(length) {
    if (length <= 0)
      throw new RangeError("Random byte length must be greater than 0");
    const array = new Uint8Array(length);
    globalThis.crypto.getRandomValues(array);
    return array;
  }
  function generateRandomSeed() {
    const ALPHABET_SIZE = 26;
    const REJECT_THRESHOLD = 256 - 256 % ALPHABET_SIZE;
    let seed = "";
    while (seed.length < 55) {
      const bytes = getRandomBytes(Math.ceil((55 - seed.length) * 1.1 + 8));
      for (const byte of bytes) {
        if (byte >= REJECT_THRESHOLD)
          continue;
        seed += String.fromCharCode(97 + byte % ALPHABET_SIZE);
        if (seed.length === 55)
          break;
      }
    }
    if (seed.length !== 55 || !/^[a-z]+$/.test(seed)) {
      throw new InvalidSeedError(seed);
    }
    return seed;
  }
  var PARAM_D = [
    0x00000000000000e40000000000000142n,
    0x5e472f846657e0fcb3821488f1fc0c8dn
  ];
  var GENERATOR_X = [
    0x1a3472237c2fb305286592ad7b3833aan,
    0x1e1f553f2878aa9c96869fb360ac77f6n
  ];
  var GENERATOR_Y = [
    0x0e3fee9ba120785ab924a2462bcbb287n,
    0x6e1c4af8630e024249a7c344844c8b5cn
  ];
  var SIZE_FP = 16;
  var P = (1n << 127n) - 1n;
  function fpMod(a) {
    let res = a % P;
    res += P & res >> 127n;
    return res;
  }
  function fpAdd(a, b) {
    return fpMod(a + b);
  }
  function fpSub(a, b) {
    return fpMod(a - b);
  }
  function fpMul(a, b) {
    return fpMod(a * b);
  }
  function fpSqr(a) {
    return fpMod(a * a);
  }
  function fpNeg(a) {
    return fpMod(P - a);
  }
  function fpInv(a) {
    if (fpMod(a) === 0n)
      throw new Error("invert: expected non-zero number");
    const t = fpTwo1251(a);
    let res = t;
    res = fpSqr(res);
    res = fpSqr(res);
    return fpMul(res, a);
  }
  function fpSgn(a) {
    const v = fpMod(a);
    const nonZero = (v | -v) >> 126n & 1n;
    const negative = v >> 126n & 1n;
    return Number(nonZero * (1n - (negative << 1n)));
  }
  function fpHlf(a) {
    const v = fpMod(a);
    const carry = -(v & 1n);
    return v + (P & carry) >> 1n;
  }
  function fpCmov(a, b, flag) {
    const mask = -BigInt(flag & 1);
    return a & ~mask | b & mask;
  }
  function fpTwo1251(a) {
    let t2 = fpSqr(a);
    t2 = fpMul(t2, a);
    let t3 = fpSqr(fpSqr(t2));
    t3 = fpMul(t3, t2);
    let t4 = fpSqr(fpSqr(fpSqr(fpSqr(t3))));
    t4 = fpMul(t4, t3);
    let t5 = fpSqr(t4);
    for (let i = 0; i < 7; i++)
      t5 = fpSqr(t5);
    t5 = fpMul(t5, t4);
    let tt2 = fpSqr(t5);
    for (let i = 0; i < 15; i++)
      tt2 = fpSqr(tt2);
    tt2 = fpMul(tt2, t5);
    let t1 = fpSqr(tt2);
    for (let i = 0; i < 31; i++)
      t1 = fpSqr(t1);
    t1 = fpMul(t1, tt2);
    for (let i = 0; i < 32; i++)
      t1 = fpSqr(t1);
    t1 = fpMul(tt2, t1);
    for (let i = 0; i < 16; i++)
      t1 = fpSqr(t1);
    t1 = fpMul(t1, t5);
    for (let i = 0; i < 8; i++)
      t1 = fpSqr(t1);
    t1 = fpMul(t1, t4);
    for (let i = 0; i < 4; i++)
      t1 = fpSqr(t1);
    t1 = fpMul(t1, t3);
    t1 = fpSqr(t1);
    return fpMul(a, t1);
  }
  function fpToBytes(a) {
    const v = fpMod(a);
    const buf = new Uint8Array(SIZE_FP);
    let tmp = v;
    for (let i = 0; i < SIZE_FP; i++) {
      buf[i] = Number(tmp & 0xffn);
      tmp >>= 8n;
    }
    return buf;
  }
  function fpFromBytes(buf) {
    if (buf.length !== SIZE_FP)
      return null;
    if (buf[SIZE_FP - 1] >> 7 !== 0)
      return null;
    let v = 0n;
    for (let i = SIZE_FP - 1; i >= 0; i--) {
      v = v << 8n | BigInt(buf[i]);
    }
    return fpMod(v);
  }
  function fqSgn(a) {
    const s0 = fpSgn(a[0]);
    const s1 = fpSgn(a[1]);
    const useS0 = BigInt(s0 * s0);
    return Number(BigInt(s0) * useS0 + BigInt(s1) * (1n - useS0));
  }
  function fqZero() {
    return [0n, 0n];
  }
  function fqOne() {
    return [1n, 0n];
  }
  function fqCopy(a) {
    return [a[0], a[1]];
  }
  function fqIsZero(a) {
    return (fpMod(a[0]) | fpMod(a[1])) === 0n;
  }
  function fqAdd(a, b) {
    return [fpAdd(a[0], b[0]), fpAdd(a[1], b[1])];
  }
  function fqSub(a, b) {
    return [fpSub(a[0], b[0]), fpSub(a[1], b[1])];
  }
  function fqMul(a, b) {
    const t1 = fpMul(a[0], b[0]);
    const t2 = fpMul(a[1], b[1]);
    const t3 = fpAdd(a[0], a[1]);
    const t4 = fpAdd(b[0], b[1]);
    let t5 = fpMul(t3, t4);
    t5 = fpSub(t5, t1);
    t5 = fpSub(t5, t2);
    const t6 = fpSub(t1, t2);
    return [t6, t5];
  }
  function fqSqr(a) {
    const t1 = fpAdd(a[0], a[1]);
    const t2 = fpSub(a[0], a[1]);
    const t3 = fpAdd(a[0], a[0]);
    return [fpMul(t1, t2), fpMul(t3, a[1])];
  }
  function fqNeg(a) {
    return [fpNeg(a[0]), fpNeg(a[1])];
  }
  function fqInv(a) {
    const t1 = fpSqr(a[0]);
    const t2 = fpSqr(a[1]);
    const norm = fpAdd(t1, t2);
    const invNorm = fpInv(norm);
    return [fpMul(a[0], invNorm), fpMul(a[1], fpNeg(invNorm))];
  }
  function fqSqrt(u, v, s) {
    const a = fpAdd(fpMul(u[0], v[0]), fpMul(u[1], v[1]));
    const b = fpAdd(fpSqr(v[0]), fpSqr(v[1]));
    const g = fpSub(fpMul(u[1], v[0]), fpMul(u[0], v[1]));
    let t0 = fpAdd(fpSqr(a), fpSqr(g));
    for (let i = 0; i < 125; i++)
      t0 = fpSqr(t0);
    let t = fpAdd(a, t0);
    const tMod = fpMod(t);
    t = fpCmov(t, fpSub(a, t0), 1 - Number((tMod | -tMod) >> 126n & 1n));
    t = fpAdd(t, t);
    let r = fpMul(fpMul(fpSqr(b), b), t);
    r = fpTwo1251(r);
    const rb = fpMul(r, b);
    const c1Mag = fpMul(rb, g);
    const c0Mag = fpHlf(fpMul(rb, t));
    const x02Sqr = fpSqr(fpAdd(c0Mag, c0Mag));
    const check = fpSub(fpMul(b, x02Sqr), t);
    const checkMod = fpMod(check);
    const swapFlag = Number((checkMod | -checkMod) >> 126n & 1n);
    let result = [fpCmov(c0Mag, c1Mag, swapFlag), fpCmov(c1Mag, c0Mag, swapFlag)];
    const negFlag = 1 - fqSgn(result) * s >> 1;
    result = fqCmov(result, fqNeg(result), negFlag);
    return result;
  }
  function fqCmov(a, b, flag) {
    const mask = -BigInt(flag & 1);
    const invMask = ~mask;
    return [a[0] & invMask | b[0] & mask, a[1] & invMask | b[1] & mask];
  }
  function fqToBytes(a) {
    const buf = new Uint8Array(SIZE_FP * 2);
    buf.set(fpToBytes(a[0]), 0);
    buf.set(fpToBytes(a[1]), SIZE_FP);
    return buf;
  }
  function fqFromBytes(buf) {
    if (buf.length !== SIZE_FP * 2)
      return null;
    const a0 = fpFromBytes(buf.slice(0, SIZE_FP));
    const a1 = fpFromBytes(buf.slice(SIZE_FP));
    if (a0 === null || a1 === null)
      return null;
    return [a0, a1];
  }
  var ORDER_GENERATOR = [
    0x2fb2540ec7768ce7n,
    0xdfbd004dfe0f7999n,
    0xf05397829cbc14e5n,
    0x0029cbc14e5e0a72n
  ];
  function pointIdentity() {
    return { X: fqZero(), Y: fqOne(), Z: fqOne(), Ta: fqZero(), Tb: fqZero() };
  }
  function pointGenerator() {
    return {
      X: fqCopy(GENERATOR_X),
      Y: fqCopy(GENERATOR_Y),
      Z: fqOne(),
      Ta: fqCopy(GENERATOR_X),
      Tb: fqCopy(GENERATOR_Y)
    };
  }
  function pointCopy(P22) {
    return {
      X: fqCopy(P22.X),
      Y: fqCopy(P22.Y),
      Z: fqCopy(P22.Z),
      Ta: fqCopy(P22.Ta),
      Tb: fqCopy(P22.Tb)
    };
  }
  function pointDouble(P22) {
    const a = fqSqr(P22.X);
    const b = fqSqr(P22.Y);
    const c = fqSqr(P22.Z);
    const c2 = fqAdd(c, c);
    const d = fqAdd(a, b);
    const xplusySqr = fqSqr(fqAdd(P22.X, P22.Y));
    const e = fqSub(xplusySqr, d);
    const f = fqSub(b, a);
    const g = fqSub(c2, f);
    return { X: fqMul(e, g), Y: fqMul(d, f), Z: fqMul(f, g), Ta: d, Tb: e };
  }
  function pointAdd(P22, Q) {
    const cc = fqMul(P22.Ta, P22.Tb);
    const h = fqSub(P22.Y, P22.X);
    const bb = fqAdd(P22.Y, P22.X);
    const a = fqMul(h, Q.subYX);
    const bv = fqMul(bb, Q.addYX);
    const e = fqSub(bv, a);
    const hh = fqAdd(bv, a);
    const dd = fqMul(P22.Z, Q.z2);
    const c2 = fqMul(cc, Q.dt2);
    const f = fqSub(dd, c2);
    const g = fqAdd(dd, c2);
    return { X: fqMul(e, f), Y: fqMul(g, hh), Z: fqMul(f, g), Ta: e, Tb: hh };
  }
  function toR2(P22) {
    const t = fqMul(P22.Ta, P22.Tb);
    const dt = fqMul(t, PARAM_D);
    const dt2 = fqAdd(dt, dt);
    return { addYX: fqAdd(P22.Y, P22.X), subYX: fqSub(P22.Y, P22.X), z2: fqAdd(P22.Z, P22.Z), dt2 };
  }
  function r3Cmov(a, b, flag) {
    return {
      addYX: fqCmov(a.addYX, b.addYX, flag),
      subYX: fqCmov(a.subYX, b.subYX, flag),
      dt2: fqCmov(a.dt2, b.dt2, flag)
    };
  }
  function r3Cneg(P22, flag) {
    const tAddYX = fqCopy(P22.addYX);
    const tSubYX = fqCopy(P22.subYX);
    const tNegDt2 = fqNeg(P22.dt2);
    return {
      addYX: fqCmov(tAddYX, tSubYX, flag),
      subYX: fqCmov(tSubYX, tAddYX, flag),
      dt2: fqCmov(P22.dt2, tNegDt2, flag)
    };
  }
  function r2Cmov(a, b, flag) {
    const r3 = r3Cmov(a, b, flag);
    return { ...r3, z2: fqCmov(a.z2, b.z2, flag) };
  }
  function r2Cneg(P22, flag) {
    const r3 = r3Cneg(P22, flag);
    return { ...r3, z2: fqCopy(P22.z2) };
  }
  function toAffine(P22) {
    const zInv = fqInv(P22.Z);
    const X = fqMul(P22.X, zInv);
    const Y = fqMul(P22.Y, zInv);
    return { X, Y, Z: fqOne(), Ta: fqCopy(X), Tb: fqCopy(Y) };
  }
  function add64(a, b, carry) {
    const sum = a + b + carry;
    return [sum & MASK64, sum >> 64n];
  }
  function sub64(a, b, borrow) {
    const res = a - b - borrow;
    return [res & MASK64, res >> 64n & 1n];
  }
  var MASK64 = 0xffffffffffffffffn;
  function condAddOrderN(x) {
    const mask = (x[0] & 1n) - 1n;
    let carry = 0n;
    for (let i = 0; i < 4; i++) {
      const addend = ORDER_GENERATOR[i] & mask;
      const [res, nextCarry] = add64(x[i], addend, carry);
      x[i] = res;
      carry = nextCarry;
    }
    const [res4] = add64(x[4], 0n, carry);
    x[4] = res4;
  }
  function subYDiv16(x, y) {
    const yBig = BigInt(y);
    const s = yBig >> 63n & MASK64;
    const [r0, b0] = sub64(x[0], yBig & MASK64, 0n);
    const [r1, b1] = sub64(x[1], s, b0);
    const [r2, b2] = sub64(x[2], s, b1);
    const [r3, b3] = sub64(x[3], s, b2);
    const [r4] = sub64(x[4], s, b3);
    x[0] = r0 >> 4n | r1 << 60n;
    x[1] = r1 >> 4n | r2 << 60n;
    x[2] = r2 >> 4n | r3 << 60n;
    x[3] = r3 >> 4n | r4 << 60n;
    x[4] = r4 >> 4n;
  }
  function recodeScalar(k) {
    const d = new Int8Array(65);
    const m = new BigUint64Array(5);
    const view = new DataView(k.buffer, k.byteOffset, 32);
    m[0] = view.getBigUint64(0, true);
    m[1] = view.getBigUint64(8, true);
    m[2] = view.getBigUint64(16, true);
    m[3] = view.getBigUint64(24, true);
    condAddOrderN(m);
    for (let i = 0; i < 64; i++) {
      d[i] = Number((m[0] & 0x1fn) - 16n);
      subYDiv16(m, d[i]);
    }
    d[64] = Number((m[0] & 0xffn ^ 0x80n) - 0x80n);
    return d;
  }
  function scalarBaseMult(scalar) {
    return scalarMult(scalar, pointGenerator());
  }
  function oddMultiples(Q) {
    let p2 = pointCopy(Q);
    p2 = pointDouble(p2);
    const pp2 = toR2(p2);
    const T = [toR2(Q)];
    let R = pointCopy(Q);
    for (let i = 1; i < 8; i++) {
      R = pointAdd(R, pp2);
      T.push(toR2(R));
    }
    return T;
  }
  function scalarMult(k, Q) {
    const tabQ = oddMultiples(Q);
    const d = recodeScalar(k);
    let P22 = pointIdentity();
    for (let i = 64; i >= 0; i--) {
      P22 = pointDouble(P22);
      P22 = pointDouble(P22);
      P22 = pointDouble(P22);
      P22 = pointDouble(P22);
      const di = d[i];
      const mask = di >> 7;
      const absDi = di + mask ^ mask;
      const inx = absDi - 1 >> 1;
      const sig = di >> 7 & 1;
      let S = { addYX: fqZero(), subYX: fqZero(), dt2: fqZero(), z2: fqZero() };
      for (let j = 0; j < 8; j++) {
        S = r2Cmov(S, tabQ[j], Number(BigInt(inx ^ j) - 1n >> 63n & 1n));
      }
      S = r2Cneg(S, sig);
      P22 = pointAdd(P22, S);
    }
    return P22;
  }
  function doubleScalarMult(k1, Q, k2) {
    const P1 = scalarBaseMult(k1);
    const P22 = scalarMult(k2, Q);
    const Q2 = toR2(P22);
    return pointAdd(P1, Q2);
  }
  function pointMarshal(P22) {
    const aff = toAffine(P22);
    const out = fqToBytes(aff.Y);
    const s = fqSgn(aff.X);
    const b = 1 - s >> 1;
    out[31] = out[31] | b << 7;
    return out;
  }
  function pointUnmarshal(input) {
    const buf = new Uint8Array(input);
    const s = buf[31] >> 7;
    buf[31] = buf[31] & 127;
    const Y = fqFromBytes(buf);
    if (Y === null)
      return null;
    const one = fqOne();
    const t0 = fqSqr(Y);
    const t1pre = fqMul(t0, PARAM_D);
    const u = fqSub(t0, one);
    const v = fqAdd(t1pre, one);
    const X = fqSqrt(u, v, 1 - 2 * s);
    const P22 = { X, Y, Z: fqOne(), Ta: fqCopy(X), Tb: fqCopy(Y) };
    const curveFlag = Number(isOnCurve(P22));
    const flippedX = [P22.X[0], fpNeg(P22.X[1])];
    P22.X = fqCmov(flippedX, P22.X, curveFlag);
    P22.Ta = fqCopy(P22.X);
    P22.Tb = fqCopy(P22.Y);
    return P22;
  }
  function isOnCurve(P22) {
    const t0 = fqAdd(P22.Y, P22.X);
    let lhs = fqSub(P22.Y, P22.X);
    lhs = fqMul(lhs, t0);
    let rhs = fqMul(P22.X, P22.Y);
    rhs = fqSqr(rhs);
    rhs = fqMul(rhs, PARAM_D);
    const one = fqOne();
    rhs = fqAdd(rhs, one);
    const diff = fqSub(lhs, rhs);
    return fqIsZero(diff);
  }
  var SEED_LENGTH = 55;
  var IDENTITY_LENGTH = 60;
  function deriveKeys(seed) {
    if (seed.length !== SEED_LENGTH || !/^[a-z]+$/.test(seed)) {
      throw new InvalidSeedError(seed);
    }
    const seedBytes = new Uint8Array(SEED_LENGTH);
    for (let i = 0; i < SEED_LENGTH; i++) {
      seedBytes[i] = seed.charCodeAt(i) - 97;
    }
    const subseed = k12(seedBytes, 32);
    const privateKey = k12(subseed, 32);
    const publicKey = pointMarshal(scalarBaseMult(privateKey));
    return { subseed, privateKey, publicKey };
  }
  function publicKeyToIdentity(publicKey) {
    if (publicKey.byteLength !== 32) {
      throw new InvalidIdentityError("Public keys must be exactly 32 bytes");
    }
    const identity = new Uint16Array(IDENTITY_LENGTH);
    const view = new DataView(publicKey.buffer, publicKey.byteOffset, 32);
    for (let fragmentIndex = 0; fragmentIndex < 4; fragmentIndex++) {
      let fragment = view.getBigUint64(fragmentIndex * 8, true);
      for (let digitIndex = 0; digitIndex < 14; digitIndex++) {
        identity[fragmentIndex * 14 + digitIndex] = Number(fragment % 26n) + 65;
        fragment /= 26n;
      }
    }
    const checksum = encodeChecksum(publicKey);
    for (let i = 0; i < 4; i++) {
      identity[56 + i] = checksum[i];
    }
    return String.fromCharCode(...identity);
  }
  function identityToPublicKey(identity) {
    if (identity.length !== IDENTITY_LENGTH || !/^[A-Z]+$/.test(identity)) {
      throw new InvalidIdentityError(identity);
    }
    const publicKey = new Uint8Array(32);
    const view = new DataView(publicKey.buffer);
    for (let fragmentIndex = 0; fragmentIndex < 4; fragmentIndex++) {
      let fragment = 0n;
      for (let digitIndex = 13; digitIndex >= 0; digitIndex--) {
        const charCode = identity.charCodeAt(fragmentIndex * 14 + digitIndex);
        fragment = fragment * 26n + BigInt(charCode - 65);
      }
      view.setBigUint64(fragmentIndex * 8, fragment, true);
    }
    const expectedChecksum = encodeChecksum(publicKey);
    for (let i = 0; i < 4; i++) {
      if (identity.charCodeAt(56 + i) !== expectedChecksum[i]) {
        throw new InvalidIdentityError(identity);
      }
    }
    return publicKey;
  }
  function isValidIdentityChecksum(identity) {
    try {
      identityToPublicKey(identity);
      return true;
    } catch {
      return false;
    }
  }
  function encodeChecksum(publicKey) {
    const checksumBytes = k12(publicKey, 3);
    let checksum = BigInt(checksumBytes[0]) | BigInt(checksumBytes[1]) << 8n | BigInt(checksumBytes[2]) << 16n;
    checksum &= 0x3ffffn;
    const output = new Array(4);
    for (let i = 0; i < 4; i++) {
      output[i] = Number(checksum % 26n) + 65;
      checksum /= 26n;
    }
    return output;
  }
  var ORDER = 0x0029cbc14e5e0a72f05397829cbc14e5dfbd004dfe0f79992fb2540ec7768ce7n;
  function k12Hash64(data) {
    return k12(data, 64);
  }
  function bytesToBigIntLE(bytes) {
    let res = 0n;
    for (let i = bytes.length - 1; i >= 0; i--) {
      res = res << 8n | BigInt(bytes[i]);
    }
    return res;
  }
  function bigIntToBytes(n) {
    const res = new Uint8Array(32);
    let temp = n;
    for (let i = 0; i < 32; i++) {
      res[i] = Number(temp & 0xffn);
      temp >>= 8n;
    }
    return res;
  }
  function sign(subSeed, publicKey, messageDigest) {
    const subSeedHash = k12Hash64(subSeed);
    const temp = new Uint8Array(64);
    temp.set(subSeedHash.slice(32, 64), 0);
    temp.set(messageDigest, 32);
    const tempHash = k12Hash64(temp);
    const rScalarBytes = tempHash.slice(0, 32);
    const rValue = bytesToBigIntLE(rScalarBytes) % ORDER;
    const pointR = scalarBaseMult(rScalarBytes);
    const pointREncoding = pointMarshal(pointR);
    const finalTemp = new Uint8Array(96);
    finalTemp.set(pointREncoding, 0);
    finalTemp.set(publicKey, 32);
    finalTemp.set(messageDigest, 64);
    const finalHash = k12Hash64(finalTemp);
    const kValue = bytesToBigIntLE(finalHash.slice(0, 32)) % ORDER;
    const aValue = bytesToBigIntLE(subSeedHash.slice(0, 32)) % ORDER;
    let sValue = (rValue - kValue * aValue % ORDER) % ORDER;
    sValue += ORDER & sValue >> 255n;
    const signature = new Uint8Array(64);
    signature.set(pointREncoding, 0);
    signature.set(bigIntToBytes(sValue), 32);
    return signature;
  }
  function verify(publicKey, messageDigest, signature) {
    if ((publicKey[15] & 128) !== 0 || (signature[15] & 128) !== 0) {
      return false;
    }
    const pointREncoding = signature.slice(0, 32);
    const sBytes = signature.slice(32, 64);
    const sValue = bytesToBigIntLE(sBytes);
    if (sValue >= ORDER)
      return false;
    const pointPK = pointUnmarshal(publicKey);
    if (pointPK === null)
      return false;
    const temp = new Uint8Array(96);
    temp.set(pointREncoding, 0);
    temp.set(publicKey, 32);
    temp.set(messageDigest, 64);
    const finalHash = k12Hash64(temp);
    const hScalarBytes = finalHash.slice(0, 32);
    const resultPoint = doubleScalarMult(sBytes, pointPK, hScalarBytes);
    const resultEncoding = pointMarshal(resultPoint);
    let diff = 0;
    for (let i = 0; i < 32; i++) {
      diff |= resultEncoding[i] ^ pointREncoding[i];
    }
    return diff === 0;
  }
  async function sign2(message, seed) {
    const { subseed, publicKey } = deriveKeys(seed);
    return sign(subseed, publicKey, message);
  }
  function verify2(message, signature, publicKey) {
    return verify(publicKey, message, signature);
  }

  // node_modules/@qubic.org/tx/dist/binary-reader.js
  var BinaryReader = class {
    constructor(bytes) {
      __publicField(this, "bytes");
      __publicField(this, "view");
      __publicField(this, "offset", 0);
      this.bytes = bytes;
      this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    require(n) {
      if (this.offset + n > this.bytes.byteLength)
        throw new RangeError(`BinaryReader: need ${n} byte(s) at offset ${this.offset}, only ${this.remaining} remaining`);
    }
    readUint8() {
      this.require(1);
      const v = this.view.getUint8(this.offset);
      this.offset += 1;
      return v;
    }
    readUint16() {
      this.require(2);
      const v = this.view.getUint16(this.offset, true);
      this.offset += 2;
      return v;
    }
    readUint32() {
      this.require(4);
      const v = this.view.getUint32(this.offset, true);
      this.offset += 4;
      return v;
    }
    readInt64() {
      this.require(8);
      const v = this.view.getBigInt64(this.offset, true);
      this.offset += 8;
      return v;
    }
    readUint64() {
      this.require(8);
      const v = this.view.getBigUint64(this.offset, true);
      this.offset += 8;
      return v;
    }
    readBytes(n) {
      this.require(n);
      const slice = this.bytes.slice(this.offset, this.offset + n);
      this.offset += n;
      return slice;
    }
    get bytesRead() {
      return this.offset;
    }
    get remaining() {
      return this.bytes.byteLength - this.offset;
    }
  };

  // node_modules/@qubic.org/tx/dist/binary-writer.js
  var BinaryWriter = class {
    constructor(size) {
      __publicField(this, "buf");
      __publicField(this, "view");
      __publicField(this, "offset", 0);
      this.buf = new Uint8Array(size);
      this.view = new DataView(this.buf.buffer);
    }
    require(n) {
      if (this.offset + n > this.buf.byteLength)
        throw new RangeError(`BinaryWriter: need ${n} byte(s) at offset ${this.offset}, only ${this.buf.byteLength - this.offset} remaining`);
    }
    writeUint8(v) {
      this.require(1);
      this.view.setUint8(this.offset, v);
      this.offset += 1;
    }
    writeUint16(v) {
      this.require(2);
      this.view.setUint16(this.offset, v, true);
      this.offset += 2;
    }
    writeUint32(v) {
      this.require(4);
      this.view.setUint32(this.offset, v, true);
      this.offset += 4;
    }
    writeInt64(v) {
      this.require(8);
      this.view.setBigInt64(this.offset, v, true);
      this.offset += 8;
    }
    writeUint64(v) {
      this.require(8);
      this.view.setBigUint64(this.offset, v, true);
      this.offset += 8;
    }
    writeBytes(v) {
      this.require(v.byteLength);
      this.buf.set(v, this.offset);
      this.offset += v.byteLength;
    }
    getBytes() {
      return this.buf.slice(0, this.offset);
    }
    get bytesWritten() {
      return this.offset;
    }
  };

  // node_modules/@qubic.org/types/dist/errors.js
  var QubicError2 = class extends Error {
    constructor(message, context) {
      super(message);
      __publicField(this, "context");
      this.name = this.constructor.name;
      if (context !== void 0)
        this.context = context;
      if ("captureStackTrace" in Error) {
        ;
        Error.captureStackTrace(this, this.constructor);
      }
    }
  };
  var InvalidIdentityError2 = class extends QubicError2 {
    constructor(identity) {
      super(`Invalid identity: expected 60 uppercase letters, got ${identity.length} chars`);
      __publicField(this, "identity");
      __publicField(this, "code", "INVALID_IDENTITY");
      this.identity = identity;
    }
  };
  var InvalidBase64Error = class extends QubicError2 {
    constructor(value) {
      super("Invalid base64 string");
      __publicField(this, "value");
      __publicField(this, "code", "INVALID_BASE64");
      this.value = value;
    }
  };

  // node_modules/@qubic.org/types/dist/brands.js
  function toBase64(s) {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0)
      throw new InvalidBase64Error(s);
    return s;
  }
  function isIdentity(s) {
    return s.length === 60 && /^[A-Z]+$/.test(s);
  }

  // node_modules/@qubic.org/types/dist/constants.js
  var PROTOCOL = {
    MAX_INPUT_SIZE: 1024,
    TX_HEADER_SIZE: 80,
    SIGNATURE_SIZE: 64,
    PUBLIC_KEY_SIZE: 32,
    IDENTITY_LENGTH: 60,
    SEED_LENGTH: 55,
    TX_HASH_LENGTH: 60,
    /** Total number of computors in the network. */
    NUMBER_OF_COMPUTORS: 676,
    /** Quorum threshold: 2/3 + 1 of computors. */
    QUORUM: 451,
    /** Max transactions per tick (must be 2^N). */
    NUMBER_OF_TRANSACTIONS_PER_TICK: 4096,
    /** Max number of smart contracts. */
    MAX_NUMBER_OF_CONTRACTS: 1024,
    /** Number of peers exchanged in EXCHANGE_PUBLIC_PEERS. */
    NUMBER_OF_EXCHANGED_PEERS: 4,
    /** Request/response header size in bytes. */
    HEADER_SIZE: 8,
    /** Spectrum Merkle tree depth. */
    SPECTRUM_DEPTH: 24,
    /** Assets Merkle tree depth. */
    ASSETS_DEPTH: 24,
    /** Max message size including header (24-bit size field). */
    MAX_MESSAGE_SIZE: 16777215,
    /** Spectrum capacity: 2^SPECTRUM_DEPTH. */
    SPECTRUM_CAPACITY: 16777216,
    /** Assets capacity: 2^ASSETS_DEPTH. */
    ASSETS_CAPACITY: 16777216,
    /** Issuance rate: 1e12 (base unit per coin). */
    ISSUANCE_RATE: 1e12,
    /** Maximum amount in a single transaction: ISSUANCE_RATE * 1000. */
    MAX_AMOUNT: 1e15,
    /** Maximum total supply: ISSUANCE_RATE * 200. */
    MAX_SUPPLY: 2e14
  };

  // node_modules/@qubic.org/tx/dist/errors.js
  var PayloadTooLargeError = class extends QubicError2 {
    constructor(byteLength) {
      super(`Payload is ${byteLength} bytes; maximum allowed is ${PROTOCOL.MAX_INPUT_SIZE}`, {
        byteLength,
        max: PROTOCOL.MAX_INPUT_SIZE
      });
      __publicField(this, "byteLength");
      __publicField(this, "code", "PAYLOAD_TOO_LARGE");
      this.byteLength = byteLength;
    }
  };
  var TickInThePastError = class extends QubicError2 {
    constructor(targetTick, currentTick) {
      super(`targetTick ${targetTick} must be greater than currentTick ${currentTick}`, {
        targetTick,
        currentTick
      });
      __publicField(this, "targetTick");
      __publicField(this, "currentTick");
      __publicField(this, "code", "TICK_IN_THE_PAST");
      this.targetTick = targetTick;
      this.currentTick = currentTick;
    }
  };
  var InvalidTransactionError = class extends QubicError2 {
    constructor(reason) {
      super(`Invalid transaction: ${reason}`);
      __publicField(this, "code", "INVALID_TRANSACTION");
    }
  };

  // node_modules/@qubic.org/tx/dist/transaction.js
  function buildTransaction(input) {
    const payload = input.payload ?? new Uint8Array(0);
    const sourcePublicKey = typeof input.source === "string" ? isIdentity(input.source) ? identityToPublicKey(input.source) : (() => {
      throw new InvalidIdentityError2(input.source);
    })() : input.source;
    const destinationPublicKey = typeof input.destination === "string" ? isIdentity(input.destination) ? identityToPublicKey(input.destination) : (() => {
      throw new InvalidIdentityError2(input.destination);
    })() : input.destination;
    if (sourcePublicKey.byteLength !== PROTOCOL.PUBLIC_KEY_SIZE) {
      throw new InvalidTransactionError(`source must resolve to exactly ${PROTOCOL.PUBLIC_KEY_SIZE} bytes, got ${sourcePublicKey.byteLength}`);
    }
    if (destinationPublicKey.byteLength !== PROTOCOL.PUBLIC_KEY_SIZE) {
      throw new InvalidTransactionError(`destination must resolve to exactly ${PROTOCOL.PUBLIC_KEY_SIZE} bytes, got ${destinationPublicKey.byteLength}`);
    }
    if (payload.byteLength > PROTOCOL.MAX_INPUT_SIZE) {
      throw new PayloadTooLargeError(payload.byteLength);
    }
    if (input.currentTick !== void 0 && input.targetTick <= input.currentTick) {
      throw new TickInThePastError(input.targetTick, input.currentTick);
    }
    const writer = new BinaryWriter(PROTOCOL.TX_HEADER_SIZE + payload.byteLength);
    writer.writeBytes(sourcePublicKey);
    writer.writeBytes(destinationPublicKey);
    writer.writeInt64(input.amount);
    writer.writeUint32(input.targetTick);
    writer.writeUint16(input.inputType);
    writer.writeUint16(payload.byteLength);
    writer.writeBytes(payload);
    return writer.getBytes();
  }
  async function signTransaction(txBytes, seed) {
    const digest = k12(txBytes, 32);
    const signature = await sign2(digest, seed);
    const result = new Uint8Array(txBytes.byteLength + PROTOCOL.SIGNATURE_SIZE);
    result.set(txBytes, 0);
    result.set(signature, txBytes.byteLength);
    return result;
  }
  function encodeTransaction(signedTx) {
    let str = "";
    for (let i = 0; i < signedTx.byteLength; i++) {
      str += String.fromCharCode(signedTx[i]);
    }
    return toBase64(btoa(str));
  }
  function decodeTransaction(bytes) {
    if (bytes.byteLength < PROTOCOL.TX_HEADER_SIZE) {
      throw new InvalidTransactionError(`buffer too small: expected ≥ ${PROTOCOL.TX_HEADER_SIZE} bytes, got ${bytes.byteLength}`);
    }
    const reader = new BinaryReader(bytes);
    const sourcePublicKey = reader.readBytes(PROTOCOL.PUBLIC_KEY_SIZE);
    const destinationPublicKey = reader.readBytes(PROTOCOL.PUBLIC_KEY_SIZE);
    const amount = reader.readInt64();
    const targetTick = reader.readUint32();
    const inputType = reader.readUint16();
    const inputSize = reader.readUint16();
    const payload = reader.readBytes(inputSize);
    return { sourcePublicKey, destinationPublicKey, amount, targetTick, inputType, payload };
  }
  function computeTransactionHash(signedTxBytes) {
    const digest = k12(signedTxBytes, 32);
    return encodeBytesAsTxHash(digest);
  }
  function verifyTransactionSignature(signedTxBytes) {
    if (signedTxBytes.byteLength < PROTOCOL.TX_HEADER_SIZE + PROTOCOL.SIGNATURE_SIZE)
      return false;
    const inputSize = new DataView(signedTxBytes.buffer, signedTxBytes.byteOffset, signedTxBytes.byteLength).getUint16(78, true);
    const txEnd = PROTOCOL.TX_HEADER_SIZE + inputSize;
    if (signedTxBytes.byteLength < txEnd + PROTOCOL.SIGNATURE_SIZE)
      return false;
    const txBytes = signedTxBytes.slice(0, txEnd);
    const signature = signedTxBytes.slice(txEnd, txEnd + PROTOCOL.SIGNATURE_SIZE);
    const sourcePublicKey = signedTxBytes.slice(0, PROTOCOL.PUBLIC_KEY_SIZE);
    const digest = k12(txBytes, 32);
    return verify2(digest, signature, sourcePublicKey);
  }
  function encodeBytesAsTxHash(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, 32);
    const chars = [];
    for (let i = 0; i < 4; i++) {
      let fragment = view.getBigUint64(i * 8, true);
      for (let j = 0; j < 14; j++) {
        chars.push(Number(fragment % 26n) + 97);
        fragment /= 26n;
      }
    }
    const checksumBytes = k12(bytes, 3);
    let checksum = BigInt(checksumBytes[0]) | BigInt(checksumBytes[1]) << 8n | BigInt(checksumBytes[2]) << 16n;
    checksum &= 0x3ffffn;
    for (let i = 0; i < 4; i++) {
      chars.push(Number(checksum % 26n) + 97);
      checksum /= 26n;
    }
    return String.fromCharCode(...chars);
  }

  // node_modules/@noble/hashes/utils.js
  function isBytes2(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
  }
  var atitle = (title) => title ? `"${title}" ` : "";
  function anumber2(n, title = "") {
    if (typeof n !== "number")
      throw new TypeError(atitle(title) + "expected number, got " + typeof n);
    if (!Number.isSafeInteger(n) || n < 0)
      throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
    return n;
  }
  function abytes2(value, length, title = "") {
    if (isBytes2(value) && (length === void 0 || value.length === length))
      return value;
    if (length !== void 0)
      anumber2(length, "length");
    const bytes = isBytes2(value);
    const ofLen = length !== void 0 ? ` of length ${length}` : "";
    const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
    const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
    if (!bytes)
      throw new TypeError(message);
    throw new RangeError(message);
  }
  function copyBytes2(bytes) {
    return Uint8Array.from(abytes2(bytes));
  }
  var aobject = (value, label) => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
  };
  var aopts = (value, label) => {
    aobject(value, label);
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null)
      throw new TypeError(`"${label}" expected plain object`);
    if (Object.hasOwn(value, "__proto__"))
      throw new TypeError(`"${label}.__proto__" is not allowed`);
  };
  function aexists2(instance, checkFinished = true) {
    if (instance.destroyed)
      throw new Error("hash was destroyed");
    if (checkFinished && instance.finished)
      throw new Error("digest() was already called");
  }
  function aoutput2(out, instance) {
    abytes2(out, void 0, "output");
    const min = instance.outputLen;
    if (!(out.length >= min)) {
      throw new RangeError('"output" expected length >= ' + min);
    }
  }
  function u8(arr) {
    return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  }
  function u322(arr) {
    return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
  }
  function clean2(...arrays) {
    for (let i = 0; i < arrays.length; i++) {
      arrays[i].fill(0);
    }
  }
  var isLE2 = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
  function byteSwap2(word) {
    return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
  }
  var swap8IfBE = isLE2 ? (n) => n : (n) => byteSwap2(n) >>> 0;
  function byteSwap322(arr) {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = byteSwap2(arr[i]);
    }
    return arr;
  }
  var swap32IfBE2 = isLE2 ? (u) => u : byteSwap322;
  function nextTick(onReject) {
    const host = globalThis;
    if (typeof host.scheduler?.yield === "function") {
      const promise = host.scheduler.yield();
      if (onReject)
        promise.catch(onReject);
      return promise;
    }
    return new Promise((resolve) => host.setTimeout(resolve, 0));
  }
  function utf8ToBytes(str) {
    if (typeof str !== "string")
      throw new TypeError("string expected");
    const encoded = new TextEncoder().encode(str);
    try {
      return new Uint8Array(encoded);
    } finally {
      clean2(encoded);
    }
  }
  function kdfInputToBytes(data, errorTitle = "") {
    if (typeof data === "string")
      return utf8ToBytes(data);
    return abytes2(data, void 0, errorTitle);
  }
  function checkOpts(defaults, opts, title = "opts") {
    aopts(defaults, "defaults");
    if (opts !== void 0)
      aopts(opts, title);
    const merged = Object.assign(/* @__PURE__ */ Object.create(null), defaults, opts);
    return merged;
  }
  function createHasher2(hashCons, info = {}) {
    if (typeof hashCons !== "function")
      throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
    info = checkOpts({}, info, "info");
    const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
    const tmp = hashCons(void 0);
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.canXOF = tmp.canXOF;
    hashC.create = (opts) => hashCons(opts);
    Object.assign(hashC, info);
    return Object.freeze(hashC);
  }

  // node_modules/@noble/hashes/_blake.js
  var BSIGMA = /* @__PURE__ */ Uint8Array.from([
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15,
    14,
    10,
    4,
    8,
    9,
    15,
    13,
    6,
    1,
    12,
    0,
    2,
    11,
    7,
    5,
    3,
    11,
    8,
    12,
    0,
    5,
    2,
    15,
    13,
    10,
    14,
    3,
    6,
    7,
    1,
    9,
    4,
    7,
    9,
    3,
    1,
    13,
    12,
    11,
    14,
    2,
    6,
    5,
    10,
    4,
    0,
    15,
    8,
    9,
    0,
    5,
    7,
    2,
    4,
    10,
    15,
    14,
    1,
    11,
    12,
    6,
    8,
    3,
    13,
    2,
    12,
    6,
    10,
    0,
    11,
    8,
    3,
    4,
    13,
    7,
    5,
    15,
    14,
    1,
    9,
    12,
    5,
    1,
    15,
    14,
    13,
    4,
    10,
    0,
    7,
    6,
    3,
    9,
    2,
    8,
    11,
    13,
    11,
    7,
    14,
    12,
    1,
    3,
    9,
    5,
    0,
    15,
    4,
    8,
    6,
    2,
    10,
    6,
    15,
    14,
    9,
    11,
    3,
    0,
    8,
    12,
    2,
    13,
    7,
    1,
    4,
    10,
    5,
    10,
    2,
    8,
    4,
    7,
    6,
    1,
    5,
    15,
    11,
    9,
    14,
    3,
    12,
    13,
    0,
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15,
    14,
    10,
    4,
    8,
    9,
    15,
    13,
    6,
    1,
    12,
    0,
    2,
    11,
    7,
    5,
    3,
    // Blake1, unused in others
    11,
    8,
    12,
    0,
    5,
    2,
    15,
    13,
    10,
    14,
    3,
    6,
    7,
    1,
    9,
    4,
    7,
    9,
    3,
    1,
    13,
    12,
    11,
    14,
    2,
    6,
    5,
    10,
    4,
    0,
    15,
    8,
    9,
    0,
    5,
    7,
    2,
    4,
    10,
    15,
    14,
    1,
    11,
    12,
    6,
    8,
    3,
    13,
    2,
    12,
    6,
    10,
    0,
    11,
    8,
    3,
    4,
    13,
    7,
    5,
    15,
    14,
    1,
    9
  ]);

  // node_modules/@noble/hashes/_u64.js
  var fromNumH = (n) => n / 2 ** 32 | 0;
  var fromNumL = (n) => n >>> 0;
  var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
  var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
  var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
  var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
  var rotr32H = (_h, l) => l;
  var rotr32L = (h, _l) => h;
  function add(Ah, Al, Bh, Bl) {
    const l = (Al >>> 0) + (Bl >>> 0);
    return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
  }
  var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
  var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;

  // node_modules/@noble/hashes/blake2.js
  var B2B_IV = /* @__PURE__ */ Uint32Array.from([
    4089235720,
    1779033703,
    2227873595,
    3144134277,
    4271175723,
    1013904242,
    1595750129,
    2773480762,
    2917565137,
    1359893119,
    725511199,
    2600822924,
    4215389547,
    528734635,
    327033209,
    1541459225
  ]);
  var BBUF = /* @__PURE__ */ new Uint32Array(32);
  function G1b(a, b, c, d, msg, x) {
    const Xl = msg[x], Xh = msg[x + 1];
    let Al = BBUF[2 * a], Ah = BBUF[2 * a + 1];
    let Bl = BBUF[2 * b], Bh = BBUF[2 * b + 1];
    let Cl = BBUF[2 * c], Ch = BBUF[2 * c + 1];
    let Dl = BBUF[2 * d], Dh = BBUF[2 * d + 1];
    const ll = add3L(Al, Bl, Xl);
    Ah = add3H(ll, Ah, Bh, Xh);
    Al = ll | 0;
    let xh = Dh ^ Ah, xl = Dl ^ Al;
    Dh = rotr32H(xh, xl);
    Dl = rotr32L(xh, xl);
    ({ h: Ch, l: Cl } = add(Ch, Cl, Dh, Dl));
    xh = Bh ^ Ch;
    xl = Bl ^ Cl;
    Bh = rotrSH(xh, xl, 24);
    Bl = rotrSL(xh, xl, 24);
    BBUF[2 * a] = Al;
    BBUF[2 * a + 1] = Ah;
    BBUF[2 * b] = Bl;
    BBUF[2 * b + 1] = Bh;
    BBUF[2 * c] = Cl;
    BBUF[2 * c + 1] = Ch;
    BBUF[2 * d] = Dl;
    BBUF[2 * d + 1] = Dh;
  }
  function G2b(a, b, c, d, msg, x) {
    const Xl = msg[x], Xh = msg[x + 1];
    let Al = BBUF[2 * a], Ah = BBUF[2 * a + 1];
    let Bl = BBUF[2 * b], Bh = BBUF[2 * b + 1];
    let Cl = BBUF[2 * c], Ch = BBUF[2 * c + 1];
    let Dl = BBUF[2 * d], Dh = BBUF[2 * d + 1];
    const ll = add3L(Al, Bl, Xl);
    Ah = add3H(ll, Ah, Bh, Xh);
    Al = ll | 0;
    let xh = Dh ^ Ah, xl = Dl ^ Al;
    Dh = rotrSH(xh, xl, 16);
    Dl = rotrSL(xh, xl, 16);
    ({ h: Ch, l: Cl } = add(Ch, Cl, Dh, Dl));
    xh = Bh ^ Ch;
    xl = Bl ^ Cl;
    Bh = rotrBH(xh, xl, 63);
    Bl = rotrBL(xh, xl, 63);
    BBUF[2 * a] = Al;
    BBUF[2 * a + 1] = Ah;
    BBUF[2 * b] = Bl;
    BBUF[2 * b + 1] = Bh;
    BBUF[2 * c] = Cl;
    BBUF[2 * c + 1] = Ch;
    BBUF[2 * d] = Dl;
    BBUF[2 * d + 1] = Dh;
  }
  function checkBlake2Opts(outputLen, opts = {}, keyLen, saltLen, persLen) {
    anumber2(keyLen);
    if (outputLen <= 0 || outputLen > keyLen)
      throw new Error('"dkLen" must be 1..' + keyLen + ", got " + outputLen);
    const { key, salt, personalization } = opts;
    if (key !== void 0 && (key.length < 1 || key.length > keyLen))
      throw new Error('"key" expected to be undefined or of length=1..' + keyLen);
    if (salt !== void 0)
      abytes2(salt, saltLen, "salt");
    if (personalization !== void 0)
      abytes2(personalization, persLen, "personalization");
  }
  var _BLAKE2 = class {
    constructor(blockLen, outputLen) {
      __publicField(this, "buffer");
      __publicField(this, "buffer32");
      __publicField(this, "finished", false);
      __publicField(this, "destroyed", false);
      __publicField(this, "length", 0);
      __publicField(this, "pos", 0);
      __publicField(this, "blockLen");
      __publicField(this, "outputLen");
      __publicField(this, "canXOF", false);
      anumber2(blockLen);
      anumber2(outputLen);
      this.blockLen = blockLen;
      this.outputLen = outputLen;
      this.buffer = new Uint8Array(blockLen);
      this.buffer32 = u322(this.buffer);
    }
    update(data) {
      aexists2(this);
      abytes2(data);
      const { blockLen, buffer, buffer32 } = this;
      const len = data.length;
      const offset = data.byteOffset;
      const buf = data.buffer;
      for (let pos = 0; pos < len; ) {
        if (this.pos === blockLen) {
          swap32IfBE2(buffer32);
          this.compress(buffer32, 0, false);
          swap32IfBE2(buffer32);
          this.pos = 0;
        }
        const take = Math.min(blockLen - this.pos, len - pos);
        const dataOffset = offset + pos;
        if (take === blockLen && !(dataOffset % 4) && pos + take < len) {
          const data32 = new Uint32Array(buf, dataOffset, Math.floor((len - pos) / 4));
          swap32IfBE2(data32);
          for (let pos32 = 0; pos + blockLen < len; pos32 += buffer32.length, pos += blockLen) {
            this.length += blockLen;
            this.compress(data32, pos32, false);
          }
          swap32IfBE2(data32);
          continue;
        }
        buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
        this.pos += take;
        this.length += take;
        pos += take;
      }
      return this;
    }
    digestInto(out) {
      aexists2(this);
      aoutput2(out, this);
      if (out.byteOffset & 3)
        throw new RangeError('"output" expected 4-byte aligned byteOffset, got ' + out.byteOffset);
      const { pos, buffer32 } = this;
      this.finished = true;
      this.buffer.fill(0, pos);
      swap32IfBE2(buffer32);
      this.compress(buffer32, 0, true);
      swap32IfBE2(buffer32);
      const state = this.get();
      const out32 = out === this.buffer ? buffer32 : u322(out);
      const full = Math.floor(this.outputLen / 4);
      for (let i = 0; i < full; i++)
        out32[i] = swap8IfBE(state[i]);
      const tail = this.outputLen % 4;
      if (!tail)
        return;
      const off = full * 4;
      const word = state[full];
      for (let i = 0; i < tail; i++)
        out[off + i] = word >>> 8 * i;
    }
    digest() {
      const { buffer, outputLen } = this;
      this.digestInto(buffer);
      const res = buffer.slice(0, outputLen);
      this.destroy();
      return res;
    }
    _cloneInto(to) {
      const { buffer, length, finished, destroyed, outputLen, pos } = this;
      to || (to = new this.constructor({ dkLen: outputLen }));
      to.set(...this.get());
      to.buffer.set(buffer);
      to.destroyed = destroyed;
      to.finished = finished;
      to.length = length;
      to.pos = pos;
      to.outputLen = outputLen;
      return to;
    }
    clone() {
      return this._cloneInto();
    }
  };
  var _BLAKE2b = class extends _BLAKE2 {
    constructor(opts = {}) {
      opts = checkOpts({}, opts);
      const olen = opts.dkLen === void 0 ? 64 : opts.dkLen;
      super(128, olen);
      // Same IV words as SHA-512 / BLAKE2b, encoded as LE u32 low/high halves.
      __publicField(this, "v0l", B2B_IV[0] | 0);
      __publicField(this, "v0h", B2B_IV[1] | 0);
      __publicField(this, "v1l", B2B_IV[2] | 0);
      __publicField(this, "v1h", B2B_IV[3] | 0);
      __publicField(this, "v2l", B2B_IV[4] | 0);
      __publicField(this, "v2h", B2B_IV[5] | 0);
      __publicField(this, "v3l", B2B_IV[6] | 0);
      __publicField(this, "v3h", B2B_IV[7] | 0);
      __publicField(this, "v4l", B2B_IV[8] | 0);
      __publicField(this, "v4h", B2B_IV[9] | 0);
      __publicField(this, "v5l", B2B_IV[10] | 0);
      __publicField(this, "v5h", B2B_IV[11] | 0);
      __publicField(this, "v6l", B2B_IV[12] | 0);
      __publicField(this, "v6h", B2B_IV[13] | 0);
      __publicField(this, "v7l", B2B_IV[14] | 0);
      __publicField(this, "v7h", B2B_IV[15] | 0);
      checkBlake2Opts(olen, opts, 64, 16, 16);
      let { key, personalization, salt } = opts;
      let keyLength = 0;
      if (key !== void 0) {
        abytes2(key, void 0, "key");
        keyLength = key.length;
      }
      this.v0l ^= this.outputLen | keyLength << 8 | 1 << 16 | 1 << 24;
      if (salt !== void 0) {
        abytes2(salt, void 0, "salt");
        const slt = u322(copyBytes2(salt));
        this.v4l ^= swap8IfBE(slt[0]);
        this.v4h ^= swap8IfBE(slt[1]);
        this.v5l ^= swap8IfBE(slt[2]);
        this.v5h ^= swap8IfBE(slt[3]);
      }
      if (personalization !== void 0) {
        abytes2(personalization, void 0, "personalization");
        const pers = u322(copyBytes2(personalization));
        this.v6l ^= swap8IfBE(pers[0]);
        this.v6h ^= swap8IfBE(pers[1]);
        this.v7l ^= swap8IfBE(pers[2]);
        this.v7h ^= swap8IfBE(pers[3]);
      }
      if (key !== void 0) {
        const tmp = new Uint8Array(this.blockLen);
        tmp.set(key);
        this.update(tmp);
        clean2(tmp);
      }
    }
    // prettier-ignore
    get() {
      let { v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h } = this;
      return [v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h];
    }
    // prettier-ignore
    set(v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h) {
      this.v0l = v0l | 0;
      this.v0h = v0h | 0;
      this.v1l = v1l | 0;
      this.v1h = v1h | 0;
      this.v2l = v2l | 0;
      this.v2h = v2h | 0;
      this.v3l = v3l | 0;
      this.v3h = v3h | 0;
      this.v4l = v4l | 0;
      this.v4h = v4h | 0;
      this.v5l = v5l | 0;
      this.v5h = v5h | 0;
      this.v6l = v6l | 0;
      this.v6h = v6h | 0;
      this.v7l = v7l | 0;
      this.v7h = v7h | 0;
    }
    compress(msg, offset, isLast) {
      const { v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h } = this;
      {
        BBUF[0] = v0l;
        BBUF[1] = v0h;
        BBUF[2] = v1l;
        BBUF[3] = v1h;
        BBUF[4] = v2l;
        BBUF[5] = v2h;
        BBUF[6] = v3l;
        BBUF[7] = v3h;
        BBUF[8] = v4l;
        BBUF[9] = v4h;
        BBUF[10] = v5l;
        BBUF[11] = v5h;
        BBUF[12] = v6l;
        BBUF[13] = v6h;
        BBUF[14] = v7l;
        BBUF[15] = v7h;
      }
      BBUF.set(B2B_IV, 16);
      const l = fromNumL(this.length);
      const h = fromNumH(this.length);
      BBUF[24] = B2B_IV[8] ^ l;
      BBUF[25] = B2B_IV[9] ^ h;
      if (isLast) {
        BBUF[28] = ~BBUF[28];
        BBUF[29] = ~BBUF[29];
      }
      let j = 0;
      const s = BSIGMA;
      for (let i = 0; i < 12; i++) {
        G1b(0, 4, 8, 12, msg, offset + 2 * s[j++]);
        G2b(0, 4, 8, 12, msg, offset + 2 * s[j++]);
        G1b(1, 5, 9, 13, msg, offset + 2 * s[j++]);
        G2b(1, 5, 9, 13, msg, offset + 2 * s[j++]);
        G1b(2, 6, 10, 14, msg, offset + 2 * s[j++]);
        G2b(2, 6, 10, 14, msg, offset + 2 * s[j++]);
        G1b(3, 7, 11, 15, msg, offset + 2 * s[j++]);
        G2b(3, 7, 11, 15, msg, offset + 2 * s[j++]);
        G1b(0, 5, 10, 15, msg, offset + 2 * s[j++]);
        G2b(0, 5, 10, 15, msg, offset + 2 * s[j++]);
        G1b(1, 6, 11, 12, msg, offset + 2 * s[j++]);
        G2b(1, 6, 11, 12, msg, offset + 2 * s[j++]);
        G1b(2, 7, 8, 13, msg, offset + 2 * s[j++]);
        G2b(2, 7, 8, 13, msg, offset + 2 * s[j++]);
        G1b(3, 4, 9, 14, msg, offset + 2 * s[j++]);
        G2b(3, 4, 9, 14, msg, offset + 2 * s[j++]);
      }
      this.v0l ^= BBUF[0] ^ BBUF[16];
      this.v0h ^= BBUF[1] ^ BBUF[17];
      this.v1l ^= BBUF[2] ^ BBUF[18];
      this.v1h ^= BBUF[3] ^ BBUF[19];
      this.v2l ^= BBUF[4] ^ BBUF[20];
      this.v2h ^= BBUF[5] ^ BBUF[21];
      this.v3l ^= BBUF[6] ^ BBUF[22];
      this.v3h ^= BBUF[7] ^ BBUF[23];
      this.v4l ^= BBUF[8] ^ BBUF[24];
      this.v4h ^= BBUF[9] ^ BBUF[25];
      this.v5l ^= BBUF[10] ^ BBUF[26];
      this.v5h ^= BBUF[11] ^ BBUF[27];
      this.v6l ^= BBUF[12] ^ BBUF[28];
      this.v6h ^= BBUF[13] ^ BBUF[29];
      this.v7l ^= BBUF[14] ^ BBUF[30];
      this.v7h ^= BBUF[15] ^ BBUF[31];
      clean2(BBUF);
    }
    destroy() {
      this.destroyed = true;
      clean2(this.buffer32);
      this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
  };
  var blake2b = /* @__PURE__ */ createHasher2((opts) => new _BLAKE2b(opts));

  // node_modules/@noble/hashes/argon2.js
  var AT = { Argon2d: 0, Argon2i: 1, Argon2id: 2 };
  var ARGON2_SYNC_POINTS = 4;
  var abytesOrZero = (buf, errorTitle = "") => {
    if (buf === void 0)
      return Uint8Array.of();
    return kdfInputToBytes(buf, errorTitle);
  };
  var A2_BUF = new Uint32Array(256);
  function G(a, b, c, d) {
    let Al = A2_BUF[2 * a], Ah = A2_BUF[2 * a + 1];
    let Bl = A2_BUF[2 * b], Bh = A2_BUF[2 * b + 1];
    let Cl = A2_BUF[2 * c], Ch = A2_BUF[2 * c + 1];
    let Dl = A2_BUF[2 * d], Dh = A2_BUF[2 * d + 1];
    let ml = 0, mh = 0, rl = 0, xh = 0, xl = 0;
    ml = Math.imul(Al, Bl);
    mh = ((Al >>> 0) * (Bl >>> 0) - (ml >>> 0)) / 4294967296 + 0.5 | 0;
    rl = (Al >>> 0) + (Bl >>> 0) + (ml << 1 >>> 0);
    Ah = Ah + Bh + (mh << 1 | ml >>> 31) + (rl / 4294967296 | 0) | 0;
    Al = rl | 0;
    xh = Dh ^ Ah;
    xl = Dl ^ Al;
    Dh = xl;
    Dl = xh;
    ml = Math.imul(Cl, Dl);
    mh = ((Cl >>> 0) * (Dl >>> 0) - (ml >>> 0)) / 4294967296 + 0.5 | 0;
    rl = (Cl >>> 0) + (Dl >>> 0) + (ml << 1 >>> 0);
    Ch = Ch + Dh + (mh << 1 | ml >>> 31) + (rl / 4294967296 | 0) | 0;
    Cl = rl | 0;
    xh = Bh ^ Ch;
    xl = Bl ^ Cl;
    Bh = xh >>> 24 | xl << 8;
    Bl = xh << 8 | xl >>> 24;
    ml = Math.imul(Al, Bl);
    mh = ((Al >>> 0) * (Bl >>> 0) - (ml >>> 0)) / 4294967296 + 0.5 | 0;
    rl = (Al >>> 0) + (Bl >>> 0) + (ml << 1 >>> 0);
    Ah = Ah + Bh + (mh << 1 | ml >>> 31) + (rl / 4294967296 | 0) | 0;
    Al = rl | 0;
    xh = Dh ^ Ah;
    xl = Dl ^ Al;
    Dh = xh >>> 16 | xl << 16;
    Dl = xh << 16 | xl >>> 16;
    ml = Math.imul(Cl, Dl);
    mh = ((Cl >>> 0) * (Dl >>> 0) - (ml >>> 0)) / 4294967296 + 0.5 | 0;
    rl = (Cl >>> 0) + (Dl >>> 0) + (ml << 1 >>> 0);
    Ch = Ch + Dh + (mh << 1 | ml >>> 31) + (rl / 4294967296 | 0) | 0;
    Cl = rl | 0;
    xh = Bh ^ Ch;
    xl = Bl ^ Cl;
    Bh = xh << 1 | xl >>> 31;
    Bl = xh >>> 31 | xl << 1;
    A2_BUF[2 * a] = Al, A2_BUF[2 * a + 1] = Ah;
    A2_BUF[2 * b] = Bl, A2_BUF[2 * b + 1] = Bh;
    A2_BUF[2 * c] = Cl, A2_BUF[2 * c + 1] = Ch;
    A2_BUF[2 * d] = Dl, A2_BUF[2 * d + 1] = Dh;
  }
  function P2(v00, v01, v02, v03, v04, v05, v06, v07, v08, v09, v10, v11, v12, v13, v14, v15) {
    G(v00, v04, v08, v12);
    G(v01, v05, v09, v13);
    G(v02, v06, v10, v14);
    G(v03, v07, v11, v15);
    G(v00, v05, v10, v15);
    G(v01, v06, v11, v12);
    G(v02, v07, v08, v13);
    G(v03, v04, v09, v14);
  }
  function block(x, xPos, yPos, outPos, needXor) {
    if (needXor) {
      for (let i = 0; i < 256; i++) {
        const r = x[xPos + i] ^ x[yPos + i];
        A2_BUF[i] = r;
        x[outPos + i] ^= r;
      }
    } else {
      for (let i = 0; i < 256; i++) {
        const r = x[xPos + i] ^ x[yPos + i];
        A2_BUF[i] = r;
        x[outPos + i] = r;
      }
    }
    for (let i = 0; i < 128; i += 16) {
      P2(i, i + 1, i + 2, i + 3, i + 4, i + 5, i + 6, i + 7, i + 8, i + 9, i + 10, i + 11, i + 12, i + 13, i + 14, i + 15);
    }
    for (let i = 0; i < 16; i += 2) {
      P2(i, i + 1, i + 16, i + 17, i + 32, i + 33, i + 48, i + 49, i + 64, i + 65, i + 80, i + 81, i + 96, i + 97, i + 112, i + 113);
    }
    for (let i = 0; i < 256; i++)
      x[outPos + i] ^= A2_BUF[i];
    clean2(A2_BUF);
  }
  function Hp(A, dkLen) {
    const A8 = u8(A);
    const T = new Uint32Array(1);
    const T8 = u8(T);
    T[0] = swap8IfBE(dkLen);
    if (dkLen <= 64)
      return blake2b.create({ dkLen }).update(T8).update(A8).digest();
    const out = new Uint8Array(dkLen);
    let V = blake2b.create({}).update(T8).update(A8).digest();
    let pos = 0;
    out.set(V.subarray(0, 32));
    pos += 32;
    for (; dkLen - pos > 64; pos += 32) {
      const Vh = blake2b.create({}).update(V);
      Vh.digestInto(V);
      Vh.destroy();
      out.set(V.subarray(0, 32), pos);
    }
    out.set(blake2b(V, { dkLen: dkLen - pos }), pos);
    clean2(V, T);
    return out;
  }
  function indexAlpha(r, s, laneLen, segmentLen, index, randL, sameLane = false) {
    let area;
    if (r === 0) {
      if (s === 0)
        area = index - 1;
      else if (sameLane)
        area = s * segmentLen + index - 1;
      else
        area = s * segmentLen + (index == 0 ? -1 : 0);
    } else if (sameLane)
      area = laneLen - segmentLen + index - 1;
    else
      area = laneLen - segmentLen + (index == 0 ? -1 : 0);
    const startPos = r !== 0 && s !== ARGON2_SYNC_POINTS - 1 ? (s + 1) * segmentLen : 0;
    const randLow = Math.imul(randL, randL);
    const randHigh = ((randL >>> 0) * (randL >>> 0) - (randLow >>> 0)) / 4294967296 + 0.5 | 0;
    const areaLow = Math.imul(area, randHigh);
    const areaHigh = ((area >>> 0) * (randHigh >>> 0) - (areaLow >>> 0)) / 4294967296 + 0.5 | 0;
    const rel = area - 1 - areaHigh;
    return (startPos + rel) % laneLen;
  }
  var maxUint32 = Math.pow(2, 32);
  var ARGON2_DEFAULT_MEMORY = 1024 ** 2;
  var ARGON2_DEFAULT_MAXMEM = ARGON2_DEFAULT_MEMORY * 1024;
  function isU32(num) {
    return Number.isSafeInteger(num) && num >= 0 && num < maxUint32;
  }
  function argon2Opts(opts = {}) {
    opts = checkOpts({}, opts);
    const merged = {
      t: 3,
      m: ARGON2_DEFAULT_MEMORY,
      p: 1,
      version: 19,
      dkLen: 32,
      maxmem: ARGON2_DEFAULT_MAXMEM,
      asyncTick: 10
    };
    for (let [k, v] of Object.entries(opts))
      if (v !== void 0)
        merged[k] = v;
    const { dkLen, p, m, t, version, onProgress, asyncTick } = merged;
    if (!isU32(dkLen) || dkLen < 4)
      throw new Error('"dkLen" must be 4..');
    if (!isU32(p) || p < 1 || p >= Math.pow(2, 24))
      throw new Error('"p" must be 1..2^24');
    if (!isU32(m))
      throw new Error('"m" must be 0..2^32');
    if (!isU32(t) || t < 1)
      throw new Error('"t" (iterations) must be 1..2^32');
    if (onProgress !== void 0 && typeof onProgress !== "function")
      throw new Error('"onProgress" must be a function');
    anumber2(asyncTick, "asyncTick");
    if (!isU32(m) || m < 8 * p)
      throw new Error('"m" (memory) must be at least 8*p bytes');
    if (version !== 16 && version !== 19)
      throw new Error('"version" must be 0x10 or 0x13, got ' + version);
    return merged;
  }
  function argon2InitialHash(password, salt, type, opts) {
    const ownedInputs = [];
    const BUF = new Uint32Array(1);
    const BUF8 = u8(BUF);
    let h;
    let H0;
    let succeeded = false;
    const rememberOwned = (input, bytes) => {
      if (typeof input === "string")
        ownedInputs.push(bytes);
      return bytes;
    };
    try {
      const passwordBytes = rememberOwned(password, kdfInputToBytes(password, "password"));
      const saltBytes = rememberOwned(salt, kdfInputToBytes(salt, "salt"));
      if (!isU32(passwordBytes.length))
        throw new Error('"password" must be less of length 1..4Gb');
      if (!isU32(saltBytes.length) || saltBytes.length < 8)
        throw new Error('"salt" must be of length 8..4Gb');
      if (!Object.values(AT).includes(type))
        throw new Error('"type" was invalid');
      let { p, dkLen, m, t, version, key, personalization, maxmem, onProgress, asyncTick } = argon2Opts(opts);
      const keyInput = key;
      key = rememberOwned(keyInput, abytesOrZero(keyInput, "key"));
      const personalizationInput = personalization;
      personalization = rememberOwned(personalizationInput, abytesOrZero(personalizationInput, "personalization"));
      h = blake2b.create();
      for (let item of [p, dkLen, m, t, version, type]) {
        BUF[0] = swap8IfBE(item);
        h.update(BUF8);
      }
      for (let i of [passwordBytes, saltBytes, key, personalization]) {
        BUF[0] = swap8IfBE(i.length);
        h.update(BUF8).update(i);
      }
      H0 = new Uint32Array(18);
      h.digestInto(u8(H0));
      succeeded = true;
      return { H0, p, dkLen, m, t, version, maxmem, onProgress, asyncTick };
    } finally {
      if (h)
        h.destroy();
      clean2(BUF, ...ownedInputs);
      if (!succeeded && H0)
        clean2(H0);
    }
  }
  function argon2Init(password, salt, type, opts) {
    const { H0, p, dkLen, m, t, version, maxmem, onProgress, asyncTick } = argon2InitialHash(password, salt, type, opts);
    try {
      const lanes = p;
      const mP = 4 * p * Math.floor(m / (ARGON2_SYNC_POINTS * p));
      const laneLen = Math.floor(mP / p);
      const segmentLen = Math.floor(laneLen / ARGON2_SYNC_POINTS);
      const memUsed = mP * 1024;
      if (!isU32(maxmem))
        throw new Error('"maxmem" expected <2**32, got ' + maxmem);
      if (memUsed > maxmem)
        throw new Error('"maxmem" limit was hit: memUsed(mP*1024)=' + memUsed + ", maxmem=" + maxmem);
      const B = new Uint32Array(memUsed / 4);
      for (let l = 0; l < p; l++) {
        const i = 256 * laneLen * l;
        H0[17] = swap8IfBE(l);
        H0[16] = swap8IfBE(0);
        B.set(swap32IfBE2(u322(Hp(H0, 1024))), i);
        H0[16] = swap8IfBE(1);
        B.set(swap32IfBE2(u322(Hp(H0, 1024))), i + 256);
      }
      let perBlock = () => {
      };
      if (onProgress) {
        const totalBlock = t * ARGON2_SYNC_POINTS * p * segmentLen - 2 * p;
        const callbackPer = Math.max(Math.floor(totalBlock / 1e4), 1);
        let blockCnt = 0;
        perBlock = () => {
          blockCnt++;
          if (onProgress && (!(blockCnt % callbackPer) || blockCnt === totalBlock))
            onProgress(blockCnt / totalBlock);
        };
      }
      return { type, mP, p, t, version, B, laneLen, lanes, segmentLen, dkLen, perBlock, asyncTick };
    } finally {
      clean2(H0);
    }
  }
  function argon2Output(B, p, laneLen, dkLen) {
    const B_final = new Uint32Array(256);
    for (let l = 0; l < p; l++)
      for (let j = 0; j < 256; j++)
        B_final[j] ^= B[256 * (laneLen * l + laneLen - 1) + j];
    const res = Hp(swap32IfBE2(B_final), dkLen);
    clean2(B, B_final);
    return res;
  }
  function* argon2Blocks(ctx, address) {
    const { type, mP, p, t, version, B, laneLen, lanes, segmentLen, perBlock } = ctx;
    address[256 + 6] = mP;
    address[256 + 8] = t;
    address[256 + 10] = type;
    for (let r = 0; r < t; r++) {
      const needXor = r !== 0 && version === 19;
      address[256 + 0] = r;
      for (let s = 0; s < ARGON2_SYNC_POINTS; s++) {
        address[256 + 4] = s;
        const dataIndependent = type == AT.Argon2i || type == AT.Argon2id && r === 0 && s < 2;
        for (let l = 0; l < p; l++) {
          address[256 + 2] = l;
          address[256 + 12] = 0;
          let startPos = 0;
          if (r === 0 && s === 0) {
            startPos = 2;
            if (dataIndependent) {
              address[256 + 12]++;
              block(address, 256, 2 * 256, 0, false);
              block(address, 0, 2 * 256, 0, false);
            }
          }
          let offset = l * laneLen + s * segmentLen + startPos;
          for (let index = startPos; index < segmentLen; index++, offset++) {
            perBlock();
            const prev = offset % laneLen ? offset - 1 : offset + laneLen - 1;
            let randL, randH;
            if (dataIndependent) {
              let i128 = index % 128;
              if (i128 === 0) {
                address[256 + 12]++;
                block(address, 256, 2 * 256, 0, false);
                block(address, 0, 2 * 256, 0, false);
              }
              randL = address[2 * i128];
              randH = address[2 * i128 + 1];
            } else {
              const T = 256 * prev;
              randL = B[T];
              randH = B[T + 1];
            }
            const refLane = r === 0 && s === 0 ? l : randH % lanes;
            const refPos = indexAlpha(r, s, laneLen, segmentLen, index, randL, refLane == l);
            const refBlock = laneLen * refLane + refPos;
            block(B, 256 * prev, 256 * refBlock, offset * 256, needXor);
            yield;
          }
        }
      }
    }
    clean2(address);
  }
  async function argon2Async(type, password, salt, opts) {
    const ctx = argon2Init(password, salt, type, opts);
    const address = new Uint32Array(3 * 256);
    const blocks = argon2Blocks(ctx, address);
    const abort = () => clean2(address, ctx.B);
    let ts = Date.now();
    while (!blocks.next().done) {
      const diff = Date.now() - ts;
      if (diff >= 0 && diff < ctx.asyncTick)
        continue;
      await nextTick(abort);
      ts = Date.now();
    }
    return argon2Output(ctx.B, ctx.p, ctx.laneLen, ctx.dkLen);
  }
  var argon2idAsync = (password, salt, opts = {}) => argon2Async(AT.Argon2id, password, salt, opts);

  // node_modules/@qubic.org/crypto/src/fourq-constants.ts
  var PARAM_D2 = [
    0x00000000000000e40000000000000142n,
    0x5e472f846657e0fcb3821488f1fc0c8dn
  ];
  var GENERATOR_X2 = [
    0x1a3472237c2fb305286592ad7b3833aan,
    0x1e1f553f2878aa9c96869fb360ac77f6n
  ];
  var GENERATOR_Y2 = [
    0x0e3fee9ba120785ab924a2462bcbb287n,
    0x6e1c4af8630e024249a7c344844c8b5cn
  ];

  // node_modules/@qubic.org/crypto/src/fp.ts
  var SIZE_FP2 = 16;
  var P3 = (1n << 127n) - 1n;
  function fpMod2(a) {
    let res = a % P3;
    res += P3 & res >> 127n;
    return res;
  }
  function fpAdd2(a, b) {
    return fpMod2(a + b);
  }
  function fpSub2(a, b) {
    return fpMod2(a - b);
  }
  function fpMul2(a, b) {
    return fpMod2(a * b);
  }
  function fpSqr2(a) {
    return fpMod2(a * a);
  }
  function fpNeg2(a) {
    return fpMod2(P3 - a);
  }
  function fpInv2(a) {
    if (fpMod2(a) === 0n) throw new Error("invert: expected non-zero number");
    const t = fpTwo12512(a);
    let res = t;
    res = fpSqr2(res);
    res = fpSqr2(res);
    return fpMul2(res, a);
  }
  function fpSgn2(a) {
    const v = fpMod2(a);
    const nonZero = (v | -v) >> 126n & 1n;
    const negative = v >> 126n & 1n;
    return Number(nonZero * (1n - (negative << 1n)));
  }
  function fpHlf2(a) {
    const v = fpMod2(a);
    const carry = -(v & 1n);
    return v + (P3 & carry) >> 1n;
  }
  function fpCmov2(a, b, flag) {
    const mask = -BigInt(flag & 1);
    return a & ~mask | b & mask;
  }
  function fpTwo12512(a) {
    let t2 = fpSqr2(a);
    t2 = fpMul2(t2, a);
    let t3 = fpSqr2(fpSqr2(t2));
    t3 = fpMul2(t3, t2);
    let t4 = fpSqr2(fpSqr2(fpSqr2(fpSqr2(t3))));
    t4 = fpMul2(t4, t3);
    let t5 = fpSqr2(t4);
    for (let i = 0; i < 7; i++) t5 = fpSqr2(t5);
    t5 = fpMul2(t5, t4);
    let tt2 = fpSqr2(t5);
    for (let i = 0; i < 15; i++) tt2 = fpSqr2(tt2);
    tt2 = fpMul2(tt2, t5);
    let t1 = fpSqr2(tt2);
    for (let i = 0; i < 31; i++) t1 = fpSqr2(t1);
    t1 = fpMul2(t1, tt2);
    for (let i = 0; i < 32; i++) t1 = fpSqr2(t1);
    t1 = fpMul2(tt2, t1);
    for (let i = 0; i < 16; i++) t1 = fpSqr2(t1);
    t1 = fpMul2(t1, t5);
    for (let i = 0; i < 8; i++) t1 = fpSqr2(t1);
    t1 = fpMul2(t1, t4);
    for (let i = 0; i < 4; i++) t1 = fpSqr2(t1);
    t1 = fpMul2(t1, t3);
    t1 = fpSqr2(t1);
    return fpMul2(a, t1);
  }
  function fpToBytes2(a) {
    const v = fpMod2(a);
    const buf = new Uint8Array(SIZE_FP2);
    let tmp = v;
    for (let i = 0; i < SIZE_FP2; i++) {
      buf[i] = Number(tmp & 0xffn);
      tmp >>= 8n;
    }
    return buf;
  }
  function fpFromBytes2(buf) {
    if (buf.length !== SIZE_FP2) return null;
    if (buf[SIZE_FP2 - 1] >> 7 !== 0) return null;
    let v = 0n;
    for (let i = SIZE_FP2 - 1; i >= 0; i--) {
      v = v << 8n | BigInt(buf[i]);
    }
    return fpMod2(v);
  }

  // node_modules/@qubic.org/crypto/src/fq.ts
  function fqSgn2(a) {
    const s0 = fpSgn2(a[0]);
    const s1 = fpSgn2(a[1]);
    const useS0 = BigInt(s0 * s0);
    return Number(BigInt(s0) * useS0 + BigInt(s1) * (1n - useS0));
  }
  function fqZero2() {
    return [0n, 0n];
  }
  function fqOne2() {
    return [1n, 0n];
  }
  function fqCopy2(a) {
    return [a[0], a[1]];
  }
  function fqIsZero2(a) {
    return (fpMod2(a[0]) | fpMod2(a[1])) === 0n;
  }
  function fqAdd2(a, b) {
    return [fpAdd2(a[0], b[0]), fpAdd2(a[1], b[1])];
  }
  function fqSub2(a, b) {
    return [fpSub2(a[0], b[0]), fpSub2(a[1], b[1])];
  }
  function fqMul2(a, b) {
    const t1 = fpMul2(a[0], b[0]);
    const t2 = fpMul2(a[1], b[1]);
    const t3 = fpAdd2(a[0], a[1]);
    const t4 = fpAdd2(b[0], b[1]);
    let t5 = fpMul2(t3, t4);
    t5 = fpSub2(t5, t1);
    t5 = fpSub2(t5, t2);
    const t6 = fpSub2(t1, t2);
    return [t6, t5];
  }
  function fqSqr2(a) {
    const t1 = fpAdd2(a[0], a[1]);
    const t2 = fpSub2(a[0], a[1]);
    const t3 = fpAdd2(a[0], a[0]);
    return [fpMul2(t1, t2), fpMul2(t3, a[1])];
  }
  function fqNeg2(a) {
    return [fpNeg2(a[0]), fpNeg2(a[1])];
  }
  function fqInv2(a) {
    const t1 = fpSqr2(a[0]);
    const t2 = fpSqr2(a[1]);
    const norm = fpAdd2(t1, t2);
    const invNorm = fpInv2(norm);
    return [fpMul2(a[0], invNorm), fpMul2(a[1], fpNeg2(invNorm))];
  }
  function fqSqrt2(u, v, s) {
    const a = fpAdd2(fpMul2(u[0], v[0]), fpMul2(u[1], v[1]));
    const b = fpAdd2(fpSqr2(v[0]), fpSqr2(v[1]));
    const g = fpSub2(fpMul2(u[1], v[0]), fpMul2(u[0], v[1]));
    let t0 = fpAdd2(fpSqr2(a), fpSqr2(g));
    for (let i = 0; i < 125; i++) t0 = fpSqr2(t0);
    let t = fpAdd2(a, t0);
    const tMod = fpMod2(t);
    t = fpCmov2(t, fpSub2(a, t0), 1 - Number((tMod | -tMod) >> 126n & 1n));
    t = fpAdd2(t, t);
    let r = fpMul2(fpMul2(fpSqr2(b), b), t);
    r = fpTwo12512(r);
    const rb = fpMul2(r, b);
    const c1Mag = fpMul2(rb, g);
    const c0Mag = fpHlf2(fpMul2(rb, t));
    const x02Sqr = fpSqr2(fpAdd2(c0Mag, c0Mag));
    const check = fpSub2(fpMul2(b, x02Sqr), t);
    const checkMod = fpMod2(check);
    const swapFlag = Number((checkMod | -checkMod) >> 126n & 1n);
    let result = [fpCmov2(c0Mag, c1Mag, swapFlag), fpCmov2(c1Mag, c0Mag, swapFlag)];
    const negFlag = 1 - fqSgn2(result) * s >> 1;
    result = fqCmov2(result, fqNeg2(result), negFlag);
    return result;
  }
  function fqCmov2(a, b, flag) {
    const mask = -BigInt(flag & 1);
    const invMask = ~mask;
    return [a[0] & invMask | b[0] & mask, a[1] & invMask | b[1] & mask];
  }
  function fqToBytes2(a) {
    const buf = new Uint8Array(SIZE_FP2 * 2);
    buf.set(fpToBytes2(a[0]), 0);
    buf.set(fpToBytes2(a[1]), SIZE_FP2);
    return buf;
  }
  function fqFromBytes2(buf) {
    if (buf.length !== SIZE_FP2 * 2) return null;
    const a0 = fpFromBytes2(buf.slice(0, SIZE_FP2));
    const a1 = fpFromBytes2(buf.slice(SIZE_FP2));
    if (a0 === null || a1 === null) return null;
    return [a0, a1];
  }

  // node_modules/@qubic.org/crypto/src/fourq.ts
  var ORDER_GENERATOR2 = [
    0x2fb2540ec7768ce7n,
    0xdfbd004dfe0f7999n,
    0xf05397829cbc14e5n,
    0x0029cbc14e5e0a72n
  ];
  function pointIdentity2() {
    return { X: fqZero2(), Y: fqOne2(), Z: fqOne2(), Ta: fqZero2(), Tb: fqZero2() };
  }
  function pointGenerator2() {
    return {
      X: fqCopy2(GENERATOR_X2),
      Y: fqCopy2(GENERATOR_Y2),
      Z: fqOne2(),
      Ta: fqCopy2(GENERATOR_X2),
      Tb: fqCopy2(GENERATOR_Y2)
    };
  }
  function pointCopy2(P4) {
    return {
      X: fqCopy2(P4.X),
      Y: fqCopy2(P4.Y),
      Z: fqCopy2(P4.Z),
      Ta: fqCopy2(P4.Ta),
      Tb: fqCopy2(P4.Tb)
    };
  }
  function pointDouble2(P4) {
    const a = fqSqr2(P4.X);
    const b = fqSqr2(P4.Y);
    const c = fqSqr2(P4.Z);
    const c2 = fqAdd2(c, c);
    const d = fqAdd2(a, b);
    const xplusySqr = fqSqr2(fqAdd2(P4.X, P4.Y));
    const e = fqSub2(xplusySqr, d);
    const f = fqSub2(b, a);
    const g = fqSub2(c2, f);
    return { X: fqMul2(e, g), Y: fqMul2(d, f), Z: fqMul2(f, g), Ta: d, Tb: e };
  }
  function pointAdd2(P4, Q) {
    const cc = fqMul2(P4.Ta, P4.Tb);
    const h = fqSub2(P4.Y, P4.X);
    const bb = fqAdd2(P4.Y, P4.X);
    const a = fqMul2(h, Q.subYX);
    const bv = fqMul2(bb, Q.addYX);
    const e = fqSub2(bv, a);
    const hh = fqAdd2(bv, a);
    const dd = fqMul2(P4.Z, Q.z2);
    const c2 = fqMul2(cc, Q.dt2);
    const f = fqSub2(dd, c2);
    const g = fqAdd2(dd, c2);
    return { X: fqMul2(e, f), Y: fqMul2(g, hh), Z: fqMul2(f, g), Ta: e, Tb: hh };
  }
  function toR22(P4) {
    const t = fqMul2(P4.Ta, P4.Tb);
    const dt = fqMul2(t, PARAM_D2);
    const dt2 = fqAdd2(dt, dt);
    return { addYX: fqAdd2(P4.Y, P4.X), subYX: fqSub2(P4.Y, P4.X), z2: fqAdd2(P4.Z, P4.Z), dt2 };
  }
  function r3Cmov2(a, b, flag) {
    return {
      addYX: fqCmov2(a.addYX, b.addYX, flag),
      subYX: fqCmov2(a.subYX, b.subYX, flag),
      dt2: fqCmov2(a.dt2, b.dt2, flag)
    };
  }
  function r3Cneg2(P4, flag) {
    const tAddYX = fqCopy2(P4.addYX);
    const tSubYX = fqCopy2(P4.subYX);
    const tNegDt2 = fqNeg2(P4.dt2);
    return {
      addYX: fqCmov2(tAddYX, tSubYX, flag),
      subYX: fqCmov2(tSubYX, tAddYX, flag),
      dt2: fqCmov2(P4.dt2, tNegDt2, flag)
    };
  }
  function r2Cmov2(a, b, flag) {
    const r3 = r3Cmov2(a, b, flag);
    return { ...r3, z2: fqCmov2(a.z2, b.z2, flag) };
  }
  function r2Cneg2(P4, flag) {
    const r3 = r3Cneg2(P4, flag);
    return { ...r3, z2: fqCopy2(P4.z2) };
  }
  function toAffine2(P4) {
    const zInv = fqInv2(P4.Z);
    const X = fqMul2(P4.X, zInv);
    const Y = fqMul2(P4.Y, zInv);
    return { X, Y, Z: fqOne2(), Ta: fqCopy2(X), Tb: fqCopy2(Y) };
  }
  function add642(a, b, carry) {
    const sum = a + b + carry;
    return [sum & MASK642, sum >> 64n];
  }
  function sub642(a, b, borrow) {
    const res = a - b - borrow;
    return [res & MASK642, res >> 64n & 1n];
  }
  var MASK642 = 0xffffffffffffffffn;
  function condAddOrderN2(x) {
    const mask = (x[0] & 1n) - 1n;
    let carry = 0n;
    for (let i = 0; i < 4; i++) {
      const addend = ORDER_GENERATOR2[i] & mask;
      const [res, nextCarry] = add642(x[i], addend, carry);
      x[i] = res;
      carry = nextCarry;
    }
    const [res4] = add642(x[4], 0n, carry);
    x[4] = res4;
  }
  function subYDiv162(x, y) {
    const yBig = BigInt(y);
    const s = yBig >> 63n & MASK642;
    const [r0, b0] = sub642(x[0], yBig & MASK642, 0n);
    const [r1, b1] = sub642(x[1], s, b0);
    const [r2, b2] = sub642(x[2], s, b1);
    const [r3, b3] = sub642(x[3], s, b2);
    const [r4] = sub642(x[4], s, b3);
    x[0] = r0 >> 4n | r1 << 60n;
    x[1] = r1 >> 4n | r2 << 60n;
    x[2] = r2 >> 4n | r3 << 60n;
    x[3] = r3 >> 4n | r4 << 60n;
    x[4] = r4 >> 4n;
  }
  function recodeScalar2(k) {
    const d = new Int8Array(65);
    const m = new BigUint64Array(5);
    const view = new DataView(k.buffer, k.byteOffset, 32);
    m[0] = view.getBigUint64(0, true);
    m[1] = view.getBigUint64(8, true);
    m[2] = view.getBigUint64(16, true);
    m[3] = view.getBigUint64(24, true);
    condAddOrderN2(m);
    for (let i = 0; i < 64; i++) {
      d[i] = Number((m[0] & 0x1fn) - 16n);
      subYDiv162(m, d[i]);
    }
    d[64] = Number((m[0] & 0xffn ^ 0x80n) - 0x80n);
    return d;
  }
  function scalarBaseMult2(scalar) {
    return scalarMult2(scalar, pointGenerator2());
  }
  function oddMultiples2(Q) {
    let p2 = pointCopy2(Q);
    p2 = pointDouble2(p2);
    const pp2 = toR22(p2);
    const T = [toR22(Q)];
    let R = pointCopy2(Q);
    for (let i = 1; i < 8; i++) {
      R = pointAdd2(R, pp2);
      T.push(toR22(R));
    }
    return T;
  }
  function scalarMult2(k, Q) {
    const tabQ = oddMultiples2(Q);
    const d = recodeScalar2(k);
    let P4 = pointIdentity2();
    for (let i = 64; i >= 0; i--) {
      P4 = pointDouble2(P4);
      P4 = pointDouble2(P4);
      P4 = pointDouble2(P4);
      P4 = pointDouble2(P4);
      const di = d[i];
      const mask = di >> 7;
      const absDi = di + mask ^ mask;
      const inx = absDi - 1 >> 1;
      const sig = di >> 7 & 1;
      let S = { addYX: fqZero2(), subYX: fqZero2(), dt2: fqZero2(), z2: fqZero2() };
      for (let j = 0; j < 8; j++) {
        S = r2Cmov2(S, tabQ[j], Number(BigInt(inx ^ j) - 1n >> 63n & 1n));
      }
      S = r2Cneg2(S, sig);
      P4 = pointAdd2(P4, S);
    }
    return P4;
  }
  function doubleScalarMult2(k1, Q, k2) {
    const P1 = scalarBaseMult2(k1);
    const P22 = scalarMult2(k2, Q);
    const Q2 = toR22(P22);
    return pointAdd2(P1, Q2);
  }
  function pointMarshal2(P4) {
    const aff = toAffine2(P4);
    const out = fqToBytes2(aff.Y);
    const s = fqSgn2(aff.X);
    const b = 1 - s >> 1;
    out[31] = out[31] | b << 7;
    return out;
  }
  function pointUnmarshal2(input) {
    const buf = new Uint8Array(input);
    const s = buf[31] >> 7;
    buf[31] = buf[31] & 127;
    const Y = fqFromBytes2(buf);
    if (Y === null) return null;
    const one = fqOne2();
    const t0 = fqSqr2(Y);
    const t1pre = fqMul2(t0, PARAM_D2);
    const u = fqSub2(t0, one);
    const v = fqAdd2(t1pre, one);
    const X = fqSqrt2(u, v, 1 - 2 * s);
    const P4 = { X, Y, Z: fqOne2(), Ta: fqCopy2(X), Tb: fqCopy2(Y) };
    const curveFlag = Number(isOnCurve2(P4));
    const flippedX = [P4.X[0], fpNeg2(P4.X[1])];
    P4.X = fqCmov2(flippedX, P4.X, curveFlag);
    P4.Ta = fqCopy2(P4.X);
    P4.Tb = fqCopy2(P4.Y);
    return P4;
  }
  function isOnCurve2(P4) {
    const t0 = fqAdd2(P4.Y, P4.X);
    let lhs = fqSub2(P4.Y, P4.X);
    lhs = fqMul2(lhs, t0);
    let rhs = fqMul2(P4.X, P4.Y);
    rhs = fqSqr2(rhs);
    rhs = fqMul2(rhs, PARAM_D2);
    const one = fqOne2();
    rhs = fqAdd2(rhs, one);
    const diff = fqSub2(lhs, rhs);
    return fqIsZero2(diff);
  }

  // node_modules/@qubic.org/crypto/src/schnorrq.ts
  var ORDER2 = 0x0029cbc14e5e0a72f05397829cbc14e5dfbd004dfe0f79992fb2540ec7768ce7n;
  return __toCommonJS(entry_exports);
})();
