// ═══════════════════════════════════════════════════════════════════════════
// 1. CONFIGURATION
// Every host fetched from here is in the CSP connect-src (assemble.py), and no other host is; EXPLORER is only
// linked to.
// ═══════════════════════════════════════════════════════════════════════════
const APP_VERSION = '1.1.0-rc.3';

const RPC = 'https://rpc.qubic.org';
// Paths match the official wallets (qubic/wallet-app lib/config.dart, qubic/wallet) and SDK.
const API = {
  tickInfo: `${RPC}/live/v1/tick-info`,
  balance: (id) => `${RPC}/live/v1/balances/${id}`,
  ownedAssets: (id) => `${RPC}/live/v1/assets/${id}/owned`,
  broadcast: `${RPC}/live/v1/broadcast-transaction`,
  lastProcessedTick: `${RPC}/query/v1/getLastProcessedTick`,
  transactionByHash: `${RPC}/query/v1/getTransactionByHash`,
  transactionsForIdentity: `${RPC}/query/v1/getTransactionsForIdentity`,
  processedIntervals: `${RPC}/query/v1/getProcessedTickIntervals`,
  tickData: `${RPC}/query/v1/getTickData`,
  // Core's event log, as the archive serves it (beta upstream, not guaranteed complete): read only as positive
  // evidence that a transfer moved QUBIC.
  eventLogs: `${RPC}/query/v1/getEventLogs`,
  latestStats: `${RPC}/v1/latest-stats`,
};
const MARKET_API = {
  price: 'https://api.coingecko.com/api/v3/simple/price?ids=qubic-network&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_last_updated_at=true',
  chart: 'https://api.coingecko.com/api/v3/coins/qubic-network/market_chart?vs_currency=usd&days=1',
  // "Value when sent": generic series (hourly over 90 days, daily over a year), never a
  // per-transaction request.
  history90: 'https://api.coingecko.com/api/v3/coins/qubic-network/market_chart?vs_currency=usd&days=90',
  history365: 'https://api.coingecko.com/api/v3/coins/qubic-network/market_chart?vs_currency=usd&days=365',
  // Older than CoinGecko's free year: Gate.io's daily QUBIC/USDT candles, asked for in fixed windows from the
  // listing month (May 2024), so the request is the same for every wallet whatever you're looking at.
  gateDaily: (from, to) => `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=QUBIC_USDT&interval=1d&from=${from}&to=${to}`,
  // Order books (opt-in): each exchange's public QUBIC/USDT book, `limit` levels a side.
  gateBook: (limit) => `https://api.gateio.ws/api/v4/spot/order_book?currency_pair=QUBIC_USDT&limit=${limit}`,
  // Best effort: blocked in some countries, and not confirmed to let web pages read it (it then shows as unavailable).
  mexcBook: (limit) => `https://api.mexc.com/api/v3/depth?symbol=QUBICUSDT&limit=${limit}`,
  // Exchange status: whether Gate.io takes QUBIC deposits and withdrawals right now (public, no key needed).
  gateStatus: 'https://api.gateio.ws/api/v4/spot/currencies/QUBIC',
};
const GATE_FROM = 1714521600;   // 2024-05-01 00:00 UTC; Gate.io's first QUBIC/USDT candle is 2024-05-09
const GATE_WINDOW_DAYS = 900;   // Gate.io returns at most 1,000 candles per request
const LABELS_API = {
  contracts: 'https://static.qubic.org/v1/general/data/smart_contracts.json',
  exchanges: 'https://static.qubic.org/v1/general/data/exchanges.json',
  labels: 'https://static.qubic.org/v1/general/data/address_labels.json',
};
const EXPLORER = 'https://explorer.qubic.org/network';

const STORAGE_KEYS = { vault: 'qubic-wallet.vault.v1', prefs: 'qubic-wallet.prefs.v1', resume: 'qubic-wallet.resume.v2', journal: 'qubic-wallet.pending.v1' };

// Official @qubic.org/vault defaults: Argon2id, 64 MiB, 3 passes, 4 lanes.
const VAULT_KDF = { name: 'argon2id', m: 65536, t: 3, p: 4 };
// Accepted range when reading a stored header (guards against a tampered, oversized header).
const VAULT_KDF_LIMITS = { m: [19456, 262144], t: [1, 10], p: [1, 8] };
const VAULT_FORMAT = 'qubic-web-wallet-vault';
const MIN_PASSWORD = 10;

// Accent colours offered in Settings, the default (blue, qoree's main colour) first; each has a matching :root[data-accent] ramp in the
// CSS. fill/ink repeat its colours to draw the favicon (ink is inkFor(fill); the outcomes suite holds the two lists and
// the rule together); fill also paints the Settings swatches and is the colour picker's starting value.
const ACCENTS = [
  { id: 'blue', name: trLater('Blue'), fill: '#0D42FF', ink: '#FFFFFF' },
  { id: 'teal', name: trLater('Teal'), fill: '#1BDEF5', ink: '#292524' },
  { id: 'indigo', name: trLater('Indigo'), fill: '#5B5FEF', ink: '#FFFFFF' },
  { id: 'violet', name: trLater('Violet'), fill: '#7550F5', ink: '#FFFFFF' },
  { id: 'emerald', name: trLater('Emerald'), fill: '#10B981', ink: '#FFFFFF' },
  { id: 'rose', name: trLater('Rose'), fill: '#E11D48', ink: '#FFFFFF' },
  { id: 'orange', name: trLater('Orange'), fill: '#F97316', ink: '#FFFFFF' },
  { id: 'gold', name: trLater('Gold'), fill: '#FAC515', ink: '#292524' },
];

// The languages the app is written in (see src/js/01b-i18n.js), English first. id: the setting's value and its table
// in src/i18n/; tag: the page's lang; name: the language in itself; intl: the locale numbers and dates are written in
// (English writes dates the browser's way, as before); rel: how "5 min ago" is shortened (Intl.RelativeTimeFormat's
// style); usd: how dollars are marked (Intl's currencyDisplay; 'symbol' when not set: US$ in Chinese, USD in Latin
// American Spanish, where a bare $ reads as pesos, $US in French); usdPrefix: a sign put before the language's own
// number instead (Arabic writes $1,234.56 and $4.6 مليار, as its crypto apps do; Hindi $4.6 अरब, with the unit in words);
// hour: 'numeric' for a 12-hour clock without a
// leading zero; compact: 'long' to write large numbers' units out (1.23 अरब, not 1.23 अ॰); units: how durations name their
// units ('short': 3 min 5 s, 'long': 3 मिनट 5 सेकंड; English 3m 5s); capBillions: from how big a number keeps the unit
// for 10^9 (see capped); lessThan: how "less than" is put before a tiny amount (French spaces it: < 0,01 $US). reviewed: a native speaker has read the translation. Until one has, a
// language is used only once picked: it is never chosen from the browser's languages, so English stays the default.
// Each language's choices are explained in localization/<id>/style.md.
/** @type {Language[]} */
const LANGUAGES = [
  { id: 'en', tag: 'en', name: 'English', dir: 'ltr', intl: 'en-US', rel: 'narrow', reviewed: true },
  { id: 'zh-Hans', tag: 'zh-Hans', name: '简体中文', dir: 'ltr', intl: 'zh-CN', rel: 'short', usd: 'narrowSymbol', reviewed: false },
  { id: 'hi-IN', tag: 'hi', name: 'हिन्दी', dir: 'ltr', intl: 'hi-IN', rel: 'long', hour: 'numeric', compact: 'long', units: 'long', capBillions: 1e11, usdPrefix: '$', reviewed: false },
  { id: 'es-419', tag: 'es-419', name: 'Español', dir: 'ltr', intl: 'es-419', rel: 'short', hour: 'numeric', units: 'short', capBillions: 1e12, reviewed: false },
  { id: 'ar', tag: 'ar', name: 'العربية', dir: 'rtl', intl: 'ar-u-nu-latn', rel: 'short', hour: 'numeric', usdPrefix: '$', reviewed: false },
  { id: 'fr-FR', tag: 'fr', name: 'Français', dir: 'ltr', intl: 'fr-FR', rel: 'short', units: 'short', capBillions: 1e12, lessThan: '<\u00a0', reviewed: false },
];

/** @type {Readonly<Prefs>} */
const DEFAULT_PREFS = Object.freeze({
  lang: null,             // one of LANGUAGES, once picked; until then a reviewed language matching the browser's, or English
  theme: 'dark',          // dark | light | system
  accent: 'blue',         // one of ACCENTS
  accentChosen: false,    // picked in Settings; until then the default applies, even if a past default was saved
  accentCustom: null,     // '#rrggbb' from the colour picker; used when accent is 'custom'
  grays: 'warm',          // warm | neutral: the grays of surfaces and text (warm stone, or pure gray)
  heroUnit: 'usd',        // usd | qubic: what the balance shows (tap it to switch)
  priceUnit: 'unit',      // unit | billion: the QUBIC price per coin or per billion coins
  privacy: false,         // mask balances
  selection: null,        // encrypted mode: the account last in view (an id, or 'all'), so switching leaves the sealed wallet be
  marketData: true,       // CoinGecko price, 24h change and chart, and Gate.io's older daily prices
  labels: true,           // official static address labels
  orderBooks: false,      // QUBIC/USDT order books from Gate.io and MEXC (they'd see this device's IP address)
  exchangeStatus: true,   // whether Gate.io has paused QUBIC deposits or withdrawals (it sees the IP address too)
  tickOffset: 10,         // qubic/wallet default; wallet-app offers 5/10/20/40
  autoLockMinutes: 10,    // encrypted mode only
  resumeOnReload: false,  // encrypted mode, opt-in: a reload in the same tab reopens the wallet until auto-lock
  activityFiltersOpen: false, // show Activity's search, transaction types and ordering controls
});
const TICK_OFFSETS = [5, 10, 20, 40];
const AUTO_LOCK_CHOICES = [1, 5, 10, 30, 60];

const HISTORY_PAGE = 25;
// An account's whole history (for Activity and the look-alike check) is read in pages of 1,000 (the query API's
// maximum), up to 3,000. New transactions the latest page already holds are added to it without reading again; a full
// read happens at most every FULL_HISTORY_MIN_MS (FULL_HISTORY_CAPPED_MS for one past the cap). While the archive is
// behind an account's latest balance change, its latest page is read again every HISTORY_BEHIND_MS.
const FULL_HISTORY_PAGE = 1000;
const FULL_HISTORY_CAP = 3000;
const FULL_HISTORY_MIN_MS = 60000;
const FULL_HISTORY_CAPPED_MS = 600000;
const HISTORY_BEHIND_MS = 15000;
// The look-alike check reads each seed account's own outgoing transactions in the same pages, up to SENT_CAP (the
// archive serves at most 10,000 results deep). A screen waits at most LOOKALIKE_WAIT_MS for that read; a read that
// failed is tried again after SENT_RETRY_MS.
const SENT_CAP = 10000;
const LOOKALIKE_WAIT_MS = 15000;
const SENT_RETRY_MS = 30000;
const DAY_MS = 86400000;
// Tips for qoree's development (Settings → Support qoree) go to this address; the outcomes suite checks it's a valid
// identity, so a typo here can't send anyone's QUBIC nowhere. The tip choices are in US dollars.
const DONATION_ADDRESS = 'SCSGABTBOJFGTBFQVBFFWNYLHIRCXMIJUJMHSCFRVFHGYCBHMEVWEMCCHRUH';
const TIP_USD = [5, 10, 25];
// balances: the accounts on screen; otherBalances: the rest, which show only in lists that read them again on opening.
const POLL_MS = { tick: 5000, tickFast: 2000, balances: 20000, otherBalances: 120000, history: 90000, price: 60000, chart: 600000, archive: 3000, exchanges: 600000 };
const TIMEOUT_MS = 12000;
// The largest response read from any server (a 1,000-transaction history page is about 0.5 MB): anything bigger is
// refused while it streams in, before it can fill memory or stall the page.
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
// Counted from signing: after this long, a transfer whose tick the network and the archive have passed, but that
// can't be settled, is reported as unknown. Never before they have passed it, however long that takes: until then it
// can still execute (see pastTarget).
const PENDING_GIVE_UP_MS = 15 * 60 * 1000;
// The network counts as stalled once its tick hasn't moved for this long (a tick normally takes a few seconds).
const TICK_STALL_MS = 60 * 1000;
const MAX_ACCOUNTS = 20;
// Avatar choices: one of 10 colours (see AVATAR_PRESETS) and one of these finishes.
const AVATAR_COLORS = 10;
const AVATAR_FINISH_IDS = ['radial', 'ember', 'twin', 'aqua'];
const MAX_CONTACTS = 200;
// Qubic Core's MAX_AMOUNT (ISSUANCE_RATE × 1000): a transfer above it is invalid on the network.
const MAX_AMOUNT = 1000000000000000n;
// Qubic Core's MAX_INPUT_SIZE and NUMBER_OF_TRANSACTIONS_PER_TICK (src/network_messages/common_def.h; the vendored
// SDK's protocol table agrees): a transaction's input is at most 1024 bytes and a tick holds at most 4096
// transactions. Used to reject malformed archive data.
const MAX_INPUT_SIZE = 1024;
const TRANSACTIONS_PER_TICK = 4096;

const QUTIL_INDEX = 4;            // QubicDefinitions.QUTIL_ADDRESS (contract #4)
const QUTIL_SENDMANY_INPUT = 1;   // QubicDefinitions.QUTIL_SENDMANY_INPUT_TYPE

// Known-answer tests run at startup. Values were produced and cross-checked against the
// production web wallet's WASM crypto (@qubic-lib/qubic-ts-library 0.1.6).
const KAT = Object.freeze({
  seed: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  identity: 'BZBQFLLBNCXEMGLOBHUVFTLUPLVCPQUASSILFABOFFBCADQSSUPNWLZBQEXK',
  message: 'qubic-wallet self-test v1',
  digest: '6f5ce5d79393404f8ec30cd87031ca8a7779665613f1bc98fec2259560d46c65',
  signature: 'b4bbb5b33951da04fa656d61fb3c5141c7a5341ca23fe2678d48e7d82949a9fa35c08309c12beb6c0034a1eb22a480da7b93c77aaaf61b93d06e59f35cdc1d00',
  // Real mainnet transfer (tick 85,111,251, 100,000,000 QU, moneyFlew = true).
  mainnetTx: '2viIZ8s8tz45iOdP3XMAU1xIDseruf91nujBGglPSsMX5IYFhV8EdNgv8/k9a4VpIjVssPYLXFtf6C0NRdVk7QDh9QUAAAAA07ESBQAAAABQ52hJqYEtCH24tyNuCSFUVR4mkt0xprqfQbQGFqXJFMHDjuEioUITxM/s6bja/KXualEVIZ9TdMiS3nho4xMA',
  mainnetHash: 'jkowcxdyisixqdyusvbulvothgchctwgfnuvwbdfdfinzhnvrfewhepeszyi',
  // A signed message in the official web wallet's format (same seed), produced by its own sign-message code path.
  signedMessage: 'qubic-wallet message self-test v1',
  messageSignature: 'JGIECIHOLHKCHMKHBBHFMKOFFCIHMJHBFGPNGNGNDMCLJJLMIEOHCJAEOAEJAAKOJICHPOCJDPPNNCBKPDIAAECBPCKAOGOHOCGODEONKJGLPCKLKGDBLNOOENMOADAAOM',
  // RFC 9106 §5.3 Argon2id test vector.
  argon2id: '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
});
