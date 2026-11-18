// The type check build.sh runs after lint: tsconfig.json (src/js with src/types.d.ts), then the files in STRICT again
// with strictNullChecks on. src/js is one scope, so that second pass reads every file but reports only those. Exits 1
// on any error, and 2 if a file in STRICT isn't among the ones checked.
//   node typecheck.js [src dir]   another copy of src/ in place of ../src (tests/types.cjs plants faults in one)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const STRICT = ['03-qubic.js', '04-storage.js', '05-net.js', '06-store.js'];

const dir = path.dirname(fileURLToPath(import.meta.url));
const host = { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: (f) => f, getNewLine: () => '\n' };
let errors = 0;
const report = (diags, label = '') => {
  for (const d of diags) process.stdout.write(label + ts.formatDiagnostics([d], host));
  errors += diags.length;
};

const config = ts.getParsedCommandLineOfConfigFile(path.join(dir, 'tsconfig.json'), {}, {
  ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => report([d]),
});
if (!config) process.exit(1);
report(config.errors);
const src = path.join(dir, '..', 'src');
const other = process.argv[2] && path.resolve(process.argv[2]);
const files = other ? config.fileNames.map((f) => path.join(other, path.relative(src, f))) : config.fileNames;
const base = ts.createProgram({ rootNames: files, options: config.options });
report(ts.getPreEmitDiagnostics(base));

const strict = ts.createProgram({ rootNames: files, options: { ...config.options, strictNullChecks: true }, oldProgram: base });
for (const name of STRICT) {
  const found = strict.getSourceFiles().filter((f) => path.basename(f.fileName) === name && path.basename(path.dirname(f.fileName)) === 'js');
  if (found.length !== 1) { console.error(`typecheck.js: ${name} (in STRICT) is not one of the files checked`); process.exit(2); }
  report(strict.getSemanticDiagnostics(found[0]), 'strictNullChecks: ');
}
process.exit(errors ? 1 : 0);
