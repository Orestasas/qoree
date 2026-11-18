// ═══════════════════════════════════════════════════════════════════════════
// 10. DASHBOARD
// Each section re-renders only when its inputs change (cheap keys, or the versions
// of what it shows), so focus and hover survive the frequent background refreshes.
// ═══════════════════════════════════════════════════════════════════════════
const renderKeys = new WeakMap();
function paintIf(el, key, build) {
  if (renderKeys.get(el) === key) return;
  renderKeys.set(el, key);
  fill(el, build());
}
// Like paintIf for a list whose items come and go on their own: items is [key, build] pairs in order, the key naming an
// item and what it says. An item whose key stays keeps its element (and whatever it's in the middle of, such as the
// screen's fade-in); a new one is inserted in place and opens, one that's gone closes and is removed (openClose). On
// the first paint nothing moves: that's part of the screen's own arrival.
function paintKeyed(el, items) {
  const first = !renderKeys.has(el);
  renderKeys.set(el, true);
  const have = new Map([...el.children].filter((c) => !c.dataset.leaving).map((c) => [c.dataset.key, c]));
  let at = el.firstElementChild;
  for (const [key, build] of items) {
    while (at && at.dataset.leaving) at = at.nextElementSibling;
    const kept = have.get(key);
    if (kept) { have.delete(key); if (kept === at) at = at.nextElementSibling; else el.insertBefore(kept, at); continue; }
    const made = build();
    if (!made) continue;
    made.dataset.key = key;
    el.insertBefore(made, at);
    if (!first) openClose(made, true);
  }
  for (const gone of have.values()) openClose(gone, false);
}
// An item opening from nothing or closing to nothing in a grid list: its height and the gap beside it (or, alone,
// the list's top margin) grow or shrink with it while it fades through a slight blur, so what's below slides rather than
// jumps. A closing one is removed at the end; with Reduce Motion, or a browser that isn't drawing frames, it all just
// happens.
function openClose(item, opening) {
  const list = item.parentElement;
  if (reducedMotion()) { if (!opening) item.remove(); return; }
  if (!opening) item.dataset.leaving = '1';
  const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
  const side = item.previousElementSibling ? 'marginTop' : item.nextElementSibling ? 'marginBottom' : null;
  const height = `${item.offsetHeight}px`;
  const space = (on) => ({ height: on ? height : '0px', ...(side ? { [side]: on ? '0px' : `${-gap}px` } : {}) });
  const look = (on) => ({ opacity: on ? 1 : 0, ...arrivalBlur(on ? 0 : 8) });
  // Opening, the space and the item arrive together. Closing, the space folds away on its own curve while the item fades
  // more slowly into it, so it fills its space until the space is gone: faded on the same curve, it looked gone with a
  // quarter of its space still closing, a gap that caught up afterwards.
  const timing = opening ? { duration: 520, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'none' }
    : { duration: 260, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' };
  item.style.overflow = 'hidden';
  const moves = opening ? [item.animate([{ ...space(false), ...look(false) }, { ...space(true), ...look(true) }], timing)]
    : [item.animate([space(true), space(false)], timing), item.animate([look(true), look(false)], { duration: 220, easing: 'ease-in', fill: 'forwards' })];
  if (!side) {
    const margin = getComputedStyle(list).marginTop;
    moves.push(list.animate(opening ? [{ marginTop: '0px' }, { marginTop: margin }] : [{ marginTop: margin }, { marginTop: '0px' }], timing));
  }
  let ended = false;
  const done = () => {
    if (ended) return;
    ended = true;
    if (opening) item.style.removeProperty('overflow');
    else { item.remove(); for (const m of moves) m.cancel(); }
  };
  moves[0].onfinish = done;
  // The finish event comes with a drawn frame; without frames, end it here.
  setTimeout(() => { for (const m of moves) if (m.playState !== 'finished') m.finish(); done(); }, timing.duration + 400);
}
// A section's heading, with its short note on the right.
const sectionHead = (title, meta = null) => h('div', { class: 'section-head' }, h('h2', { class: 'section-title', text: title }), meta ? h('span', { class: 'section-meta', text: meta }) : null);

let sessionNoticeDismissed = false;
// The exchange notice's text when it was dismissed: it comes back only once the status says something else.
let exchangeNoticeDismissed = '';

// What an exchange has paused, in one sentence ("Gate.io has paused QUBIC deposits and withdrawals."), or null when it
// hasn't (or its status isn't known).
function exchangePauseText(status) {
  for (const [id, s] of Object.entries(status)) {
    const paused = s ? [s.deposits === false && 'deposits', s.withdrawals === false && 'withdrawals'].filter(Boolean).join(' and ') : '';
    if (paused) {
      return tr('{exchange} has paused {paused, select, deposits {QUBIC deposits} withdrawals {QUBIC withdrawals} other {QUBIC deposits and withdrawals}}.',
        { exchange: STATUS_SOURCES[id].name, paused });
    }
  }
  return null;
}

// Getting to the wallet (unlocked, created, imported, watched, or reloaded) reveals it; coming back from adding an
// account slides it back in.
function showDashboard(opts = {}) {
  // Arriving afresh (unlocked, created, imported, a language picked), Activity starts plain and phones start on Home;
  // back from adding an account, both stay as they were.
  if (!opts.back) { resetActivityView(); dashTab = 'home'; }
  showScreen('dashboard', () => {
    const els = {
      account: h('div', { class: 'account-slot' }),
      // The wallet's logo rests in the middle of the header and gives way to the balance once it scrolls up there.
      logo: h('div', { class: 'head-logo', role: 'img', 'aria-label': 'qoree' }, qoreeLogo(24)),
      tools: h('div', { class: 'topbar-tools' }),
      // The balance arrives here once the big number has scrolled under the header; tap to go back up.
      head: h('button', { type: 'button', class: 'head-amount', title: tr('Back to top'), onClick: () => window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }) }),
      label: heroLabel(),
      value: h('div', { class: 'hero-num' }),
      sub: h('div', { class: 'hero-subs' }),
      actions: h('div', { class: 'actions arrive tab-home' }),
      notices: h('div', { class: 'notices arrive-children tab-home' }),
      assets: h('section', { class: 'section arrive-children tab-home', 'aria-label': tr('Assets') }),
      market: h('section', { class: 'section arrive-children tab-home', 'aria-label': tr('Market') }),
      toolkit: h('section', { class: 'section arrive-children tab-tools', 'aria-label': tr('Tools') }),
      activity: h('section', { class: 'section arrive-children tab-activity', 'aria-label': tr('Activity') }),
      // Phones and tablets: Settings as a tab of its own (wider, it's a sheet; see openSettings)
      settings: h('section', { class: 'section tab-settings', 'aria-label': tr('Settings') }),
      net: netBar(),
    };
    const topbar = h('header', { class: 'topbar' }, edgeBlur('top'), h('div', { class: 'topbar-inner arrive' }, els.account, els.logo, els.head, els.tools));
    const left = h('div', { class: 'dash-left' },
      h('section', { class: 'hero arrive tab-home', 'aria-label': tr('Balance') }, els.label.el, els.value, els.sub),
      els.actions, els.notices, els.assets, els.market, els.toolkit);
    // The same frosted blur along the bottom edge, while there's more page below to scroll to.
    const floor = h('div', { class: 'page-floor', 'aria-hidden': 'true' }, edgeBlur('bottom'));
    const moreBelow = () => window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 4;
    const showFloor = () => floor.classList.toggle('shown', moreBelow());
    // The network line sits outside the two-column grid, so the sticky left column can never ride over it.
    // A heading for the screen, read out and focused when it arrives (after unlocking, focus would otherwise be nowhere).
    const dash = h('main', { class: 'dash', dataset: { tab: dashTab } }, h('h1', { class: 'sr-only', tabindex: '-1', text: tr('Wallet') }), left,
      h('div', { class: 'dash-right' }, els.activity, els.settings));
    const root = h('div', { class: 'dash-shell' }, topbar, dash, els.net.el, floor);
    const motion = numberToHeader({
      scroller: window, bar: () => topbar.getBoundingClientRect().bottom,
      number: els.value, label: els.label.el, slot: els.head, hide: els.account, rest: els.logo,
    });
    // ── Tabs (phones and tablets; see DASH_TABS) ──
    const settingsHome = () => settingsRoot(host);
    const host = pageHost(els.settings, settingsHome);
    settingsHome();
    const bar = tabBar((id, again) => pickTab(id, again));
    $('#layer').append(bar.el);
    const remembered = {};
    // A tab picked on the bar comes back scrolled as you left it; the one on screen picked again goes to its top
    // (Settings: to its first page). Settings goes back to its first page when you leave it, so nothing it showed (a
    // seed, a form) stays open behind another tab.
    function pickTab(id, again) {
      if (again) {
        if (id === 'settings' && host.back) settingsHome();
        else window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
        return;
      }
      remembered[dashTab] = window.scrollY;
      if (dashTab === 'settings') { settingsHome(); remembered.settings = 0; }
      dashTab = id;
      dash.dataset.tab = id;
      scrolledAway = false;
      placeBar();
      lastY = remembered[id] || 0;
      window.scrollTo(0, lastY);
      update();
    }
    // The bar steps out of the way while the page scrolls down and comes back when it scrolls up or nears the top (not
    // while a sheet holds the page still). A field with the keyboard up hides it too, on a touch screen, where the
    // keyboard would carry it up over the field.
    let lastY = window.scrollY; let scrolledAway = false; let typing = false;
    const placeBar = () => bar.el.classList.toggle('away', scrolledAway || typing);
    const followScroll = () => {
      // iOS bounces past either end and back: that's neither down nor up
      const end = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const y = Math.min(Math.max(window.scrollY, 0), end);
      if (Math.abs(y - lastY) < 8) return;
      const down = y > lastY;
      lastY = y;
      const away = down && y > 32;
      if (away !== scrolledAway) { scrolledAway = away; placeBar(); }
    };
    const touch = window.matchMedia('(hover: none) and (pointer: coarse)');
    const isField = (t) => Boolean(t && t.matches && root.contains(t) && t.matches('input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=range]), textarea'));
    const onFocus = () => setTimeout(() => {
      const now = touch.matches && isField(document.activeElement);
      if (now !== typing) { typing = now; placeBar(); }
    }, 60);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onFocus);
    dashTabs = {
      // openSettings on a screen with tabs: the Settings tab, at its first page (or Appearance → Language)
      settings(at) {
        if (WIDE_DASH.matches) return false;
        if (dashTab !== 'settings') pickTab('settings', false);
        settingsHome();
        if (at === 'language') languagePane(host, () => appearancePane(host, () => settingsRoot(host, 'back'), 'back'), null);
        return true;
      },
    };
    const update = () => {
      if (state.phase !== 'ready') return;
      bar.update(dashTab, state.pending.some(isOpenTransfer));
      renderAccountButton(els.account);
      renderTools(els.tools);
      renderHero(els);
      renderActions(els.actions);
      renderNotices(els.notices);
      renderAssets(els.assets);
      renderMarket(els.market);
      renderToolkit(els.toolkit);
      renderActivity(els.activity);
      els.net.update();
      motion.update();
      requestAnimationFrame(showFloor);
    };
    update();
    const unsub = subscribe(update);
    const onScroll = () => {
      if (pageLocked()) return;
      topbar.classList.toggle('scrolled', window.scrollY > 4);
      showFloor();
      followScroll();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    // Switching accounts from the keyboard (see scopeForKey). Not while typing, with a modifier held (those belong to
    // the browser), over a sheet, or when the focused control already used the key.
    const onKey = (e) => {
      if (e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || sheets.length || state.phase !== 'ready' || typingIn(e.target)) return;
      const next = scopeForKey(e.key);
      if (next == null || next === shownScope()) return;
      e.preventDefault();
      switchScope(next, { fast: true });
    };
    window.addEventListener('keydown', onKey);
    // Wide screens: the left column scrolls with the page until its bottom is in view, then stays put. This runs on every
    // frame a notice opens or closes, so it reads before it writes (a read after a write forces a layout), and writes
    // only a change, to the column's own top (an inherited variable would restyle everything in it).
    let leftTop = '';
    const layout = () => {
      const top = WIDE_DASH.matches ? `${Math.min(96, window.innerHeight - left.offsetHeight - 24)}px` : '';
      const below = moreBelow();
      if (top !== leftTop) { leftTop = top; left.style.top = top; }
      floor.classList.toggle('shown', below);
    };
    const sizes = new ResizeObserver(layout);
    sizes.observe(root); sizes.observe(left);
    window.addEventListener('resize', layout, { passive: true });
    const clock = setInterval(() => els.net.update(), 1000);
    onLeave(() => {
      unsub(); motion.destroy(); sizes.disconnect(); clearInterval(clock);
      window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', layout); window.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus); document.removeEventListener('focusout', onFocus);
      bar.el.remove(); host.destroy();
      dashTabs = null;
    });
    return root;
  }, { ...opts, reveal: !opts.back });
}

// Switching accounts: the dashboard and the selector fade out with a slight blur, the new account is drawn at the top
// of the page, then it all comes back into focus (160 ms out, 450 ms in; from the keyboard 200 ms quicker, 100 + 310).
// Reduce Motion: an instant swap. A switch asked for while one is fading out retargets it (so quick key presses add up,
// and only one fade ever runs).
let switchTarget = null;
const shownScope = () => (switchTarget !== null ? switchTarget : state.selection);
// Accounts by keyboard: ← → step through them in the switcher's order (All accounts first), 1–9 pick one, 0 picks
// All accounts. null when the key means nothing here (one account, no such number).
const scopeOrder = () => [...(state.accounts.length > 1 ? ['all'] : []), ...state.accounts.map((a) => a.id)];
function scopeForKey(key) {
  const order = scopeOrder();
  if (order.length < 2) return null;
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const i = order.indexOf(shownScope());
    return order[(i + (key === 'ArrowRight' ? 1 : -1) + order.length) % order.length];
  }
  if (key === '0') return 'all';
  if (/^[1-9]$/.test(key)) { const a = state.accounts[Number(key) - 1]; return a ? a.id : null; }
  return null;
}

function switchScope(selection, { fast = false } = {}) {
  if (switchTarget !== null) { switchTarget = selection; return; }
  if (selection === state.selection) return;
  const root = view.name === 'dashboard' ? view.el : null;
  const parts = root ? [root.querySelector('.dash'), root.querySelector('.account-slot')].filter(Boolean) : [];
  if (!parts.length || reducedMotion()) { selectScope(selection); return; }
  switchTarget = selection;
  const [outMs, inMs] = fast ? [100, 310] : [160, 450];
  const out = parts.map((el) => el.animate([{ opacity: 1, ...arrivalBlur(0) }, { opacity: 0, ...arrivalBlur(8) }], { duration: outMs, easing: 'ease-in', fill: 'forwards' }));
  setTimeout(() => {
    const target = switchTarget;
    switchTarget = null;
    if (target !== state.selection && (target === 'all' || accountById(target))) selectScope(target);
    window.scrollTo(0, 0);
    // The redraw runs on the next frame; the fade-in starts in that same frame, so nothing flashes.
    requestAnimationFrame(() => {
      for (const a of out) a.cancel();
      for (const el of parts) {
        el.animate([{ opacity: 0, ...arrivalBlur(12) }, { opacity: 1, ...arrivalBlur(0) }], { duration: inMs, easing: 'cubic-bezier(0.3, 0.6, 0.3, 1)' });
      }
    });
  }, outMs);
}

// ── Aggregates ──────────────────────────────────────────────────────────────
function scopeBalance(accts = scopeAccounts()) {
  let total = 0n; let loaded = 0; let failed = 0;
  for (const a of accts) {
    const d = dataFor(a.identity);
    if (d.balance) { total += d.balance.amount; loaded++; }
    else if (d.balanceErr) failed++;
  }
  return { total, loaded, failed, count: accts.length, ready: loaded + failed === accts.length };
}

// ── Header: the account selector on the left, lock and settings on the right ─
function renderAccountButton(el) {
  const acct = currentAccount();
  const keys = state.accounts.length > 1;
  // The account in view, the accounts' names and avatars (see heroKey).
  paintIf(el, String(versions.wallet), () => h('button', {
    type: 'button', class: 'account-btn', onClick: openAccountsSheet, 'aria-label': acct ? tr('{name}. Switch account', { name: acct.name }) : tr('All accounts. Switch account'),
    title: keys ? tr('Switch account (← →, 1–9, 0 for all)') : null, 'aria-keyshortcuts': keys ? 'ArrowLeft ArrowRight 0 1 2 3 4 5 6 7 8 9' : null,
  },
    acct ? avatar(acct) : h('div', { class: 'stack-avatar' }, icon('layers', 18)),
    h('div', { class: 'who' },
      h('b', { text: acct ? acct.name : tr('All accounts') }),
      h('span', { text: acct ? shortId(acct.identity, 5) : tr('{count, plural, one {# account} other {# accounts}}', { count: state.accounts.length }) })),
    icon('chevronDown', 16)));
}

function renderTools(el) {
  paintIf(el, state.mode, () => [
    state.mode === 'vault' ? iconButton('lock', tr('Lock wallet'), () => lockWallet(tr('Wallet locked')), 'tool') : null,
    // on phones and tablets, Settings is a tab on the bar instead
    iconButton('settings', tr('Settings'), () => openSettings(), 'tool wide-only'),
  ]);
}

// ── Tabs (phones and tablets) ───────────────────────────────────────────────
// Under 1024 px the dashboard is four tabs, picked on a bar along the bottom: Home (the balance, actions, assets and
// market), Activity, Tools and Settings. Wider, it's the two columns as before, with Settings in its sheet. The bar shows
// icons only, each saying its name to a screen reader: [id, icon, the filled icon for the tab on screen, name].
const DASH_TABS = [['home', 'house', 'houseFill', trLater('Home')], ['activity', 'clock', 'clockFill', trLater('Activity')],
  ['tools', 'grid', 'gridFill', trLater('Tools')], ['settings', 'settings', 'settingsFill', trLater('Settings')]];
// The tab on screen, kept while you use the wallet (arriving afresh starts on Home; see showDashboard).
let dashTab = 'home';
// The dashboard on screen, while it has one: settings(at) takes it to its Settings tab, false where the screen is wide
// enough for Settings' sheet (see openSettings).
let dashTabs = null;
// The bar: the tab on screen filled, lit in the accent and on a pill that slides to it. onPick(id, again): again when
// it's the tab already on screen.
function tabBar(onPick) {
  const pill = h('span', { class: 'tab-pill', 'aria-hidden': 'true' });
  const dot = h('span', { class: 'tab-dot', hidden: true });
  const buttons = DASH_TABS.map(([id]) => {
    const b = h('button', { type: 'button', class: 'tab' });
    b.addEventListener('click', () => onPick(id, b.getAttribute('aria-current') === 'page'));
    return b;
  });
  buttons[1].append(dot);
  const el = h('nav', { class: 'tabbar' }, pill, buttons);
  let placed = false;
  return {
    el,
    // current: the tab on screen; busy: a transfer is in progress (the dot on Activity)
    update(current, busy) {
      el.setAttribute('aria-label', tr('Sections'));
      DASH_TABS.forEach(([id, glyph, filled, name], i) => {
        const b = buttons[i];
        const on = id === current;
        b.setAttribute('aria-label', tr(name));
        b.title = tr(name);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        const want = on ? filled : glyph;
        if (b.dataset.glyph !== want) {
          b.dataset.glyph = want;
          const old = b.querySelector('.nc-icon');
          const fresh = icon(want, 24);
          if (old) old.replaceWith(fresh); else b.prepend(fresh);
        }
        // in place at once the first time, then sliding (offsetLeft keeps it right in a right-to-left language too);
        // not while the bar is hidden on a wide screen
        if (on && b.offsetWidth) {
          if (!placed) pill.style.transition = 'none';
          pill.style.transform = `translateX(${b.offsetLeft}px)`;
          if (!placed) { pill.getBoundingClientRect(); pill.style.removeProperty('transition'); placed = true; }
        }
      });
      dot.hidden = !busy;
    },
  };
}

// ── Balance hero ────────────────────────────────────────────────────────────
// Stable slots (label, number, sub line, header amount) so the scroll motion can style them.
function heroLabel() {
  const name = h('span', { class: 'hero-name' });
  const tag = h('span', { class: 'hero-tag' });
  const eye = h('button', { type: 'button', class: 'hero-eye', onClick: () => setPref('privacy', !state.prefs.privacy) });
  return {
    el: h('div', { class: 'hero-label' }, name, tag, eye),
    update(title, watch) {
      name.textContent = title;
      // Watch-only: a blue eye, not a button, saying so in a bubble on hover or focus (as addresses do), and no
      // hide-balances eye beside it to mistake it for (Settings has that switch).
      if (tag.dataset.watch !== String(Boolean(watch))) {
        tag.dataset.watch = String(Boolean(watch));
        fill(tag, watch ? h('span', { class: 'hero-watch', tabindex: '0', role: 'img', 'aria-label': tr('Watch-only wallet') }, icon('eye', 18),
          h('span', { class: 'addr-tip', 'aria-hidden': 'true', text: tr('Watch-only. You can follow this address, but sending needs its seed.') })) : null);
        eye.hidden = Boolean(watch);
      }
      const on = hidden();
      if (eye.dataset.on === String(on)) return;
      eye.dataset.on = String(on);
      eye.replaceChildren(icon(on ? 'eyeOff' : 'eye', 18));
      // One name, with its state in aria-pressed (a name that flips with the state would contradict it).
      eye.setAttribute('aria-pressed', String(on));
      eye.setAttribute('aria-label', tr('Hide balances'));
      eye.title = on ? tr('Show balances') : tr('Hide balances');
    },
  };
}

// Redraw keys: the versions of what a section shows (see versions in 06-store.js). The big balance: the accounts in
// view, their balances, the price, and the settings (hidden balances, its unit, market data).
function heroKey() {
  return [versions.wallet, versions.balances, versions.market, versions.prefs].join('|');
}
function renderHero(els) {
  const acct = currentAccount();
  const b = scopeBalance();
  const p = priceInfo();
  const key = heroKey();
  if (renderKeys.get(els.value) === key) return;
  const title = acct ? tr('Balance') : tr('Total balance');
  els.label.update(title, acct && acct.kind === 'watch');
  const usd = b.loaded && p ? qubicToUsd(b.total, p.price) : null;
  // Tap the balance to switch between USD and QUBIC in billions; the choice is remembered.
  const showQubic = state.prefs.heroUnit === 'qubic' || usd == null;
  const parts = showQubic ? qubicLargeParts(b.total) : usd != null ? usdParts(usd) : null;
  const { major, minor } = parts;
  // A unit in words (亿, Md, مليار) follows the language's direction: right to left in Arabic, before the figure.
  const wordUnit = showQubic && /\p{L}/u.test(minor);
  els.head.classList.toggle('unit-word', wordUnit);
  const amount = (where) => { const r = rollingAmount(major, minor); heroRoll[where] = r; return r.nodes; };
  const spoken = showQubic ? tr('{amount} QUBIC', { amount: fmtQubicLarge(b.total, { long: true }) }) : `${parts.major}${parts.minor}`;
  const fit = major.length + minor.length > 15 ? 'xs' : major.length + minor.length > 11 ? 'sm' : '';
  const toggle = showQubic ? tr('Show in US dollars') : tr('Show in billions of QUBIC');

  // A new value of the same kind (same account, unit and state) rolls its changed digits into place, in the header's
  // copy too; anything else is painted afresh.
  const shape = [state.selection, showQubic, usd == null, hidden(), b.loaded, b.failed].join('|');
  const num = showQubic ? Number(b.total) : usd;
  if (heroRoll.shape === shape && b.loaded && !hidden() && heroRoll.value && els.value.contains(heroRoll.value.nodes[0])) {
    const rise = num >= heroRoll.num;
    heroRoll.value.set(major, minor, rise);
    if (heroRoll.head && els.head.contains(heroRoll.head.nodes[0])) { heroRoll.head.set(major, minor, rise); renderKeys.set(els.head, key); }
    const box = els.value.firstElementChild;
    for (const f of ['sm', 'xs']) box.classList.toggle(f, fit === f);
    box.setAttribute('aria-label', box.tagName === 'BUTTON' ? tr('{amount}. {action}', { amount: spoken, action: toggle }) : spoken);
    heroRoll.num = num;
    renderKeys.set(els.value, key);
  }

  paintIf(els.value, key, () => {
    heroRoll = { shape, num };
    if (!b.loaded) return b.failed ? h('div', { class: 'hero-value muted', text: '—' }) : h('span', { class: 'sk sk-hero' });
    if (hidden()) return h('div', { class: 'hero-value masked', text: MASK });
    const swap = heroSwapped ? 'swap' : '';
    heroSwapped = false;
    if (usd == null) return h('div', { class: ['hero-value', fit, wordUnit && 'unit-word'], role: 'img', 'aria-label': spoken }, amount('value'));
    return h('button', {
      type: 'button', class: ['hero-value', fit, swap, wordUnit && 'unit-word'], title: toggle, 'aria-label': tr('{amount}. {action}', { amount: spoken, action: toggle }),
      onClick: () => { heroSwapped = true; setPref('heroUnit', showQubic ? 'usd' : 'qubic'); },
    }, amount('value'));
  });

  paintIf(els.sub, key, () => {
    if (!b.loaded && !b.failed) return h('span', { class: 'sk sk-line w-40' });
    if (!b.loaded) {
      return h('div', { class: 'hero-sub' }, h('span', { text: tr('Balance unavailable') }),
        h('button', { type: 'button', class: 'link-btn', onClick: () => refreshAll({ manual: true }), text: tr('Retry') }));
    }
    return [
      h('div', { class: 'hero-sub' },
        h('span', { class: 'sub-amount', text: hidden() ? MASK : showQubic && usd != null ? fmtUsd(usd) : `${fmtInt(b.total)} QUBIC` }),
        usd == null && !hidden() ? h('span', { class: 'subtle', text: tr('USD price unavailable') }) : null),
      b.failed ? h('p', { class: 'hero-note', text: tr('{failed} of {count} accounts couldn’t be loaded and aren’t included.', { failed: b.failed, count: b.count }) }) : null,
    ];
  });

  paintIf(els.head, key, () => (!b.loaded ? null : hidden() ? MASK : amount('head')));
  els.head.setAttribute('aria-label', b.loaded ? (hidden() ? tr('{title}, hidden. Back to top', { title }) : tr('{title}, {amount}. Back to top', { title, amount: spoken })) : tr('Back to top'));
}
let heroSwapped = false;
// The big balance as last painted: what it showed (shape), its value, and its rolling amounts (value, header copy).
let heroRoll = {};

// Quick actions: up to three 84px tiles, Send first and in the brand fill when there is one.
// Send and Receive are for accounts this wallet can spend from. A watch-only address gets Copy and Explorer instead
// (its notice offers to add the seed); with All accounts, both pick among the accounts with seeds.
function renderActions(el) {
  const acct = currentAccount();
  const spendable = acct ? acct.kind === 'seed' : seedAccounts().length > 0;
  // The account in view, which accounts have seeds, and whether this device signs (a lock, the self-test).
  paintIf(el, String(versions.wallet), () => [
    spendable ? h('button', { type: 'button', class: 'action primary', disabled: !canSign(), onClick: () => openSendSheet() }, icon('send', 24), h('span', { text: tr('Send') })) : null,
    spendable ? h('button', { type: 'button', class: 'action', onClick: () => openReceiveSheet() }, icon('receive', 24), h('span', { text: tr('Receive') })) : null,
    acct
      ? h('button', { type: 'button', class: 'action', onClick: () => copyWithToast(acct.identity, tr('Address copied')) }, icon('copy', 24), h('span', { text: tr('Copy') }))
      : h('button', { type: 'button', class: 'action', onClick: openAccountsSheet }, icon('layers', 24), h('span', { text: tr('Accounts') })),
    acct && !spendable ? h('a', { class: 'action', href: `${EXPLORER}/address/${acct.identity}`, target: '_blank', rel: 'noopener noreferrer' },
      icon('globe', 24), h('span', { text: tr('Explorer') })) : null,
  ]);
}

function renderNotices(el) {
  const acct = currentAccount();
  const netDown = state.net.tickErr && (!state.net.tickAt || Date.now() - state.net.tickAt > 15000);
  const showSession = state.mode === 'session' && !sessionNoticeDismissed;
  const paused = state.prefs.exchangeStatus ? exchangePauseText(state.exchanges) : null;
  const showPaused = paused && paused !== exchangeNoticeDismissed ? paused : '';
  // Each notice keyed by what it says, so the others stay put when one comes or goes (paintKeyed).
  paintKeyed(el, [
    state.journalProblem ? ['journal', () => notice('error', 'alert', tr('Unsettled transfers couldn’t be read'), tr('{error} Sending is paused until then.', { error: errorText('JOURNAL') }),
      button(tr('I’ve checked them'), { kind: 'secondary', onClick: async () => {
        const ok = await confirmDialog({ title: tr('Checked on the explorer?'), message: tr('Only continue once you’ve confirmed on the explorer which of your recent transfers went through, so nothing is sent twice.'), confirmLabel: tr('Resume sending') });
        if (ok) clearJournalProblem();
      } }))] : null,
    [`self-test|${trustedContext()}|${state.selfTest.status}|${state.selfTest.failed || ''}`, selfTestBlocker],
    netDown ? ['net', () => notice('warn', 'globe', tr('Can’t reach the Qubic RPC'), tr('Showing the last data received. Retrying automatically.'))] : null,
    acct && acct.kind === 'watch' ? [`watch|${canSign()}`, () => notice('info', 'eye', tr('Watch-only address'), tr('You can follow this address, but sending needs its seed.'),
      canSign() ? button(tr('Add its seed'), { kind: 'secondary', onClick: () => showImport(true) }) : null)] : null,
    showSession ? [`session|${secureStorageSupported()}`, () => notice('info', 'clock', tr('Session only'), tr('Reloading or closing this tab forgets this wallet. Make sure your seed is backed up.'),
      secureStorageSupported() ? button(tr('Encrypt & remember'), { kind: 'secondary', onClick: () => openEnableEncryption() }) : null,
      { onDismiss: () => { sessionNoticeDismissed = true; changed(); } })] : null,
    showPaused ? [`paused|${showPaused}`, () => notice('warn', 'alert', null, showPaused, null, { onDismiss: () => { exchangeNoticeDismissed = showPaused; changed(); } })] : null,
  ].filter(Boolean));
}

// ── Assets ──────────────────────────────────────────────────────────────────
function scopeAssets() {
  const merged = new Map();
  let loading = false; let error = null;
  for (const a of scopeAccounts()) {
    const d = dataFor(a.identity);
    if (d.assetsErr) error = d.assetsErr;
    if (!d.assets) { loading = loading || !d.assetsErr; continue; }
    for (const x of d.assets) {
      const k = `${x.name}:${x.issuer}`;
      const prev = merged.get(k);
      if (prev) prev.units += x.units; else merged.set(k, { ...x });
    }
  }
  return { list: [...merged.values()], loading, error };
}

function fmtUnits(units, decimals) {
  if (!decimals) return fmtInt(units);
  const s = units.toString().padStart(decimals + 1, '0');
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return fmtInt(BigInt(s.slice(0, -decimals))) + (frac ? `.${frac}` : '');
}

// QUBIC first, then each asset held across the accounts in scope.
function assetRows(b, p, as) {
  const usd = p ? qubicToUsd(b.total, p.price) : null;
  const rows = [h('div', { class: 'row' },
    qubicCoin(),
    // The ticker and the price, with a dot between them that the CSS drops if the price wraps onto its own line.
    h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: 'Qubic' }), p ? h('div', { class: 'row-sub tick-price' }, h('span', { class: 'tp' },
      h('span', { text: 'QUBIC' }), h('span', { text: perBillion() ? tr('{price} per billion', { price: priceText(p.price) }) : priceText(p.price) })))
      : h('div', { class: 'row-sub', text: 'QUBIC' })),
    h('div', { class: 'row-end' },
      b.loaded ? h('div', { class: 'row-amount', text: hidden() ? MASK : fmtCompact(b.total) }) : h('span', { class: 'sk sk-line sk-amt' }),
      h('div', { class: 'row-note', text: b.loaded && usd != null ? usdText(usd) : '' })))];
  if (as.loading && !as.list.length) rows.push(...skeletonRows(1));
  for (const x of as.list) {
    rows.push(h('div', { class: 'row' },
      h('div', { class: 'token', text: x.name.slice(0, 2) }),
      h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: x.name }),
        h('div', { class: 'row-sub', text: tr('Issued by {name}', { name: partyName(x.issuer) }) })),
      h('div', { class: 'row-end' }, h('div', { class: 'row-amount', text: hidden() ? MASK : fmtUnits(x.units, x.decimals) }),
        h('div', { class: 'row-note', text: x.decimals ? tr('Units') : tr('{count, plural, one {Share} other {Shares}}', { count: Number(x.units) }) }))));
  }
  return rows;
}
const ASSETS_SHOWN = 3;
// What assetRows() shows: the accounts in view and the names you gave (an issuer can be one), their balances and
// assets, the price, address labels, and the settings (hidden balances, the price unit).
function assetsKey() {
  return [versions.wallet, versions.balances, versions.assets, versions.market, versions.labels, versions.prefs].join('|');
}
function renderAssets(el) {
  const b = scopeBalance();
  const p = priceInfo();
  const as = scopeAssets();
  paintIf(el, assetsKey(), () => {
    const rows = assetRows(b, p, as);
    return [
      sectionHead(tr('Assets'), tr('{count} held', { count: as.list.length + 1 })),
      h('div', { class: 'card' }, rows.slice(0, ASSETS_SHOWN),
        rows.length > ASSETS_SHOWN ? h('button', { type: 'button', class: 'see-all', onClick: openAssetsSheet, text: tr('See all') }) : null,
        as.error && !as.list.length ? h('div', { class: 'list-foot', text: tr('Other assets couldn’t be loaded right now.') }) : null),
    ];
  });
}
function openAssetsSheet() {
  const sheet = openSheet({ title: tr('Assets') });
  const list = h('div', { class: 'card' });
  const paint = () => {
    const b = scopeBalance(); const p = priceInfo(); const as = scopeAssets();
    paintIf(list, assetsKey(), () => assetRows(b, p, as));
  };
  paint();
  sheet.setPane([list], { title: tr('Assets') });
  sheet.onCleanup(subscribe(paint));
}

// ── Market ──────────────────────────────────────────────────────────────────
function sparkline(points) {
  const up = points[points.length - 1][1] >= points[0][1];
  const w = 300; const hgt = 64; const pad = 3;
  const xs = points.map((p) => p[0]); const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
  const sx = (x) => ((x - x0) / Math.max(1, x1 - x0)) * w;
  const sy = (y) => pad + (1 - (y - y0) / Math.max(1e-18, y1 - y0)) * (hgt - pad * 2);
  let d = '';
  points.forEach((p, i) => { d += `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`; });
  const area = `${d}L${w} ${hgt}L0 ${hgt}Z`;
  return svg('svg', { class: ['spark', up ? 'up' : 'down'].join(' '), viewBox: `0 0 ${w} ${hgt}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': up ? tr('QUBIC price over the last 24 hours, up') : tr('QUBIC price over the last 24 hours, down') },
    svg('path', { class: 'area', d: area }), svg('path', { class: 'line', d, 'vector-effect': 'non-scaling-stroke' }));
}

// Market: prices, stats and chart, the settings (market data, its unit; turning market data off clears them), and how
// long ago the price was read.
function marketKey(p) {
  return [versions.market, versions.prefs, p && timeAgo(p.at)].join('|');
}
function renderMarket(el) {
  const p = priceInfo();
  const m = state.market;
  const chart = state.prefs.marketData ? m.chart : null;
  paintIf(el, marketKey(p), () => {
    const head = sectionHead(tr('Market'), p ? `${p.source} · ${timeAgo(p.at)}` : null);
    if (!p) {
      if (!m.rpcErr && !m.cgErr) return [head, h('div', { class: 'card market' }, h('span', { class: 'sk sk-line w-40' }), h('span', { class: 'sk' }))];
      return [head, h('div', { class: 'card' }, emptyState('chart', tr('Price unavailable'), tr('Market data couldn’t be loaded. Balances in QUBIC are unaffected.')))];
    }
    const stat = (k, v) => h('div', null, h('div', { class: 'stat-k', text: k }), h('div', { class: 'stat-v', text: v }));
    return [head, h('div', { class: 'card market' },
      h('div', { class: 'market-top' },
        h('div', null, h('div', { class: 'market-name' }, perBillion() ? tr('Price per billion QUBIC') : tr('QUBIC price')), h('div', { class: 'market-price', text: priceText(p.price) })),
        p.change24h != null ? h('span', { class: ['change', pctDir(p.change24h)] }, tr('{change} · 24h', { change: fmtPct(p.change24h) })) : null),
      chart ? sparkline(chart) : null,
      h('div', { class: 'market-stats' },
        stat(tr('Market cap'), p.marketCap ? fmtUsd(p.marketCap, { compact: true }) : '—'),
        stat(tr('Circulating'), m.rpc && m.rpc.circulating ? fmtCompact(m.rpc.circulating) : '—'),
        stat(tr('Burned'), m.rpc && m.rpc.burned ? fmtCompact(m.rpc.burned) : '—')),
      !state.prefs.marketData ? h('p', { class: 'source', text: tr('24h change and chart are off (Settings → Network & data → Market data).') }) : null)];
  });
}

// Under Market, one row per tool (its coloured icon square and name; what it does on hover): the price calculator,
// order books, BPP-9000's calls, address book and signed messages. Signing needs a seed, so it's offered only when the account on screen
// has one (with All accounts, when any does); a watch-only account can't sign, and isn't stood in for.
const toolRow = (iconName, tone, label, onClick, hint) => h('button', { type: 'button', class: 'item', title: hint, onClick },
  h('span', { class: ['tool-icon', tone], 'aria-hidden': 'true' }, icon(iconName, 20)),
  h('span', { class: 'item-main' }, h('span', { class: 'item-title', text: label })));
// The tools: how many addresses are saved, whether the account in view can sign (wallet), and the settings (order books,
// BPP-9000).
function toolkitKey() {
  return [versions.wallet, versions.prefs].join('|');
}
function renderToolkit(el) {
  const saved = state.contacts.length;
  const shown = currentAccount();
  const signing = canSign() && (shown ? shown.kind === 'seed' && Boolean(shown.seed) : seedAccounts().length > 0);
  paintIf(el, toolkitKey(), () => [
    sectionHead(tr('Tools')),
    h('div', { class: 'group' },
      toolRow('calculatorFill', 'orange', tr('Price calculator'), openWhatIfSheet, tr('Your balance at any QUBIC price')),
      toolRow('bookFill', 'blue', tr('Order books'), openOrderBooks, state.prefs.orderBooks ? tr('QUBIC/USDT on Gate.io and MEXC') : tr('QUBIC/USDT on Gate.io and MEXC (off until you turn it on)')),
      toolRow('gridFill', 'indigo', tr('BPP-9000 calls'), openBpp, state.prefs.bpp ? tr('How often Qubic’s network calls Bitcoin’s next hour') : tr('How often Qubic’s network calls Bitcoin’s next hour (off until you turn it on)')),
      toolRow('addressBookFill', 'green', tr('Address book'), openAddressBook, saved ? tr('{count, plural, one {# saved address} other {# saved addresses}}', { count: saved }) : tr('Exchange deposit addresses, friends')),
      signing ? toolRow('signFill', 'purple', tr('Sign a message'), openSignMessage, tr('Prove that you control an address')) : null,
      toolRow('verifyFill', 'teal', tr('Verify a message'), openVerifyMessage, tr('Check a signed message from anyone'))),
  ]);
}

// ── Activity ────────────────────────────────────────────────────────────────
function describeTx(tx, perspective) {
  // perspective: identities owned in the current scope
  const fromOwn = perspective.has(tx.source);
  const toOwn = perspective.has(tx.destination);
  const contract = state.labels.get(tx.destination);
  const destKind = identityKind(tx.destination);
  const isCall = tx.inputType !== 0 || (destKind === 'contract' && !toOwn);
  let dir = fromOwn && toOwn ? 'self' : fromOwn ? 'out' : 'in';
  // Money coming in is received only once it's known to have gone through (see wentThrough); until then it's only a
  // transfer to you. 'in' means the source isn't one of yours, so it never becomes a call below.
  const received = dir === 'in' && wentThrough(tx);
  let title; let counterparty;
  if (isCall && fromOwn) {
    const proc = contract && contract.procedures ? contract.procedures.get(tx.inputType) : null;
    title = contract ? contract.name : tr('Contract call');
    counterparty = proc || (tx.inputType ? tr('Procedure {number}', { number: String(tx.inputType) }) : tr('Transfer to contract'));
    dir = 'call';
  } else if (dir === 'self') {
    title = tr('Between your accounts');
    counterparty = tr('{from} → {to}', { from: partyName(tx.source), to: partyName(tx.destination) });
  } else {
    const other = dir === 'out' ? tx.destination : tx.source;
    title = dir === 'out' ? tr('Sent') : received ? tr('Received') : tr('Transfer to you');
    counterparty = dir === 'out' ? tr('To {name}', { name: partyName(other) }) : tr('From {name}', { name: partyName(other) });
  }
  return { dir, title, counterparty, received };
}

// How a transaction's amount and icon read, in its row and its details. Money coming in reads as received (a plus, a
// green amount, its dollar values, the icon lit green) only once it's known to have gone through (see wentThrough);
// until then it's a plain amount with no dollar value, beside a grey icon. A move between your accounts that isn't
// known to have gone through has no dollar value either (one side may be an address you only watch).
function txLook(tx, info) {
  const doubtful = (info.dir === 'in' || info.dir === 'self') && !wentThrough(tx);
  return {
    sign: tx.amount === 0n || info.dir === 'self' ? '' : info.received ? '+' : info.dir === 'in' ? '' : MINUS,
    credit: info.received,
    valued: tx.amount > 0n && !doubtful,
    type: info.dir === 'in' && !info.received ? 'unconfirmed' : info.dir === 'self' ? 'move' : info.dir,
  };
}

// The state word for a transfer: an in-progress row's note (it stays grey, text/tertiary; the icon's badge carries any
// colour) and the transaction sheet's Status.
const STATUS_TEXT = {
  success: trLater('Confirmed'), failed: trLater('Failed'), executed: trLater('Executed'), 'not-executed': trLater('Not included'),
  waiting: trLater('Pending'), confirming: trLater('Confirming'), broadcasting: trLater('Sending'), signing: trLater('Signing'), unknown: trLater('Unconfirmed'), dismissed: trLater('Checked'),
};
// The other side's logo or avatar, for money in or out.
const txArt = (tx, info) => (info.dir === 'in' || info.dir === 'out' ? partyArt(info.dir === 'in' ? tx.source : tx.destination) : null);

// A row: the type's lit icon, or the other side's logo or avatar with which way it went; a red ✕ when it failed.
// Failed amounts are struck through and the state word stays grey, so the badge is the row's one bit of colour.
// twinOf: the look-alike check (lookalikeOf), for money coming in from an address you don't know: one that resembles
// an address you do is how address poisoning starts (a little dust, so you'll copy it from here later), and says so in
// amber in place of its time. dated: the day in place of the time (a list ordered by amount has no day headings).
function txRow(tx, perspective, twinOf = null, dated = false) {
  const info = describeTx(tx, perspective);
  const look = txLook(tx, info);
  const status = txStatus(tx);
  const failed = status === 'failed';
  // A transfer the archive doesn't report as moved says so instead of its time (see archivedStatus).
  const unconfirmed = status === 'unknown';
  const twin = info.dir === 'in' && twinOf ? twinOf(tx.source) : null;
  const lookalike = Boolean(twin && !twin.self);
  const amountText = tx.amount === 0n ? '0 QUBIC' : qubicText(tx.amount, { sign: look.sign });
  const when = tx.timestamp ? (dated ? fmtDay(tx.timestamp) : fmtTime(tx.timestamp)) : tr('Tick {tick}', { tick: fmtInt(tx.tick) });
  const note = failed ? tr('Failed') : unconfirmed ? tr('Unconfirmed') : lookalike ? tr('Look-alike') : when;
  return h('button', { type: 'button', class: 'row', onClick: () => openTxSheet(tx), 'aria-label': lookalike
    ? tr('{title}, {amount}, {party}, {status, select, failed {failed} unknown {unconfirmed} other {{when}}}, from a look-alike address', { title: info.title, amount: amountText, party: info.counterparty, status, when })
    : tr('{title}, {amount}, {party}, {status, select, failed {failed} unknown {unconfirmed} other {{when}}}', { title: info.title, amount: amountText, party: info.counterparty, status, when }) },
    txLead({ type: look.type, art: txArt(tx, info), failed }),
    h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: info.title }),
      h('div', { class: 'row-sub', text: info.counterparty })),
    h('div', { class: 'row-end' },
      h('div', { class: ['row-amount', look.credit && 'in', failed && 'dim'], text: amountText }),
      h('div', { class: ['row-note', lookalike && !failed && !unconfirmed && 'warn'], text: note })));
}

function pendingRow(p) {
  const acct = accountByIdentity(p.from);
  const failed = p.status === 'failed' || p.status === 'not-executed';
  const sub = !acct ? tr('To {name} · from a removed account', { name: partyName(p.to) })
    : state.selection === 'all' ? tr('To {name} · from {account}', { name: partyName(p.to), account: acct.name }) : tr('To {name}', { name: partyName(p.to) });
  return h('button', { type: 'button', class: 'row', onClick: () => openPendingSheet(p) },
    txLead({ type: 'out', art: partyArt(p.to), failed }),
    h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: tr('Sending') }),
      h('div', { class: 'row-sub', text: sub })),
    h('div', { class: 'row-end' }, h('div', { class: ['row-amount', failed && 'dim'], text: qubicText(p.amount, { sign: MINUS }) }),
      h('div', { class: 'row-note', text: tr(STATUS_TEXT[p.status] || trLater('Unknown')) })));
}

// Activity's parts that outlive a redraw: the heading's slot, the filter bar (09c-activity-view.js; kept, so a search
// being typed keeps its place) and the list under it.
const activityParts = new WeakMap();
// What Activity's filters search (see activitySource) is made from: the accounts in view and the names you gave
// (wallet), their transactions, transfers signed here, address labels, and the settings (the language, which the
// descriptions are in, and labels on or off).
function activitySourceKey() {
  return [versions.wallet, versions.history, versions.pending, versions.labels, versions.prefs].join('|');
}
// Activity's list: what its filters search (above; also the pages read, Load more, and the addresses you've sent to,
// which the look-alike check knows), the filters (versions.filters), and what time changes: the day (Today, Yesterday)
// and how many transfers are in progress (a settled one leaves after two minutes).
function activityKey(day, inProgress) {
  return [activitySourceKey(), versions.filters, day, inProgress].join('|');
}
function renderActivity(el) {
  const scope = scopeAccounts();
  const perspective = new Set(scope.map((a) => a.identity));
  const all = state.selection === 'all';
  let loading = false; let error = null;
  const byHash = new Map();
  for (const a of scope) {
    const d = dataFor(a.identity);
    if (d.historyErr && !d.history) error = d.historyErr;
    if (!d.history) { loading = loading || !d.historyErr; continue; }
    for (const t of d.history) byHash.set(t.hash, t);
  }
  // A transfer signed here stays "In progress" until it settles, even once the archive lists it: its own row says it
  // isn't confirmed and leads to "I've checked it on the explorer", where the archive's row would show only the
  // archive's flag. Settled ones give way to the archive's row once it lists them, and leave after two minutes if it
  // doesn't. One from an account that has left the wallet shows whichever account is on screen: it still blocks that
  // seed, and nothing else leads to it.
  const open = new Set(state.pending.filter(isOpenTransfer).map((p) => p.hash));
  const txs = [...byHash.values()].filter((t) => !open.has(t.hash)).sort((a, b) => b.tick - a.tick);
  const shown = all ? txs.slice(0, 40) : txs;
  const pend = state.pending.filter((p) => (perspective.has(p.from) || perspective.has(p.to) || !accountByIdentity(p.from))
    && p.hash && (open.has(p.hash) || !byHash.has(p.hash)) && (!SETTLED.has(p.status) || Date.now() - (p.resolvedAt || 0) < 120000));
  const acct = currentAccount();
  const d = acct ? dataFor(acct.identity) : null;
  const more = d && d.history && d.history.length < Math.min(d.historyTotal, 10000);
  // The addresses you know, read once for every row's look-alike check (see txRow).
  const ids = knownIdentities();
  const twinOf = (id) => lookalikeOf(id, ids);
  // The filters (09c-activity-view.js), over each account's whole history: described once per change of it or of the
  // language (a search reads the words on screen), then each kind, search and order is a pass over that.
  const view = activityView;
  const masked = hidden();
  const filtered = activityFiltered(view, masked);
  const source = activitySourceFor(activitySourceKey(), () => activitySource(scope, open));
  const list = filtered ? activityList(source, view, { nameOf: partyName, masked }) : null;
  const pendShown = filtered ? pend.filter((p) => activityPendingMatch(p, view, list.words, partyName, masked)) : pend;
  let parts = activityParts.get(el);
  if (!parts) {
    parts = { head: activityHead(), bar: activityBar(changed), list: h('div', { class: 'activity-list arrive-children' }) };
    activityParts.set(el, parts);
    // Only the search/filter controls can hide; transaction rows always remain in the page.
    fill(el, parts.head, parts.bar.el, parts.list);
  }
  updateActivityToggle(el);
  // Nothing read yet to filter: the list waits with its skeleton, and the bar has nothing to say. Nothing matching: the
  // list says so itself, so the line over it is only read out.
  const settling = loading && !source.items.length;
  const summary = filtered && !settling && (list.rows.length || pendShown.length) ? activitySummary(list.totals, masked) : '';
  parts.bar.update({
    open: state.prefs.activityFiltersOpen, present: source.kinds, masked, summary,
    announce: !filtered || settling ? '' : summary || tr('No matching transactions'),
  });
  // Activity: one titled list card per day.
  const addToDay = (groups, t) => {
    const label = t.timestamp ? dayLabel(t.timestamp) : tr('Earlier');
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, rows: [] });
    groups[groups.length - 1].rows.push(txRow(t, perspective, twinOf));
  };
  const days = (groups) => h('div', { class: 'days' }, groups.map((g) => h('section', { class: 'day' }, g.label ? h('h3', { class: 'day-title', text: g.label }) : null, h('div', { class: 'card' }, g.rows))));
  // The list as it always was: the pages read (all accounts: the latest 40), and Load more.
  const plain = () => {
    if (loading && !shown.length && !pend.length) return [h('div', { class: 'card' }, skeletonRows(4))];
    if (error && !shown.length && !pend.length) {
      return [h('div', { class: 'card' }, emptyState('alert', tr('Couldn’t load activity'), messageOf(error),
        button(tr('Try again'), { kind: 'secondary', block: false, small: true, onClick: () => scope.forEach((a) => loadHistory(a)) })))];
    }
    if (!shown.length && !pend.length) {
      const canReceive = acct ? acct.kind === 'seed' : seedAccounts().length > 0;
      return [h('div', { class: 'card' }, emptyState(qoreeFace('content', 40), tr('No transactions yet'), tr('Transfers to and from this address will appear here.'),
        canReceive ? button(tr('Receive QUBIC'), { kind: 'secondary', block: false, small: true, iconName: 'receive', onClick: () => openReceiveSheet() }) : null))];
    }
    const groups = [];
    if (pend.length) groups.push({ label: tr('In progress'), rows: pend.map(pendingRow) });
    for (const t of shown) addToDay(groups, t);
    const foot = more
      ? h('div', { class: 'load-more' }, button(d.loadingMore ? tr('Loading…') : tr('Load more'), { kind: 'secondary', block: false, small: true, disabled: d.loadingMore, onClick: () => loadHistory(acct, { more: true }) }))
      : null;
    return [days(groups),
      foot,
      h('p', { class: 'list-foot', text: all ? tr('Latest activity across all accounts. Select an account for its full history. Contract payouts (e.g. SendMany) change balances but appear only on the explorer.')
        : tr('Contract payouts (e.g. SendMany) change the balance but appear only on the explorer.') })];
  };
  // A filtered list: its matches, 50 at a time. Ordered by amount it's one card, each row dated; by time, a card per day
  // (oldest first too). Short of a whole history, it says how far back it reaches.
  const matches = () => {
    if (settling && !pend.length) return [h('div', { class: 'card' }, skeletonRows(4))];
    const rows = list.rows.slice(0, view.limit);
    if (!rows.length && !pendShown.length) {
      return [h('div', { class: 'card' }, emptyState(qoreeFace('confused', 40), tr('No matching transactions'), view.query.trim() ? tr('Try another name, address or amount.') : null,
        button(tr('Show all'), { kind: 'secondary', block: false, small: true, onClick: () => { resetActivityView(); changed(); } })))];
    }
    const groups = [];
    if (pendShown.length) groups.push({ label: tr('In progress'), rows: pendShown.map(pendingRow) });
    if (AMOUNT_ORDERS.has(list.order)) groups.push({ label: null, rows: rows.map(({ tx }) => txRow(tx, perspective, twinOf, true)) });
    else for (const { tx } of rows) addToDay(groups, tx);
    return [days(groups),
      list.rows.length > rows.length ? h('div', { class: 'load-more' }, button(tr('Show more'), { kind: 'secondary', block: false, small: true, onClick: () => { moreActivity(); changed(); } })) : null,
      source.complete ? null : h('p', { class: 'list-foot', text: tr('{count, plural, one {Covers the latest transaction only.} other {Covers the latest # transactions.}}', { count: source.items.length }) })];
  };
  paintIf(parts.list, activityKey(new Date().toDateString(), pend.length), filtered ? matches : plain);
}

// The desktop layout breakpoint is also used by navigation and Settings.
const WIDE_DASH = window.matchMedia('(min-width: 1024px)');
WIDE_DASH.addEventListener('change', () => changed());
// The filter button is an icon, the same colour open or closed. While the filters are hidden, a dot on it marks a list
// that isn't the default one, and the line that says what's shown (the bar's summary) describes it to a screen reader.
function activityHead() {
  const toggle = h('button', { type: 'button', class: ['chip-btn', 'neutral', 'activity-filter-toggle'], 'aria-controls': 'activity-controls',
    'aria-describedby': 'activity-sum', onClick: () => setPref('activityFiltersOpen', !state.prefs.activityFiltersOpen) }, icon('filter', 16));
  return h('div', { class: 'section-head' }, h('h2', { class: 'section-title', text: tr('Activity') }), toggle);
}
// Update the existing button so toggling with a keyboard doesn't discard its focus.
function updateActivityToggle(el) {
  const toggle = el.querySelector('.activity-filter-toggle');
  if (!toggle) return;
  const open = state.prefs.activityFiltersOpen;
  const label = open ? tr('Hide search and filters') : tr('Show search and filters');
  toggle.classList.toggle('filtered', !open && activityFiltered(activityView, hidden()));
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
}

// ── Network status bar (with the manual refresh) ───────────────────────────
function netBar() {
  const status = h('div', { class: 'net-status' });
  const refresh = h('button', { type: 'button', class: 'net-refresh', 'aria-label': tr('Refresh now'), title: tr('Refresh now'), onClick: () => refreshAll({ manual: true }) }, icon('refresh', 14));
  return {
    el: h('footer', { class: 'netbar' }, status, refresh),
    update() {
      renderNet(status);
      refresh.classList.toggle('spinning', state.refreshing);
      refresh.disabled = state.refreshing;
    },
  };
}

// The network bar: the tick as read, and the clock (live, stalled for some minutes, or updated some time ago).
function netKey(status, bucket, stallMin) {
  return [versions.net, status, bucket, stallMin].join('|');
}
function renderNet(el) {
  const n = state.net;
  const age = n.tickAt ? Date.now() - n.tickAt : Infinity;
  // Answers that keep coming with the same tick are a stall (amber), not "live" (see tickStall); a feed that stops
  // answering shows as an error, as before.
  const stall = tickStall();
  const stallMin = Math.floor(stall / 60000);
  const status = !n.tickAt ? 'connecting' : age < 20000 ? (stall ? 'stalled' : 'live') : n.tickErr ? 'error' : 'stale';
  const bucket = age < 60000 ? Math.floor(age / 5000) : Math.floor(age / 60000) + 100;
  const key = netKey(status, bucket, stallMin);
  const freshness = status === 'live' ? tr('live')
    : status === 'stalled' ? tr('no new tick for {minutes} min', { minutes: stallMin }) : tr('updated {when}', { when: timeAgo(n.tickAt) });
  paintIf(el, key, () => [
    h('span', { class: ['dot', status === 'live' ? 'live' : status === 'error' ? 'err' : 'warn'] }),
    h('span', { text: status === 'connecting' ? tr('Connecting to Qubic mainnet…') : tr('Qubic mainnet') }),
    n.tick ? h('span', { text: '· ' + tr('Tick {tick}', { tick: fmtInt(n.tick) }) }) : null,
    n.epoch ? h('span', { text: '· ' + tr('Epoch {epoch}', { epoch: String(n.epoch) }) }) : null,
    n.tickAt ? h('span', { text: `· ${freshness}` }) : null,
  ]);
}
