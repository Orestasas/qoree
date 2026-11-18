// ═══════════════════════════════════════════════════════════════════════════
// 8. UI PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════

// ── Screens (full-page views with slide transitions) ────────────────────────
const view = { el: null, name: null, cleanup: null };
function showScreen(name, render, { back = false, reveal = false } = {}) {
  const root = $('#app');
  $('#boot')?.remove();
  if (view.cleanup) { try { view.cleanup(); } catch { /* ignore */ } view.cleanup = null; }
  const prev = view.el;
  const next = render();
  // Arriving (the first screen after loading, or reveal: the wallet whenever you get to it): the new screen's blocks
  // come in where they are (cascadeIn) while the old one fades; otherwise it slides in from the side it lies on.
  const arriving = reveal || !prev;
  if (!arriving) next.classList.add('view-enter');
  if (back && !arriving) next.classList.add('back');
  if (prev) {
    prev.style.top = `${-window.scrollY}px`;
    prev.classList.add('view-exit');
    if (reveal) prev.classList.add('fade');
    if (back) prev.classList.add('back');
    prev.setAttribute('aria-hidden', 'true');
    prev.inert = true;
    setTimeout(() => prev.remove(), 280);
  }
  root.append(next);
  window.scrollTo(0, 0);
  view.el = next;
  view.name = name;
  if (arriving) cascadeIn(next);
  else {
    // Its own slide only: its children's animations end too, and bubble.
    const done = (e) => { if (e.target !== next) return; next.classList.remove('view-enter', 'back'); next.removeEventListener('animationend', done); };
    next.addEventListener('animationend', done);
  }
  const focusTarget = next.querySelector('[data-autofocus]') || next.querySelector('h1');
  if (focusTarget) requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
  return next;
}
// Called by a screen to release subscriptions/timers when it is replaced.
function onLeave(fn) { const before = view.cleanup; view.cleanup = before ? () => { before(); fn(); } : fn; }
// Remove revealed secrets immediately when the page loses focus, is hidden or leaves. Returning never reveals
// them automatically. The owner unregisters on leaving its screen/pane; this must not discard session-only seeds.
function onPrivacyHide(conceal) {
  const visibility = () => { if (document.hidden) conceal(); };
  window.addEventListener('blur', conceal);
  window.addEventListener('pagehide', conceal);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    window.removeEventListener('blur', conceal);
    window.removeEventListener('pagehide', conceal);
    document.removeEventListener('visibilitychange', visibility);
  };
}
// An arriving screen's blocks (each .arrive, and each child of an .arrive-children) come in from a slight blur top to
// bottom, each delayed by how far down the screen it sits. Each one drops its class when its own fade is done, so a
// block drawn again meanwhile (a notice that just arrived) simply appears rather than starting over; or a little after
// it should have been, since a browser that isn't drawing frames never ends it and a block mustn't stay hidden.
function cascadeIn(screen) {
  if (reducedMotion()) return;
  // Every position is read before any block is changed: reading after a change makes the browser lay the page out
  // again, once per block.
  const blocks = [...screen.querySelectorAll('.arrive, .arrive-children > :not(.arrive-children)')]
    .map((el) => [el, Math.round(clamp(el.getBoundingClientRect().top, 0, window.innerHeight) * 0.45)]);
  for (const [el, delay] of blocks) {
    el.style.setProperty('--arrive-delay', `${delay}ms`);
    el.classList.add('arriving');
    let timer = 0;
    const done = (e) => {
      if (e && e.target !== el) return;
      clearTimeout(timer);
      el.classList.remove('arriving');
      el.style.removeProperty('--arrive-delay');
      el.removeEventListener('animationend', done);
    };
    timer = setTimeout(done, delay + 1100);
    el.addEventListener('animationend', done);
  }
}

function stepDots(current, total) {
  return h('div', { class: 'steps', role: 'img', 'aria-label': tr('Step {current} of {total}', { current, total }) },
    Array.from({ length: total }, (_, i) => h('i', { class: i + 1 === current ? 'on' : i + 1 < current ? 'done' : '' })));
}

// ── Buttons ─────────────────────────────────────────────────────────────────
function iconButton(name, label, onClick, cls = '') {
  return h('button', { type: 'button', class: ['icon-btn', cls], 'aria-label': label, title: label, onClick }, icon(name, 20));
}
// Paste into a text field: the clipboard where the browser lets the page read it, otherwise a hint to paste by hand.
function pasteButton(field, label, take) {
  return iconButton('paste', label, async () => {
    const t = await readClipboard();
    if (t == null) { field.focus(); toast(tr('Paste with ⌘V / Ctrl+V or long-press'), 'info'); return; }
    take(t);
  });
}
/** @param {Child} label @param {ButtonOptions} [opts] */
function button(label, { kind = 'primary', onClick, iconName, block = true, small = false, type = 'button', disabled = false } = {}) {
  return h('button', {
    type, class: ['btn', `btn-${kind}`, block && 'btn-block', small && 'btn-sm'], onClick, disabled,
  }, iconName ? icon(iconName, small ? 16 : 18) : null, h('span', { text: label }));
}
// Puts a button into a busy state; returns a function that restores it.
function busy(btn, label) {
  const saved = [...btn.childNodes];
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.replaceChildren(faceLoader(btn.classList.contains('btn-sm') ? 16 : 18), h('span', { text: label }));
  return () => { btn.replaceChildren(...saved); btn.disabled = wasDisabled; btn.removeAttribute('aria-busy'); };
}
// The fixed username password managers file the wallet password under (the same everywhere, so they keep one entry).
// It keeps the wallet's old name, so a password saved before the rename to qoree still matches.
const walletUsername = () => h('input', { type: 'text', class: 'sr-only', autocomplete: 'username', value: 'Qubic Wallet', tabindex: '-1', 'aria-hidden': 'true', readonly: true });

// Press-and-hold confirmation for irreversible actions (pointer or Space/Enter). A hold only counts if it is still
// going when the bar fills: letting go, Escape, the window or button losing focus, the page going to the background,
// the button being disabled or removed, or dispose() (called when its pane or sheet closes) all cancel it.
function holdButton(label, onConfirm, duration = 1000) {
  const bar = h('span', { class: 'hold-fill', 'aria-hidden': 'true' });
  const text = h('span', { class: 'hold-label' }, icon('lock', 18), h('span', { text: label }));
  const btn = h('button', { type: 'button', class: 'btn btn-primary btn-block btn-hold', 'aria-label': tr('{label}. Press and hold to confirm.', { label }) }, bar, text);
  // The fill is a Web Animation, so the browser draws it on its own at the screen's rate, even while the page is busy.
  // The hold confirms only when it finishes with the button still held, enabled, on the page and in view.
  let fill = null; let active = false; let done = false; let disposed = false;
  // A press that held to the end: the click that ends it isn't a short press, even if the hold was reset meanwhile.
  let held = false;
  // A key let go before the bar fills asks in a dialog instead (see ask).
  const onKeyUp = (e) => {
    if (e.key === 'Escape') cancel();
    else if (e.key === ' ' || e.key === 'Enter') { const early = active; cancel(); if (early) ask(); }
  };
  const onVisibility = () => { if (document.hidden) cancel(); };
  const listen = (on) => {
    const m = on ? 'addEventListener' : 'removeEventListener';
    window[m]('keyup', onKeyUp, true);
    window[m]('blur', cancel);
    document[m]('visibilitychange', onVisibility);
  };
  const finish = (anim) => {
    if (anim !== fill || !active) return;
    if (disposed || btn.disabled || !btn.isConnected || document.hidden) { cancel(); return; }
    active = false; done = true; held = true; listen(false); btn.classList.remove('holding'); onConfirm();
  };
  const begin = () => {
    if (btn.disabled || active || done || disposed) return;
    held = false;
    active = true; btn.classList.add('holding');
    listen(true);
    if (navigator.vibrate && navigator.userActivation && navigator.userActivation.isActive) navigator.vibrate(8);
    if (fill) fill.cancel();
    const anim = bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration, easing: 'linear', fill: 'forwards' });
    fill = anim;
    anim.onfinish = () => finish(anim);
  };
  // Let go early: the fill shrinks back from where it got to.
  function cancel() {
    if (!active) return;
    active = false; listen(false); btn.classList.remove('holding');
    const anim = fill;
    fill = null;
    const p = anim && typeof anim.currentTime === 'number' ? clamp(anim.currentTime / duration, 0, 1) : 0;
    if (anim) anim.cancel();
    if (p > 0) bar.animate([{ transform: `scaleX(${p})` }, { transform: 'scaleX(0)' }], { duration: 250, easing: 'ease' });
  }
  // Disabled while held (what Review shows changed): stop at once.
  new MutationObserver(() => { if (btn.disabled) cancel(); }).observe(btn, { attributes: true, attributeFilter: ['disabled'] });
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    try { btn.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
    begin();
  });
  btn.addEventListener('pointerup', cancel);
  btn.addEventListener('pointercancel', cancel);
  btn.addEventListener('lostpointercapture', cancel);
  btn.addEventListener('blur', cancel);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); begin(); } });
  // A press too short to fill the bar, or a single click from a screen reader, voice control or a switch (none of which
  // can hold): the same question in a dialog, as the caller words it, whose button takes no press for a moment, so a
  // double tap can't confirm it. btn.ask returns the dialog's title, message and confirmLabel, and what to say if the
  // button was disabled meanwhile (blocked) or onConfirm refused, returning false (changed). The dialog confirms
  // through the same onConfirm as the hold, so what the hold would check when it ends is checked when it answers.
  // btn.check, when set, is called as the question is asked and returns whether what it checks still says the same;
  // onConfirm gets that (asked) and refuses if not, as a hold in progress would have been cancelled.
  btn.ask = null;
  btn.check = null;
  let asking = false;
  async function ask() {
    if (!btn.ask) { toast(tr('Press and hold to confirm'), 'info'); return; }
    if (asking || done || disposed || btn.disabled) return;
    asking = true;
    const q = btn.ask();
    const same = btn.check ? btn.check() : null;
    const yes = await confirmDialog({ title: q.title, message: q.message, confirmLabel: q.confirmLabel, armAfter: 600 });
    asking = false;
    if (!yes || done || disposed || !btn.isConnected || document.hidden) return;
    if (btn.disabled) { if (q.blocked) toast(q.blocked, 'info'); return; }
    done = true;
    if (onConfirm(same) === false && q.changed) toast(q.changed, 'info');
  }
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (held) { held = false; return; }
    if (!done && !active) ask();
  });
  btn.reset = () => { done = false; active = false; if (fill) fill.cancel(); fill = null; };
  btn.dispose = () => { disposed = true; cancel(); };
  btn.cancel = cancel; // stops a hold in progress; the button stays usable
  return btn;
}

// ── Toasts ──────────────────────────────────────────────────────────────────
// kind: ok, err, info, or received (money that arrived, with the delighted face).
function toast(message, kind = 'ok', ms = 2600) {
  const wrap = $('#toasts');
  if (!wrap) return;
  const ic = kind === 'err' ? 'xCircle' : kind === 'info' ? 'info' : 'checkCircle';
  const el = h('div', { class: 'toast' }, h('span', { class: `t-${kind}` }, kind === 'received' ? qoreeFace('delighted', 20) : icon(ic, 20)), h('span', { text: message }));
  wrap.append(el);
  while (wrap.children.length > 3) wrap.firstElementChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
}
// Payments that just arrived (see noteArrivals), as one toast: how much and from whom, or only that one came while
// balances are hidden; the account is named when there's more than one that can receive.
function announceArrivals(account, txs) {
  const named = seedAccounts().length > 1;
  const vars = { name: account.name, count: txs.length };
  let said;
  if (hidden()) {
    said = named ? tr('{count, plural, one {{name} received a payment} other {{name} received # payments}}', vars)
      : tr('{count, plural, one {Received a payment} other {Received # payments}}', vars);
  } else {
    vars.amount = fmtInt(txs.reduce((sum, t) => sum + t.amount, 0n));
    if (txs.length === 1) {
      vars.party = partyName(txs[0].source);
      said = named ? tr('{name} received {amount} QUBIC from {party}', vars) : tr('Received {amount} QUBIC from {party}', vars);
    } else said = named ? tr('{name} received {amount} QUBIC', vars) : tr('Received {amount} QUBIC', vars);
  }
  toast(said, 'received', 5000);
}
async function copyWithToast(text, what) {
  const ok = await copyText(text);
  toast(ok ? what : tr('Copy failed. Select the text and copy it manually.'), ok ? 'ok' : 'err');
}

// ── Sheets (bottom sheets on phones, centered dialogs on wider screens) ─────
const sheets = [];
// The page is pinned (position: fixed, shifted up by its scroll) while a sheet is open. That zeroes window.scrollY, so
// scroll-driven effects (the header's balance, its blur) pause until the last sheet closes instead of resetting and
// replaying.
let scrollLockY = 0;
const pageLocked = () => document.body.classList.contains('scroll-locked');
function lockScroll() {
  if (pageLocked()) return;
  scrollLockY = window.scrollY;
  document.body.style.top = `${-scrollLockY}px`;
  document.body.classList.add('scroll-locked');
}
function unlockScroll() {
  if (!pageLocked()) return;
  document.body.classList.remove('scroll-locked');
  document.body.style.top = '';
  window.scrollTo(0, scrollLockY);
}

// Frosted progressive blur behind a bar (see .edge-blur): four stacked backdrop blurs under a fading tint.
const edgeBlur = (side) => h('div', { class: ['edge-blur', side], 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));

// Phones: the page behind the first sheet steps back (scale 0.94, 6 px down) and comes forward when the last one
// closes.
function stepBack(on) {
  if (!on) { document.body.classList.remove('stepped'); return; }
  if (!window.matchMedia('(max-width: 639px)').matches) return;
  $('#app').style.setProperty('--step-y', `${scrollLockY}px`);
  document.body.classList.add('stepped');
}

// Where an element sits, to find it again once a redraw has replaced it (a tile, a tool, a row): each element above it,
// with the child positions from there down to it, and what it says.
/** @param {Element} el */
function saysOf(el) {
  return el.getAttribute('aria-label') || (el.textContent || '').trim();
}
/** @param {Element} el */
function placeOf(el) {
  /** @type {[Element, number[]][]} */
  const ups = [];
  /** @type {number[]} */
  const path = [];
  for (let at = el; at.parentElement; at = at.parentElement) {
    path.unshift([...at.parentElement.children].indexOf(at));
    ups.push([at.parentElement, path.slice()]);
  }
  return { ups, tag: el.tagName, says: saysOf(el) };
}
// What stands in for it now: under the nearest element above it that's still on the page, the one in its place if it
// says the same, else the only one there that says the same, else the one in its place if it's the same kind.
/** @param {ReturnType<typeof placeOf>} place @returns {HTMLElement | null} */
function standIn(place) {
  const up = place.ups.find(([el]) => document.contains(el));
  if (!up) return null;
  /** @type {Element | undefined} */
  let at = up[0];
  for (const i of up[1]) at = at && at.children[i];
  const kind = (/** @type {Element | undefined} */ el) => Boolean(el) && el.tagName === place.tag;
  const same = (/** @type {Element | undefined} */ el) => kind(el) && saysOf(el) === place.says;
  const like = [...up[0].querySelectorAll(place.tag)].filter(same);
  const found = same(at) ? at : like.length === 1 ? like[0] : kind(at) ? at : null;
  return /** @type {HTMLElement | null} */ (found || null);
}

/** @param {{ title?: string, onClose?: () => void, full?: boolean }} [opts] */
function openSheet({ title = '', onClose, full = false } = {}) {
  const opener = /** @type {HTMLElement | null} */ (document.activeElement);
  // A redraw while the sheet is open can replace what opened it; focus then goes back to what stands in for it.
  const openerPlace = opener ? placeOf(opener) : null;
  const titleEl = h('h2', { class: 'sheet-title', id: uid('sheet-title'), text: title, tabindex: '-1' });
  const backBtn = iconButton('back', tr('Back'), () => api.back && api.back(), 'tool');
  backBtn.hidden = true;
  const closeBtn = iconButton('close', tr('Close'), () => api.close(), 'tool');
  // The title cell can also hold a header amount (see numberToHeader) that crossfades with the title.
  const titleWrap = h('div', { class: 'sheet-title-wrap' }, titleEl);
  const head = h('div', { class: 'sheet-head' }, h('div', null, backBtn), titleWrap, h('div', { class: 'end' }, closeBtn));
  const body = h('div', { class: 'sheet-body' });
  const foot = h('div', { class: 'sheet-foot', hidden: true });
  // The header and the pinned buttons float over the content, which scrolls under them into a progressive blur.
  const top = h('div', { class: 'sheet-top' }, edgeBlur('top'), h('div', { class: 'grabber', 'aria-hidden': 'true' }), head);
  const panel = h('div', { class: ['sheet', full && 'full'], role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleEl.id, tabindex: '-1' },
    top, body, foot);
  const measureBars = () => {
    panel.style.setProperty('--top-h', `${top.offsetHeight}px`);
    panel.style.setProperty('--foot-h', `${foot.offsetHeight}px`);
  };
  const bars = new ResizeObserver(measureBars);
  bars.observe(top);
  bars.observe(foot);
  const edge = () => panel.classList.toggle('scrolled', body.scrollTop > 2);
  body.addEventListener('scroll', edge, { passive: true });
  const scrim = h('div', { class: 'scrim', 'aria-hidden': 'true' });
  const z = 100 + sheets.length * 2;
  scrim.style.zIndex = String(z);
  panel.style.zIndex = String(z + 1);
  $('#layer').append(scrim, panel);
  measureBars();
  const first = !sheets.length;
  lockScroll();
  if (first) stepBack(true);
  // Everything under it goes inert, so Tab can't leave the sheet: the screen, the sheets open before it, and the rest of
  // the layer (the phone tab bar).
  if (view.el) view.el.inert = true;
  for (const s of sheets) s.panel.inert = true;
  for (const el of $('#layer').children) if (el !== panel && el !== scrim) el.inert = true;

  let closed = false;
  const cleanups = [];
  // Pane cleanups are registered just before setPane() and run when that pane is replaced.
  let paneCleanups = [];
  let nextPaneCleanups = [];
  const runAll = (list) => { for (const fn of list) { try { fn(); } catch { /* ignore */ } } };
  const api = {
    panel, top, body, titleEl, titleWrap, back: null,
    setTitle(t) { titleEl.textContent = t; },
    // Replace the visible pane; direction animates like a navigation push/pop ('forward', 'back'), or 'swap' crossfades
    // (another topic picked from the side column).
    /** @param {Child} node @param {PaneOptions} [opts] */
    setPane(node, { title: t, back = null, footer = null, direction = null, keepScroll = false } = {}) {
      runAll(paneCleanups);
      paneCleanups = nextPaneCleanups;
      nextPaneCleanups = [];
      if (t != null) titleEl.textContent = t;
      api.back = back;
      backBtn.hidden = !back;
      const scroll = body.scrollTop;
      const pane = h('div', { class: ['pane', direction && 'pane-enter', direction === 'back' && 'back', direction === 'swap' && 'swap'] }, node);
      body.replaceChildren(pane);
      body.scrollTop = keepScroll ? scroll : 0;
      edge();
      const actions = footer ? [].concat(footer).filter(Boolean) : [];
      foot.replaceChildren(edgeBlur('bottom'), ...actions);
      foot.hidden = !actions.length;
      measureBars();
      if (direction) pane.addEventListener('animationend', () => pane.classList.remove('pane-enter', 'back', 'swap'), { once: true });
      // Focus left in the pane just replaced would fall to the page, where Escape no longer reaches the sheet and a
      // screen reader says nothing: it goes to the new pane's title (or, with a pointer, to a field marked to take it;
      // on a phone that would bring up the keyboard).
      const auto = pane.querySelector('[data-autofocus]');
      if (auto && window.matchMedia('(hover: hover)').matches) requestAnimationFrame(() => auto.focus({ preventScroll: true }));
      else if (!panel.contains(document.activeElement) && sheets.includes(api)) (titleEl.textContent ? titleEl : panel).focus({ preventScroll: true });
    },
    // A column of its own on the left (Settings on wide screens), beside the header, the panes and the pinned
    // buttons, which keep working as they do; null takes it away.
    setNav(node) {
      const old = panel.querySelector(':scope > .sheet-nav');
      if (old) old.remove();
      panel.classList.toggle('has-nav', Boolean(node));
      if (node) panel.prepend(node);
      measureBars();
    },
    onPaneLeave(fn) { nextPaneCleanups.push(fn); },
    onCleanup(fn) { cleanups.push(fn); },
    close(immediate = false) {
      if (closed) return;
      closed = true;
      runAll(paneCleanups);
      runAll(nextPaneCleanups);
      runAll(cleanups);
      bars.disconnect();
      if (onClose) { try { onClose(); } catch { /* ignore */ } }
      const i = sheets.indexOf(api);
      if (i >= 0) sheets.splice(i, 1);
      const under = sheets[sheets.length - 1];
      if (under) under.panel.inert = false;
      else {
        if (view.el) view.el.inert = false;
        for (const el of $('#layer').children) if (el !== panel && el !== scrim) el.inert = false;
      }
      panel.classList.remove('open');
      scrim.classList.remove('open');
      const remove = () => { panel.remove(); scrim.remove(); };
      if (immediate) remove(); else setTimeout(remove, 420);
      if (!sheets.length) { stepBack(false); unlockScroll(); }
      const back = !opener || immediate ? null : document.contains(opener) ? opener : openerPlace && standIn(openerPlace);
      if (back && back.focus) back.focus({ preventScroll: true });
    },
  };
  scrim.addEventListener('click', () => api.close());
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); api.close(); }
    if (e.key === 'Tab') trapFocus(panel, e);
  });
  enableDragToDismiss(panel, head, () => api.close());
  sheets.push(api);
  // Slide in after the first style flush. The first pane may already have focused its [data-autofocus] field (setPane,
  // a frame earlier), so the panel takes focus only when nothing inside it has it. A sheet closed meanwhile stays shut.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (closed) return;
    scrim.classList.add('open'); panel.classList.add('open');
    if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
  }));
  return api;
}

// Settings in its tab on phones and tablets (see showDashboard): the calls Settings makes on a sheet, drawn in a section
// of the page instead, so its pages don't change. A page's title and Back sit over it and its pinned buttons under it;
// leaving a page runs what it asked to run then (onPaneLeave); close() goes back home (Settings' first page); destroy()
// runs everything still waiting, as the dashboard leaves.
function pageHost(el, home) {
  const backBtn = iconButton('back', tr('Back'), () => api.back && api.back(), 'tool');
  backBtn.hidden = true;
  const titleEl = h('h2', { class: 'section-title', tabindex: '-1' });
  const body = h('div', { class: 'page-host' });
  const foot = h('div', { class: 'page-host-foot', hidden: true });
  el.append(h('div', { class: 'section-head page-host-head' }, h('div', { class: 'page-host-title' }, backBtn, titleEl)), body, foot);
  let paneCleanups = [];
  let nextPaneCleanups = [];
  const cleanups = [];
  const runAll = (list) => { for (const fn of list) { try { fn(); } catch { /* ignore */ } } };
  const api = {
    panel: el, body, titleEl, back: null,
    setTitle(t) { titleEl.textContent = t; },
    /** @param {Child} node @param {PaneOptions} [opts] */
    setPane(node, { title: t, back = null, footer = null, direction = null, keepScroll = false } = {}) {
      runAll(paneCleanups);
      paneCleanups = nextPaneCleanups;
      nextPaneCleanups = [];
      if (t != null) titleEl.textContent = t;
      api.back = back;
      backBtn.hidden = !back;
      const had = el.contains(document.activeElement);
      const pane = h('div', { class: ['pane', direction && 'pane-enter', direction === 'back' && 'back', direction === 'swap' && 'swap'] }, node);
      body.replaceChildren(pane);
      const actions = footer ? [].concat(footer).filter(Boolean) : [];
      foot.replaceChildren(...actions);
      foot.hidden = !actions.length;
      if (direction) pane.addEventListener('animationend', () => pane.classList.remove('pane-enter', 'back', 'swap'), { once: true });
      // Only while it's on screen: a page changed behind another tab leaves that tab where it was.
      const shown = el.offsetParent !== null;
      if (shown && !keepScroll && direction) window.scrollTo(0, 0);
      // As on a sheet: focus left in the page just replaced goes to the new one's title (or, with a pointer, to a field
      // marked to take it).
      const auto = pane.querySelector('[data-autofocus]');
      if (shown && auto && window.matchMedia('(hover: hover)').matches) requestAnimationFrame(() => auto.focus({ preventScroll: true }));
      else if (had) titleEl.focus({ preventScroll: true });
    },
    setNav() {},
    onPaneLeave(fn) { nextPaneCleanups.push(fn); },
    onCleanup(fn) { cleanups.push(fn); },
    close() { if (home) home(); },
    destroy() { runAll(paneCleanups); runAll(nextPaneCleanups); runAll(cleanups); paneCleanups = []; nextPaneCleanups = []; },
  };
  return api;
}

// A field's error, for assistive tech as well as the eye: aria-invalid with the red outline, and the hint that explains
// it (box: the element that draws the outline, when it isn't the field itself).
function markField(input, hint, invalid, box = input) {
  box.classList.toggle('invalid', invalid);
  input.setAttribute('aria-invalid', String(invalid));
  if (hint) {
    if (!hint.id) hint.id = uid('hint');
    input.setAttribute('aria-describedby', hint.id);
  }
}
// Escape closes the top sheet wherever focus is (its own handler stops it from reaching here when focus is inside).
function escapeTopSheet(e) {
  if (e.key === 'Escape' && !e.defaultPrevented && sheets.length) sheets[sheets.length - 1].close();
}
// True while the key is going into a text field (shortcuts stay out of the way).
const typingIn = (el) => el instanceof Element && el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;

function closeAllSheets(immediate = false) {
  for (const s of [...sheets].reverse()) s.close(immediate);
}

function trapFocus(container, e) {
  const items = [...container.querySelectorAll('button, [href], input, textarea, select, [tabindex]')]
    .filter((el) => el.tabIndex >= 0 && !el.disabled && !el.hidden && el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0]; const last = items[items.length - 1];
  const at = document.activeElement;
  // Shift+Tab from the dialog itself (focused when it opens) wraps too, instead of leaving it.
  if (e.shiftKey && (at === first || at === container)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
}

function enableDragToDismiss(panel, handle, dismiss) {
  let startY = 0; let dy = 0; let dragging = false; let t0 = 0;
  const isPhoneSheet = () => window.matchMedia('(max-width: 639px)').matches;
  handle.addEventListener('pointerdown', (e) => {
    if (!isPhoneSheet() || e.target.closest('button')) return;
    dragging = true; startY = e.clientY; dy = 0; t0 = performance.now();
    panel.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);
    panel.style.transform = `translate3d(0, ${dy}px, 0)`;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('dragging');
    panel.style.transform = '';
    const velocity = dy / Math.max(1, performance.now() - t0);
    if (dy > 120 || velocity > 0.6) dismiss();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

// A typed confirmation word as compared: trimmed, in capitals, and in Arabic without the hamza or vowel marks phones
// often leave out or add (إزالة and ازالة are the same word).
const confirmWord = (s) => String(s).trim().toUpperCase().normalize('NFC')
  .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627').replace(/[\u0640\u064B-\u0652\u0670]/g, '');
// Confirmation dialog; resolves true/false. Optional typed confirmation for destructive actions.
// armAfter: ms in which the confirm button takes no press (a dialog that opens under a finger mid-tap).
function confirmDialog({ title, message, confirmLabel = tr('Confirm'), danger = false, requireText = null, armAfter = 0 }) {
  const ic = danger ? 'alert' : 'info';
  return new Promise((resolve) => {
    let result = false;
    const opened = Date.now();
    // The title sits under the icon, above the explanation, rather than in the sheet's header. An alert dialog, so a
    // screen reader reads the question with it.
    const sheet = openSheet({ title: '', onClose: () => resolve(result) });
    const heading = h('h3', { class: 'status-title', id: uid('confirm-title'), text: title });
    const lead = h('p', { class: 'sheet-lead', id: uid('confirm-text'), text: message });
    sheet.panel.setAttribute('role', 'alertdialog');
    sheet.panel.setAttribute('aria-labelledby', heading.id);
    sheet.panel.setAttribute('aria-describedby', lead.id);
    // requireText: the word to type, in English (marked with trLater). It's shown translated, and either is accepted.
    const word = requireText ? tr(requireText) : null;
    const input = requireText ? h('input', { class: 'input', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: word, 'aria-label': tr('Type {word} to confirm', { word }) }) : null;
    const ok = button(confirmLabel, { kind: danger ? 'danger-solid' : 'primary', disabled: Boolean(requireText), onClick: () => {
      if (Date.now() - opened < armAfter) return;
      result = true; sheet.close();
    } });
    if (input) {
      input.addEventListener('input', () => {
        const typed = confirmWord(input.value);
        ok.disabled = typed !== confirmWord(requireText) && typed !== confirmWord(word);
      });
    }
    sheet.setPane([
      h('div', { class: 'sheet-center' },
        h('div', { class: ['status-ring', danger ? 'err' : 'wait'] }, icon(ic, 30)),
        heading,
        lead),
      input ? h('div', { class: 'field' }, h('label', { class: 'field-label', text: tr('Type {word} to confirm', { word }) }), input) : null,
    ], { footer: [ok, button(tr('Cancel'), { kind: 'ghost', onClick: () => sheet.close() })] });
    if (input) setTimeout(() => input.focus(), 350);
  });
}

// ── Springs ─────────────────────────────────────────────────────────────────
// Springs are SwiftUI-style (duration, bounce) baked into CSS linear() easing where supported.
const SPRINGS = { snappy: [0.4, 0.15], smooth: [0.5, 0] };
const springCache = {};
const linearEasing = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)');
function spring(name) {
  if (springCache[name]) return springCache[name];
  const [d, bounce] = SPRINGS[name];
  const w = (2 * Math.PI) / d; const k = w * w; const c = 2 * (1 - bounce) * w; const dt = 1 / 600;
  let x = 0; let v = 0; let t = 0; const samples = [];
  while (t < 3) {
    v += (k * (1 - x) - c * v) * dt; x += v * dt; t += dt; samples.push(x);
    if (t > d * 0.6 && Math.abs(1 - x) < 0.0008 && Math.abs(v) < 0.02) break;
  }
  const pts = ['0'];
  for (let i = 1; i < 64; i++) pts.push(samples[Math.min(samples.length - 1, Math.round((samples.length * i) / 64))].toFixed(4));
  pts.push('1');
  springCache[name] = {
    ease: linearEasing ? `linear(${pts.join(', ')})` : name === 'snappy' ? 'cubic-bezier(0.3, 1.25, 0.5, 1)' : 'cubic-bezier(0.16, 1, 0.3, 1)',
    ms: t * 1000,
  };
  return springCache[name];
}
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Phones and tablets. Arrivals there fade and move without blurring (arrivalBlur, and .arriving in the styles):
// blurring large areas is the heaviest work their GPUs do here. Small blurs (rolling digits, header swaps) stay.
const touchScreen = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches;
const arrivalBlur = (px) => (touchScreen() ? {} : { filter: `blur(${px}px)` });

// ── Rolling digits ──────────────────────────────────────────────────────────
// A number changing in place, the way SwiftUI's numeric text transition does it: only the characters that differ
// move. The old one leaves upward and the new one rises in from below when the value went up (the other way when it
// went down), each blurring while it moves, on the smooth spring. As on Apple's clocks, the changed characters
// cascade: the leftmost moves first and each one to its right ROLL_STAGGER ms later (first: how many already moved
// before this text, e.g. in the major part of an amount). Characters are matched from the right, where the changing
// digits sit, and unchanged ones stay put. rise null (a first paint) or Reduce Motion: the text is just set.
// Returns how many characters moved.
const ROLL_STAGGER = 40;
// What rolls: each digit or sign on its own, and each word (a unit such as 亿, Md or مليار) whole, so letters that join
// (Arabic) or carry vowel signs (Devanagari) stay together.
const rollPieces = (text) => text.match(/[\p{L}\p{M}]+|./gsu) || [];
function rollText(el, text, rise = null, first = 0) {
  const before = el.dataset.roll;
  if (before === text) return 0;
  el.dataset.roll = text;
  const chars = rollPieces(text);
  const slot = (c) => h('span', { class: 'roll-slot' }, h('span', { class: 'roll-in', text: c }));
  if (rise == null || before == null || reducedMotion()) { el.replaceChildren(...chars.map(slot)); return 0; }
  const old = rollPieces(before);
  const shift = old.length - chars.length;
  const { ease, ms } = spring('smooth');
  const from = rise ? '0.6em' : '-0.6em';
  const to = rise ? '-0.6em' : '0.6em';
  let moved = 0;
  el.replaceChildren(...chars.map((c, i) => {
    const s = slot(c);
    const was = old[i + shift];
    if (was === c) return s;
    const delay = (first + moved++) * ROLL_STAGGER;
    s.firstChild.animate([{ transform: `translateY(${from})`, opacity: 0, filter: 'blur(6px)' }, { transform: 'none', opacity: 1, filter: 'blur(0)' }],
      { duration: ms, easing: ease, delay, fill: 'backwards' });
    if (was != null) {
      const out = h('span', { class: 'roll-out', 'aria-hidden': 'true', text: was });
      s.append(out);
      out.animate([{ transform: 'none', opacity: 1, filter: 'blur(0)' }, { transform: `translateY(${to})`, opacity: 0, filter: 'blur(6px)' }],
        { duration: ms * 0.8, easing: ease, delay, fill: 'both' }).onfinish = () => out.remove();
    }
    return s;
  }));
  return moved;
}
// A big amount: the major part and the lighter minor part, each rolling its own changed characters.
function rollingAmount(major, minor) {
  const a = h('span', { class: 'roll' });
  const b = h('span', { class: ['roll', 'minor'] });
  rollText(a, major);
  rollText(b, minor);
  return { nodes: [a, b], set(nextMajor, nextMinor, rise) { rollText(b, nextMinor, rise, rollText(a, nextMajor, rise)); } };
}

// ── Number into header ──────────────────────────────────────────────────────
// Animate from whatever is on screen now, so every move can be interrupted mid-flight.
// Reduce Motion: only opacity animates (about 200 ms); everything else lands at once.
/** @param {HTMLElement} el @param {Record<string, string>} props @param {{ spring?: string, from?: Record<string, string> }} [opts] */
function animateTo(el, props, { spring: name, from } = {}) {
  const cs = getComputedStyle(el);
  const keys = Object.keys(props);
  const start = {};
  for (const k of keys) start[k] = from && k in from ? from[k] : cs[k];
  el.getAnimations().forEach((a) => a.cancel());
  const rm = reducedMotion();
  const moving = rm ? keys.filter((k) => k === 'opacity') : keys;
  const sp = name && !rm ? spring(name) : null;
  const f = /** @type {Keyframe} */ ({}); const t = /** @type {Keyframe} */ ({});
  for (const k of moving) { f[k] = start[k]; t[k] = props[k]; }
  Object.assign(el.style, props);
  if (!moving.length) return;
  const a = el.animate([f, t], { duration: sp ? sp.ms : 200, easing: sp ? sp.ease : 'ease-out', fill: 'backwards' });
  a.onfinish = () => a.cancel();
}

const HEAD_IN = 'translateY(0px) scale(1)';
const HEAD_OUT = 'translateY(12px) scale(0.94)';
// What rests in the header (the logo) lifts away as the amount rises in, and settles back when it leaves.
const REST_OUT = 'translateY(-10px) scale(0.94)';
// Shows or hides something in the header: at once, or in on the snappy spring and out (to `out`) on the smooth one.
function swapHeaderItem(el, show, instant, out, from = null) {
  el.setAttribute('aria-hidden', String(!show));
  if (instant) {
    el.getAnimations().forEach((a) => a.cancel());
    Object.assign(el.style, { opacity: show ? '1' : '0', transform: show ? HEAD_IN : out, filter: 'blur(0px)' });
  } else if (show) animateTo(el, { opacity: '1', transform: HEAD_IN, filter: 'blur(0px)' }, { spring: 'snappy', from });
  else animateTo(el, { opacity: '0', transform: out, filter: 'blur(2px)' }, { spring: 'smooth' });
}
function restSwap(el, show, instant) { swapHeaderItem(el, show, instant, REST_OUT); }
function headSwap(el, show, instant) {
  el.tabIndex = show ? 0 : -1;
  el.style.pointerEvents = show ? '' : 'none';
  // Rising in from fully hidden, the amount also comes into focus from a slight blur.
  const fresh = show && !instant && parseFloat(getComputedStyle(el).opacity) < 0.02;
  swapHeaderItem(el, show, instant, HEAD_OUT, fresh ? { opacity: '0', transform: HEAD_OUT, filter: 'blur(3px)' } : null);
}
// The big number and its label step back (fade, and shrink a little toward their top) as the amount moves into the
// header, on the smooth spring, and return on the snappy one. Opacity and transform only, which the browser animates
// on its own without the page.
const HERO_OUT = 'scale(0.92)';
function heroStep(el, show, instant) {
  const props = { opacity: show ? '1' : '0', transform: show ? 'none' : HERO_OUT };
  if (instant) { el.getAnimations().forEach((a) => a.cancel()); Object.assign(el.style, props); }
  else animateTo(el, props, { spring: show ? 'snappy' : 'smooth' });
}

// A big number scrolls with the page, as a large title does, and passes under the header's blur. Once 100% of it is
// "under", it steps back and the same amount springs into the header; it returns when that drops below 85%, so it
// never flickers at the edge. Nothing follows the scroll frame by frame: Safari on 120 Hz iPhones redraws the page
// at about 60 Hz while the content scrolls at 120, so a scale or fade set on every scroll event trails the content
// and looks choppy. The swaps are timed animations, which the browser runs on its own at the screen's rate.
//   under = (headerBottom - numberTop) / (numberHeight * 0.6), all in viewport coordinates.
// scroller: window or an element. bar(): the header's bottom edge, in viewport pixels.
// number/label: the big number and the label above it. slot: the header amount.
// hide: optional element that steps aside while the amount is in (a sheet title). rest: what the amount replaces.
/** @param {HeaderMotion} motion */
function numberToHeader({ scroller, bar, number, label, slot, hide, rest }) {
  let isIn = false;
  function update(instant = false) {
    if (scroller === window && pageLocked()) return;
    // A number that isn't on screen (the dashboard on another tab) leaves the header at rest.
    const height = number.isConnected ? number.offsetHeight : 0;
    const under = height ? (bar() - number.getBoundingClientRect().top) / (height * 0.6) : 0;
    const want = isIn ? under > 0.85 : under > 1;
    if (want === isIn && !instant) return;
    isIn = want;
    headSwap(slot, want, instant);
    heroStep(number, !want, instant);
    if (label) heroStep(label, !want, instant);
    if (rest) restSwap(rest, !want, instant);
    if (hide) hide.classList.toggle('away', want);
  }
  const onScroll = () => update();
  scroller.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  // Start hidden; measure once the caller has put everything on the page.
  headSwap(slot, false, true);
  if (rest) restSwap(rest, true, true);
  queueMicrotask(() => update(true));
  return {
    update,
    destroy() { scroller.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); },
  };
}

// ── Activity icons ──────────────────────────────────────────────────────────
// A lit circle in the type's colour with a white glyph; or, when the other side is one of your accounts, a saved
// address or an exchange, its avatar or logo with a small badge saying which way the money went. A failure swaps in a
// red ✕. Money coming in that isn't known to have moved ('unconfirmed', see txLook) isn't lit: a grey circle.
const TYPE_GLYPH = { in: 'receive', out: 'send', move: 'transfer', call: 'cube', unconfirmed: 'receive' };
// The details light per type (dark, light); funds in uses a softer green than the icon, unconfirmed funds a grey.
const TYPE_RGB = { in: ['79 163 123', '79 163 123'], out: ['0 145 255', '0 136 255'], move: ['0 210 224', '0 195 208'], call: ['219 52 242', '203 48 224'],
  unconfirmed: ['169 162 157', '121 113 107'] };
const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ');
function partyArt(identity) {
  if (!identity) return null;
  const own = accountByIdentity(identity);
  if (own) return { kind: 'account', account: own, rgb: hexRgb(avatarPreset(own.identity, own.avatar).center) };
  const saved = contactByIdentity(identity);
  if (saved) {
    const logo = contactLogo(saved.name);
    return logo ? { kind: 'logo', src: logo.src, rgb: logo.rgb } : { kind: 'account', account: saved, rgb: hexRgb(avatarPreset(saved.identity).center) };
  }
  const lab = state.labels.get(identity);
  if (!lab || lab.kind !== 'exchange') return null;
  const logo = exchangeLogo(logoKey(lab.name));
  return logo ? { kind: 'logo', src: logo.src, rgb: logo.rgb } : { kind: 'mono', text: initialOf(lab.name), rgb: null };
}
function txLead({ type = 'out', art = null, failed = false, big = false, withBadge = true }) {
  const cls = big ? 'dlead' : 'lead';
  let el;
  if (art && art.kind === 'logo') el = h('div', { class: [cls, 'pic'] }, h('img', { src: art.src, alt: '', decoding: 'async', draggable: 'false' }));
  else if (art && art.kind === 'account') el = h('div', { class: [cls, 'pic'] }, avatarSvg(art.account.identity, art.account.name, art.account.avatar));
  else if (art) el = h('div', { class: [cls, 'mono'], text: art.text });
  else el = h('div', { class: [cls, type !== 'unconfirmed' && 'lit'], dataset: { t: type } }, icon(TYPE_GLYPH[type] || 'send', big ? 32 : 20));
  el.setAttribute('aria-hidden', 'true');
  const mark = failed ? ['bad', 'close'] : art ? ['dir', type === 'in' || type === 'unconfirmed' ? 'receive' : 'send'] : null;
  if (mark && withBadge) el.append(h('span', { class: ['sb', mark[0]] }, icon(mark[1], big ? 14 : 10, 2)));
  return el;
}
function lightRgb(type, art) {
  if (art && art.rgb) return art.rgb;
  return (TYPE_RGB[type] || TYPE_RGB.out)[document.documentElement.dataset.theme === 'light' ? 1 : 0];
}

// ── The details sheet opening: light, icon arrival, focus-in ───────────────
// The quadratic ease-in-out (cubic-bezier(0.45, 0, 0.55, 1) in CSS is its usual stand-in; they differ by under 0.006).
const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) ** 2);
// Apple's .smooth spring (0.5 s, no bounce), progress 0–1 mapped onto its settle time.
const smoothSpring = (() => {
  const w = (2 * Math.PI) / 0.5; const f = (t) => 1 - Math.exp(-w * t) * (1 + w * t);
  let T = 0.05;
  for (let t = 0; t < 4; t += 0.004) if (Math.abs(1 - f(t)) > 0.002) T = t + 0.004;
  return (p) => (p >= 1 ? 1 : p <= 0 ? 0 : f(p * T));
})();

// Two soft glows in the icon's colour. Each leaves the icon 200 ms after the sheet starts to move and travels on a
// gentle upward curve to just above its top corner (1 s), growing from a small spread as it fades in; there it stays
// still until the sheet closes, when both fade out in 180 ms. Reduce Motion: they just fade in at the corners.
function detailLight(sheet, rgb, iconEl) {
  const glows = ['l', 'r'].map((side) => h('span', { class: ['tgw', side] }, h('i', { class: 'tg' })));
  const lit = h('div', { class: 'dlit', 'aria-hidden': 'true' }, glows);
  lit.style.setProperty('--tint-rgb', rgb);
  sheet.panel.prepend(lit);
  const follow = () => { lit.style.transform = `translate3d(0, ${-sheet.body.scrollTop}px, 0)`; };
  sheet.body.addEventListener('scroll', follow, { passive: true });
  if (reducedMotion()) {
    for (const g of glows) g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'ease-out', fill: 'forwards' });
  } else {
    const ic = iconEl.getBoundingClientRect();
    const ix = ic.left + ic.width / 2; const iy = ic.top + ic.height / 2;
    for (const g of glows) {
      const r = g.getBoundingClientRect();
      const dx = ix - (r.left + r.width / 2); const dy = iy - (r.top + r.height / 2);
      const frames = [];
      for (let i = 0; i <= 12; i++) {
        const u = i / 12; const v = 1 - u;
        // a quadratic curve from the icon to the corner, its middle raised 64 px
        const x = v * v * dx + 2 * u * v * (dx / 2); const y = v * v * dy + 2 * u * v * (dy / 2 - 64);
        frames.push({ offset: u, opacity: Math.min(1, u * 1.6), transform: `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${(0.22 + 0.78 * u).toFixed(3)})` });
      }
      g.animate(frames, { duration: 1000, delay: 200, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', fill: 'both' });
    }
  }
  return () => {
    sheet.body.removeEventListener('scroll', follow);
    lit.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-out', fill: 'forwards' });
  };
}

// The icon arrives like a new photo in the photo picker: from 80 ms over 600 ms its circle dips 5% and back while a
// halo in its colour blooms behind it, and the icon softens to a 6 px blur and sharpens on the smooth spring. A lit
// icon also starts with a white glow round its lines that cools from 200 ms over 520 ms. Reduce Motion: none of it.
const ICON_IN = { delay: 80, dur: 600, dip: 0.05, blur: 6, halo: 0.35, grow: 0.2, glowDelay: 200, glowDur: 520, glow: 7 };
function iconArrival(lead, halo) {
  if (reducedMotion() || !lead.animate) return;
  const I = ICON_IN;
  const timing = { duration: I.dur, delay: I.delay, easing: 'linear', fill: 'backwards' };
  lead.animate([{ transform: 'none' }, { transform: `scale(${1 - I.dip})` }, { transform: 'none' }], timing);
  if (halo) halo.animate([{ opacity: 0, transform: 'scale(0.9)' }, { opacity: I.halo, transform: `scale(${0.9 + I.grow})` }, { opacity: 0, transform: 'scale(0.9)' }], timing);
  const inner = lead.querySelector(':scope > svg, :scope > img');
  if (!inner) return;
  const glow = lead.classList.contains('lit');
  const end = glow ? Math.max(I.delay + I.dur, I.glowDelay + I.glowDur) : I.delay + I.dur;
  const frames = [];
  for (let t = 0; ; t = Math.min(end, t + 16)) {
    const p = clamp((t - I.delay) / I.dur, 0, 1);
    const dip = p < 0.5 ? smoothSpring(p * 2) : 1 - smoothSpring(p * 2 - 1);
    let f = `blur(${(I.blur * dip).toFixed(2)}px)`;
    if (glow) {
      const e = easeInOut(clamp((t - I.glowDelay) / I.glowDur, 0, 1));
      f += ` drop-shadow(0 0 ${(I.glow * (1 - e)).toFixed(2)}px rgba(255, 255, 255, ${(0.9 * (1 - e)).toFixed(3)}))`;
    }
    frames.push({ offset: t / end, filter: f });
    if (t >= end) break;
  }
  inner.animate(frames, { duration: end, easing: 'linear' });
}

// Everything but the icon comes into focus as the sheet opens: from a 40 px blur at half opacity to sharp in 400 ms.
function focusIn(els) {
  for (const el of els) {
    if (!el || !el.animate) continue;
    if (reducedMotion()) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    else el.animate([{ ...arrivalBlur(40), opacity: 0.5 }, { ...arrivalBlur(0), opacity: 1 }], { duration: 400, easing: 'cubic-bezier(0.3, 0.6, 0.3, 1)' });
  }
}

// ── Small components ────────────────────────────────────────────────────────
// Avatar colours: ten presets, teal first. An account's colour is picked by FNV-1a of its address unless one was chosen
// (account → Avatar), which is saved as its index, so keep the order. The letter follows the name. pair: the
// neighbouring colour the Twin finish glows from above with.
const AVATAR_PRESETS = [
  { name: trLater('Teal'), center: '#56E7F8', rim: '#DDFBFE', ink: '#05323D', pair: 3 },
  { name: trLater('Lime'), center: '#A6F05E', rim: '#E6FDD2', ink: '#2D4206', pair: 2 },
  { name: trLater('Mint'), center: '#6EE7C8', rim: '#DDFBF1', ink: '#0B3B30', pair: 3 },
  { name: trLater('Sky'), center: '#7CCCFA', rim: '#E1F4FE', ink: '#0A3550', pair: 4 },
  { name: trLater('Iris'), center: '#A9B5FF', rim: '#E9ECFF', ink: '#1F2468', pair: 5 },
  { name: trLater('Lilac'), center: '#D2AEFC', rim: '#F4EAFF', ink: '#3A145F', pair: 6 },
  { name: trLater('Rose'), center: '#F9A8D2', rim: '#FEE7F2', ink: '#5A1238', pair: 7 },
  { name: trLater('Coral'), center: '#FFA59A', rim: '#FFEAE6', ink: '#5E1710', pair: 8 },
  { name: trLater('Apricot'), center: '#FFC078', rim: '#FFEEDB', ink: '#4A2004', pair: 7 },
  { name: trLater('Stone'), center: '#D3CEC9', rim: '#F6F5F3', ink: '#292524', pair: 9 },
];
const AVATAR_FINISHES = [
  { id: 'radial', name: trLater('Soft radial') }, { id: 'ember', name: trLater('Ember') }, { id: 'twin', name: trLater('Twin') }, { id: 'aqua', name: trLater('Aqua') },
];
// The colour an account or address shows: the one chosen (look.color), or the one its address picks.
const avatarPreset = (key, look = null) => AVATAR_PRESETS[look && Number.isInteger(look.color) ? look.color : fnv1a(key) % AVATAR_PRESETS.length];
function fnv1a(str) {
  let x = 0x811c9dc5;
  const s = String(str).trim().toLowerCase();
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193); }
  return x >>> 0;
}
function initialOf(name) {
  const s = String(name || '').trim().replace(/^[@._\-\s]+/, '');
  const m = s.match(/[\p{L}\p{N}]/u);
  return m ? m[0].toLocaleUpperCase() : (Array.from(s)[0] || '?');
}
// The avatar: the colour (see avatarPreset), in one of four finishes, gradients and shapes only, with the name's
// initial. Soft radial: a solid centre melting into a pale edge. Ember: dark, the colour glowing up from below. Twin:
// two glows, the colour from below and its neighbour from above. Aqua: glossy gel, gloss on top over the initial.
function avatarSvg(key, name, look = null) {
  const p = avatarPreset(key, look);
  const finish = look && AVATAR_FINISH_IDS.includes(look.finish) ? look.finish : 'radial';
  const k = 0.6;
  const id = uid('av');
  const stop = (o, c, a = 1) => svg('stop', { offset: o, 'stop-color': c, 'stop-opacity': clamp(+a.toFixed(3), 0, 1) });
  const lin = (sid, stops) => svg('linearGradient', { id: sid, x1: 0, y1: 0, x2: 0, y2: 1 }, stops.map((s) => stop(...s)));
  const rad = (sid, stops, cx = 44, cy = 44, r = 44, extra = {}) =>
    svg('radialGradient', { id: sid, cx, cy, r, gradientUnits: 'userSpaceOnUse', ...extra }, stops.map((s) => stop(...s)));
  const blob = (sid, cx, cy, r, c, a) => rad(sid, [[0, c, a], [1, c, 0]], cx, cy, r);
  const disc = (fill) => svg('circle', { cx: 44, cy: 44, r: 44, fill });
  const square = (fill) => svg('rect', { width: 88, height: 88, fill });
  const rim = (stroke, extra = {}) => svg('circle', { cx: 44, cy: 44, r: 43.5, fill: 'none', stroke, ...extra });
  const c = p.center;
  let defs; let body; let ink = p.ink; let over = null;
  if (finish === 'ember') {
    defs = [rad(`${id}g`, [[0, c, 1], [0.5, c, 0.45], [1, c, 0]], 44, 92, 62),
      lin(`${id}r`, [[0, '#FFFFFF', 0.45 * k], [0.4, '#FFFFFF', 0], [1, c, 0.6 * k]]),
      lin(`${id}h`, [[0, '#FFFFFF', 0.14 * k], [1, '#FFFFFF', 0]])];
    body = [disc(p.ink), disc(`url(#${id}g)`), svg('ellipse', { cx: 44, cy: 22, rx: 28, ry: 14, fill: `url(#${id}h)` }), rim(`url(#${id}r)`)];
    ink = p.rim;
  } else if (finish === 'twin') {
    defs = [blob(`${id}a`, 12, 6, 62, AVATAR_PRESETS[p.pair].center, 0.7), blob(`${id}b`, 80, 94, 66, c, 0.95),
      lin(`${id}r`, [[0, '#FFFFFF', 0.35 * k], [0.5, '#FFFFFF', 0], [1, '#FFFFFF', 0.15 * k]])];
    body = [disc(p.ink), square(`url(#${id}a)`), square(`url(#${id}b)`), rim(`url(#${id}r)`)];
    ink = p.rim;
  } else if (finish === 'aqua') {
    defs = [rad(`${id}e`, [[0.55, p.ink, 0], [0.84, p.ink, 0.16 + 0.2 * k], [1, p.ink, 0.4 + 0.25 * k]]),
      rad(`${id}c`, [[0, p.rim, 0.95], [0.55, p.rim, 0.45], [1, p.rim, 0]], 44, 80, 40),
      lin(`${id}t`, [[0, p.ink, 0.22 * k], [0.45, p.ink, 0]]),
      lin(`${id}g`, [[0, '#FFFFFF', 0.72 * k], [0.45, '#FFFFFF', 0.3 * k], [0.75, '#FFFFFF', 0.1 * k], [1, '#FFFFFF', 0.04 * k]])];
    body = [disc(c), disc(`url(#${id}t)`), square(`url(#${id}c)`), disc(`url(#${id}e)`), rim(p.ink, { 'stroke-opacity': +(0.25 + 0.2 * k).toFixed(3) })];
    over = svg('ellipse', { cx: 44, cy: 21, rx: 28, ry: 16.5, fill: `url(#${id}g)`, 'clip-path': `url(#${id}clip)` });
  } else {
    defs = [rad(`${id}b`, [[0, c, 1], [0.28, c, 1], [0.46, c, 0.93], [0.6, c, 0.8], [0.72, c, 0.6], [0.83, c, 0.38], [0.92, c, 0.18], [1, c, 0.04]]),
      lin(`${id}s`, [[0.4, p.ink, 0], [0.7, p.ink, 0.035 * k], [0.88, p.ink, 0.08 * k], [1, p.ink, 0.12 * k]]),
      rad(`${id}h`, [[0, '#FFFFFF', 0.42 * k], [0.35, '#FFFFFF', 0.3 * k], [0.65, '#FFFFFF', 0.12 * k], [1, '#FFFFFF', 0]], 44, 20, 40,
        { gradientTransform: 'translate(44 20) scale(1 0.62) translate(-44 -20)' }),
      lin(`${id}r`, [[0, '#FFFFFF', 0.5 * k], [0.35, '#FFFFFF', 0.06 * k], [0.7, '#FFFFFF', 0], [1, '#FFFFFF', 0.14 * k]])];
    body = [disc(p.rim), disc(`url(#${id}b)`), disc(`url(#${id}s)`), square(`url(#${id}h)`), rim(`url(#${id}r)`)];
  }
  return svg('svg', { viewBox: '0 0 88 88', 'aria-hidden': 'true' },
    svg('defs', null, svg('clipPath', { id: `${id}clip` }, svg('circle', { cx: 44, cy: 44, r: 44 })), defs),
    svg('g', { 'clip-path': `url(#${id}clip)` }, body),
    svg('text', { x: 44, y: 61, 'text-anchor': 'middle', 'font-family': 'Geist, -apple-system, system-ui, sans-serif', 'font-weight': 600, 'font-size': 48, fill: ink }, initialOf(name)),
    over);
}
function avatar(account, size = '') {
  return h('div', { class: ['avatar', size], 'aria-hidden': 'true' }, avatarSvg(account.identity, account.name, account.avatar));
}
// The lead of a row in a list you pick from: the one picked carries a check badge on its corner, like Activity's.
function pickLead(lead, picked) {
  return h('span', { class: ['pick-lead', picked && 'picked'], 'aria-hidden': 'true' }, lead, picked ? h('span', { class: 'sb' }, icon('check', 10, 2.5)) : null);
}
// A saved address: its exchange's logo when its name starts with one, otherwise an avatar like an account's.
function contactAvatar(contact, size = '') {
  const logo = contactLogo(contact.name);
  return logo ? h('div', { class: ['avatar', size], 'aria-hidden': 'true' }, h('img', { src: logo.src, alt: '', decoding: 'async', draggable: 'false' })) : avatar(contact, size);
}
// Notice: tone surface, icon + one-line title, optional body and one full-width action.
// Tones: plain (neutral), info, ok (success), warn, error. Generic icons fall back to the tone's own.
const NOTICE_ICON = { plain: 'info', info: 'info', ok: 'checkCircle', warn: 'info', error: 'xCircleFill' };
/** @param {string} kind @param {string | null} iconName @param {string | null} title @param {string | null} text @param {Child} [action] @param {{ onDismiss?: () => void }} [opts] */
function notice(kind, iconName, title, text, action, { onDismiss } = {}) {
  const generic = !iconName || iconName === 'alert' || iconName === 'info';
  return h('div', { class: ['notice', kind], role: kind === 'error' ? 'alert' : null },
    h('div', { class: 'notice-head' },
      icon(generic ? NOTICE_ICON[kind] || 'info' : iconName, 20),
      title ? h('b', { text: title }) : h('span', { class: 'notice-text', text }),
      onDismiss ? h('button', { type: 'button', class: 'notice-x', 'aria-label': tr('Dismiss'), title: tr('Dismiss'), onClick: onDismiss }, icon('close', 16)) : null),
    title && text ? h('p', { class: 'notice-text', text }) : null,
    action ? h('div', { class: 'notice-action' }, action) : null);
}
// art: an icon's name, or a face (an empty list is a calm one).
function emptyState(art, title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, typeof art === 'string' ? icon(art, 32, 1.25) : art), h('h3', { text: title }), text ? h('p', { text }) : null, action || null);
}
function skeletonRows(n) {
  return Array.from({ length: n }, () => h('div', { class: 'row', 'aria-hidden': 'true' },
    h('span', { class: 'sk sk-circle' }),
    h('div', { class: 'row-main' }, h('span', { class: 'sk sk-line w-50' }), h('span', { class: 'sk sk-line w-30' })),
    h('div', { class: 'row-end' }, h('span', { class: 'sk sk-line sk-amt' }))));
}
function badge(text, kind = '') { return h('span', { class: ['badge', kind], text }); }
// Rows of [key, value, { stack }]; { whole } lets the value carry its own key (e.g. "From" on a party's name line).
function kv(rows) {
  return h('div', { class: 'kv' }, rows.filter(Boolean).map(([k, v, opts]) => (opts?.whole
    ? h('div', { class: 'kv-row stack' }, h('div', { class: 'kv-v' }, v))
    : h('div', { class: ['kv-row', opts?.stack && 'stack'] }, h('div', { class: 'kv-k', text: k }), h('div', { class: 'kv-v' }, v)))));
}
// Full address with the first and last 5 letters emphasised, to help eyeball-checks.
function addressText(identity, cls = '') { return h('div', { class: ['address', cls] }, addressSpans(identity)); }
// The address on one line, as much of it as the line holds: cut in the middle only as far as it has to be, the whole
// address when it fits (see fitAddress). With a pointer, hovering (or focusing) it shows the whole address in a small
// glass bubble; screen readers get the whole address.
function addressPeek(identity) {
  const shown = h('span', { class: 'shown', 'aria-hidden': 'true' }, addressSpans(identity));
  fitAddress(shown, identity);
  return h('span', { class: 'addr-peek', tabindex: '0' }, shown, h('span', { class: 'sr-only', text: identity }), h('span', { class: 'addr-tip', 'aria-hidden': 'true', text: identity }));
}
// The address as text: its first and last five characters in the primary colour, the rest secondary, with one
// ellipsis between the kept start (head characters) and end (tail characters) when it's cut.
function addressSpans(identity, head = identity.length, tail = 0) {
  const em = (t) => h('span', { class: 'em', text: t });
  if (head + tail >= identity.length) return [em(identity.slice(0, 5)), identity.slice(5, -5), em(identity.slice(-5))];
  const start = identity.slice(0, head); const end = identity.slice(identity.length - tail);
  return [em(start.slice(0, 5)), start.slice(5), '…', end.slice(0, Math.max(0, end.length - 5)), em(end.slice(-5))];
}
// Monospaced, so every character is as wide: as many as fit, the start and end kept around a single ellipsis.
function fitAddress(el, identity) {
  let charWidth = 0;
  const fit = () => {
    const width = el.getBoundingClientRect().width;
    if (!width || !el.isConnected) return;
    if (!charWidth) {
      const probe = h('span', { text: 'M'.repeat(20) });
      el.append(probe);
      charWidth = probe.getBoundingClientRect().width / 20;
      probe.remove();
      if (!charWidth) return;
    }
    const chars = Math.floor(width / charWidth + 0.01);
    if (chars >= identity.length) { fill(el, addressSpans(identity)); return; }
    const keep = Math.max(2, chars - 1);
    const tail = Math.min(10, Math.floor(keep / 2));
    fill(el, addressSpans(identity, keep - tail, tail));
  };
  // Whenever its width changes, which includes once when it first goes on the page (before it is painted).
  new ResizeObserver(fit).observe(el);
}
function explorerLink(kind, value, label, { iconOnly = false } = {}) {
  const safe = (kind === 'tx' && isHash(value)) || (kind === 'address' && isId(value)) || (kind === 'tick' && Number.isSafeInteger(value) && value >= 0);
  if (!safe) return null;
  const href = `${EXPLORER}/${kind}/${value}`;
  if (iconOnly) return h('a', { class: 'tool-ic', href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': label, title: label }, icon('globe', 16));
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, h('span', { text: label }), icon('globe', 14));
}
// Copy as a bare 16 px icon (44 px to tap), for the end of a value's first line. label: what the button says ("Copy
// address"); done: the toast once copied ("Address copied"), each a whole message so it can agree with what's copied.
function copyTool(text, { label, done }) {
  return h('button', { type: 'button', class: 'tool-ic', 'aria-label': label, title: label,
    onClick: () => copyWithToast(text, done) }, icon('copy', 16));
}
// Floated to the right of the first line, so the name or address below keeps the full width.
const lineTools = (...tools) => h('span', { class: 'line-tools' }, tools);
// An address's copy and explorer tools (after any extra ones, such as save), for the end of its first line.
const addressTools = (identity, ...extra) => lineTools(...extra, copyTool(identity, { label: tr('Copy address'), done: tr('Address copied') }), explorerLink('address', identity, tr('View address on explorer'), { iconOnly: true }));
// The Address row of a details list: its tools, then the whole address.
const addressRow = (identity) => [tr('Address'), h('div', { class: 'party' }, addressTools(identity), addressText(identity)), { stack: true }];
function labelFor(identity) {
  const own = accountByIdentity(identity);
  if (own) return { name: own.name, kind: 'own' };
  // Your own name for a saved address comes before the official labels.
  const saved = contactByIdentity(identity);
  if (saved) return { name: saved.name, kind: 'contact' };
  const known = state.labels.get(identity);
  if (known) return known;
  const kind = identityKind(identity);
  if (kind === 'burn') return { name: tr('Burn address'), kind: 'burn' };
  return null;
}
// Your name for an address (an account, a saved address or an official label), else its short form.
const partyName = (identity) => labelFor(identity)?.name || shortId(identity);
// Large amounts step down from 48px so billions of QUBIC still fit on one line.
const amountSize = (text) => (text.length > 19 ? 'xs' : text.length > 14 ? 'sm' : '');
const hidden = () => state.prefs.privacy;
const MASK = '••••••';
function qubicText(amount, { sign = '', compact = false } = {}) {
  if (hidden()) return `${MASK} QUBIC`;
  return `${sign}${compact ? fmtCompact(amount) : fmtInt(amount)} QUBIC`;
}
function usdText(value) { return hidden() ? MASK : fmtUsd(value); }

