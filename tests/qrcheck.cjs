// Round-trips Qubic identities through the vendored qrcodegen encoder (the app's receive QR) and the independent jsQR
// decoder: every decoded text must be exactly the identity encoded. Deterministic identities.
// Usage: node qrcheck.cjs <build dir> <jsQR dir>
// TEST_FAULT: qr-result (corrupts one decoded result)
const path = require('path');
const { check, fault, finish, harnessError, prng, bytesFrom } = require('./lib/check.cjs');
const { vendored } = require('./lib/load.cjs');
const [BUILD, QRT] = process.argv.slice(2).map((p) => path.resolve(p));
try {
  const { QubicLib, qrcodegen } = vendored(BUILD);
  const jsQR = require(path.join(QRT, 'node_modules/jsqr'));
  const { QrCode } = qrcodegen;
  const rand = prng(0x0a2c);
  const N = 200; const wrong = []; const versions = new Set();
  for (let i = 0; i < N; i++) {
    const id = QubicLib.publicKeyToIdentity(bytesFrom(rand, 32));
    const qr = QrCode.encodeText(id, QrCode.Ecc.MEDIUM);
    versions.add(qr.version);
    const scale = 4, border = 4, size = (qr.size + border * 2) * scale;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / scale) - border, my = Math.floor(y / scale) - border;
      const dark = mx >= 0 && my >= 0 && mx < qr.size && my < qr.size && qr.getModule(mx, my);
      const o = (y * size + x) * 4; const v = dark ? 0 : 255;
      data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
    }
    const res = jsQR(data, size, size);
    let decoded = res ? res.data : null;
    if (fault('qr-result') && i === 17) decoded = `${decoded.slice(0, -1)}${decoded.endsWith('A') ? 'B' : 'A'}`;
    if (decoded !== id) wrong.push(i);
  }
  check(`every QR decodes to exactly the identity it encodes (${N} identities, QR version ${[...versions].join('/')})`, wrong.length === 0, wrong.length ? `wrong at #${wrong.join(', #')}` : '');
  finish('QR');
} catch (e) { harnessError(e); }
