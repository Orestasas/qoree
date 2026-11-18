#!/bin/zsh
# Rebuild index.html from src/, then syntax-check its one script, lint the app part of it and type-check src/js.
set -e
ROOT="${0:A:h}"
OUT="$ROOT/index.html"
# assemble.py also writes the app part of the page's script, as embedded, to lint/app.js (after a /* global vendored */
# line: the one name it takes from the function around it).
python3 "$ROOT/src/assemble.py" "$ROOT/src" "$ROOT/build" "$OUT" "$ROOT/lint/app.js"
# The whole script as the page holds it, the wrapper around the libraries and the app included: a slip there would
# otherwise build a page that runs nothing while lint passes. The page must have exactly one script.
python3 - "$OUT" "$ROOT/lint/script.js" <<'PY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
scripts = re.findall(r'<script>(.*?)</script>', s, re.S)
len(scripts) == 1 or sys.exit(f'{sys.argv[1]}: {len(scripts)} script blocks, expected one')
open(sys.argv[2], 'w', encoding='utf-8').write(scripts[0])
PY
node --check "$ROOT/lint/script.js"
node --check "$ROOT/lint/app.js"
cd "$ROOT/lint" && ./node_modules/.bin/eslint --max-warnings 0 app.js && echo "lint OK"
# tsc over src/js as written (with src/types.d.ts, which isn't shipped), then strict null checks on the files listed in
# typecheck.js.
node typecheck.js && echo "types OK"
