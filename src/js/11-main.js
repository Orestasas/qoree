// ═══════════════════════════════════════════════════════════════════════════
// 12. LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════
// A colour from the picker as the accent: it is the fill as picked, its ink is white or near-black by the same rule as
// the presets (inkFor), and the rest of the ramp is built in OKLCH around its hue at fixed lightness steps, so brand
// text, badges, focus rings and subtle fills stay legible whatever was picked.
// The ramp steps the styles read (50, 400, 500, 700, 800, 950), as [step, OKLCH lightness, share of the chroma].
const RAMP = [[50, 0.97, 0.25], [400, 0.74, 0.95], [500, 0.66, 1], [700, 0.49, 0.95], [800, 0.42, 0.85], [950, 0.27, 0.6]];
const RAMP_VARS = ['--brand-fill', '--brand-ink', '--brand-bevel', ...RAMP.map(([step]) => `--brand-${step}`)];
function customAccent(hex) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.min(Math.hypot(A, B), 0.2);
  const H = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  const ink = inkFor(hex);
  const lch = (lightness, chroma) => `oklch(${lightness.toFixed(3)} ${chroma.toFixed(3)} ${H.toFixed(1)})`;
  const vars = { '--brand-fill': hex, '--brand-ink': ink, '--brand-bevel': lch(Math.min(0.96, L + 0.2), C * 0.6) };
  for (const [step, lightness, share] of RAMP) vars[`--brand-${step}`] = lch(lightness, C * share);
  return { fill: hex, ink, vars };
}

// preview: a picker colour to show while picking, not saved.
function applyTheme(preview = null) {
  const pref = state.prefs.theme;
  const dark = pref === 'dark' || (pref === 'system' && !window.matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.grays = state.prefs.grays === 'neutral' ? 'neutral' : 'warm';
  // The browser's own bars take the page colour, whichever grays are in use.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg-page').trim() || (dark ? '#171412' : '#F4F3F2'));
  const pickedHex = preview || (state.prefs.accent === 'custom' ? state.prefs.accentCustom : null);
  const picked = pickedHex && /^#[0-9a-f]{6}$/i.test(pickedHex) ? customAccent(pickedHex.toLowerCase()) : null;
  const accent = picked || ACCENTS.find((a) => a.id === state.prefs.accent) || ACCENTS[0];
  const rootStyle = document.documentElement.style;
  for (const v of RAMP_VARS) rootStyle.removeProperty(v);
  if (picked) for (const [k, v] of Object.entries(picked.vars)) rootStyle.setProperty(k, v);
  document.documentElement.dataset.accent = picked ? 'custom' : accent.id;
  // The favicon and the Home Screen icon: the logo's mark on the accent colour, in its ink. The Home Screen one is a
  // plain square (the system rounds it) with the mark half its width; it's made here, as it's read only when the page
  // is added, and not for every step of a colour being picked. head.html holds a blue favicon for the moment before.
  const markIcon = (px, radius, share) => {
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d');
    if (!g || typeof Path2D !== 'function' || typeof g.roundRect !== 'function') return null;
    canvas.width = canvas.height = px;
    g.fillStyle = accent.fill;
    g.beginPath(); g.roundRect(0, 0, px, px, radius); g.fill();
    // the mark is 29.2 units square, centred on (14.95, 14.9)
    const k = (px * share) / 29.2;
    g.setTransform(k, 0, 0, k, px / 2 - 14.95 * k, px / 2 - 14.9 * k);
    g.fillStyle = accent.ink;
    g.fill(new Path2D(QOREE_MARK), 'evenodd');
    return canvas.toDataURL('image/png');
  };
  const icons = [['icon', 64, 18, 36 / 64], ['apple-touch-icon', 180, 0, 0.5]];
  for (const [rel, px, radius, share] of preview ? icons.slice(0, 1) : icons) {
    const href = markIcon(px, radius, share);
    if (!href) break;
    let link = document.querySelector(`link[rel="${rel}"]`);
    if (!link) {
      link = h('link', { rel, sizes: `${px}x${px}` });
      document.head.append(link);
    }
    link.setAttribute('href', href);
  }
}

function isFramed() {
  try { return window.top !== window.self; } catch { return true; }
}

// Uncaught errors are reported without their message: some library errors
// (e.g. InvalidSeedError) carry secrets, and messages can echo input.
function scrubError(ev) {
  ev.preventDefault();
  const err = ev.error || ev.reason;
  const frames = err && err.stack ? String(err.stack).split('\n').slice(1, 4).join('\n') : '';
  console.warn(`[wallet] suppressed ${err && err.name ? err.name : 'error'} (message withheld)\n${frames}`);
}

async function boot() {
  applyLanguage();
  if (isFramed()) {
    document.body.replaceChildren(h('p', { class: 'noscript', text: tr('qoree doesn’t run inside frames. Open it directly.') }));
    return;
  }
  // No cryptography: the vendored libraries threw while starting (src/assemble.py logs it). Nothing here works without
  // them, unlocking and watching included, so say so instead of showing screens that would fail or invite erasing.
  // A service worker from another page is still refused first, as it is below (that check needs no libraries): the
  // reload key is forgotten and the warning shown.
  if (!Q || !QR) {
    const foreign = await foreignWorker();
    if (foreign) { Resume.clear(); showWorkerRefusal(); } else {
      document.body.replaceChildren(h('p', { class: 'noscript', text: tr('qoree can’t run in this browser: its cryptography didn’t start. Any wallet saved here is unchanged. Updating this browser may fix it.') }));
    }
    return;
  }
  window.addEventListener('error', scrubError);
  window.addEventListener('unhandledrejection', scrubError);
  applyTheme();
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (state.prefs.theme === 'system') applyTheme(); });
  // A service worker on this address came from another page served there (see foreignWorker): the reload key is
  // forgotten (that worker could serve a page that joins its halves), nothing else starts, and no saved wallet is read
  // or resumed, until it is removed.
  if (await foreignWorker()) { Resume.clear(); showWorkerRefusal(); return; }

  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, noteActivity, { passive: true, capture: true });
  document.addEventListener('keydown', escapeTopSheet);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    autoLockCheck();
    if (state.phase === 'ready') refreshAll();
  });
  // Entering the back/forward cache keeps the page alive in memory: lock first.
  window.addEventListener('pagehide', (e) => { if (e.persisted) lockWallet(); else Resume.touch(true); });
  window.addEventListener('online', () => { if (state.phase === 'ready') refreshAll(); });
  // A wallet kept for this session only is gone after a reload or once the tab closes: the browser asks first while it
  // holds a seed or a transfer that hasn't settled (Safari on iPhone never asks).
  window.addEventListener('beforeunload', (e) => {
    if (state.mode !== 'session' || state.phase !== 'ready' || !(seedAccounts().length || state.pending.some(isOpenTransfer))) return;
    e.preventDefault();
    e.returnValue = '';
  });
  // Another tab wrote the wallet record. Only its journal part changed (a transfer sent there): take in those entries.
  // Accounts or password changed: lock, to stay in sync.
  const accountsPart = (v) => { try { const r = JSON.parse(v); return r ? `${r.kdf && r.kdf.salt}|${r.cipher && r.cipher.iv}|${r.data}` : null; } catch { return null; } };
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEYS.vault) return;
    if (state.mode === 'vault' && state.phase === 'ready' && e.newValue && accountsPart(e.newValue) === accountsPart(e.oldValue)) { syncJournal(); return; }
    // Erased, or accounts or password replaced, elsewhere: whatever this tab had in flight (an unlock, a resume, a
    // password change, a send's journal write, a read) belongs to a wallet that no longer exists as it knew it.
    nextSession();
    if (state.mode === 'vault' && state.phase === 'ready') { vaultLost(); return; }
    // Not entered yet: whatever an unlock or resume in flight had already loaded goes now, not when it notices.
    if (state.phase === 'locked' && (state.accounts.length || state.vault)) dropSecrets();
    if (state.phase === 'locked' && !Vault.exists()) { state.mode = 'none'; showWelcome(); }
    else if (state.phase === 'welcome' && Vault.exists()) { state.mode = 'vault'; showUnlock(); }
  });

  await runSelfTest();
  setInterval(heartbeat, 1000);

  if (Vault.exists()) {
    state.mode = 'vault';
    if (state.selfTest.status === 'pass' && await resumeWallet()) return;
    if (Vault.exists()) showUnlock(); else { state.mode = 'none'; showWelcome(); }
  } else showWelcome();
}

boot();
