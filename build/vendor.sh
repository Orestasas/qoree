#!/bin/zsh
# Rebuilds the two libraries the page embeds from their pinned sources and compares them, byte for byte, with the files
# committed in build/. Run npm ci in build/ first; the QR generator's source is fetched, so this needs the network.
#   build/vendor.sh            check: exits 1 if either file differs from its rebuild
#   build/vendor.sh --write    replace them with their rebuilds (after changing a pin below or in build/package.json)
# qubic-lib.iife.js: build/entry.js bundled from the packages build/package-lock.json pins, with esbuild (pinned there).
# qrcodegen.js: Project Nayuki's qrcodegen.ts at the commit below (untagged, v1.8.0 + 31), types stripped.
set -e
emulate -L zsh
DIR="${0:A:h}"
ESBUILD="$DIR/node_modules/.bin/esbuild"
NAYUKI=3c6d0b3cefb4e049dc337e82237c9644399716a8
NAYUKI_TS_SHA256=1dc03fb5a10e0e2318ea162755bbdb9977ca6ce52cff959e9c9b6deafdccda9c
[[ -x $ESBUILD ]] || { print "esbuild not found: run npm ci in build/ first"; exit 2; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

(cd "$DIR" && "$ESBUILD" entry.js --bundle --format=iife --global-name=QubicLib --platform=browser --target=es2020 \
  --charset=utf8 --preserve-symlinks --log-level=warning --outfile="$TMP/qubic-lib.iife.js")
curl -fsSL "https://raw.githubusercontent.com/nayuki/QR-Code-generator/$NAYUKI/typescript-javascript/qrcodegen.ts" -o "$TMP/qrcodegen.ts"
got=$(shasum -a 256 "$TMP/qrcodegen.ts" | cut -d' ' -f1)
[[ $got == $NAYUKI_TS_SHA256 ]] || { print "qrcodegen.ts at $NAYUKI is not the reviewed source (sha256 $got)"; exit 1; }
"$ESBUILD" "$TMP/qrcodegen.ts" --target=es2020 --log-level=warning --outfile="$TMP/qrcodegen.js"

rc=0
for f in qubic-lib.iife.js qrcodegen.js; do
  if [[ $1 == --write ]]; then cp "$TMP/$f" "$DIR/$f"; print "wrote build/$f"
  elif cmp -s "$TMP/$f" "$DIR/$f"; then print "build/$f: identical to its rebuild"
  else print "build/$f: DIFFERS from its rebuild"; rc=1; fi
done
exit $rc
