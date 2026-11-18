import base64, hashlib, os, re, sys
src, mock, out = sys.argv[1:4]; os.path.realpath(out) != os.path.realpath(src) or sys.exit('refusing to write the mocked copy over the page')
s = open(src, encoding='utf-8').read(); m = open(mock, encoding='utf-8').read()
# The page has one script: the vendored libraries, then the app, inside one function (src/assemble.py). The mock goes
# in between, as a block of its own, where the libraries are in scope as `vendored` and before any app code runs. If
# the mock throws while loading, the whole script stops there, so the wallet never runs without its mock.
MARK = '{ // QA-ONLY: qa/mock.js, inserted by qa/make.py'
MARK in s and sys.exit('qa/make.py: this page already has the QA mock (it was made by qa/make.py)')
APP = "\n((VENDORED) => {\n'use strict';\n"
if s.count(APP) != 1:
    sys.exit("qa/make.py: the app's start wasn't found exactly once (not a page from src/assemble.py?)")
i = s.index(APP)
s = s[:i] + '\n' + MARK + '\n' + m + '\n}' + s[i:]
# QA_GIVE_UP_MS=<ms>: a shorter give-up time for transfers, so a stall past it can be watched (before the pins below).
if os.environ.get('QA_GIVE_UP_MS'):
    line = 'const PENDING_GIVE_UP_MS = 15 * 60 * 1000;'
    s.count(line) == 1 or sys.exit('PENDING_GIVE_UP_MS line not found')
    s = s.replace(line, 'const PENDING_GIVE_UP_MS = %d;' % int(os.environ['QA_GIVE_UP_MS']))
pin = lambda t: "'sha256-" + base64.b64encode(hashlib.sha256(t.encode()).digest()).decode() + "'"
blocks = re.findall(r'<(script|style)>(.*?)</\1>', s, re.S)
tag = 'http-equiv="Content-Security-Policy" content="'
a = s.index(tag) + len(tag); b = s.index('"', a)
csp = re.sub(r"script-src [^;]*", 'script-src ' + ' '.join(pin(x) for t, x in blocks if t == 'script'), s[a:b])
s = s[:a] + csp + s[b:]
# The title tells a QA copy from the real page at a glance: refuse to write one that doesn't say so.
title = '<title>qoree · Qubic wallet</title>'
s.count(title) == 1 or sys.exit("qa/make.py: the page's <title> wasn't found exactly once, so the copy can't be marked")
s = s.replace(title, '<title>QA MOCK · qoree · Qubic wallet</title>')
open(out, 'w', encoding='utf-8').write(s); print('qa build written')
