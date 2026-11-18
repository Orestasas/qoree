# qoree

A Qubic wallet in a single HTML file. Seeds never leave your browser: only addresses and signed transactions go to the
network. Live at [qoree.app](https://qoree.app).

It hasn't been audited. Write down every seed, and keep large amounts on a hardware wallet.

## Features

- Create, import or watch accounts
- Send QUBIC with a review screen and hold to confirm
- Activity with search and filters, and an address book
- Warnings for look-alike addresses
- Encrypted storage (Argon2id, AES-256-GCM) and encrypted backup files
- Optional market data, exchange status and order books
- BPP-9000 tracker: how often Qubic's network calls Bitcoin's next hour
- English, Arabic, French, Hindi, Spanish and Chinese

## Run it locally

Put `index.html` in an empty folder and serve it:

```
python3 -m http.server 8000 --bind 127.0.0.1 --directory <folder>
```

Open `http://127.0.0.1:8000/` and stick to that exact address. Saved wallets belong to the address they were opened
from, so `localhost:8000` won't see them.

To host it, serve it over HTTPS from a domain that serves nothing else. [docs/SECURITY.md](docs/SECURITY.md#hosting)
lists the headers to send.

Back up from **Settings → Security → Encrypted backup**. Restore from the welcome screen of an empty browser.

## Build and test

Needs Python 3 and Node. Run `npm ci` once in `build/`, `lint/` and `qrtest/`.

- `./build.sh` builds `index.html` from `src/`, pins the script and styles in the CSP, then lints and type-checks.
- `./test.sh` runs the offline tests. `--live` adds the network ones, `--only <suite>` runs one.
- `./build/vendor.sh` rebuilds the bundled libraries from source and checks they match.
- `tests/prove-failures.sh` plants each known bug and checks a test catches it. Takes about an hour.
- `./build-cloudflare.sh` prepares the Cloudflare upload in `cloudflare-assets/`.

Edit `src/`, not `index.html`: a hand edit breaks the CSP hashes. CI rebuilds on every push and fails if `index.html`
doesn't match `src/`.

## Security

[docs/SECURITY.md](docs/SECURITY.md) covers how seeds are stored, which hosts the page talks to, how a transfer is
confirmed, and what qoree doesn't protect against.

## Licence

qoree is [MIT](LICENSE). These are bundled unmodified, with their licences at the top of the script in `index.html`:

- Qubic TypeScript SDK (`@qubic.org/crypto`, `@qubic.org/tx`): Qubic Anti-Military License. Because the built page
  includes it, using or sharing `index.html` also falls under that licence.
- `@noble/hashes` and Project Nayuki's QR code generator: MIT.
- Geist and Geist Mono fonts: SIL Open Font License 1.1.

Exchange logos are trademarks of their owners.
