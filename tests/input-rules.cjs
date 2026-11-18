// Input rules (src/js 00–01): whole-QUBIC amount parsing, Send's short forms and dollars, and the password estimator.
// Usage: node input-rules.cjs <src dir>
const { check, finish } = require('./lib/check.cjs');
const { appScript, runApp } = require('./lib/load.cjs');
const SRC = process.argv[2];
globalThis.window = { isSecureContext: true };
const code = appScript(SRC, ['00-config.js', '01-util.js', '01b-i18n.js']);
runApp(`const state = { prefs: {} };\n${code}\n globalThis.__r = { parseWholeAmount, parseAmountText, passwordScore };`, null);
const { parseWholeAmount, parseAmountText, passwordScore } = globalThis.__r;
const amounts = {
  '1000': '1000', '1,000': '1000', '1,000,000': '1000000', '1 000 000': '1000000', "1'000": '1000', '1_000': '1000', '0005': '5', '': '',
  '1.00': null, '1.5': null, '2,500.00': null, '-10': null, '+5': null, '1e6': null, '1,5': null, '10,00': null, '1,0000': null, 'abc': null, '12345678901234567890': null,
  '0,500': null, "0'250": null, '00,001': null, '012,345': null,
  '1.000.000': '1000000', '12.345.678': '12345678', '1.000': null, '1.000,00': null, '1.000.00': null, '1.00.000': null, '0.000.000': null,
  '12,34,567': '1234567', '1,00,000': '100000', '12,3,456': null, '123,45,678': null,
};
for (const [input, want] of Object.entries(amounts)) {
  const r = parseWholeAmount(input);
  const got = r.error ? null : r.digits;
  check(`amount ${JSON.stringify(input)}`, got === want, `got ${got}`);
}
// Send's field: a short form comes to a whole amount and reads one way only ("1,500K" could be 1.5K or 1500K); dollars
// convert at the price, rounded down, and need one; while the field is in dollars, a short form isn't one.
const PRICE = 0.000000387;
const sends = [
  ['2.5B', {}, 'short', '2500000000'], ['300M', {}, 'short', '300000000'], ['10k', {}, 'short', '10000'], ['1T', {}, 'short', '1000000000000'],
  ['2,5B', {}, 'short', '2500000000'], ['2.5 b', {}, 'short', '2500000000'], ['0.75K', {}, 'short', '750'], ['1.0000K', {}, 'short', '1000'],
  ['1,500K', {}, 'short', null], ['1.500K', {}, 'short', null], ['10,000K', {}, 'short', null], ['1.2345K', {}, 'short', null],
  ['2.5.5B', {}, 'short', null], ['1,500,000K', {}, 'short', null], ['B', {}, 'short', null], ['-5B', {}, 'short', null], ['99999999T', {}, 'short', null],
  ['$25', { price: PRICE }, 'usd', '64599483'], ['25', { price: PRICE, dollars: true }, 'usd', '64599483'], ['$0.387', { price: PRICE }, 'usd', '1000000'],
  ['25 USD', { price: 0.0000004 }, 'usd', '62500000'], ['$1,250.50', { price: 0.5 }, 'usd', '2501'], ['$25', {}, 'usd', null], ['$', { price: PRICE }, 'usd', null],
  ['2.5B', { price: PRICE, dollars: true }, 'usd', null], ['', { dollars: true }, 'usd', ''],
  ['1,000', {}, 'qubic', '1000'], ['2.5', {}, 'qubic', null], ['', {}, 'qubic', ''],
];
for (const [input, opts, kind, want] of sends) {
  const r = parseAmountText(input, opts);
  const got = r.error ? null : r.digits;
  check(`send amount ${JSON.stringify(input)}${opts.dollars ? ' in dollars' : ''}${opts.price ? ` at $${opts.price}` : ''}`, r.kind === kind && got === want, `${r.kind} ${got}`);
}
const twoWays = parseAmountText('1,500K');
check('send amount: a short form that reads two ways names both', /1,5K/.test(twoWays.error || '') && /1500K/.test(twoWays.error || ''), twoWays.error);
const weak = ['password123', '1234567890', 'qwertyuiop', 'Password2024!', 'qubicwallet1', 'aaaaaaaaaaaa', 'abcdefghijkl', '0987654321', 'letmein2025!'];
const strong = ['correct horse battery staple', 'kV9#pL2!qZ7m', 'plum-orbit-candle-ferry', 'Tq8&zR!m2wLx'];
for (const p of weak) check(`weak password rejected: ${p}`, passwordScore(p) < 2, `score ${passwordScore(p)}`);
for (const p of strong) check(`strong password accepted: ${p}`, passwordScore(p) >= 2, `score ${passwordScore(p)}`);
finish('input');
