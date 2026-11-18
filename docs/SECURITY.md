# Security

How qoree handles seeds, what it trusts, and what it doesn't protect against. It hasn't been audited. Keep a written
copy of every seed.

- [Hosting](#hosting)
- [Network](#network)
- [Seeds and keys](#seeds-and-keys)
- [Storage](#storage)
- [Encrypted backups](#encrypted-backups)
- [Sending](#sending)
- [Confirming transfers](#confirming-transfers)
- [Signed messages](#signed-messages)
- [The page](#the-page)
- [Not covered](#not-covered)

## Hosting

Serve `index.html` over HTTPS from an origin (scheme, host and port) that serves nothing else, before or after. A
subdomain of its own, like `wallet.example.com`, works.

A saved wallet, and any password the browser saves for it, belong to the origin. Any other page on that origin can read
the encrypted wallet, change its settings, be offered the password, or leave a service worker that replaces this page.
Checking the file's SHA-256 can't catch that.

Whoever controls the domain, server or CDN can serve a modified page that reads seeds as they're typed. So:

- use phishing-resistant 2FA on the host, the registrar and the Git account
- limit deploy access and API tokens to this one project
- only deploy releases, and publish each release's SHA-256

Send these headers:

```
Content-Security-Policy: frame-ancestors 'none'
Strict-Transport-Security: max-age=31536000
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cross-Origin-Opener-Policy: same-origin
Cache-Control: no-cache
```

The CSP inside the page can't block framing, so the header adds that. The page also refuses to run in a frame.

### qoree.app

qoree.app runs on Cloudflare Workers Static Assets. `./build-cloudflare.sh` writes `index.html` and `_headers` (the
headers above plus `X-Frame-Options: DENY` and `no-transform`) to `cloudflare-assets/`, and a zip to `release/`. It
doesn't deploy. The zone also sets the same headers with a Response Header Transform Rule and redirects HTTP with
Always Use HTTPS. Keep that rule in sync with `cloudflare/_headers`.

After a deploy, `./test.sh --live --only deployed` checks that the live page matches this `index.html` byte for byte,
sends every header, and redirects HTTP to HTTPS.

### Moving to a new address

Wallets don't carry over between origins. Write down every seed, wait until Activity shows no transfer in progress,
and note your watch-only addresses and contacts. Then import the seeds on the new address and erase the old wallet.

### Running locally

Serve the file alone from its own folder, on 127.0.0.1 and a port used for nothing else. Always open the same address:
`localhost` is a different origin with separate storage. Over plain HTTP anywhere else, only watch-only addresses work.

## Network

There's no backend. The Qubic RPC allows CORS, so the page calls it directly. The CSP allows these hosts and no others:

| Host | Used for | Setting (Settings → Network & data) |
|---|---|---|
| `rpc.qubic.org` | Balances, history, ticks, broadcast, price | Always on |
| `api.coingecko.com` | 24h change, chart, prices for the past year | Market data, on by default |
| `api.gateio.ws` | Daily prices older than a year; its order book; its QUBIC deposit and withdrawal status, checked on open and every 10 minutes | Market data; Order books, off by default; Exchange status, on by default |
| `api.mexc.com` | Its order book, only while the Order books sheet is open. Blocked in some countries | Order books, off by default |
| `static.qubic.org` | Official contract and exchange names | Address labels, on by default |
| `annexplorer.jetskipool.ai` | BPP-9000's calls on Bitcoin's next hour, each epoch's overview, only while its sheet is open, every 5 minutes | BPP-9000, on by default |

Every host except the RPC sees your IP address, the page's origin, your browser (User-Agent) and languages. None gets
an address, a transaction or an amount, and no cookie or Referer is sent. Explorer links (`explorer.qubic.org`) open
only when clicked.

Only public addresses and signed transactions are sent. Seeds, keys and passwords never leave the page. Activity's
search and filters run on the device.

Locking, erasing, or another tab changing the saved wallet ends the session. Requests in flight are aborted and late
answers are dropped, so nothing appears over the lock screen. A broadcast already under way is the one exception.

Responses are capped at 4 MB (the largest real one is about 0.5 MB) and must stream in. A browser that can't stream a
response gets no data.

## Seeds and keys

- New seeds are 55 lowercase letters from `crypto.getRandomValues` with rejection sampling. The generator is sampled
  twice first and refused if its output is constant or repeats, and the seed must pass the weak-seed check. This
  catches a broken generator, not a malicious one.
- Qubic seeds have no checksum, so one wrong letter opens a different account. On import the wallet looks up the
  address (only the address is sent) and shows its balance, or says it has never received QUBIC.
- Keys, signatures and transaction encoding come from the official Qubic TypeScript SDK (`@qubic.org/crypto`,
  `@qubic.org/tx` 1.0.0), bundled unmodified.
- Seeds only work on a page the browser treats as secure: HTTPS, localhost or a local file.
- On start, a self-test runs known-answer tests: key derivation, K12, SchnorrQ, a real mainnet transaction and
  Argon2id. If any fails, creating, importing, sending and signing are turned off.
- A revealed seed hides again when the page loses focus, is hidden or closes. Coming back doesn't reveal it, and a
  saved seed needs the password again. This can't stop an OS screenshot or a browser extension.

## Storage

A first wallet is saved encrypted on the device by default. "This session only" keeps it in the tab's memory, and the
browser asks before a reload or close while it holds a seed or an open transfer (Safari on iPhone never asks).

The key comes from Argon2id (64 MiB, 3 passes, 4 lanes, the `@qubic.org/vault` defaults) and the wallet is sealed
with AES-256-GCM, header included. Only ciphertext is stored.

Passwords need at least 10 characters. Common passwords, keyboard runs, sequences and years are refused, and the check
runs when the vault is written, so nothing can save a weak one. A password field is emptied as soon as it's read, and
every password field is emptied when you leave its screen. After a wrong current password, Change password keeps the
new pair so you only retype the current one. The password manager is offered the wallet password and new passwords,
never a backup file's password.

### Writes

The vault is one record: the sealed accounts and a sealed journal of unsettled transfers, both bound to its header.
Every write goes through one queue and a Web Lock shared by all tabs, merges with what's stored, and checks right
before writing that its session is still current.

- A tab that's fallen behind (another tab changed the password or accounts) is refused and locks. It never overwrites.
- A new vault never replaces one another tab saved.
- Without Web Locks nothing is written. Encrypted storage isn't offered, and an existing vault opens but can't be
  changed or sent from.
- An unlock is dropped if the vault was erased or replaced while it ran, along with everything it loaded.
- A new wallet whose screen is left while it's being saved isn't kept.
- Erasing clears memory first, deletes under the lock, and only reports success once the record is gone.

### Stay unlocked on reload

Off by default (Settings → Security, encrypted mode only). When on, the vault key is wrapped with a random secret. The
wrapped key goes in IndexedDB, the secret and the auto-lock deadline in the tab's sessionStorage, and a reload in the
same tab joins them until the deadline. Locking, auto-lock, turning it off and erasing delete both halves. Anyone with
access to the browser profile while both exist can join them, and browsers may write sessionStorage to disk. Leave it
off if that matters to you.

## Encrypted backups

**Settings → Security → Encrypted backup** downloads a `.qoree-backup` file. It holds every seed and watch-only
account, names, appearance, saved addresses and unsettled transfers, but not preferences or cached balances. It's
encrypted on the device (fresh Argon2id salt, AES-256-GCM), the whole payload is authenticated, and the file is read
back before the download is offered. **Check backup file** opens a saved copy and verifies it.

**Restore backup** is on the welcome screen of an empty browser. It validates the file, derives each address, checks
the journal's signatures and asks before saving. It never overwrites an existing wallet. Files are capped at 1 MiB, KDF
costs are bounded before decryption, and only qoree's own format is read.

A backup doesn't know about payments made after it, so check the explorer before sending from a restored wallet.
Changing the wallet password doesn't change old backups.

## Sending

- One transfer at a time per account, across tabs where the browser has Web Locks.
- Review freezes the account, recipient and amount, and that copy is what's shown and signed. Before broadcast, the
  signed transaction is decoded, compared field by field with what you confirmed, and its signature checked.
- Amounts are whole QUBIC. Anything else is refused, not rounded.
- Hold to confirm cancels if you let go or the page loses focus. A short press, a screen reader or a switch gets a
  dialog naming the amount, recipient and account, and its button ignores presses for 0.6 s.
- Tips (Settings → Support qoree) only fill in the Send form with `DONATION_ADDRESS` and the amount. The rest is a
  normal send.
- Send and Review show how many times this wallet has sent to the address.

### Transfer journal

In encrypted mode every signed transfer is sealed into the journal before broadcast. If that write fails or the
wallet locks, it isn't broadcast. Journalled transfers come back after a reload, in every tab, and block their account
from sending until they settle. An account with an unsettled transfer can't be removed. Session-only wallets keep no
journal.

A transfer can only execute in its target tick. It stays in progress until the live tick has passed it and the archive
has processed it, however long the network stalls. If the RPC's tick stops moving but the network carries on, erasing
the wallet and importing the seed again forgets the transfer. Only do that once the explorer shows the network past
the tick.

Locking or erasing can't recall a transfer that's already been broadcast.

### Look-alike addresses

Send and Add address compare the address with every address you know: your accounts, saved addresses, tracked
transfers, and every address your seed accounts have sent to (from each account's newest 10,000 outgoing
transactions). Incoming transfers don't count, so dust can't add a payee or push one out.

Six or more matching letters at the ends trigger a warning. By chance that's about 1 in 15 million per pair. Until
every seed account has been read, Hold to send and Save wait up to 15 seconds, then say the check is incomplete.

Watched accounts' payees, SendMany and asset recipients, and removed accounts' payees aren't checked. Only the ends are
compared, so check the full address against where you got it.

Activity marks incoming transfers from unknown addresses that resemble known ones as "Look-alike", and copying that
address asks first. That's how address poisoning starts.

## Confirming transfers

The Qubic RPC is trusted for balances, ticks and outcomes. All of it comes from the same operator, so these are
consistency checks, not independent proof.

- **Sent:** the archive has the transfer in its tick, matching the signed bytes field by field, and either
  `moneyFlew = true` or Core's event log shows it. `moneyFlew = false` proves nothing: the archive also returns it
  when it has no status.
- **Failed:** Core's record of the sender, from a later tick, shows nothing sent since the transfer's tick, and the
  account has existed without a break since before it. Otherwise the outcome stays unknown, the account stays blocked,
  and it's checked again.
- **Not executed:** the archive has processed the target tick, that tick's full transaction list lacks the hash, and
  the live record shows nothing sent since.
- **Activity:** QUBIC counts as moved only when `moneyFlew = true`. Until then an incoming transfer reads "Transfer to
  you" in grey, never "Received".

Network data is type-checked and held to Core's limits: MAX_AMOUNT (10^15 QU), 32-bit ticks, 4,096 transactions per
tick, 1,024-byte inputs. Non-canonical addresses are refused.

## Signed messages

Same format as the official web wallet (SchnorrQ over the UTF-8 text). Messages of exactly 32 bytes are refused,
because that signature could also authorise a transaction.

A message containing a seed from the wallet is refused, even with capitals, separators or full-width letters. Runs of
20 or more letters ask you to confirm they aren't a seed. The warning depends only on the message, never on partial
matches, so it can't leak a seed letter by letter. Never sign any part of a seed.

Verification rejects small-order public keys and contract or burn addresses.

## The page

Strict CSP (hash-pinned inline code, no eval, Trusted Types, no workers), no third-party scripts, no analytics. It
won't run in a frame.

The bundled libraries and the app share one inline script, and the libraries reach the app only as an argument, never
through a global. So code that ran first (an extension, or a same-origin page that opened this one) can't slip in a
fake library that way. That's an extra layer, not isolation: such code can still patch built-ins, random numbers,
WebCrypto or fetch.

qoree never installs a service worker. If one is there at startup, another page on the origin put it there: the wallet
opens nothing, reads no saved wallet, and offers to remove it. A worker that replaces the page entirely skips this
check.

## Not covered

- Isolated signing. Seeds, signing and networking share one page. Keep large amounts on a hardware wallet.
- Code inside the page. An extension or a same-origin page can replace what the wallet relies on and read seeds. Use a
  browser profile with no extensions for real funds.
- Crash safety of the journal. It's written before broadcast, but browsers don't promise a write survives a crash or
  power loss.
- Incoming payments the archive has no status for. They stay "Transfer to you" even though the balance includes them.
- Assets, smart-contract calls (QX, QEarn, SendMany), hardware wallets, and official wallet vault files.
- Search over more than an account's newest 3,000 transactions.
- Incoming payments from smart contracts. They update the balance but aren't listed; the explorer shows them.
- An audit, and the security of whoever hosts the page.
