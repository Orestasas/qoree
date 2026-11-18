// The type check (lint/typecheck.js, which build.sh runs): it passes on src/ as it is, and fails on each fault below,
// planted in a copy of src/. That proves tsc reads the shared types and the app with them, and that the strict null
// pass runs on its files.
// Usage: node types.cjs <src dir>
// MUTATE: types-field (a field the app state doesn't have) | types-code (an error code AppError doesn't know) |
//   types-record (parseTx's output drifts from ArchiveTx) | types-null (a restored transfer reads its account, which
//   may be gone, without checking: caught only by the strict null pass on 06-store.js).
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const { check, finish, harnessError } = require('./lib/check.cjs');
const SRC = path.resolve(process.argv[2]);
const read = (f) => fs.readFileSync(f, 'utf8');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qw-types-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const src = path.join(tmp, 'src');
fs.cpSync(SRC, src, { recursive: true });
// Every anchor is looked for in the unmutated source on every run, and must be there exactly once.
const mutation = (name, file, from, to) => {
  const original = read(path.join(SRC, 'js', file));
  const found = original.split(from).length - 1;
  if (found !== 1) throw new Error(`mutation anchor ${found ? `found ${found} times` : 'missing'} (${name}): ${from.slice(0, 50)}`);
  if (process.env.MUTATE === name) fs.writeFileSync(path.join(src, 'js', file), original.replace(from, () => to));
};
try {
  mutation('types-field', '06-store.js', "if (opened.pending === 'unreadable') state.journalProblem = true;",
    "if (opened.pending === 'unreadable') state.journalProblm = true;");
  mutation('types-code', '04-storage.js', "if (!entered) throw new AppError('NO_LOCKS');", "if (!entered) throw new AppError('NO_LOCK');");
  mutation('types-record', '05-net.js', '    tick: t.tickNumber,', '    tickNumber: t.tickNumber,');
  mutation('types-null', '06-store.js', 'draft: acct ? { fromId: acct.id, to, amountRaw: amount.toString() } : null,',
    'draft: { fromId: acct.id, to, amountRaw: amount.toString() },');
} catch (e) { harnessError(e); }

const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'lint', 'typecheck.js'), src], { encoding: 'utf8' });
if (run.error || (run.status !== 0 && run.status !== 1)) harnessError(run.error || `typecheck.js exited ${run.status}: ${run.stderr}`);
const errors = (run.stdout.match(/error TS\d+/g) || []).length;
check('tsc and the strict null pass find no errors', run.status === 0 && errors === 0, errors ? `${errors} errors, first: ${run.stdout.split('\n')[0]}` : '');
finish('type');
