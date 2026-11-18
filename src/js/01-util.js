// ═══════════════════════════════════════════════════════════════════════════
// 2. UTILITIES
// DOM is built with createElement/textContent only. No HTML strings are parsed
// anywhere in the app (the CSP enforces Trusted Types to keep it that way).
// ═══════════════════════════════════════════════════════════════════════════
const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, String(v));
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}
// replaceChildren() that skips null/false instead of rendering them as text. A redraw that removes the focused control
// moves focus to its twin in the new content (same tag, label and text, and the only one, before and after), or else
// to the sheet around it, so Escape and Tab still reach the sheet instead of the page.
function fill(el, ...children) {
  const had = document.activeElement;
  const kin = had && had !== el && el.contains(had)
    ? (n) => n.getAttribute('aria-label') === had.getAttribute('aria-label') && n.textContent === had.textContent : null;
  const kinIn = () => [...el.querySelectorAll(had.localName)].filter(kin);
  const unique = kin && kinIn().length === 1;
  el.replaceChildren();
  append(el, children);
  if (kin && !el.contains(document.activeElement)) {
    const twins = unique ? kinIn() : [];
    const home = twins.length === 1 ? twins[0] : el.closest('[tabindex="-1"]');
    if (home) home.focus({ preventScroll: true });
  }
  return el;
}

const uid = (() => { let n = 0; return (p = 'id') => `${p}-${++n}`; })();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Display text from storage or a server: a string without control characters (C0, DEL, C1) or the marks that reorder
// text (bidi embeddings, overrides and isolates: U+202E can make an address or a name read backwards), trimmed, at most max
// long ('' otherwise).
const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, max) : '');

// ── Errors: only fixed, pre-written messages ever reach the UI ──────────────
// text: the message in English (marked with trLater), or a list of them said one after another; vars fill in their
// placeholders. The message stays English (for the console and the tests) and is translated where it's shown, by
// messageOf, so one kept on screen follows a change of language.
class AppError extends Error {
  /** @param {AppErrorCode} code @param {LaterText} [text] @param {Record<string, unknown> | null} [vars] */
  constructor(code, text, vars) {
    const en = text || ERROR_TEXT[code] || trLater('Something went wrong.');
    const filled = vars || (code === 'WEAK_PASSWORD' ? { min: MIN_PASSWORD } : null);
    super([].concat(en).map((s) => trEnglish(s, filled)).join(' '));
    this.code = code;
    this.text = en;
    this.vars = filled;
  }
}
const ERROR_TEXT = {
  INVALID_SEED: trLater('A seed is exactly 55 lowercase letters (a–z).'),
  INVALID_IDENTITY: trLater('That address is not a valid Qubic identity.'),
  CRYPTO: trLater('A cryptographic operation failed. Nothing was signed or sent.'),
  RANDOM: trLater('This browser’s random number generator failed a safety check, so no seed was made. Try again, or use another browser.'),
  SELF_TEST: trLater('Signing is disabled because the cryptography self-test did not pass.'),
  KEY_MISMATCH: trLater('The seed in memory does not match this account. Nothing was signed.'),
  SIGNATURE: trLater('The signature failed local verification. Nothing was sent.'),
  TX_MISMATCH: trLater('The signed transaction did not match what you confirmed. Nothing was sent.'),
  LOCKED: trLater('The wallet is locked.'),
  WRONG_PASSWORD: trLater('Incorrect password.'),
  VAULT_CORRUPT: trLater('The saved wallet data is damaged or was modified.'),
  STORAGE: trLater('This browser refused to save data (storage full or blocked).'),
  NO_SECURE_CONTEXT: trLater('Encrypted storage needs a secure context (https or localhost).'),
  MESSAGE_EMPTY: trLater('Write a message to sign.'),
  MESSAGE_32: trLater('Messages of exactly 32 bytes can’t be signed: a signature on 32 bytes could also authorize a transaction.'),
  MESSAGE_LONG: trLater('That message is too long to sign here (8 KB at most).'),
  MESSAGE_SEED: trLater('This message contains your secret seed, or part of it, so it can’t be signed. Anyone who has your seed can take your funds, and no support agent, exchange or website will ever need it.'),
  MESSAGE_SEEDLIKE: trLater('This message has 20 or more letters in a row, like a seed. Anyone who has a seed can take its funds, and no support agent, exchange or website will ever need one. Don’t sign it if it’s a seed.'),
  WEAK_PASSWORD: trLater('Use a password of at least {min} characters that isn’t easy to guess.'),
  INSECURE: trLater('Seeds are disabled: this page isn’t loaded over https or from this device, so its code could have been altered on the way.'),
  BUSY: trLater('A transfer from this account is still in progress.'),
  REMOVE_BUSY: trLater('A transfer from this account hasn’t settled yet (or is still being sent), so this account can’t be removed yet. Wait until it settles. If it shows as unconfirmed, open it from Activity, check it on the explorer and mark it as checked.'),
  JOURNAL: trLater('The record of unsettled transfers couldn’t be read. Check your recent transfers on the explorer before sending again.'),
  STALE: trLater('This wallet was changed in another tab, so this tab stopped. Unlock it again to continue.'),
  EXISTS: trLater('A wallet is already saved in this browser (from another tab). Nothing was changed.'),
  ERASE_FAILED: trLater('This browser didn’t delete the saved wallet. Its seeds are cleared from this tab; to remove the saved copy, clear this site’s data in the browser’s settings.'),
  GONE: trLater('The saved wallet was erased or changed in another tab meanwhile. Nothing was kept here.'),
  DISCARD_FAILED: trLater('The new wallet was cancelled, but this browser didn’t delete the copy it had just saved. It’s still here, encrypted with the password you chose: unlock it, or erase it with “Forgot password?”.'),
  DISCARD_KEPT: trLater('The new wallet was cancelled here, but another tab had already opened and changed it, so it was kept.'),
  NO_LOCKS: trLater('This browser can’t keep its tabs from overwriting each other’s changes (no Web Locks), so the saved wallet can’t be changed here. Nothing was changed.'),
};
// An error as the person reads it: its message in the language in use (sentences after one another, each translated).
function messageOf(err) {
  if (err instanceof AppError || err instanceof NetError) return joinSentences(...[].concat(err.text).map((s) => tr(s, err.vars)));
  return tr('Unexpected error. Nothing was sent.');
}
// An error's message (see messageOf) when it has one of these codes; null for any other.
const errorText = (/** @type {keyof typeof ERROR_TEXT} */ code) => tr(ERROR_TEXT[code], code === 'WEAK_PASSWORD' ? { min: MIN_PASSWORD } : undefined);

// ── Bytes ───────────────────────────────────────────────────────────────────
const utf8 = (s) => new TextEncoder().encode(s);
function wipe(...arrays) { for (const a of arrays) if (a && typeof a.fill === 'function') a.fill(0); }
function bytesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
function toHex(u8) { let s = ''; for (const b of u8) s += b.toString(16).padStart(2, '0'); return s; }
function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }
function randomId() { return toHex(randomBytes(8)); }

// ── Formatting ──────────────────────────────────────────────────────────────
// Numbers and dates are written the way the language in use writes them (its intl locale, see LANGUAGES). Formatters
// are made once per language and kept: making one costs more than formatting with it, and long Activity lists format
// a lot. The marks Intl adds to set a number's direction (U+200E, U+200F, U+061C) are taken out: an amount is always
// laid out left to right (the styles isolate amounts; a placeholder is isolated by tr()), so they'd only get in the way.
const MINUS = '−';
const formatters = new Map();
function formatter(kind, name, make) {
  const key = `${lang.id}|${kind}|${name}`;
  let f = formatters.get(key);
  if (!f) { f = make(lang.intl); formatters.set(key, f); }
  return f;
}
const numberFormat = (name, opts) => formatter('n', name, (loc) => new Intl.NumberFormat(loc, opts));
const unmarked = (s) => s.replace(/[\u200e\u200f\u061c]/g, '');
// A number as the language writes it (a count, a size): grouped, at most two decimals.
const fmtNum = (n) => unmarked(numberFormat('num', { maximumFractionDigits: 2 }).format(n));
// A string of digits, grouped the way the language groups whole numbers (1,234,567 · 1 234 567 · 12,34,567).
function groupDigits(digits) { return digits ? unmarked(numberFormat('int', { maximumFractionDigits: 0 }).format(BigInt(digits))) : ''; }
function fmtInt(v) {
  const n = typeof v === 'bigint' ? v : BigInt(v);
  return n < 0n ? MINUS + groupDigits((-n).toString()) : groupDigits(n.toString());
}
function fmtCompact(v) {
  const n = Number(v);
  if (Math.abs(n) < 100000) return fmtInt(BigInt(Math.trunc(n)));
  return compactText(n, 'short');
}
// A number in the language's compact units (12.35B, 123.46亿, 12,35 Md).
function compactText(n, shown) {
  const display = lang.compact || shown;
  const f = numberFormat(`compact-${display}`, { notation: 'compact', compactDisplay: display, maximumFractionDigits: 2 });
  return capped(f, n) ?? unmarked(f.format(n));
}
// From lang.capBillions up, a compact number stays in the language's unit for 10^9, grouped (144 070 Md, 144,070 mil M,
// 1,44,070 अरब; $ and $US kept), where the next unit up would mislead: French Bn and Spanish B (10^12) read like
// English's billion; Hindi's खरब (10^11) is rarely used. null below the cap, or when f's unit for 2×10^10 isn't 10^9.
function capped(f, n) {
  if (!lang.capBillions || !(Math.abs(n) >= lang.capBillions)) return null;
  const parts = f.formatToParts(2e10);
  if (parts.filter((p) => p.type === 'integer').map((p) => p.value).join('') !== '20' || !parts.some((p) => p.type === 'compact')) return null;
  const figure = groupDigits(String(Math.round(Math.abs(n) / 1e9)));
  let put = false;
  const text = parts.map((p) => (p.type === 'integer' ? (put ? '' : ((put = true), figure)) : p.type === 'group' ? '' : p.value)).join('');
  return unmarked((n < 0 ? MINUS : '') + text);
}
// US dollars: each language writes them its own way (lang.usd: Intl's currencyDisplay, 'symbol' unless it says).
const usdFormat = (name, opts) => formatter('n', `usd-${name}`, (loc) => {
  if (!lang.usdPrefix) return new Intl.NumberFormat(loc, { style: 'currency', currency: 'USD', currencyDisplay: lang.usd || 'symbol', ...opts });
  // The sign before the language's own number ($1,234.56, $4.6 مليار): Intl's currency pattern can't say that.
  const figure = new Intl.NumberFormat(loc, { minimumFractionDigits: 0, maximumFractionDigits: 2, ...opts });
  const parts = (v) => [{ type: 'currency', value: lang.usdPrefix }, ...figure.formatToParts(v)];
  return { format: (v) => parts(v).map((p) => p.value).join(''), formatToParts: parts };
});
const usdCents = () => usdFormat('cents', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// whole: no cents (a tip of $5).
function fmtUsd(v, { compact = false, whole = false } = {}) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v > 0 && v < 0.01) return `${lang.lessThan || '<'}${unmarked(usdCents().format(0.01))}`;
  const f = compact && v >= 100000 ? usdFormat('compact', { notation: 'compact', compactDisplay: lang.compact || 'short', maximumFractionDigits: 2 })
    : whole ? usdFormat('whole', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : usdCents();
  return (compact && v >= 100000 && capped(f, v)) || unmarked(f.format(v));
}
// A dollar amount split where its cents start (the decimal mark and all after it), for a big number with lighter cents.
function usdParts(v) {
  if (v == null || !Number.isFinite(v)) return null;
  const small = v > 0 && v < 0.01;
  const parts = usdCents().formatToParts(small ? 0.01 : v);
  const at = parts.findIndex((p) => p.type === 'decimal');
  const text = (list) => unmarked(list.map((p) => p.value).join(''));
  return { major: (small ? lang.lessThan || '<' : '') + text(at < 0 ? parts : parts.slice(0, at)), minor: at < 0 ? '' : text(parts.slice(at)) };
}
// Per-unit QUBIC prices are tiny (~1e-7): about three significant digits, no exponent (extra: more for order-book
// levels).
const priceDecimals = (p, extra = 2, max = 14) => clamp(Math.ceil(-Math.log10(p)) + extra, 2, max);
// A dollar price with exactly this many decimals.
const fmtUsdDecimals = (p, d) => unmarked(usdFormat(`d${d}`, { minimumFractionDigits: d, maximumFractionDigits: d }).format(p));
function fmtPrice(p) {
  if (p == null || !Number.isFinite(p) || p <= 0) return '—';
  if (p >= 1) return unmarked(usdCents().format(p));
  return fmtUsdDecimals(p, priceDecimals(p));
}
// The QUBIC price as chosen in Settings: per coin ($0.000000451) or per billion coins ($451.00).
const perBillion = () => state.prefs.priceUnit === 'billion';
const priceText = (p) => (perBillion() ? fmtUsd(p * 1e9) : fmtPrice(p));
// Which way a percent change points as shown to two decimals ('flat' when it rounds to 0.00%).
const pctDir = (p) => (Math.abs(p).toFixed(2) === '0.00' ? 'flat' : p > 0 ? 'up' : 'down');
// A percent change to two decimals, signed (+3.40%, −1.25%, 0.00%), as the language writes percentages. decimals: to
// that many places instead (a share of an order book); signed false: the size alone, no sign.
function fmtPct(p, decimals = 2, signed = true) {
  if (p == null || !Number.isFinite(p)) return '—';
  const s = unmarked(numberFormat(`pct${decimals}`, { style: 'percent', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Math.abs(p) / 100));
  const dir = !signed || Math.abs(p).toFixed(decimals) === (0).toFixed(decimals) ? 'flat' : p > 0 ? 'up' : 'down';
  return dir === 'up' ? '+' + s : dir === 'down' ? MINUS + s : s;
}
// QUBIC in billions: two decimals from 0.01B up, otherwise enough to show two significant digits.
function fmtBillions(amount) {
  if (amount === 0n) return fmtNum(0);
  const b = Number(amount) / 1e9;
  const decimals = b >= 0.01 ? 2 : Math.min(9, Math.ceil(-Math.log10(b)) + 1);
  return unmarked(numberFormat(`b${decimals}`, { minimumFractionDigits: Math.min(2, decimals), maximumFractionDigits: decimals }).format(b));
}
// QUBIC in the large units the language counts in, for the balance in QUBIC: English keeps
// billions ("1.23B", read out as "1.23 billion"); other languages take their own (12.3亿, 1,23 Md, 1.23 mil M), from
// Intl's compact notation. long: the unit written out (1.23 billion, 12.3亿, 1,23 milliard).
function fmtQubicLarge(amount, { long = false } = {}) {
  if (lang.id === 'en') return `${fmtBillions(amount)}${long ? ' billion' : 'B'}`;
  return compactText(Number(amount), long ? 'long' : 'short');
}
// The same split where the number ends, for a big figure with a lighter unit: { major: '1.23', minor: 'B' }.
function qubicLargeParts(amount) {
  if (lang.id === 'en') return { major: fmtBillions(amount), minor: 'B' };
  // The figure up to its unit, and the unit with the space before it (1,23 | Md); one too small to have a unit is all
  // figure (950 000).
  const whole = compactText(Number(amount), 'short');
  const m = /^(.*?\d)(\D*)$/.exec(whole);
  return m ? { major: m[1], minor: m[2] } : { major: whole, minor: '' };
}
// A number with exactly this many decimals (1.23 s, 1,23 s).
const fmtDecimals = (n, d) => unmarked(numberFormat(`dec${d}`, { minimumFractionDigits: d, maximumFractionDigits: d }).format(n));
// The dollar sign as the language writes it, and whether it goes after the number ($ before in English, $US after in
// French), for a field that takes dollars.
function usdMark() {
  const parts = usdCents().formatToParts(1);
  const at = parts.findIndex((p) => p.type === 'currency');
  return { text: at < 0 ? '$' : parts[at].value, after: at > parts.findIndex((p) => p.type === 'integer') };
}
// A plain decimal number for a field to edit (no grouping): 0.000000451 or 0,000000451, as the language writes it.
const fmtPlain = (v, d) => unmarked(numberFormat(`plain${d}`, { useGrouping: false, minimumFractionDigits: d, maximumFractionDigits: d }).format(v));
function qubicToUsd(amount, price) {
  if (price == null || amount == null) return null;
  return Number(amount) * price;
}
// US dollars as whole QUBIC at price, to the nearest coin; null without a usable amount or price.
function usdToQubic(usd, price) {
  if (!(usd > 0) || !(price > 0)) return null;
  const n = Math.round(usd / price);
  return Number.isSafeInteger(n) && n > 0 ? BigInt(n) : null;
}
function shortId(id, n = 4) { return id ? `${id.slice(0, n)}…${id.slice(-n)}` : ''; }
// "5s ago", "3m ago" (English), as the language shortens them (lang.rel), up to a week; then the date.
function timeAgo(ms) {
  if (!ms) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 10) return tr('just now');
  const rel = formatter('r', 'ago', (loc) => new Intl.RelativeTimeFormat(loc, { style: lang.rel || 'short' }));
  if (s < 60) return rel.format(-s, 'second');
  const m = Math.round(s / 60);
  if (m < 60) return rel.format(-m, 'minute');
  const hr = Math.round(m / 60);
  if (hr < 24) return rel.format(-hr, 'hour');
  const d = Math.round(hr / 24);
  return d < 7 ? rel.format(-d, 'day') : fmtDay(ms);
}
// Dates and times in the language's own order and words; English ones the browser's way (en-US, en-GB…), as before.
const dateFormat = (name, opts) => formatter('d', name, (loc) => new Intl.DateTimeFormat(lang.id === 'en' ? undefined : loc, opts));
function fmtDay(ms) {
  const sameYear = new Date(ms).getFullYear() === new Date().getFullYear();
  return sameYear ? dateFormat('day', { month: 'short', day: 'numeric' }).format(ms) : dateFormat('dayYear', { month: 'short', day: 'numeric', year: 'numeric' }).format(ms);
}
function fmtTime(ms) { return dateFormat('time', { hour: lang.hour || '2-digit', minute: '2-digit' }).format(ms); }
function fmtDateTime(ms) { return dateFormat('dateTime', { year: 'numeric', month: 'short', day: 'numeric', hour: lang.hour || '2-digit', minute: '2-digit', second: '2-digit' }).format(ms); }
function dayLabel(ms) {
  const d = new Date(ms); const now = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / DAY_MS);
  if (diff === 0) return tr('Today');
  if (diff === 1) return tr('Yesterday');
  return fmtDay(ms);
}
// "45s", "3m 5s" (English), in the language's own units (lang.units: 'short' for 3 min 5 s, 'long' for whole words),
// side by side.
function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const style = lang.units || 'narrow';
  const unit = (n, u) => unmarked(numberFormat(`unit-${u}-${style}`, { style: 'unit', unit: u, unitDisplay: style }).format(n));
  if (s < 60) return unit(s, 'second');
  return formatter('l', 'units', (loc) => new Intl.ListFormat(loc, { type: 'unit', style: 'narrow' })).format([unit(Math.floor(s / 60), 'minute'), unit(s % 60, 'second')]);
}

// ── Colour ──────────────────────────────────────────────────────────────────
// Text on an accent fill ('#rrggbb'): white or near-black, whichever reads better on it by APCA, a newer contrast
// model than WCAG 2's ratio. That ratio puts near-black on mid-tone oranges, reds and greens, where white is the easier
// read. Both texts are compared on the same scale, so APCA's fixed offsets cancel out.
const INK_DARK = '#292524';
function inkFor(fill) {
  const y = (hex) => [0.2126729, 0.7151522, 0.072175].reduce((sum, k, i) => sum + k * (parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255) ** 2.4, 0);
  const soft = (v) => (v > 0.022 ? v : v + (0.022 - v) ** 1.414);
  const bg = soft(y(fill));
  const onWhite = 1 - bg ** 0.65;
  const onDark = bg ** 0.56 - soft(y(INK_DARK)) ** 0.57;
  return onWhite > onDark ? '#FFFFFF' : INK_DARK;
}

// ── Clipboard (best effort; falls back to a hidden textarea) ────────────────
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  const ta = h('textarea', { class: 'clip-helper', readonly: true, 'aria-hidden': 'true', tabindex: '-1' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.value = '';
  ta.remove();
  return ok;
}
async function readClipboard() {
  try {
    if (navigator.clipboard && navigator.clipboard.readText && window.isSecureContext) return await navigator.clipboard.readText();
  } catch { /* permission denied or unsupported */ }
  return null;
}

function storageAvailable() {
  try {
    const k = '__qw_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch { return false; }
}
// Web Locks keep two tabs from writing the saved wallet at once. Without them nothing is written (see withLock), so
// encrypted storage isn't offered.
const locksAvailable = () => Boolean(typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function');
// Why encrypted storage isn't available, in a sentence (null when it is).
function storageUnavailableReason() {
  if (!window.isSecureContext || !window.crypto || !crypto.subtle) return tr('This page is not running in a secure context (https or localhost), so wallets can be kept for this session only.');
  if (!storageAvailable()) return tr('This browser blocks local storage here, so wallets can be kept for this session only.');
  if (!locksAvailable()) return tr('This browser doesn’t support Web Locks, which keep its tabs from overwriting the saved wallet, so wallets can be kept for this session only.');
  return null;
}
const secureStorageSupported = () => storageUnavailableReason() === null;
// Seeds are only created, imported, signed with or shown on a page the browser trusts: https, localhost or a local
// file. Over plain http anyone on the network could have swapped the code (and its CSP) before it arrived.
const trustedContext = () => window.isSecureContext === true;
// A service worker on this page's address. This page never installs one (its CSP has worker-src 'none'), so one here
// was left by another page served from the same address: it can answer this page's network requests, and on a later
// visit show a page of its own in place of this one. Only a tripwire: a worker that serves its own page never runs
// this check. A browser that can't say (no service workers, or it refuses to list them) or doesn't answer within
// waitMs counts as having none, so a browser quirk can't keep the wallet closed.
async function foreignWorker(waitMs = 2000) {
  let timer = null;
  try {
    const sw = navigator.serviceWorker;
    if (!sw) return false;
    if (sw.controller) return true;
    const unanswered = new Promise((r) => { timer = setTimeout(r, waitMs, []); });
    const listed = await Promise.race([sw.getRegistrations(), unanswered]);
    return Array.isArray(listed) && listed.length > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
// "Remove it and reload" on the refusal screen: unregisters every service worker on this address. true when each one
// confirmed it, or the browser then lists none; false when it says otherwise or doesn't answer within waitMs (the
// screen then says how to remove it by hand). This page stays under its worker until it is reloaded; the reload is
// fetched without it.
async function removeWorkers(waitMs = 5000) {
  let timer = null;
  try {
    const sw = navigator.serviceWorker;
    const work = (async () => {
      const done = await Promise.all((await sw.getRegistrations()).map((r) => r.unregister()));
      return done.every((ok) => ok === true) || (await sw.getRegistrations()).length === 0;
    })();
    const unanswered = new Promise((r) => { timer = setTimeout(r, waitMs, false); });
    return (await Promise.race([work, unanswered])) === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ── Input rules ─────────────────────────────────────────────────────────────
// Send amounts are whole QUBIC. Plain digits, or digits grouped in threes with one separator (1,000,000 · 1 000 000 ·
// 1'000'000 · 1_000_000, and 1.000.000 as much of South America writes it: two points can't be a decimal), or with
// commas the Indian way (10,00,000, as Hindi writes them), are accepted; anything else (a decimal point, as in "1.5" or
// "1.000", a sign, an exponent, a stray comma as in "1,5", a leading zero group as in "0,500") is rejected with a
// message, never reinterpreted as a different number.
function parseWholeAmount(text) {
  const t = String(text).trim();
  if (!t) return { digits: '' };
  if (/[.]/.test(t) && !/^[1-9]\d{0,2}(?:\.\d{3}){2,}$/.test(t)) return { error: tr('Amounts are whole QUBIC: no decimals.') };
  if (!/^[\d,'_.\s]+$/.test(t)) return { error: tr('Use digits only (whole QUBIC).') };
  if (!/^\d+$/.test(t)) {
    const sep = t.match(/[,'_.\s]/)[0];
    const s = /\s/.test(sep) ? '\\s' : sep;
    const indian = sep === ',' && /^[1-9]\d?(?:,\d{2})*,\d{3}$/.test(t);
    if (!indian && !new RegExp(`^[1-9]\\d{0,2}(?:${s}\\d{3})+$`).test(t)) return { error: tr('Group digits in threes ({example}), or use digits only.', { example: groupDigits('1000000') }) };
  }
  const digits = t.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (digits.length > 19) return { error: tr('That amount is too large.') };
  return { digits };
}
// What's typed into Send's amount field, as whole QUBIC. kind 'qubic': digits (parseWholeAmount). 'short': K, M, B or T
// after a number with at most one decimal mark (2.5B, 300M, 2,5B), whose value must be whole; a mark followed by exactly
// three digits is refused, as "1,500K" reads two ways. 'usd': dollars ($25, 25 USD, or anything while the field is in
// dollars), at price, rounded down. digits: the amount, or error: why not.
const AMOUNT_SUFFIX = { k: 3, m: 6, b: 9, t: 12 };
function parseAmountText(text, { price = null, dollars = false } = {}) {
  const t = String(text).trim();
  if (dollars || /\$|usd/i.test(t)) {
    if (!t) return { kind: 'usd', digits: '' };
    const usd = parseDecimalInput(t);
    if (usd == null) return { kind: 'usd', error: tr('Enter an amount in dollars.') };
    if (!(price > 0)) return { kind: 'usd', error: tr('The QUBIC price hasn’t loaded, so dollars can’t be converted yet.') };
    // Rounded down past float error: 0.387 / 0.000000387 comes out as 999999.9999999999.
    const q = usd / price;
    const whole = Math.floor(q + q * 1e-12);
    return Number.isSafeInteger(whole) ? { kind: 'usd', digits: String(whole) } : { kind: 'usd', error: tr('That amount is too large.') };
  }
  const m = t.match(/^(\d+)(?:([.,])(\d+))?\s*([kmbt])$/i);
  if (m) {
    const [, int, mark, frac = '', unit] = m;
    if (frac.length === 3) {
      const a = int + (/[1-9]/.test(frac) ? mark + frac.replace(/0+$/, '') : '') + unit;
      return { kind: 'short', error: tr('“{text}” can be read as {a} or {b}. Type the one you mean.', { text: t, a, b: int + frac + unit }) };
    }
    const e = AMOUNT_SUFFIX[unit.toLowerCase()];
    if (/[1-9]/.test(frac.slice(e))) return { kind: 'short', error: tr('Amounts are whole QUBIC: no decimals.') };
    const shown = frac.slice(0, e);
    const digits = (BigInt(int + shown) * 10n ** BigInt(e - shown.length)).toString();
    return digits.length > 19 ? { kind: 'short', error: tr('That amount is too large.') } : { kind: 'short', digits };
  }
  if (/[kmbt]$/i.test(t)) return { kind: 'short', error: tr('Write short amounts like 2.5B, 300M or 10K.') };
  const r = parseWholeAmount(t);
  return r.error ? { kind: 'qubic', error: r.error } : { kind: 'qubic', digits: r.digits };
}
// A dollar amount or price typed into a field, as a number; null when it isn't one non-negative number that reads one
// way only. Accepted: digits with one decimal mark, with or without groups and a $ sign (1250.5 · 1,250.50 · 1.250,50 ·
// 1 250,50 · $0.0000012). With both "," and "." the last one is the decimal mark and the other must group in threes. A
// mark used more than once groups in threes. One mark followed by other than three digits is the decimal mark ("12,5");
// one followed by exactly three ("1,250") is read as the language in use writes numbers: 1250 in English (its group
// mark), 1.25 in French (its decimal mark). In French "1.250" is neither, so it's null.
function parseDecimalInput(text) {
  const s = String(text).replace(/[\s$]/g, '').replace(/^US(D)?|US(D)?$/i, '');
  if (!s || s.length > 24 || !/^[\d.,]*\d[\d.,]*$/.test(s)) return null;
  // Groups of three, or commas the Indian way (1,00,000, as Hindi writes numbers).
  const grouped = (int, mark) => new RegExp(`^\\d{1,3}(?:\\${mark}\\d{3})*$`).test(int) || (mark === ',' && /^\d{1,2}(?:,\d{2})*,\d{3}$/.test(int));
  const dot = s.lastIndexOf('.'); const comma = s.lastIndexOf(',');
  let int = s; let frac = '';
  if (dot >= 0 && comma >= 0) {
    const at = Math.max(dot, comma); const group = at === dot ? ',' : '.';
    int = s.slice(0, at); frac = s.slice(at + 1);
    if (!grouped(int, group) || /[.,]/.test(frac)) return null;
    int = int.split(group).join('');
  } else if (dot >= 0 || comma >= 0) {
    const mark = dot >= 0 ? '.' : ',';
    const at = s.indexOf(mark);
    const marks = numberFormat('num', { maximumFractionDigits: 2 }).formatToParts(1234.5);
    const own = (type) => (marks.find((p) => p.type === type) || {}).value;
    if (at !== s.lastIndexOf(mark)) {
      if (!grouped(s, mark)) return null;
      int = s.split(mark).join('');
    } else if (s.length - at - 1 !== 3 || own('decimal') === mark) {
      int = s.slice(0, at); frac = s.slice(at + 1);
    } else if (own('group') === mark && grouped(s, mark)) {
      int = s.split(mark).join('');
    } else return null;
  }
  const v = Number(`${int || '0'}.${frac || '0'}`);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

// Password strength 0–4 from a rough guess estimate. A common password or word, a run along a keyboard row or the
// alphabet (either way), a repeated character and a year each count as one cheap guess rather than as random
// characters, so "password123", "1234567890" and "qwertyuiop" come out weak. Long passphrases come out strong.
const COMMON_WORDS = ('password passw0rd qwerty letmein welcome admin login iloveyou monkey dragon master sunshine princess '
  + 'football baseball shadow superman batman trustno1 starwars whatever freedom hello charlie michael jennifer jordan hunter '
  + 'ranger buster soccer hockey killer george summer winter ashley bailey secret love money bitcoin crypto wallet qubic '
  + 'ethereum binance coinbase blockchain satoshi moon lambo hodl changeme default computer internet samsung apple google '
  + 'microsoft facebook pokemon naruto matrix mustang ferrari cheese chocolate cookie flower purple orange banana pepper '
  + 'ginger tigger snoopy liverpool chelsea arsenal barcelona london paris berlin america canada angel babygirl family '
  + 'forever friend jesus heaven access mypassword private security test guest root user qazwsx zaq1 1q2w3e4r').split(' ');
const KEY_RUNS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'abcdefghijklmnopqrstuvwxyz']
  .flatMap((r) => [r, [...r].reverse().join('')]);
function passwordBits(pw) {
  const s = pw.slice(0, 128).normalize('NFKC').toLowerCase();
  const pool = (/[a-z]/i.test(pw) ? 26 : 0) + (/[A-Z]/.test(pw) && /[a-z]/.test(pw) ? 26 : 0) + (/\d/.test(pw) ? 10 : 0) + (/[^A-Za-z0-9]/.test(pw) ? 33 : 0);
  const perChar = Math.log2(Math.max(10, pool));
  let bits = 0;
  for (let i = 0; i < s.length;) {
    let take = 1; let cost = perChar;
    for (const w of COMMON_WORDS) if (w.length > take && s.startsWith(w, i)) { take = w.length; cost = 10; }
    for (const run of KEY_RUNS) {
      let n = 0;
      while (i + n < s.length && run.includes(s.slice(i, i + n + 1))) n++;
      if (n >= 3 && n > take) { take = n; cost = 4 + Math.log2(n); }
    }
    let rep = 1;
    while (s[i + rep] === s[i]) rep++;
    if (rep >= 3 && rep > take) { take = rep; cost = perChar + Math.log2(rep); }
    if (take < 4 && /^(19|20)\d\d/.test(s.slice(i))) { take = 4; cost = 7; }
    bits += cost; i += take;
  }
  return bits;
}
function passwordScore(pw) {
  if (!pw) return 0;
  if (pw.length < MIN_PASSWORD) return 1;
  const bits = passwordBits(pw);
  return bits < 40 ? 1 : bits < 55 ? 2 : bits < 75 ? 3 : 4;
}
