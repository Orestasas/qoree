// Shared by the test files: named checks that are counted, one summary line, and an exit code that carries the result
// (0: every check passed; 1: a check failed, or none ran; 2: the harness itself broke; 3: skipped, for live checks
// that can't reach the network). A summary line is for people: test.sh reads only the exit code.
// TEST_FAULT=<name>[,<name>] makes a test corrupt one of its own expected values on purpose, so a run can prove that
// the check it feeds really fails (see prove-failures.sh). Each test lists the fault names it knows.
const results = [];
const faults = new Set((process.env.TEST_FAULT || '').split(',').map((s) => s.trim()).filter(Boolean));

function check(name, ok, detail = '') {
  const pass = ok === true;
  results.push({ name, pass });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  return pass;
}
const fault = (name) => faults.has(name);

// A suite that stops before finish() (it awaited something that never settles, so nothing was left to run) would
// otherwise exit 0 with its remaining checks unrun: that is the harness breaking.
let finished = false;
process.on('exit', (code) => {
  if (finished || code !== 0) return;
  console.log('HARNESS ERROR the suite stopped before it finished');
  process.exitCode = 2;
});

function finish(what) {
  finished = true;
  // summary-lie: a suite that prints a passing summary and still fails, to prove the runner reads exit codes only.
  if (fault('summary-lie')) { console.log(`PASSED: all ${results.length} ${what} checks`); process.exit(1); }
  const failed = results.filter((r) => !r.pass);
  if (!results.length) { console.log(`FAILED: ${what}: no checks ran`); process.exit(1); }
  console.log(failed.length ? `FAILED: ${failed.length} of ${results.length} ${what} checks` : `PASSED: all ${results.length} ${what} checks`);
  process.exit(failed.length ? 1 : 0);
}
function harnessError(e) {
  console.error('HARNESS ERROR', (e && e.stack) || e);
  process.exit(2);
}
// Anything thrown outside a suite's own catch (while loading, say) is the harness breaking too, never a failed check.
process.on('uncaughtException', harnessError);
process.on('unhandledRejection', harnessError);
function skip(why) {
  console.log(`SKIPPED: ${why}`);
  process.exit(3);
}

// Deterministic pseudo-random numbers (mulberry32): the same inputs on every run, so a failure reproduces. Never used
// for anything secret: the app's own seed generator is tested separately.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const bytesFrom = (rand, n) => Uint8Array.from({ length: n }, () => Math.floor(rand() * 256));
const seedFrom = (rand) => Array.from({ length: 55 }, () => String.fromCharCode(97 + Math.floor(rand() * 26))).join('');
// One character changed: for corrupting an expected string on purpose.
const altered = (s, at = 0) => s.slice(0, at) + (s[at] === 'a' || s[at] === 'A' || s[at] === '0' ? String.fromCharCode(s.charCodeAt(at) + 1) : String.fromCharCode(s.charCodeAt(at) - 1)) + s.slice(at + 1);

module.exports = { check, fault, finish, harnessError, skip, prng, bytesFrom, seedFrom, altered };
