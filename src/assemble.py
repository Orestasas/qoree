#!/usr/bin/env python3
"""Assembles the single-file wallet: head + style + body + one script (vendored libs, then the app),
then pins the inline <script> and <style> blocks in the Content-Security-Policy by SHA-256."""
import base64
import hashlib
import json
import pathlib
import re
import sys

SRC = pathlib.Path(sys.argv[1])
BUILD = pathlib.Path(sys.argv[2])
OUT = pathlib.Path(sys.argv[3])
LINT = pathlib.Path(sys.argv[4]) if len(sys.argv) > 4 else None  # optional: where to write the app part for lint


def read(p):
    return p.read_text(encoding="utf-8")


def sha(text):
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode() + "'"


head = read(SRC / "head.html")
# The release's version, from the app's own config, also heads the README, so the file names itself.
version = re.search(r"const APP_VERSION = '([^']+)';", read(SRC / "js" / "00-config.js"))
if not version or "@@VERSION@@" not in head:
    sys.exit("APP_VERSION or the @@VERSION@@ placeholder in head.html is missing")
head = head.replace("@@VERSION@@", version.group(1))
css = read(SRC / "styles.css")
body = read(SRC / "body.html")

# Geist / Geist Mono (SIL OFL 1.1) are inlined as base64 woff2 so the page works offline under the CSP. Geist is the
# Latin subset. Geist Mono is cut down to what the app shows in it (addresses, seeds, IDs, signed messages): printable
# ASCII and … • – — · ’ “ ” − and the no-break space, keeping every name record (copyright, licence), the weight axis
# and all layout features. Made from the Latin woff2 with fontTools:
#   pyftsubset geist-mono-latin.woff2 --unicodes="U+0020-007E,U+00A0,U+00B7,U+2013,U+2014,U+2019,U+201C,U+201D,U+2022,U+2026,U+2212" \
#     --layout-features='*' --name-IDs='*' --name-legacy --name-languages='*' --flavor=woff2 --output-file=geist-mono-ascii.woff2
# Other characters typed into a message fall back to the system's monospace font.
for placeholder, font in (("@@FONT_GEIST@@", "geist-latin.woff2"), ("@@FONT_GEIST_MONO@@", "geist-mono-ascii.woff2")):
    if placeholder not in css:
        sys.exit(f"styles.css is missing {placeholder}")
    css = css.replace(placeholder, base64.b64encode((BUILD / "fonts" / font).read_bytes()).decode())

# The page's one <script>: the vendored libraries, then the app, inside one function. The libraries reach the app only
# as its argument, so no global name ever holds them, and no other script, task or microtask runs between the two: a
# script runs to its end once it has started. Code that ran before this page (an extension at document_start, or a
# same-origin page that opened this one) can therefore no longer hand the wallet a library through a global name or
# between two scripts. It still runs first, in the same page: it can replace the built-ins the libraries and the
# app call (Object.freeze, Object.defineProperty, accessors on Object.prototype, crypto, fetch...) and swap a library
# or its results that way. Defence in depth, not isolation.
# The bundles go in byte for byte, each once, inside a function of their own, so their top-level names (QubicLib,
# qrcodegen, esbuild's helpers) stay local to it. If they throw while starting, `vendored` stays null and the app
# refuses to run (boot in src/js/11-main.js); the console gets the error's name only.
bundles = {name: read(BUILD / name) for name in ("qubic-lib.iife.js", "qrcodegen.js")}
vendor = (
    "let vendored = null;\n"
    + "try {\n"
    + "vendored = (function () {\n"
    + bundles["qubic-lib.iife.js"]
    + "\n"
    + bundles["qrcodegen.js"]
    + "\nreturn Object.freeze({ QubicLib: Object.freeze(QubicLib), qrcodegen: Object.freeze(qrcodegen) });\n"
    + "})();\n"
    + "} catch (err) {\n"
    + "  console.warn(`[wallet] the vendored libraries failed to start (${err && err.name ? err.name : 'error'});"
    + " the wallet will not run`);\n"
    + "}\n"
)

# The app: src/js/*.js in filename order, as a function of the libraries (VENDORED in src/js/03-qubic.js). qa/make.py
# finds its first line to put the QA mock in front of it: keep the two in step.
parts = sorted((SRC / "js").glob("*.js"))
app = "((VENDORED) => {\n'use strict';\n" + "\n".join(read(p) for p in parts) + "\n})(vendored);\n"

# Translations (src/i18n/<language>.json: each English message, as written in tr() in src/js, and its translation)
# go into I18N in src/js/01b-i18n.js. A translation that doesn't parse, or that fills in other placeholders than its
# English (a missing {amount} would drop a number from a warning), stops the build. Messages no longer in the code are
# left out; ones without a translation show in English, and are counted here.
sys.path.insert(0, str(SRC))
import i18n_catalog  # noqa: E402

catalog, _ = i18n_catalog.extract(SRC / "js")
for key in catalog:
    try:
        i18n_catalog.parse(catalog[key]["text"])
    except ValueError as e:
        sys.exit(f"the English message {catalog[key]['text']!r} is malformed: {e}")
tables = {}
for path in sorted((SRC / "i18n").glob("*.json")):
    table = json.loads(read(path))
    if not isinstance(table, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in table.items()):
        sys.exit(f"{path.name}: expected one object of English message → translation")
    kept = {}
    for key, value in table.items():
        if key not in catalog:
            continue
        try:
            same = i18n_catalog.names(value) == i18n_catalog.names(catalog[key]["text"])
        except ValueError as e:
            sys.exit(f"{path.name}: the translation of {key!r} is malformed: {e}")
        if not same:
            sys.exit(f"{path.name}: the translation of {key!r} fills in {sorted(i18n_catalog.names(value))}, "
                     f"its English {sorted(i18n_catalog.names(catalog[key]['text']))}")
        kept[key] = value
    tables[path.stem] = kept
    gone = len(table) - len(kept)
    print(f"i18n {path.stem}: {len(kept)} of {len(catalog)} messages translated"
          + (f", {len(catalog) - len(kept)} shown in English" if len(kept) < len(catalog) else "")
          + (f"; {gone} no longer in the code, left out" if gone else ""))
I18N_MARK = "/* @@I18N@@ */"
if app.count(I18N_MARK) != 1:
    sys.exit(f"src/js/01b-i18n.js must hold {I18N_MARK} once")
i18n_js = ", ".join(f"{json.dumps(name)}: Object.freeze({json.dumps(table, ensure_ascii=False, sort_keys=True)})"
                    for name, table in sorted(tables.items()))
app = app.replace(I18N_MARK, i18n_js)

script = read(SRC / "vendor-header.js") + "(function () {\n'use strict';\n" + vendor + app + "})();\n"

low = script.lower()
for bad in ("</script", "<!--", "<script"):
    if bad in low:
        sys.exit(f"refusing to inline the script: contains {bad!r}")
# Each bundle is in the page byte for byte, once. tests/page.cjs checks their SHA-256 (printed below) against the
# recorded ones.
for name, text in bundles.items():
    if script.count(text) != 1:
        sys.exit(f"{name} is not in the script exactly once")

if LINT:
    # The app part as embedded, after a /* global vendored */ line, for build.sh's syntax check and lint: `vendored` is
    # the one name it takes from the function around it.
    LINT.write_text("/* global vendored */\n" + app, encoding="utf-8")

style_block = "\n" + css + "\n"
script_block = "\n" + script + "\n"

csp = "; ".join(
    [
        "default-src 'none'",
        f"script-src {sha(script_block)}",
        f"style-src {sha(style_block)}",
        "font-src data:",
        "img-src data:",
        "connect-src https://rpc.qubic.org https://api.coingecko.com https://api.gateio.ws https://api.mexc.com https://static.qubic.org",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
        "frame-src 'none'",
        "worker-src 'none'",
        "manifest-src 'none'",
        "media-src 'none'",
        "require-trusted-types-for 'script'",
        "trusted-types 'none'",
    ]
)

if "@@CSP@@" not in head:
    sys.exit("head.html is missing the @@CSP@@ placeholder")
html = (
    head.replace("@@CSP@@", csp)
    + "<style>"
    + style_block
    + "</style>\n</head>\n<body>\n"
    + body
    + "<script>"
    + script_block
    + "</script>\n</body>\n</html>\n"
)

# Sanity: re-extract blocks exactly like the documented recompute snippet does and compare hashes.
blocks = re.findall(r"<(script|style)>(.*?)</\1>", html, re.S)
assert [sha(b) for t, b in blocks if t == "script"] == [sha(script_block)], "script hash mismatch"
assert [sha(b) for t, b in blocks if t == "style"] == [sha(style_block)], "style hash mismatch"

OUT.write_text(html, encoding="utf-8")
print(f"wrote {OUT} ({len(html.encode('utf-8')) / 1024:.1f} KiB)")
print("script sha256", sha(script_block))
for name, text in bundles.items():
    print(f"  {name} sha256 {hashlib.sha256(text.encode('utf-8')).hexdigest()}")
print("style sha256 ", sha(style_block))
