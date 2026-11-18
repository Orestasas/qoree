// Shared by the test files: the page's script in its parts, to run in a VM context the way the page runs them
// (src/assemble.py): in strict mode, so a write to a frozen object or an undeclared name throws here as it does in the
// browser. tests/page.cjs runs the page's own script, as built.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const read = (f) => fs.readFileSync(f, 'utf8');
// Code run in the VM context ctx, or in this one when ctx is null.
const run = (code, ctx) => (ctx ? vm.runInContext(code, ctx) : vm.runInThisContext(code));

// The vendored libraries, as the page makes them: both bundles run in one strict-mode function of their own, which
// returns them as one frozen namespace. The script's value is that namespace; no global name holds it, here as in the
// page.
const vendorScript = (build) => `(function () {\n'use strict';\n${read(path.join(build, 'qubic-lib.iife.js'))}\n${read(path.join(build, 'qrcodegen.js'))}
return Object.freeze({ QubicLib: Object.freeze(QubicLib), qrcodegen: Object.freeze(qrcodegen) });\n})();\n`;
// That namespace, made in ctx (or in this context).
const vendored = (build, ctx = null) => run(vendorScript(build), ctx);
// src/js files joined in the order given, as one script (the page joins all of them, in filename order).
const appScript = (src, files) => files.map((f) => read(path.join(src, 'js', f))).join('\n');
// Runs code holding the app's files (a suite's stubs first, then the files, then what it hands back) as the page runs
// its app: one strict-mode arrow function, given the libraries as its VENDORED parameter (null: they didn't start).
// Returns what the code returns.
const runApp = (code, VENDORED, ctx = null) => run(`((VENDORED) => {\n'use strict';\n${code}\n})`, ctx)(VENDORED);
// A file of the production web wallet's WASM library (@qubic-lib/qubic-ts-library), the reference implementation.
const wasmLib = (build, file) => require(path.join(build, 'node_modules/@qubic-lib/qubic-ts-library/dist', file));
// One top-level function from a file a suite can't load whole (the UI files need a page): from "function name(" (or
// "async function name(") to its closing brace, the first one at the start of a line.
function pickFunction(src, file, name) {
  const text = read(path.join(src, 'js', file));
  const plain = text.indexOf(`\nfunction ${name}(`);
  const start = plain < 0 ? text.indexOf(`\nasync function ${name}(`) : plain;
  const end = start < 0 ? -1 : text.indexOf('\n}\n', start);
  if (end < 0) throw new Error(`function ${name} not found in ${file}`);
  return text.slice(start + 1, end + 3);
}
// mutation(name, from, to) on a suite's app text: MUTATE=<name> undoes one fix, to show its checks catch the old
// behaviour. Every anchor is looked for in the unmutated source on every run, and must be there exactly once (with a
// second copy the fault could land in the wrong place), so a source change that moves one fails the clean run instead
// of leaving a fault proof that can't fail.
function mutable(text) {
  const source = text;
  let out = text;
  return {
    get text() { return out; },
    mutation(name, from, to) {
      const found = source.split(from).length - 1;
      if (found !== 1) throw new Error(`mutation anchor ${found ? `found ${found} times` : 'missing'} (${name}): ${from.slice(0, 50)}`);
      if (process.env.MUTATE === name) out = out.replace(from, () => to);
    },
  };
}

// For suites that stand in for src/js/06-store.js: its sessions (openSession, nextSession, sessionGuard) as there, over
// the suite's own state, whose session is openSession(). Goes before that state.
const SESSIONS = `let endCurrentSession = () => {};
  function openSession() { const c = new AbortController(); endCurrentSession = () => c.abort(); return { alive: () => !c.signal.aborted, signal: c.signal }; }
  function nextSession() { const end = endCurrentSession; state.session = openSession(); end(); }
  const sessionGuard = () => state.session.alive;`;

module.exports = { vendorScript, vendored, appScript, runApp, wasmLib, pickFunction, mutable, SESSIONS };
