// The built page's one script. src/assemble.py puts the vendored libraries and the app in ONE inline script and
// hands the libraries to the app as an argument, so no global name ever holds them and no other script runs between
// the two. This builds the page from src/ and build/ into a temporary folder, checks its shape, and runs its script in
// a VM with a small browser stand-in:
//  - one script, pinned by the CSP; each bundle in it byte for byte, once, and the one recorded (SHA-256); the
//    script adds no global at all;
//  - a library planted before the page, under every name one could be handed over by, is never read, whether the
//    page's own libraries start or fail to: the wallet runs on the library its own bundles made (self-test, random
//    seeds, a signed transfer), or stops with its message;
//  - libraries that throw while starting stop the wallet with a message, before any screen.
// One run gives code a turn between the page's scripts (as a MutationObserver callback gets one) to swap a library in.
// A one-script page has no such turn, so that run is the control again: it is there for a return to two scripts. What
// rules the swap out is the shape check (one script, one hash).
// The built-ins are not tested here: code that runs before the page can still replace them (Object.freeze,
// Object.defineProperty, crypto...) and swap a library that way.
// Usage: node page.cjs <build dir> <src dir>
// MUTATE: page-global (assemble.py hands the library over through window.__qwVendor, whatever holds it winning, as an
//   earlier version did) | app-global (03-qubic.js reads window.__qwVendor first, as an earlier version did) |
//   no-library-runs (boot carries on without the library) | catch-fallback (assemble.py takes a global QubicLib when the bundles fail to start). Each
//   is applied to a copy of src/, which is then built.
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const { check, finish, harnessError, fault } = require('./lib/check.cjs');
const [BUILD, SRC] = process.argv.slice(2).map((p) => path.resolve(p));
const read = (f) => fs.readFileSync(f, 'utf8');

// The bundles' SHA-256 as recorded when they were vendored (see src/vendor-header.js): a changed file in build/ fails
// here, not only a change the build makes. Updating a library means updating these with its header.
const BUNDLE_SHA256 = {
  'qubic-lib.iife.js': 'f70955c99b32dddf1a6b861c9fa59278272c37396a0c55663937686ee877393e',
  'qrcodegen.js': 'ca35d90f4611cdeb35845d968f6b8adfb99ca14bade2bb3295f1eb026425fb88',
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qw-page-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const src = path.join(tmp, 'src');
fs.cpSync(SRC, src, { recursive: true });
// Every anchor is looked for in the unmutated source on every run, and must be there exactly once, so a source change
// that moves one fails the clean run instead of leaving a fault proof that can't fail.
const mutation = (name, file, from, to) => {
  const original = read(path.join(SRC, file));
  const found = original.split(from).length - 1;
  if (found !== 1) throw new Error(`mutation anchor ${found ? `found ${found} times` : 'missing'} (${name}): ${from.slice(0, 50)}`);
  if (process.env.MUTATE === name) fs.writeFileSync(path.join(src, file), original.replace(from, () => to));
};
const HANDOVER = 'return Object.freeze({ QubicLib: Object.freeze(QubicLib), qrcodegen: Object.freeze(qrcodegen) });';
mutation('page-global', 'assemble.py', HANDOVER, `return window.__qwVendor || ${HANDOVER.slice('return '.length)}`);
const FALLBACK = 'vendored = globalThis.QubicLib ? { QubicLib: globalThis.QubicLib, qrcodegen: globalThis.qrcodegen } : null;';
mutation('catch-fallback', 'assemble.py', '+ "} catch (err) {\\n"', `+ "} catch (err) {\\n  ${FALLBACK}\\n"`);
mutation('app-global', path.join('js', '03-qubic.js'), 'const Q = /** @type {QubicLib} */ (VENDORED ? VENDORED.QubicLib : null);',
  'const Q = /** @type {QubicLib} */ (window.__qwVendor ? window.__qwVendor.QubicLib : VENDORED ? VENDORED.QubicLib : null);');
mutation('no-library-runs', path.join('js', '11-main.js'), 'if (!Q || !QR) {', 'if (false) {');

const pageFile = path.join(tmp, 'index.html');
execFileSync('python3', ['-I', path.join(src, 'assemble.py'), src, BUILD, pageFile], { stdio: ['ignore', 'ignore', 'inherit'] });
const html = read(pageFile);
const scripts = [...html.matchAll(/<(script|style)>(.*?)<\/\1>/gs)].filter((m) => m[1] === 'script').map((m) => m[2]);
const bundles = Object.keys(BUNDLE_SHA256).map((f) => ({ name: f, text: read(path.join(BUILD, f)) }));
const appFiles = fs.readdirSync(path.join(src, 'js')).filter((f) => f.endsWith('.js')).sort()
  .map((f) => read(path.join(src, 'js', f)));

// ── What a browser would do with the page ───────────────────────────────────
// Enough DOM for boot() to write its one-line refusal and stop: framed (boot refuses frames first), or without its
// library. Intervals never fire: boot starts its heartbeat only after the screens no run here should reach.
class Node {}
class El extends Node {
  constructor(tag) {
    super();
    Object.assign(this, { tag, children: [], textContent: '', dataset: {}, style: { setProperty() {}, removeProperty() {} } });
  }
  setAttribute() {} addEventListener() {} querySelector() { return null; }
  append(...c) { this.children.push(...c); }
  replaceChildren(...c) { this.children = c; }
}
// A promise the page left rejected is collected, not a broken harness: boot going on to draw a screen in this
// stand-in ends in one, and the checks count them. (This suite's own steps run in one chain, caught below.)
const rejections = [];
process.removeAllListeners('unhandledRejection');
process.on('unhandledRejection', (e) => { rejections.push(e); });
const FRAMED = 'qoree doesn’t run inside frames. Open it directly.';
const NO_LIBRARY = 'qoree can’t run in this browser: its cryptography didn’t start. Any wallet saved here is unchanged. '
  + 'Updating this browser may fix it.';

// Script that ran before the page (an extension at document_start, or the page that opened this one) holds a working
// copy of the real library whose seeds are fixed; it passes every known-answer test. It can leave that copy, before
// the page, under every global name a library could be handed over by, fixed in place so the page can't overwrite it
// and noting every read ('before'); and it gets a turn between any two scripts of the page, as a MutationObserver
// callback does at the microtask checkpoint there, to swap the copy in under any replaceable global that script added
// holding a library ('between').
const PLANTED_SEED = 'abcdefghijklmnopqrstuvwxyz'.repeat(3).slice(0, 55);
const PLANT = (before) => `(function () {
${bundles.map((b) => b.text).join('\n')}
const lib = Object.freeze({ ...QubicLib, generateRandomSeed: () => '${PLANTED_SEED}' });
const ns = Object.freeze({ QubicLib: lib, qrcodegen });
const plant = { reads: [], swaps: [], lib };
plant.between = (added) => {
  for (const name of added) {
    const d = Object.getOwnPropertyDescriptor(globalThis, name);
    if (d && d.configurable && d.value && Object.prototype.hasOwnProperty.call(d.value, 'QubicLib')) {
      Object.defineProperty(globalThis, name, { value: ns, configurable: true }); plant.swaps.push(String(name));
    }
  }
};
Object.defineProperty(globalThis, '__plant', { value: plant });
const names = [['__qwVendor', ns], ['QubicLib', lib], ['qrcodegen', qrcodegen], ['VENDORED', ns], ['vendored', ns]];
if (${before}) for (const [name, value] of names) {
  Object.defineProperty(globalThis, name, { get() { plant.reads.push(name); return value; }, configurable: false, enumerable: false });
}
})();`;

// The app's own names, read from inside its function: appended to its last file (src/js/11-main.js), in a copy of
// the script, so the test can call it. Only a copy carries it; the checks on what the page reads use the script as
// built.
const PROBE = '\n;globalThis.__probe = { Q, state, runSelfTest, generateSeed, deriveAccount, signTransfer, KAT };\n';
function probed(script) {
  const last = appFiles[appFiles.length - 1];
  const at = script.indexOf(last);
  if (at < 0 || script.indexOf(last, at + 1) >= 0) return null;
  return script.slice(0, at + last.length) + PROBE + script.slice(at + last.length);
}

// plant: null, 'before' or 'between' (see PLANT). noBigInt: the libraries fail to start (see below).
function load({ framed = true, plant = null, noBigInt = false, probe = false } = {}) {
  const body = new El('body');
  const documentElement = new El('html');
  const document = {
    body, documentElement, createElement: (t) => new El(t), createElementNS: (ns, t) => new El(t),
    querySelector: () => null, getElementById: () => null, addEventListener() {},
  };
  const warnings = [];
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const ctx = {
    console: { ...console, warn: (...a) => warnings.push(a.join(' ')) },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    TextEncoder, TextDecoder, atob, btoa, performance, AbortController, Node, document, crypto: crypto.webcrypto,
    localStorage: storage, sessionStorage: storage, navigator: { onLine: true }, isSecureContext: true,
    addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  ctx.window = ctx; ctx.self = ctx; ctx.top = framed ? {} : ctx;
  vm.createContext(ctx);
  if (plant) vm.runInContext(PLANT(plant === 'before'), ctx);
  // The bundles call BigInt() while starting; the app's own start doesn't. Without it, only the libraries fail.
  if (noBigInt) vm.runInContext('delete globalThis.BigInt;', ctx);
  // Every own key of the global object, symbols included: a hand-over could use either.
  const globals = () => vm.runInContext('Reflect.ownKeys(globalThis)', ctx);
  const before = new Set(globals());
  const rejectedBefore = rejections.length;
  let threw = null;
  const list = probe ? scripts.map((s, i) => (i === scripts.length - 1 ? probed(s) : s)) : scripts;
  for (const [i, s] of list.entries()) {
    if (s === null) { threw = new Error('the app’s last file was not found once in the script'); break; }
    try { vm.runInContext(s, ctx); } catch (e) { threw = threw || e; }
    if (plant && i < list.length - 1) ctx.__plant.between(globals().filter((n) => !before.has(n)));
  }
  const added = globals().filter((n) => !before.has(n) && n !== '__probe').map(String);
  const shown = () => body.children.map((c) => c.textContent).join(' | ');
  const rejected = () => rejections.length - rejectedBefore;
  return { ctx, threw, added, shown, rejected, warnings, documentElement, plant: ctx.__plant, app: ctx.__probe };
}
const settle = () => new Promise((r) => setTimeout(r, 50));

(async () => {
  // ── Shape ─────────────────────────────────────────────────────────────────
  const pin = (t) => `'sha256-${crypto.createHash('sha256').update(t, 'utf8').digest('base64')}'`;
  const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1] || '';
  const scriptSrc = ((csp.match(/script-src ([^;]*)/) || [])[1] || '').trim().split(/\s+/).filter(Boolean);
  check('the page has one script, and the CSP admits exactly that one',
    scripts.length === 1 && scriptSrc.length === 1 && scriptSrc[0] === pin(scripts[0]),
    `${scripts.length} script block(s), ${scriptSrc.length} script hash(es)`);
  // The rest of the policy, exactly: nothing loosened (an 'unsafe-' source, a wildcard, another host, Trusted Types
  // dropped), the one style block pinned, and every host it allows listed in docs/SECURITY.md.
  const policy = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([name, ...v]) => [name, v.join(' ')]));
  const hosts = ['https://rpc.qubic.org', 'https://api.coingecko.com', 'https://api.gateio.ws', 'https://api.mexc.com', 'https://static.qubic.org'];
  if (fault('csp-shape')) hosts.push('https://example.com');
  const styles = [...html.matchAll(/<style>(.*?)<\/style>/gs)].map((m) => m[1]);
  const expected = { 'default-src': "'none'", 'script-src': scriptSrc.join(' '), 'style-src': styles.length === 1 ? pin(styles[0]) : 'one style block',
    'font-src': 'data:', 'img-src': 'data:', 'connect-src': hosts.join(' '), 'base-uri': "'none'", 'form-action': "'none'", 'object-src': "'none'",
    'frame-src': "'none'", 'worker-src': "'none'", 'manifest-src': "'none'", 'media-src': "'none'", 'require-trusted-types-for': "'script'", 'trusted-types': "'none'" };
  const off = [...new Set([...Object.keys(policy), ...Object.keys(expected)])].filter((k) => policy[k] !== expected[k]);
  const docs = fs.readFileSync(path.join(SRC, '..', 'docs', 'SECURITY.md'), 'utf8');
  const undocumented = hosts.filter((h) => !docs.includes(`\`${h.replace('https://', '')}\``));
  check('the rest of the CSP is exactly as reviewed (the one style block pinned, these hosts and no others), and each host is in docs/SECURITY.md',
    off.length === 0 && undocumented.length === 0, `differs: ${off.join(', ') || 'none'}; not in the docs: ${undocumented.join(', ') || 'none'}`);
  const whole = scripts.join('\n');
  const appAt = whole.indexOf(appFiles[0]);
  const count = (b) => whole.split(b.text).length - 1;
  const sha256 = (b) => crypto.createHash('sha256').update(b.text, 'utf8').digest('hex');
  const recorded = (b) => sha256(b) === BUNDLE_SHA256[b.name];
  check('each vendored bundle is in it byte for byte, once, ahead of the app, and is the one recorded (SHA-256)',
    appAt > 0 && bundles.every((b) => count(b) === 1 && whole.indexOf(b.text) < appAt && recorded(b)),
    bundles.map((b) => `${b.name} ${count(b)}×, ${recorded(b) ? 'recorded' : `sha256 ${sha256(b)}`}`).join('; '));
  check('the old hand-over name, __qwVendor, appears nowhere in the page', !html.includes('__qwVendor'));

  // ── Nothing to plant, nothing to swap ─────────────────────────────────────
  const C = load();
  check('the script runs to its end and adds no global: nothing holds the library for other code to take or replace',
    !C.threw && C.added.length === 0 && C.shown() === FRAMED,
    C.threw ? `threw: ${C.threw.message}` : `added ${C.added.join(', ') || 'none'}; shown: ${C.shown()}`);

  const P = load({ plant: 'before' });
  const readsDuringPage = P.plant.reads.length;
  vm.runInContext('void globalThis.__qwVendor;', P.ctx); // the plant notices a read: this one must count
  check('a library planted before the page, under every hand-over name and fixed in place, is never read',
    !P.threw && readsDuringPage === 0 && P.plant.reads.length === readsDuringPage + 1 && P.shown() === FRAMED,
    P.threw ? `threw: ${P.threw.message}` : `read during the page: ${P.plant.reads.slice(0, readsDuringPage).join(', ') || 'nothing'}`);

  // ── The wallet runs on its own library, planted or not ────────────────────
  const LABELS = {
    null: 'control, nothing planted',
    before: 'with that library planted before the page',
    between: 'with code that swaps a library in between scripts (a model for a return to two: one script has no between)',
  };
  for (const plant of [null, 'before', 'between']) {
    const T = load({ plant, probe: true });
    const label = LABELS[plant];
    if (!T.app) { check(`${label}: the app’s own functions can be reached`, false, T.threw ? T.threw.message : 'no probe'); continue; }
    await T.app.runSelfTest();
    const attempt = (fn) => { try { return fn(); } catch (e) { return `refused: ${e.code || e.message}`; } };
    const seeds = [0, 1, 2].map(() => attempt(() => T.app.generateSeed()));
    const account = attempt(() => T.app.deriveAccount(T.app.KAT.seed));
    let hash = null;
    try {
      const destination = T.app.deriveAccount(seeds[0]).identity;
      const signed = await T.app.signTransfer({ seed: T.app.KAT.seed, account, destination, amount: 1n, targetTick: 110, currentTick: 100 });
      hash = signed && signed.hash;
    } catch (e) { hash = `refused: ${e.code || e.message}`; }
    const { status, failed } = T.app.state.selfTest;
    const ownLibrary = Boolean(T.app.Q) && typeof T.app.Q.deriveKeys === 'function' && (!T.plant || T.app.Q !== T.plant.lib);
    const freshSeeds = seeds.every((s) => /^[a-z]{55}$/.test(s) && s !== PLANTED_SEED) && new Set(seeds).size === 3;
    const untouched = !T.plant || (T.plant.reads.length === 0 && T.plant.swaps.length === 0);
    const seedsSaid = seeds.includes(PLANTED_SEED) ? 'the planted one' : seeds.every((x) => /^[a-z]{55}$/.test(x)) ? 'random' : seeds[0];
    check(`${label}: the wallet uses the library its own bundles made (self-test passes, seeds are random and new, a transfer signs)`,
      ownLibrary && status === 'pass' && freshSeeds && account && account.identity === T.app.KAT.identity
        && /^[a-z]{60}$/.test(hash || '') && untouched,
      `self-test ${status}${failed ? ` at ${failed}` : ''}; seeds ${seedsSaid}; transfer ${hash}`
        + (T.plant ? `; planted reads ${T.plant.reads.length}, swaps ${T.plant.swaps.length}` : ''));
  }

  // ── Libraries that don't start ────────────────────────────────────────────
  const N = load({ framed: false, noBigInt: true });
  await settle();
  const warned = N.warnings.filter((w) => w.startsWith('[wallet] the vendored libraries failed to start')).length;
  check('libraries that throw while starting stop the wallet: it says why, logs it once, and draws no screen',
    !N.threw && N.shown() === NO_LIBRARY && warned === 1 && N.rejected() === 0 && N.documentElement.dataset.theme === undefined,
    N.threw ? `threw: ${N.threw.message}` : `shown: ${N.shown() || 'nothing'}; ${warned} warning(s); ${N.rejected()} unhandled rejection(s)`);

  // Code that ran before the page can make the page's own libraries fail to start (it replaced BigInt, say, keeping
  // the real one for its copy) while its copy waits under every hand-over name. A fallback to a global library when
  // `vendored` is null, in the wrapper or in the app, would then run the wallet on that copy.
  const F = load({ framed: false, noBigInt: true, plant: 'before' });
  await settle();
  check('a library planted before the page is never read when the page’s own libraries fail to start: the wallet stops with its message',
    !F.threw && F.plant.reads.length === 0 && F.shown() === NO_LIBRARY && F.rejected() === 0,
    F.threw ? `threw: ${F.threw.message}`
      : `read: ${F.plant.reads.join(', ') || 'nothing'}; shown: ${F.shown() || 'nothing'}; ${F.rejected()} unhandled rejection(s)`);

  finish('page');
})().catch(harnessError);
