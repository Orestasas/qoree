// Types for the type check (lint/tsconfig.json, run by build.sh). Never shipped: src/assemble.py reads only src/js. The
// files in src/js are one script in one function scope, so everything declared here is global to all of them.

// ── The vendored libraries ──────────────────────────────────────────────────
// The argument of the function around the app (src/assemble.py), null if the libraries threw while starting. Only
// what the app uses, as build/entry.js exports it; seeds, identities, hashes and base64 are plain strings here.
interface DerivedKeys { subseed: Uint8Array; privateKey: Uint8Array; publicKey: Uint8Array }
interface DecodedTransaction {
  sourcePublicKey: Uint8Array; destinationPublicKey: Uint8Array; amount: bigint; targetTick: number; inputType: number; payload: Uint8Array;
}
interface TransactionInput {
  source: string | Uint8Array; destination: string | Uint8Array; amount: bigint; targetTick: number; inputType: number;
  payload?: Uint8Array; currentTick?: number;
}
// FourQ points (extended coordinates, and the R2 form pointAdd takes): the app only hands them back to the library.
type FourQPoint = { readonly fourq: 'R1' };
type FourQPointR2 = { readonly fourq: 'R2' };
interface QubicLib {
  k12(input: Uint8Array, outputLength?: number): Uint8Array;
  deriveKeys(seed: string): DerivedKeys;
  publicKeyToIdentity(publicKey: Uint8Array): string;
  identityToPublicKey(identity: string): Uint8Array;
  isValidIdentityChecksum(identity: string): boolean;
  sign(message: Uint8Array, seed: string): Promise<Uint8Array>;
  verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;
  generateRandomSeed(): string;
  buildTransaction(input: TransactionInput): Uint8Array;
  signTransaction(txBytes: Uint8Array, seed: string): Promise<Uint8Array>;
  encodeTransaction(signedTx: Uint8Array): string;
  decodeTransaction(bytes: Uint8Array): DecodedTransaction;
  computeTransactionHash(signedTxBytes: Uint8Array): string;
  verifyTransactionSignature(signedTxBytes: Uint8Array): boolean;
  argon2idAsync(password: string | Uint8Array, salt: string | Uint8Array,
    opts: { t: number; m: number; p: number; dkLen?: number; asyncTick?: number; key?: Uint8Array; personalization?: Uint8Array }): Promise<Uint8Array>;
  scalarBaseMult(scalar: Uint8Array): FourQPoint;
  doubleScalarMult(k1: Uint8Array, Q: FourQPoint, k2: Uint8Array): FourQPoint;
  pointMarshal(P: FourQPoint): Uint8Array;
  pointUnmarshal(input: Uint8Array): FourQPoint | null;
  pointIdentity(): FourQPoint;
  pointDouble(P: FourQPoint): FourQPoint;
  pointAdd(P: FourQPoint, Q: FourQPointR2): FourQPoint;
  toR2(P: FourQPoint): FourQPointR2;
  isOnCurve(P: FourQPoint): boolean;
  SCHNORRQ_ORDER: bigint;
}
type QrEcc = { readonly ecc: string };
interface QrCode { readonly size: number; getModule(x: number, y: number): boolean }
interface QrCodeGen {
  QrCode: { encodeText(text: string, ecl: QrEcc): QrCode; Ecc: { LOW: QrEcc; MEDIUM: QrEcc; QUARTILE: QrEcc; HIGH: QrEcc } };
}
declare const VENDORED: { QubicLib: QubicLib; qrcodegen: QrCodeGen } | null;

// ── Errors ──────────────────────────────────────────────────────────────────
// What AppError takes as its code: one with a fixed message in ERROR_TEXT, or one always thrown with its own text.
type AppErrorCode = keyof typeof ERROR_TEXT | 'BACKUP' | 'CANCELLED' | 'CONTACT' | 'DUPLICATE' | 'FUNDS' | 'LIMIT';
// English text marked with trLater, or a list of them said one after another (AppError's text, a transfer's note).
type LaterText = string | string[];
// Anything a catch can hold: an AppError, a NetError or whatever else was thrown.
type Caught = any;

// ── The page ────────────────────────────────────────────────────────────────
// What h() and svg() take as children: nodes and text, lists of them, and nothing (null, undefined, false).
type Child = Node | string | number | null | undefined | false | Child[];
interface ButtonOptions {
  kind?: string; onClick?: (event: MouseEvent) => unknown; iconName?: string; block?: boolean; small?: boolean; type?: string;
  disabled?: boolean;
}
interface PaneOptions { title?: string; back?: (() => void) | null; footer?: Child; direction?: 'forward' | 'back' | 'swap' | null; keepScroll?: boolean }
// A large number that moves into the sheet's header as it scrolls away (numberToHeader).
interface HeaderMotion {
  scroller: HTMLElement | Window; bar: () => number; number: HTMLElement; slot: HTMLElement; label?: HTMLElement; hide?: HTMLElement;
  rest?: HTMLElement;
}
// An official label for an address (fetchLabels); a contract's carries its procedures' names by input type.
interface AddressLabel { name: string; kind: 'contract' | 'exchange' | 'label'; procedures?: Map<number, string> }

// ── Settings and accounts ───────────────────────────────────────────────────
interface Language {
  id: string; tag: string; name: string; dir: 'ltr' | 'rtl'; intl: string; rel: Intl.RelativeTimeFormatStyle; reviewed: boolean;
  usd?: 'symbol' | 'narrowSymbol'; hour?: 'numeric' | '2-digit'; compact?: 'short' | 'long'; units?: 'short' | 'long' | 'narrow';
  capBillions?: number; usdPrefix?: string; lessThan?: string;
}
// Saved whole, defaults included (Prefs in src/js/04-storage.js; DEFAULT_PREFS says what each one is).
interface Prefs {
  lang: string | null;
  theme: 'dark' | 'light' | 'system';
  accent: string;
  accentChosen: boolean;
  accentCustom: string | null;
  grays: 'warm' | 'neutral';
  heroUnit: 'usd' | 'qubic';
  priceUnit: 'unit' | 'billion';
  privacy: boolean;
  selection: string | null;
  marketData: boolean;
  labels: boolean;
  orderBooks: boolean;
  bpp: boolean;
  exchangeStatus: boolean;
  tickOffset: number;
  autoLockMinutes: number;
  resumeOnReload: boolean;
  activityFiltersOpen: boolean;
}
// A colour (0 to AVATAR_COLORS - 1; null: the one its address picks) and a finish.
interface Avatar { color: number | null; finish: string }
interface Account {
  id: string; // 16 hex digits
  name: string;
  kind: 'seed' | 'watch';
  identity: string;
  publicKey: Uint8Array;
  seed?: string | null; // seed accounts only; null once dropped
  avatar?: Avatar | null;
  createdAt: number;
}
interface Contact { id: string; name: string; identity: string; createdAt: number }

// ── The stored wallet (src/js/04-storage.js) ────────────────────────────────
interface VaultKdf { name: 'argon2id'; m: number; t: number; p: number; salt: string }
// An AES-256-GCM IV and ciphertext, base64.
interface SealedPart { iv: string; data: string }
interface VaultHeader { format: string; version: number; kdf: VaultKdf }
// The one stored record (and an encrypted backup file): the header, the sealed accounts and, when there are any, the
// sealed journal. What Vault.parseHeader returns and state.vault.header holds.
interface VaultRecord extends VaultHeader { cipher: { name: 'AES-256-GCM'; iv: string }; data: string; pending?: SealedPart }
// The sealed accounts part, opened.
interface VaultPayload {
  v: 1;
  accounts: { id: string; name: string; kind: 'seed' | 'watch'; identity: string; createdAt: number; avatar?: Avatar; seed?: string }[];
  selection: string | null;
  contacts: Contact[];
}
// One unsettled transfer in the sealed journal part ({ v: 1, entries }).
interface JournalEntry { hash: string; encoded: string; startTick: number | null; createdAt: number }

// ── Transfers ───────────────────────────────────────────────────────────────
// signing and broadcasting: on its way; waiting and confirming: broadcast, not yet settled; error: never broadcast; the
// rest are settled (SETTLED), except unknown: no evidence either way yet.
type TransferStatus = 'signing' | 'broadcasting' | 'waiting' | 'confirming' | 'unknown' | 'success' | 'failed' | 'not-executed'
  | 'dismissed' | 'error';
// A transfer signed here, tracked until it settles (state.pending).
interface PendingTransfer {
  hash: string | null; // null until it's signed
  encoded?: string; // the signed transaction, base64
  from: string;
  to: string;
  amount: bigint;
  targetTick: number | null;
  startTick: number | null; // the tick when it was broadcast
  createdAt: number;
  status: TransferStatus;
  peers: number | null;
  note: LaterText | null;
  draft: { fromId: string; to: string; amountRaw: string } | null; // to send it again
  mismatch?: boolean;
  checkedAt?: number;
  resolvedAt?: number;
}

// One transfer in flight per account (claimSend).
interface SendClaim { release: (value?: unknown) => void; done: boolean; ready?: Promise<boolean> }

// What the archive and Core's log say of a transfer (transferOutcome): whether its tick's list holds it, and if so its
// flags.
interface Evidence { included: boolean; moneyFlew?: boolean | null; event?: boolean | null }
// The look-alike check's findings for an address (lookalikeWarnings).
interface LookalikeWarnings { lines: { level: string; icon: string; text: string }[]; twin: boolean; waiting: boolean; complete: boolean }

// ── From the network (src/js/05-net.js) ─────────────────────────────────────
interface TickInfo { tick: number; epoch: number }
// A transaction from the archive (parseTx).
interface ArchiveTx {
  hash: string;
  source: string;
  destination: string;
  amount: bigint;
  tick: number;
  timestamp: number | null;
  inputType: number;
  inputSize: number;
  inputData: string | null;
  signature: string | null;
  moneyFlew: boolean | null;
}
// An account's live record, read strictly for settling (fetchOutflow).
interface LiveBalance { validForTick: number; lastOutTick: number; lastInTick: number; incoming: bigint }
// A page of an account's history (fetchHistory); total: all the archive holds for the account.
interface HistoryPage { txs: ArchiveTx[]; total: number; validForTick: number }
// NetError's detail: the server's own words, cleaned, for the console and the tests (never shown).
interface NetError { detail?: string }
type Balance = Awaited<ReturnType<typeof fetchBalance>>;
type OwnedAsset = Awaited<ReturnType<typeof fetchOwnedAssets>>[number];

// ── The app's state (src/js/06-store.js) ────────────────────────────────────
interface AccountData {
  balance: Balance | null; balanceErr: Caught;
  assets: OwnedAsset[] | null; assetsErr: Caught;
  history: ArchiveTx[] | null; historyErr: Caught; historyTotal: number; historyTick: number; historyTriedAt: number; loadingMore: boolean;
  arrivedFrom: any; announced: Set<string>;
  full: any; fullErr: Caught; fullErrAt: number;
  stale: boolean; inflight: Record<string, Promise<unknown> | undefined>;
  sentTo: Map<string, any>; sent: any; sentErr: Caught; sentErrAt: number;
}
// See openSession (06-store.js).
interface Session { alive(): boolean; signal: AbortSignal }
interface AppState {
  phase: 'boot' | 'welcome' | 'locked' | 'ready';
  mode: 'none' | 'session' | 'vault';
  vault: { key: CryptoKey; header: VaultRecord } | null;
  accounts: Account[];
  contacts: Contact[];
  selection: string | null;
  prefs: Prefs;
  selfTest: { status: 'running' | 'pass' | 'fail'; steps: string[]; failed?: string; ms?: number };
  net: {
    tick: number | null; epoch: number | null; tickAt: number; movedAt: number; tickErr: Caught; msPerTick: number | null;
    samples: [number, number][];
  };
  data: Map<string, AccountData>;
  market: { cg: any; cgErr: Caught; rpc: any; rpcErr: Caught; chart: any };
  labels: Map<string, AddressLabel>;
  labelsLoaded: boolean;
  exchanges: Record<string, Awaited<ReturnType<typeof fetchExchangeStatus>> | null>;
  pending: PendingTransfer[];
  refreshing: boolean;
  lastActivity: number;
  session: Session;
  journalProblem: boolean;
}
