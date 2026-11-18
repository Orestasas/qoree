// Browser stand-ins for the storage suites (adopt.cjs, storage-lifecycle.cjs). Each "tab" is its own VM context with
// its own state and sessionStorage; all tabs share one localStorage, one IndexedDB and one Web Locks, as the tabs of
// one origin do. shared.failVaultWrites / shared.failRemove make writing / removing the vault record throw, and
// shared.onIdbPut, when set, runs after each IndexedDB put.
const vm = require('vm'); const { webcrypto } = require('crypto');
const { vendorScript, appScript, runApp, pickFunction, mutable } = require('./load.cjs');

const VAULT_KEY = 'qubic-wallet.vault.v1';
const RESUME_KEY = 'qubic-wallet.resume.v2'; // the reload key's sessionStorage half
const shared = { ls: new Map(), idb: new Map(), locks: new Map(), onIdbPut: null, failVaultWrites: false, failRemove: false };
const localStorage = {
  getItem: (k) => (shared.ls.has(k) ? shared.ls.get(k) : null),
  setItem: (k, v) => { if (shared.failVaultWrites && k === VAULT_KEY) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } shared.ls.set(k, String(v)); },
  removeItem: (k) => { if (shared.failRemove && k === VAULT_KEY) throw new Error('blocked'); shared.ls.delete(k); },
};
const later = (fn, ms = 0) => setTimeout(fn, ms);
function storeTx(store) {
  const t = {};
  const req = (fn) => { const r = {}; later(() => { r.result = fn(); if (r.onsuccess) r.onsuccess(); }); return r; };
  t.objectStore = () => ({
    put: (v) => req(() => { store.map.set(v[store.keyPath], structuredClone(v)); if (shared.onIdbPut) shared.onIdbPut(); }),
    get: (k) => req(() => (store.map.has(k) ? structuredClone(store.map.get(k)) : undefined)),
    delete: (k) => req(() => { store.map.delete(k); }),
    clear: () => req(() => { store.map.clear(); }),
    count: () => req(() => store.map.size),
    openCursor: () => {
      const r = {}; const keys = [...store.map.keys()]; let i = 0;
      const step = () => later(() => {
        if (i >= keys.length) { r.result = null; if (r.onsuccess) r.onsuccess(); return; }
        const k = keys[i++];
        r.result = { value: structuredClone(store.map.get(k)), delete: () => store.map.delete(k), continue: step };
        if (r.onsuccess) r.onsuccess();
      });
      step();
      return r;
    },
  });
  later(() => { if (t.oncomplete) t.oncomplete(); }, 25);
  return t;
}
const indexedDB = {
  open(name, version) {
    const rq = {};
    later(() => {
      let db = shared.idb.get(name);
      const upgrade = !db || version > db.version;
      if (!db) { db = { version: 0, stores: new Map() }; shared.idb.set(name, db); }
      rq.result = {
        objectStoreNames: { contains: (n) => db.stores.has(n) },
        createObjectStore: (n, { keyPath }) => { db.stores.set(n, { keyPath, map: new Map() }); },
        deleteObjectStore: (n) => { db.stores.delete(n); },
        transaction: (n) => storeTx(db.stores.get(n)),
        close() {},
      };
      if (upgrade) { db.version = version; if (rq.onupgradeneeded) rq.onupgradeneeded(); }
      if (rq.onsuccess) rq.onsuccess();
    });
    return rq;
  },
};
const resumeRecords = () => { const db = shared.idb.get('qubic-wallet'); const st = db && db.stores.get('resume'); return st ? st.map.size : 0; };
const locks = {
  request(name, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    const q = shared.locks.get(name) || { held: false, waiters: [] };
    shared.locks.set(name, q);
    if (opts.ifAvailable && q.held) return Promise.resolve(cb(null));
    return new Promise((resolve, reject) => {
      const run = async () => {
        q.held = true;
        try { resolve(await cb({ name })); } catch (e) { reject(e); } finally { q.held = false; const next = q.waiters.shift(); if (next) next(); }
      };
      if (q.held) q.waiters.push(run); else run();
    });
  },
};

// The app's files as one script, with the KDF cost lowered for speed (the code path is unchanged), followed by any
// functions picked from other files (picks: [file, function name] pairs). mutation(name, from, to): see load.cjs.
function appSource(build, src, files, picks = []) {
  const KDF_LINE = "const VAULT_KDF = { name: 'argon2id', m: 65536, t: 3, p: 4 };";
  let text = appScript(src, files) + picks.map(([file, name]) => `\n${pickFunction(src, file, name)}`).join('');
  if (!text.includes(KDF_LINE)) throw new Error('KDF line moved');
  text = text.replace(KDF_LINE, "const VAULT_KDF = { name: 'argon2id', m: 19456, t: 1, p: 1 };");
  const app = mutable(text);
  return { vendor: vendorScript(build), get text() { return app.text; }, mutation: app.mutation };
}

// A tab running the app: body is the code run with it (stubs first, then ${app.text}, then what to hand back as
// window.__t), in strict mode and given its own copy of the libraries, as the page runs it. session: its
// sessionStorage map (a reload keeps the tab's). lockManager: null for a browser without Web Locks. extra: more
// globals. pauseNextEncrypt() / pauseDecryptOf(aad) hold that crypto call until release().
function makeTab(app, body, { session = new Map(), lockManager = locks, extra = {} } = {}) {
  const tab = { encryptGate: null, decryptGate: null, session };
  const subtle = new Proxy(webcrypto.subtle, {
    get(target, prop) {
      if (prop === 'encrypt') {
        return async (...args) => {
          if (tab.encryptGate) { const g = tab.encryptGate; tab.encryptGate = null; await g(); }
          return target.encrypt(...args);
        };
      }
      if (prop === 'decrypt') {
        return async (...args) => {
          const aad = args[0] && args[0].additionalData ? Buffer.from(args[0].additionalData).toString() : '';
          if (tab.decryptGate && tab.decryptGate.when(aad)) { const g = tab.decryptGate; tab.decryptGate = null; await g.wait(); }
          return target.decrypt(...args);
        };
      }
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  const ctx = {
    console, setTimeout, clearTimeout, TextEncoder, TextDecoder, atob, btoa, structuredClone, performance, Uint8Array, Promise, AbortController,
    crypto: { getRandomValues: (a) => webcrypto.getRandomValues(a), subtle },
    localStorage, indexedDB, navigator: { ...(lockManager ? { locks: lockManager } : {}), onLine: true },
    sessionStorage: { getItem: (k) => (session.has(k) ? session.get(k) : null), setItem: (k, v) => session.set(k, String(v)), removeItem: (k) => session.delete(k) },
    isSecureContext: true, ...extra,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  tab.navigator = ctx.navigator; // the tab's own, so a suite can give it what a browser would (a serviceWorker, say)
  tab.crypto = ctx.crypto; // likewise, so a suite can stand in a broken random generator
  runApp(body, vm.runInContext(app.vendor, ctx), ctx);
  tab.t = ctx.__t;
  const gate = () => { let release; let reached; const atGate = new Promise((r) => { reached = r; }); return { atGate, release: () => release(), wait: () => { reached(); return new Promise((r) => { release = r; }); } }; };
  tab.pauseNextEncrypt = () => { const g = gate(); tab.encryptGate = g.wait; return g; };
  tab.pauseDecryptOf = (aadText) => { const g = gate(); tab.decryptGate = { when: (aad) => aad === aadText, wait: g.wait }; return g; };
  return tab;
}

// Long enough for the stand-ins' timers (IndexedDB transactions complete after 25 ms) and the app's follow-up work.
const settle = () => new Promise((r) => setTimeout(r, 120));

module.exports = { VAULT_KEY, RESUME_KEY, shared, localStorage, resumeRecords, appSource, makeTab, settle };
