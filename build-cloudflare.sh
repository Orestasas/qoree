#!/bin/zsh
# Build a minimal Workers Static Assets upload. Never package the project, test data or old releases.
set -e
ROOT="${0:A:h}"
"$ROOT/build.sh"
python3 - "$ROOT" <<'PY'
from pathlib import Path
import hashlib
import sys
import zipfile

root = Path(sys.argv[1])
out = root / 'cloudflare-assets'
files = {'index.html': root / 'index.html', '_headers': root / 'cloudflare' / '_headers'}
if out.is_symlink():
    sys.exit('Refusing a symlink as the upload directory')
out.mkdir(exist_ok=True)
if any(p.name not in files or p.is_symlink() or not p.is_file() for p in out.iterdir()):
    sys.exit('Upload directory contains unexpected files; use a clean directory')
archive = root / 'release' / 'qoree-cloudflare.zip'
if archive.is_symlink():
    sys.exit('Refusing a symlink as the upload archive')
archive.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
    for name, source in files.items():
        content = source.read_bytes()
        (out / name).write_bytes(content)
        bundle.writestr(name, content)
print(f'Upload directory: {out}')
print(f'Upload archive: {archive}')
print(f'index.html SHA-256: {hashlib.sha256((out / "index.html").read_bytes()).hexdigest()}')
PY
