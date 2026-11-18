// ═══════════════════════════════════════════════════════════════════════════
// 11. SHEETS: accounts, receive, transaction, settings, messages, encryption (Send: 10a*-send-*.js)
// ═══════════════════════════════════════════════════════════════════════════
// A row's icon, its title and the line under it (when there is one).
function itemText(iconName, title, sub) {
  return [h('span', { class: 'item-icon' }, icon(iconName, 18)),
    h('span', { class: 'item-main' }, h('span', { class: 'item-title', text: title }), sub ? h('span', { class: 'item-sub', text: sub }) : null)];
}
function menuItem(iconName, title, sub, onClick, { disabled = false, danger = false, end = null, chevron = true } = {}) {
  return h('button', { type: 'button', class: ['item', danger && 'danger'], onClick, disabled },
    itemText(iconName, title, sub), h('span', { class: 'item-end' }, end, chevron ? icon('chevronRight', 16) : null));
}
function switchItem(iconName, title, sub, checked, onToggle) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked, 'aria-label': title });
  input.addEventListener('change', () => onToggle(input.checked));
  return h('label', { class: 'item' },
    itemText(iconName, title, sub), h('span', { class: 'switch' }, input, h('span', { class: 'track' }), h('span', { class: 'thumb' })));
}
// A setting with its control on a line of its own.
function choiceItem(iconName, title, sub, control) { return h('div', { class: 'item stack' }, itemText(iconName, title, sub), control); }
function segmented(options, value, onPick, label) {
  const wrap = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  for (const [v, text] of options) {
    const b = h('button', { type: 'button', 'aria-pressed': String(v === value), text, onClick: () => {
      for (const o of wrap.children) o.setAttribute('aria-pressed', String(o === b));
      onPick(v);
    } });
    wrap.append(b);
  }
  return wrap;
}
function balanceLine(a) {
  const d = dataFor(a.identity);
  if (d.balance) return qubicText(d.balance.amount, { compact: true });
  return d.balanceErr ? tr('Balance unavailable') : tr('Loading…');
}
// An account in a from or picker row: avatar, name and the line under it. picked: in a picker, whether it's the one
// chosen (see pickLead).
const accountMain = (a, sub, subCls = 'row-sub', picked = null) => [picked == null ? avatar(a, 'lg') : pickLead(avatar(a, 'lg'), picked),
  h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: a.name }), h('div', { class: subCls, text: sub }))];
const fromSub = (a) => `${shortId(a.identity, 5)} · ${balanceLine(a)}`;
function fromRow(a, onClick, { showBalance = true } = {}) {
  return h('button', { type: 'button', class: 'from-row', onClick, 'aria-label': tr('{name}. Change account', { name: a.name }) },
    accountMain(a, showBalance ? fromSub(a) : shortId(a.identity, 6)), icon('chevronDown', 16));
}

function pickAccount(sheet, { title, accounts, selected, onPick, back }) {
  limited(accounts, 4, loadBalance); // off screen, they're read less often (see heartbeat)
  sheet.setPane([
    h('div', { class: 'picker', role: 'radiogroup', 'aria-label': title },
      accounts.map((a) => h('button', { type: 'button', class: 'from-row', role: 'radio', 'aria-checked': String(a.id === selected), onClick: () => onPick(a) },
        accountMain(a, fromSub(a), 'row-sub', a.id === selected)))),
  ], { title, back, direction: 'forward' });
}

// ── Accounts switcher ───────────────────────────────────────────────────────
// What the list shows: the accounts, the one in view, names and avatars, their balances, the price, and the settings
// (hidden balances, the price unit).
function accountsKey() {
  return [versions.wallet, versions.balances, versions.market, versions.prefs].join('|');
}
function openAccountsSheet() {
  const sheet = openSheet({ title: tr('Accounts') });
  limited(state.accounts, 4, loadBalance); // off screen, they're read less often (see heartbeat)
  const list = h('div', { class: 'card' });
  const paintList = () => {
    const p = priceInfo();
    const all = scopeBalance(state.accounts); const complete = all.loaded === all.count;
    paintIf(list, accountsKey(), () => {
      const rows = [];
      const row = (id, lead, title, sub, amount, onManage) => h('div', { class: 'row acct-row' },
        h('button', { type: 'button', class: 'acct-pick', 'aria-current': state.selection === id ? 'true' : null, onClick: () => { sheet.close(); switchScope(id); } },
          pickLead(lead, state.selection === id),
          h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, title), h('div', { class: 'row-sub', text: sub })),
          h('div', { class: 'row-end' }, h('div', { class: 'row-amount', text: amount.main }), amount.note ? h('div', { class: 'row-note', text: amount.note }) : null)),
        onManage ? iconButton('pencil', tr('Manage {name}', { name: Array.isArray(title) ? title[0] : title }), onManage) : h('span', { class: 'acct-spacer' }));
      if (state.accounts.length > 1) {
        const usd = complete && p ? qubicToUsd(all.total, p.price) : null;
        rows.push(row('all', h('div', { class: 'stack-avatar lg' }, icon('layers', 18)), tr('All accounts'), tr('{count, plural, one {# account} other {# accounts}}', { count: state.accounts.length }),
          { main: complete ? (hidden() ? MASK : fmtCompact(all.total)) : all.ready ? '—' : '…', note: usd != null ? usdText(usd) : '' }, null));
      }
      for (const a of state.accounts) {
        const d = dataFor(a.identity);
        const usd = d.balance && p ? qubicToUsd(d.balance.amount, p.price) : null;
        rows.push(row(a.id, avatar(a, 'lg'), [a.name, a.kind === 'watch' ? ' ' : null, a.kind === 'watch' ? badge(tr('Watch')) : null], shortId(a.identity, 5),
          { main: d.balance ? (hidden() ? MASK : fmtCompact(d.balance.amount)) : d.balanceErr ? '—' : '…', note: usd != null ? usdText(usd) : '' },
          () => accountDetailPane(sheet, a.id, () => showList('back'))));
      }
      return rows;
    });
  };
  // Keyboard, on the list: ↑ ↓ move between accounts (Enter picks), 1–9 and 0 pick straight away.
  sheet.panel.addEventListener('keydown', (e) => {
    if (!list.isConnected || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return;
    const picks = [...list.querySelectorAll('.acct-pick')];
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && picks.length) {
      e.preventDefault();
      const at = picks.indexOf(document.activeElement);
      const from = at >= 0 ? at : picks.findIndex((b) => b.getAttribute('aria-current') === 'true');
      picks[clamp(from + (e.key === 'ArrowDown' ? 1 : -1), 0, picks.length - 1)].focus();
      return;
    }
    const target = !e.repeat && /^[0-9]$/.test(e.key) ? scopeForKey(e.key) : null;
    if (target != null) { e.preventDefault(); sheet.close(); switchScope(target, { fast: true }); }
  });
  const showList = (direction = null) => {
    renderKeys.delete(list);
    paintList();
    sheet.setPane([list, state.accounts.length > 1 ? h('p', { class: 'fine kbd-hint', text: tr('Keyboard: ← → switch accounts from the main screen · 1–9 pick one · 0 all accounts') }) : null], {
      title: tr('Accounts'), direction,
      footer: [button(tr('Add account'), { kind: 'secondary', iconName: 'plus', disabled: state.accounts.length >= MAX_ACCOUNTS, onClick: () => addAccountPane(sheet, () => showList('back')) })],
    });
  };
  showList();
  sheet.onCleanup(subscribe(paintList));
}

function addAccountPane(sheet, back) {
  const blocked = !canSign();
  sheet.setPane([
    h('div', { class: 'group' },
      menuItem('sparkle', tr('Create a new account'), tr('Generate a fresh seed on this device'), () => { sheet.close(); startCreate(true); }, { disabled: blocked }),
      menuItem('key', tr('Import a seed'), tr('Add an account you already own'), () => { sheet.close(); showImport(true); }, { disabled: blocked }),
      menuItem('eye', tr('Watch an address'), tr('Follow any address without its seed'), () => { sheet.close(); showWatch(true); })),
    selfTestBlocker(),
    state.mode === 'vault' ? h('p', { class: 'fine', text: tr('New accounts are added to your encrypted wallet on this device.') })
      : h('p', { class: 'fine', text: tr('Session only: new accounts are forgotten when you close this tab.') }),
  ], { title: tr('Add account'), back, direction: 'forward' });
}

// ── Receive ─────────────────────────────────────────────────────────────────
// Receive: into an account this wallet can spend from (watch-only addresses aren't offered).
function openReceiveSheet() {
  const own = seedAccounts();
  const shown = currentAccount();
  let acct = shown && shown.kind === 'seed' ? shown : own[0];
  if (!acct) return;
  const sheet = openSheet({ title: tr('Receive') });
  const render = (direction = null) => {
    const share = navigator.share
      ? button(tr('Share'), { kind: 'secondary', iconName: 'share', onClick: async () => { try { await navigator.share({ text: acct.identity }); } catch { /* dismissed */ } } })
      : null;
    sheet.setPane([
      own.length > 1 ? fromRow(acct, () => pickAccount(sheet, {
        title: tr('Receive to'), accounts: own, selected: acct.id,
        onPick: (a) => { acct = a; render('back'); }, back: () => render('back'),
      }), { showBalance: false }) : null,
      h('div', { class: 'qr-wrap' }, h('div', { class: 'qr' }, qrSvg(acct.identity)), h('div', { class: 'receive-address' }, addressText(acct.identity, 'lg'))),
      notice('info', 'info', null, tr('Send only QUBIC or Qubic assets to this address. Qubic transfers carry no network fee.')),
    ], { title: tr('Receive'), direction, footer: [button(tr('Copy address'), { iconName: 'copy', onClick: () => copyWithToast(acct.identity, tr('Address copied')) }), share] });
  };
  render();
}

// ── Transaction detail ──────────────────────────────────────────────────────
// From and To in two lines: the label, with the name (and its logo or avatar) on the right when there is one; then the
// address, as much of it as the line holds, followed by copy and explorer.
// An address you could save (not yours, not saved yet) also gets "Add to address book"; once saved, the block shows
// its new name. A look-alike (see openTxSheet) asks before it's copied.
function partyBlock(identity, key, { lookalike = false } = {}) {
  const lab = labelFor(identity);
  const art = partyArt(identity);
  const save = canSaveContact(identity) ? h('button', {
    type: 'button', class: 'tool-ic', 'aria-label': tr('Add to address book'), title: tr('Add to address book'),
    onClick: () => openSaveContact(identity, () => block.replaceWith(partyBlock(identity, key))),
  }, icon('userPlus', 16)) : null;
  const block = h('div', { class: 'cparty' },
    h('div', { class: 'cparty-top' }, h('span', { class: 'cparty-k', text: key }),
      lab ? h('span', { class: 'cparty-who' }, art ? txLead({ art, withBadge: false }) : null, h('span', { class: 'cparty-name', text: lab.name })) : null),
    h('div', { class: 'cparty-line' }, addressPeek(identity),
      lookalike ? lineTools(save, guardedCopy(identity), explorerLink('address', identity, tr('View address on explorer'), { iconOnly: true }))
        : addressTools(identity, save)));
  return block;
}
// Copy for a look-alike address: asked first, as saving one is (see saveAnyway).
function guardedCopy(identity) {
  return h('button', { type: 'button', class: 'tool-ic', 'aria-label': tr('Copy address'), title: tr('Copy address'), onClick: async () => {
    const ok = await confirmDialog({ title: tr('Copy this address?'), danger: true, confirmLabel: tr('Copy anyway'),
      message: tr('It looks like an address you know, but it’s a different one. Scammers send from look-alikes so you’ll copy theirs.') });
    if (ok) copyWithToast(identity, tr('Address copied'));
  } }, icon('copy', 16));
}

// A full-height sheet: the icon (lit in the type's colour, grey for money in not known to have moved, or the other
// side's logo or avatar), the amount, who it was with; the date and status lead the facts. As it opens, the light
// leaves the icon for the top corners, the icon arrives with a halo, and everything else comes into focus. The amount
// moves into the header once it scrolls under it.
function openTxSheet(tx) {
  const sheet = openSheet({ title: tr('Transaction'), full: true });
  const perspective = new Set(scopeAccounts().map((a) => a.identity));
  const info = describeTx(tx, perspective);
  // Money coming in that isn't known to have moved: no plus, no green, no dollar value, a grey icon (see txLook).
  const look = txLook(tx, info);
  const status = txStatus(tx);
  const p = priceInfo();
  const usd = p && look.valued ? qubicToUsd(tx.amount, p.price) : null;
  const contract = state.labels.get(tx.destination);
  const proc = contract && contract.procedures ? contract.procedures.get(tx.inputType) : null;
  // Core ignores the input type at an address that isn't a smart contract: whatever its type, that's a plain transfer.
  const typeText = identityKind(tx.destination) !== 'contract' ? tr('QUBIC transfer') : tx.inputType === 0 ? tr('Transfer to a smart contract')
    : proc ? `${contract.name} · ${proc}` : contract ? tr('{contract} · procedure {inputType}', { contract: contract.name, inputType: String(tx.inputType) })
      : tr('Contract · procedure {inputType}', { inputType: String(tx.inputType) });
  const amountFull = `${look.sign}${fmtInt(tx.amount)} QUBIC`;
  const amountText = hidden() ? MASK : amountFull;
  const incoming = look.credit;
  const type = look.type;
  const art = txArt(tx, info);
  const lead = txLead({ type, art, failed: status === 'failed', big: true });
  const rgb = lightRgb(type, art);
  const halo = h('i', { class: 'lt-halo', 'aria-hidden': 'true' });
  halo.style.setProperty('--hc', `rgb(${rgb})`);
  const amt = h('p', { class: ['amt', incoming && 'in', status === 'failed' && 'struck', amountSize(amountFull)], text: amountText });
  const whoText = (d) => (d.dir === 'call' ? `${d.title} · ${d.counterparty}` : d.counterparty);
  const who = h('p', { class: 'who', text: whoText(info) });
  const head = h('button', { type: 'button', class: ['head-amount', incoming && 'in'], text: amountText, 'aria-label': tr('{title}, {amount}. Back to top', { title: info.title, amount: amountText }),
    onClick: () => sheet.body.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }) });
  sheet.titleWrap.append(head);
  // "Value when sent": CoinGecko's price for that hour (that day, if older than 90 days); before CoinGecko's free
  // year, Gate.io's close for that day.
  const thenLabel = info.dir === 'out' ? tr('Value when sent') : info.dir === 'in' ? tr('Value when received') : tr('Value at the time');
  const showThen = state.prefs.marketData && tx.timestamp && look.valued && !hidden();
  const thenValue = h('span', { class: 'sk sk-line sk-amt', 'aria-label': tr('Loading') });
  if (showThen) {
    const alive = sessionGuard();
    priceAt(tx.timestamp).then((at) => {
      if (!alive()) return;
      if (!at) { thenValue.closest('.kv-row')?.remove(); return; }
      thenValue.className = '';
      thenValue.removeAttribute('aria-label');
      thenValue.textContent = `≈ ${fmtUsd(qubicToUsd(tx.amount, at.price))}`;
    });
  }
  // Money in from a look-alike of an address you know (see txRow): said first, and its address asks before it's copied.
  const twin = info.dir === 'in' ? lookalikeOf(tx.source) : null;
  const lookalike = Boolean(twin && !twin.self);
  const facts = kv([
    tx.timestamp ? [tr('Date'), fmtDateTime(tx.timestamp)] : null,
    [tr('Status'), tr(STATUS_TEXT[status])],
    showThen ? [thenLabel, thenValue] : null,
    usd != null && !hidden() ? [tr('Value today'), `≈ ${fmtUsd(usd)}`] : null,
    [tr('From'), partyBlock(tx.source, tr('From'), { lookalike }), { whole: true }],
    [tr('To'), partyBlock(tx.destination, tr('To')), { whole: true }],
    [tr('Type'), typeText],
    [tr('Tick'), explorerLink('tick', tx.tick, `#${fmtInt(tx.tick)}`)],
    tx.inputType ? [tr('Input'), tr('Type {inputType} · {count, plural, one {{size} byte} other {{size} bytes}}', { inputType: String(tx.inputType), count: tx.inputSize, size: String(tx.inputSize) })] : null,
    [tr('Transaction ID'), h('div', { class: 'party' }, lineTools(copyTool(tx.hash, { label: tr('Copy transaction ID'), done: tr('Transaction ID copied') })), h('div', { class: 'mono', text: tx.hash })), { stack: true }],
  ]);
  const explorer = h('a', { class: 'btn btn-secondary btn-block', href: `${EXPLORER}/tx/${tx.hash}`, target: '_blank', rel: 'noopener noreferrer' },
    icon('globe', 18), h('span', { text: tr('View on Qubic Explorer') }));
  // Unconfirmed: what the archive's flag does and doesn't show, before anyone pays, counts it as paid or asks for it
  // again. A contract call it flags as not moved may have had its QUBIC sent back.
  const doubtTail = info.dir === 'in' ? tr('Check your balance before you count it as paid or ask for it again.')
    : info.dir === 'call' ? tr('The contract may have sent it back. Check it on the explorer before calling again.')
      : tr('Before sending it again, check whether it arrived.');
  const doubt = status !== 'unknown' ? null : notice('warn', 'alert', null, tx.moneyFlew === false
    ? tr('The network archive marks this transfer as not moved, but it uses the same mark when it has no status for one, so this wallet can’t tell whether it went through. {advice}', { advice: doubtTail })
    : tr('The network archive doesn’t say whether this transfer moved its QUBIC. {advice}', { advice: doubtTail }));
  const poison = lookalike ? notice('warn', 'alert', tr('Look-alike address'), lookalikeText(twin)) : null;
  // Sent from one of your seed accounts: the same address again, from the same account (the checks all run again).
  const sender = info.dir === 'out' ? accountByIdentity(tx.source) : null;
  const again = sender && sender.kind === 'seed' && canSign()
    ? button(tr('Send again'), { kind: 'secondary', iconName: 'send', onClick: () => { sheet.close(); openSendSheet({ to: tx.destination, fromId: sender.id }); } }) : null;
  sheet.setPane([h('div', { class: 'dhero' }, halo, lead, amt, who), poison, doubt, facts], { footer: [again, explorer] });
  const stopLight = detailLight(sheet, rgb, lead);
  iconArrival(lead, halo);
  focusIn([amt, who, poison, doubt, facts, sheet.titleWrap, again, explorer].filter(Boolean));
  const motion = numberToHeader({ scroller: sheet.body, bar: () => sheet.top.getBoundingClientRect().bottom, number: amt, slot: head, hide: sheet.titleEl });
  // Saving the other side to the address book (from this sheet or elsewhere) renames it here too.
  const unsubscribe = subscribe(() => {
    const text = whoText(describeTx(tx, perspective));
    if (who.textContent !== text) who.textContent = text;
  });
  sheet.onCleanup(() => { motion.destroy(); stopLight(); unsubscribe(); });
}

// ── Settings ────────────────────────────────────────────────────────────────
// The topics, in groups: [icon, title, pane, what to show at the row's end].
function settingsTopics() {
  const failed = state.selfTest.status === 'fail';
  return [
    [['palette', tr('Appearance'), appearancePane], ['wallet', tr('Accounts'), accountsPane], ['shield', tr('Security'), securityPane], ['globe', tr('Network & data'), networkDataPane]],
    [['info', tr('About'), aboutPane, failed ? badge(tr('Self-test failed'), 'err') : null]],
    [['heart', tr('Support qoree'), supportPane]],
  ];
}
// Wide enough for the topics to stay in a column beside the chosen one; narrower, Settings is a menu of pages.
const SETTINGS_SPLIT = '(min-width: 840px)';
// The topic opened last, so a wide screen's Settings opens there again (this session only).
let settingsTopic = 0;
// at 'language': open at Appearance → Language (after the language was switched there, see setLanguage).
function openSettings(at = null) {
  // Phones and tablets: Settings is a tab of the dashboard (see DASH_TABS), which this goes to.
  if (dashTabs && dashTabs.settings(at)) return;
  const sheet = openSheet({ title: tr('Settings') });
  const split = window.matchMedia(SETTINGS_SPLIT);
  const layout = () => (split.matches ? settingsSplit(sheet) : settingsRoot(sheet));
  split.addEventListener('change', layout);
  sheet.onCleanup(() => split.removeEventListener('change', layout));
  if (at === 'language') settingsTopic = 0;
  layout();
  if (at === 'language') {
    const toTopics = split.matches ? null : () => settingsRoot(sheet, 'back');
    languagePane(sheet, () => appearancePane(sheet, toTopics, 'back'), null);
  }
}

// Settings: a short menu, one row per topic; each opens its own page, and Back returns here.
function settingsRoot(sheet, direction = null) {
  const back = () => settingsRoot(sheet, 'back');
  const groups = settingsTopics();
  const topics = groups.flat();
  sheet.setNav(null);
  sheet.setPane(groups.map((group) => h('div', { class: 'group' }, group.map((topic) => {
    const [name, title, pane, end] = topic;
    return menuItem(name, title, null, () => { settingsTopic = topics.indexOf(topic); pane(sheet, back); }, { end });
  }))), { title: tr('Settings'), direction });
}

// Wide screens: the topics in a column on the left and the chosen one beside it, with no Back to the menu; a topic's
// own pages open in its place, with Back as usual. Picking the topic again returns to its first page.
function settingsSplit(sheet) {
  const groups = settingsTopics();
  const topics = groups.flat();
  const rows = new Map();
  const pick = (topic, direction) => {
    settingsTopic = topics.indexOf(topic);
    for (const [t, row] of rows) { if (t === topic) row.setAttribute('aria-current', 'page'); else row.removeAttribute('aria-current'); }
    topic[2](sheet, null, direction);
  };
  sheet.setNav(h('nav', { class: 'sheet-nav', 'aria-label': tr('Settings') },
    h('div', { class: 'sheet-nav-title', text: tr('Settings') }),
    groups.map((group) => h('div', { class: 'nav-group' }, group.map((topic) => {
      const [name, title, , end] = topic;
      const row = h('button', { type: 'button', class: 'nav-item', onClick: () => pick(topic, topics.indexOf(topic) === settingsTopic ? null : 'swap') },
        icon(name, 18), h('span', { text: title }), end || null);
      rows.set(topic, row);
      return row;
    })))));
  pick(topics[settingsTopic] || topics[0], null);
}

// A tip for qoree's development: pick dollars, see what that is in QUBIC at the current price, and continue to the
// usual Send form with the address and amount filled in, where everything still applies (the account, Review, hold
// to send). Without a price the amount is chosen there, in QUBIC; without a way to send, the address can be copied.
function supportPane(sheet, back, direction = 'forward') {
  const p = priceInfo();
  const why = signBlocked() || (seedAccounts().length ? null : tr('Sending needs an account with its seed.'));
  let pick = String(TIP_USD[1]);
  const custom = h('input', { type: 'text', class: 'input', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done',
    placeholder: tr('Amount in US dollars'), 'aria-label': tr('Amount in US dollars'), hidden: true });
  const worth = h('p', { class: 'hint', 'aria-live': 'polite' });
  const amount = () => {
    const usd = pick === 'other' ? parseDecimalInput(custom.value) : Number(pick);
    return p ? usdToQubic(usd, p.price) : null;
  };
  const go = button(tr('Continue'), { onClick: () => { const a = amount(); sheet.close(); openSendSheet({ to: DONATION_ADDRESS, amount: a }); } });
  const update = () => {
    custom.hidden = pick !== 'other';
    const a = amount();
    worth.textContent = !p ? tr('The QUBIC price isn’t available right now, so you’ll enter the amount in QUBIC.')
      : a ? (perBillion() ? tr('{amount} QUBIC at {price} per billion QUBIC', { amount: fmtInt(a), price: priceText(p.price) })
        : tr('{amount} QUBIC at {price} per QUBIC', { amount: fmtInt(a), price: priceText(p.price) })) : tr('Enter an amount in dollars.');
    go.disabled = Boolean(why) || Boolean(p && !a);
  };
  custom.addEventListener('input', update);
  sheet.setPane([
    h('p', { class: 'sheet-lead', text: tr('qoree is free, with no fees and no ads. If it’s useful to you, a tip in QUBIC helps keep it going.') }),
    p ? segmented([...TIP_USD.map((v) => [String(v), fmtUsd(v, { whole: true })]), ['other', tr('Other')]], pick, (v) => { pick = v; update(); if (v === 'other') custom.focus(); }, tr('Tip amount')) : null,
    custom,
    worth,
    kv([addressRow(DONATION_ADDRESS)]),
    why ? notice('info', 'info', null, tr('{reason} You can still send a tip from another wallet to this address.', { reason: why })) : null,
  ], { title: tr('Support qoree'), back, direction, footer: [go] });
  update();
}

function appearancePane(sheet, back, direction = 'forward') {
  sheet.setPane([
    h('div', { class: 'group' },
      menuItem('globe', tr('Language'), lang.name, () => languagePane(sheet, () => appearancePane(sheet, back, 'back')))),
    h('div', { class: 'group' },
      choiceItem('sun', tr('Theme'), null,
        segmented([['dark', tr('Dark')], ['light', tr('Light')], ['system', tr('System')]], state.prefs.theme, (v) => { setPref('theme', v); applyTheme(); }, tr('Theme'))),
      choiceItem('layers', tr('Grays'), tr('The tint of backgrounds and text.'),
        segmented([['warm', tr('Warm')], ['neutral', tr('Neutral')]], state.prefs.grays, (v) => { setPref('grays', v); applyTheme(); }, tr('Grays'))),
      accentItem(),
      choiceItem('chart', tr('QUBIC price'), tr('Show the price per coin or per billion coins.'),
        segmented([['unit', tr('Per QUBIC')], ['billion', tr('Per billion')]], state.prefs.priceUnit, (v) => setPref('priceUnit', v), tr('QUBIC price'))),
      switchItem('eyeOff', tr('Hide balances'), tr('Mask amounts on screen'), state.prefs.privacy, (v) => setPref('privacy', v))),
  ], { title: tr('Appearance'), back, direction });
}

function accountsPane(sheet, back, direction = 'forward') {
  const here = () => accountsPane(sheet, back, 'back');
  sheet.setPane([
    h('div', { class: 'group' },
      state.accounts.map((a) => h('button', { type: 'button', class: 'item', onClick: () => accountDetailPane(sheet, a.id, here) },
        avatar(a),
        h('span', { class: 'item-main' }, h('span', { class: 'item-title', text: a.name }), h('span', { class: 'item-sub mono', text: shortId(a.identity, 6) })),
        h('span', { class: 'item-end' }, a.kind === 'watch' ? badge(tr('Watch')) : null, icon('chevronRight', 16)))),
      menuItem('plus', tr('Add account'), null, () => addAccountPane(sheet, here), { disabled: state.accounts.length >= MAX_ACCOUNTS })),
  ], { title: tr('Accounts'), back, direction });
}

// Erase, End session and Stop remembering forget unsettled transfers with everything else (at once, or when the tab
// closes); none of them can cancel a transfer already sent, so their confirmation says when one is open.
function openTransfersNote() {
  if (state.journalProblem) return tr('Unsettled transfers couldn’t be read. This won’t cancel any: check your recent transfers on the explorer before sending again.');
  const n = state.pending.filter(isOpenTransfer).length;
  if (!n) return '';
  return tr('{count, plural, one {A transfer you sent hasn’t settled yet. This won’t cancel it: it may have gone through already or still may, so check the explorer before sending it again.} '
    + 'other {# transfers you sent haven’t settled yet. This won’t cancel them: they may have gone through already or still may, so check the explorer before sending them again.}}', { count: n });
}

function securityPane(sheet, back, direction = 'forward') {
  const vault = state.mode === 'vault';
  const here = () => securityPane(sheet, back, 'back');
  const lockNote = () => tr('Argon2id (64 MiB) + AES-256-GCM. Locks after {minutes} min idle.', { minutes: state.prefs.autoLockMinutes });
  const status = h('span', { class: 'item-sub', text: vault ? lockNote() : tr('Nothing is saved. Closing this tab forgets the wallet.') });
  sheet.setPane([
    h('div', { class: 'group' },
      h('div', { class: 'item' }, h('span', { class: 'item-icon' }, icon(vault ? 'databaseLock' : 'clock', 18)),
        h('span', { class: 'item-main' },
          h('span', { class: 'item-title', text: vault ? tr('Encrypted on this device') : tr('Session only') }),
          status)),
      !vault && secureStorageSupported() ? menuItem('shield', tr('Encrypt & remember on this device'), tr('Protect with a password and keep it in this browser'), () => enableEncryptionPane(sheet, here)) : null,
      vault ? menuItem('key', tr('Change password'), null, () => changePasswordPane(sheet, here)) : null,
      menuItem('shield', tr('Encrypted backup'), tr('Download or check a password-protected backup file'), () => backupPane(sheet, here)),
      vault ? choiceItem('hourglass', tr('Auto-lock'), tr('Lock after this long without activity.'),
        segmented(AUTO_LOCK_CHOICES.map((m) => [m, tr('{minutes}m', { minutes: m })]), state.prefs.autoLockMinutes, (v) => { setPref('autoLockMinutes', v); status.textContent = lockNote(); }, tr('Auto-lock delay'))) : null,
      vault ? switchItem('refresh', tr('Stay unlocked on reload'), tr('Off by default. When on, reloading this tab reopens the wallet without the password until it auto-locks, so anyone with this browser can too. Takes effect at your next unlock.'), state.prefs.resumeOnReload, (v) => {
        setPref('resumeOnReload', v);
        if (v) toast(tr('Takes effect the next time you unlock'), 'info'); else Resume.clear();
      }) : null,
      vault ? menuItem('lock', tr('Lock now'), null, () => lockWallet(tr('Wallet locked')), { chevron: false }) : null),
    h('div', { class: 'group' },
      vault ? menuItem('databaseMinus', tr('Stop remembering on this device'), tr('Delete the encrypted copy; keep using it this session'), async () => {
        const ok = await confirmDialog({ title: tr('Stop remembering?'), message: joinSentences(tr('The encrypted wallet will be deleted from this browser. You can keep using it until you close the tab; after that you’ll need your seeds.'), openTransfersNote()), confirmLabel: tr('Delete saved copy'), danger: true });
        if (!ok) return;
        const alive = sessionGuard();
        await eraseStored();
        if (!alive()) return;
        Resume.purge();
        if (!Vault.absent()) { toast(tr('This browser didn’t delete the saved copy. Clear this site’s data in the browser’s settings to remove it.'), 'err', 8000); return; }
        state.vault = null; state.mode = 'session'; sessionNoticeDismissed = false;
        toast(tr('Saved copy deleted. Session only now.'), 'info'); changed(); securityPane(sheet, back, null);
      }, { chevron: false }) : null,
      menuItem('trash', vault ? tr('Erase wallet from this browser') : tr('End session & forget wallet'),
        vault ? tr('Removes the encrypted data. Restore only with your seeds.') : tr('Clears every seed from memory now.'), async () => {
          const ok = await confirmDialog({
            title: vault ? tr('Erase this wallet?') : tr('End this session?'),
            message: joinSentences(vault ? tr('All encrypted data in this browser will be deleted. Without your written seeds, access to the funds is lost for good.')
              : tr('Every seed will be cleared from memory. Without your written seeds, access to the funds is lost for good.'), openTransfersNote()),
            confirmLabel: vault ? tr('Erase wallet') : tr('End session'), danger: true, requireText: vault ? trLater('ERASE') : null,
          });
          if (!ok) return;
          // Erase reports success only once the saved copy is verifiably gone (a failure is reported by it).
          if (vault) { if (await forgetEverything()) toast(tr('Wallet erased from this browser'), 'info'); return; }
          endSession();
          toast(tr('Session ended. Seeds cleared from memory.'), 'info');
        }, { danger: true, chevron: false })),
  ], { title: tr('Security'), back, direction });
}

function networkDataPane(sheet, back, direction = 'forward') {
  sheet.setPane([
    h('div', { class: 'group' },
      choiceItem('clock', tr('Target tick offset'), tr('How many ticks ahead a transfer is scheduled. Larger is safer on slow connections.'),
        segmented(TICK_OFFSETS.map((t) => [t, `+${t}`]), state.prefs.tickOffset, (v) => setPref('tickOffset', v), tr('Target tick offset'))),
      switchItem('chart', tr('Market data'), tr('Prices, 24h change and chart from CoinGecko; daily prices older than a year from Gate.io. Off: the Qubic RPC price only.'), state.prefs.marketData, (v) => {
        setPref('marketData', v);
        if (v) { loadMarket(); loadChart(); } else { state.market.cg = null; state.market.chart = null; changed(); }
      }),
      switchItem('tag', tr('Address labels'), tr('Official contract and exchange names from static.qubic.org.'), state.prefs.labels, (v) => {
        setPref('labels', v);
        if (v) loadLabels(); else { state.labels = new Map(); state.labelsLoaded = false; changed(); }
      }),
      switchItem('book', tr('Exchange order books'), tr('QUBIC/USDT books from Gate.io and MEXC, loaded only while you look at them (Tools → Order books). Those exchanges see this device’s IP address.'), state.prefs.orderBooks, (v) => setPref('orderBooks', v)),
      switchItem('grid', tr('BPP-9000 calls'), tr('BPP-9000’s calls on Bitcoin’s next hour from the Jetski ANN Explorer, loaded only while you look at them (Tools → BPP-9000 calls). The explorer sees this device’s IP address.'), state.prefs.bpp, (v) => setPref('bpp', v)),
      switchItem('transfer', tr('Exchange status'), tr('A note when Gate.io pauses QUBIC deposits or withdrawals, checked every 10 minutes. Gate.io sees this device’s IP address.'), state.prefs.exchangeStatus, (v) => {
        setPref('exchangeStatus', v);
        if (v) loadExchangeStatus(); else { state.exchanges = { gate: null }; changed(); }
      }),
      menuItem('globe', tr('Network status'), null, () => networkPane(sheet, () => networkDataPane(sheet, back, 'back')))),
  ], { title: tr('Network & data'), back, direction });
}

function aboutPane(sheet, back, direction = 'forward') {
  const st = state.selfTest;
  const here = () => aboutPane(sheet, back, 'back');
  sheet.setPane([
    h('div', { class: 'group' },
      menuItem('shield', tr('Security self-test'), null, () => selfTestPane(sheet, here),
        { end: badge(st.status === 'pass' ? tr('Passed') : st.status === 'fail' ? tr('Failed') : tr('Running'), st.status === 'pass' ? 'ok' : st.status === 'fail' ? 'err' : 'warn') }),
      menuItem('info', tr('What’s implemented'), null, () => implementationPane(sheet, here)),
      h('div', { class: 'item' }, itemText('sparkle', tr('Version')), h('span', { class: 'item-end', text: APP_VERSION }))),
  ], { title: tr('About'), back, direction });
}

// Accent colour: the presets as swatches, then any colour from the system colour picker (the rainbow swatch, which
// shows the picked colour once there is one). Previews live while picking; applies at once and is remembered.
function accentItem() {
  const label = () => (state.prefs.accent === 'custom' && state.prefs.accentCustom ? tr('Custom · {color}', { color: state.prefs.accentCustom.toUpperCase() })
    : tr((ACCENTS.find((a) => a.id === state.prefs.accent) || ACCENTS[0]).name));
  const sub = h('span', { class: 'item-sub', text: label() });
  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': tr('Accent color') });
  const custom = h('button', { type: 'button', class: 'swatch custom', role: 'radio', title: tr('Any color'), 'aria-label': tr('Custom color'), dataset: { accent: 'custom' } });
  const showCustom = () => {
    custom.classList.toggle('has-colour', Boolean(state.prefs.accentCustom));
    if (state.prefs.accentCustom) custom.style.setProperty('--custom', state.prefs.accentCustom);
  };
  const mark = () => {
    for (const s of swatches.children) s.setAttribute('aria-checked', String(s.dataset.accent === state.prefs.accent));
    sub.textContent = label();
    showCustom();
  };
  const choose = (patch) => {
    setPref('accentChosen', true);
    for (const [k, v] of Object.entries(patch)) setPref(k, v);
    applyTheme();
    mark();
  };
  for (const a of ACCENTS) {
    const sw = h('button', {
      type: 'button', class: 'swatch', role: 'radio', title: tr(a.name), 'aria-label': tr(a.name), dataset: { accent: a.id },
      onClick: () => choose({ accent: a.id }),
    });
    sw.style.background = a.fill;
    swatches.append(sw);
  }
  const shown = ACCENTS.find((a) => a.id === state.prefs.accent);
  const picker = h('input', { type: 'color', class: 'color-input', tabindex: '-1', 'aria-hidden': 'true', value: state.prefs.accentCustom || (shown || ACCENTS[0]).fill.toLowerCase() });
  picker.addEventListener('input', () => applyTheme(picker.value));
  picker.addEventListener('change', () => choose({ accentCustom: picker.value.toLowerCase(), accent: 'custom' }));
  custom.addEventListener('click', () => {
    if (state.prefs.accentCustom && state.prefs.accent !== 'custom') { choose({ accent: 'custom' }); return; }
    try { picker.showPicker(); } catch { picker.click(); }
  });
  swatches.append(custom);
  mark();
  return h('div', { class: 'item stack' }, h('span', { class: 'item-icon' }, icon('palette', 18)),
    h('span', { class: 'item-main' }, h('span', { class: 'item-title', text: tr('Accent color') }), sub), swatches, picker);
}

// A name with its Save button (Enter saves too): saved, then the pane is drawn again with it; a failed save says why.
function nameField(value, label, rename, redraw) {
  const input = h('input', { class: 'input', maxlength: '32', autocomplete: 'off', 'aria-label': label, value, 'data-1p-ignore': '', 'data-lpignore': 'true' });
  const save = button(tr('Save'), { kind: 'secondary', block: false, small: true, onClick: async () => {
    try {
      await rename(input.value);
      toast(tr('Name saved'));
      if (state.phase === 'ready') redraw();
    } catch (e) { toast(messageOf(e), 'err'); }
  } });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
  return h('div', { class: 'field' }, h('label', { class: 'field-label', text: tr('Name') }), h('div', { class: 'name-row' }, input, save));
}

function accountDetailPane(sheet, id, back, direction = 'forward') {
  const a = accountById(id);
  if (!a) { back(); return; }
  let open = true; sheet.onPaneLeave(() => { open = false; }); // a rename that lands after you left mustn't bring this pane back
  const pickAvatar = () => avatarPane(sheet, id, () => accountDetailPane(sheet, id, back, 'back'));
  sheet.setPane([
    h('div', { class: 'sheet-center' },
      h('button', { type: 'button', class: 'avatar-edit', 'aria-label': tr('Change avatar'), title: tr('Change avatar'), onClick: pickAvatar },
        avatar(a, 'xl'), h('span', { class: 'avatar-edit-badge', 'aria-hidden': 'true' }, icon('pencil', 12))),
      h('div', { class: 'status-title', text: a.name }),
      a.kind === 'watch' ? badge(tr('Watch-only')) : badge(tr('Seed on this device'), 'accent')),
    nameField(a.name, tr('Account name'), (v) => renameAccount(a.id, v), () => { if (open) accountDetailPane(sheet, id, back, null); }),
    kv([
      addressRow(a.identity),
      [tr('Type'), a.kind === 'watch' ? tr('Watch-only (no seed)') : tr('Seed account')],
      [tr('Added'), fmtDay(a.createdAt)],
    ]),
    h('div', { class: 'group' },
      menuItem('palette', tr('Avatar'), a.avatar ? avatarLabel(a.avatar) : tr('Automatic'), pickAvatar),
      a.kind === 'seed' && canSign() ? menuItem('sign', tr('Sign a message'), null, () => signMessagePane(sheet, () => accountDetailPane(sheet, id, back, 'back'), a.id)) : null,
      a.kind === 'seed' ? menuItem('key', tr('Show secret seed'), tr('For backup. Make sure no one can see your screen.'), () => revealSeedPane(sheet, a.id, () => accountDetailPane(sheet, id, back, 'back'))) : null,
      a.kind === 'watch' && canSign() ? menuItem('key', tr('Add its seed'), tr('Turn this into a sending account'), () => { sheet.close(); showImport(true); }) : null,
      menuItem('trash', tr('Remove account'), a.kind === 'seed' ? tr('Only its written seed can bring it back.') : null, async () => {
        // Said before anything is typed; removeAccount checks again (a transfer from another tab can arrive meanwhile).
        if (hasOpenTransfer(a.identity)) { toast(errorText('REMOVE_BUSY'), 'err', 8000); return; }
        const last = state.accounts.length === 1;
        const ok = await confirmDialog({
          title: tr('Remove “{name}”?', { name: a.name }),
          message: last ? tr('This is the only account, so the whole wallet will be cleared from this browser. Make sure its seed is written down.')
            : a.kind === 'seed' ? tr('Its seed will be deleted from this wallet. Make sure it’s written down: without it, the funds are lost.') : tr('The address will no longer be watched.'),
          confirmLabel: tr('Remove'), danger: true, requireText: a.kind === 'seed' ? trLater('REMOVE') : null,
        });
        if (!ok) return;
        let removed = false;
        try {
          await removeAccount(a.id);
          removed = true;
        } catch (e) { toast(messageOf(e), 'err', 8000); }
        if (state.phase !== 'ready') return;
        if (removed) toast(tr('Account removed'), 'info');
        // Back whenever the account has left memory, even after a failed save; refused, it's still here.
        if (!accountById(a.id)) back();
      }, { danger: true, chevron: false })),
  ], { title: tr('Account'), back, direction, keepScroll: direction == null });
}

// An account's avatar: a colour (or the one its address picks) and a finish, previewed as you choose; saved with the
// account.
const avatarLabel = (look) => (look.color == null ? tr('Automatic color') : tr(AVATAR_PRESETS[look.color].name)) + ' · ' + tr(AVATAR_FINISHES.find((f) => f.id === look.finish).name);
function avatarPane(sheet, id, back) {
  const a = accountById(id);
  if (!a) { back(); return; }
  let open = true; sheet.onPaneLeave(() => { open = false; }); // a save that lands after you left mustn't bring the account back
  const saved = { color: a.avatar ? a.avatar.color : null, finish: a.avatar ? a.avatar.finish : 'radial' };
  let look = { ...saved };
  const preview = h('div', { class: 'avatar-preview' });
  const colors = h('div', { class: 'avatar-grid', role: 'radiogroup', 'aria-label': tr('Color') });
  const finishes = h('div', { class: 'avatar-grid finishes', role: 'radiogroup', 'aria-label': tr('Finish') });
  const save = button(tr('Save avatar'), { disabled: true, onClick: async () => {
    const restore = busy(save, tr('Saving…'));
    try {
      await setAccountAvatar(a.id, look);
      toast(tr('Avatar saved'));
      if (open) back();
    } catch (e) { restore(); toast(messageOf(e), 'err'); }
  } });
  const option = (selected, label, art, onPick) => h('button', { type: 'button', class: 'avatar-opt', role: 'radio', 'aria-checked': String(selected), onClick: onPick },
    h('span', { class: 'avatar lg', 'aria-hidden': 'true' }, art), h('span', { class: 'avatar-opt-name', text: label }));
  const paint = () => {
    fill(preview, h('div', { class: 'avatar xxl', 'aria-hidden': 'true' }, avatarSvg(a.identity, a.name, look)), h('div', { class: 'item-sub', text: avatarLabel(look) }));
    fill(colors, [null, ...AVATAR_PRESETS.keys()].map((color) => option(look.color === color, color === null ? tr('Auto') : tr(AVATAR_PRESETS[color].name),
      avatarSvg(a.identity, a.name, { ...look, color }), () => { look = { ...look, color }; paint(); })));
    fill(finishes, AVATAR_FINISHES.map((f) => option(look.finish === f.id, tr(f.name),
      avatarSvg(a.identity, a.name, { ...look, finish: f.id }), () => { look = { ...look, finish: f.id }; paint(); })));
    save.disabled = look.color === saved.color && look.finish === saved.finish;
  };
  paint();
  sheet.setPane([
    h('div', { class: 'sheet-center' }, preview),
    h('div', { class: 'field' }, h('div', { class: 'field-label', text: tr('Color') }), colors),
    h('div', { class: 'field' }, h('div', { class: 'field-label', text: tr('Finish') }), finishes),
  ], { title: tr('Avatar'), back, direction: 'forward', footer: [save] });
}

function revealSeedPane(sheet, id, back) {
  const a = accountById(id);
  if (!a || !a.seed) { back(); return; }
  const area = h('div', { class: 'pane-holder' });
  let epoch = 0;
  let active = true;
  const reveal = () => {
    if (!active || document.hidden || !a.seed || !ensureUnlocked()) return;
    area.replaceChildren(
      h('div', { class: 'seed-box' }, seedText(a.seed, true)),
      h('div', { class: 'seed-tools' },
        h('button', { type: 'button', class: 'chip-btn neutral', onClick: () => {
          const grant = epoch;
          copySeedWithWarning(a.seed, () => active && grant === epoch && a.seed && !document.hidden && ensureUnlocked());
        } }, icon('copy', 16), h('span', { text: tr('Copy') })),
        h('button', { type: 'button', class: 'chip-btn neutral', onClick: back }, icon('eyeOff', 16), h('span', { text: tr('Hide') }))));
  };
  const conceal = () => {
    // Invalidate a pending password check even if focus returns before it finishes.
    epoch++;
    for (const input of area.querySelectorAll('input')) input.value = '';
    area.replaceChildren();
    if (state.mode === 'vault') {
      const err = h('p', { class: 'hint err', role: 'alert' });
      const pw = currentPasswordField({ label: tr('Wallet password'), autofocus: true, error: err, onLeave: (fn) => sheet.onPaneLeave(fn) });
      const go = button(tr('Reveal seed'), { type: 'submit', iconName: 'eye' });
      const form = h('form', { class: 'pane-holder', novalidate: true }, walletUsername(), pw.input, err, go);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = pw.take();
        if (!password) return;
        const attempt = ++epoch;
        const alive = sessionGuard();
        const restore = busy(go, tr('Checking…'));
        try {
          await Vault.open(password, { resume: false });
          if (active && attempt === epoch && alive() && area.isConnected) reveal();
        } catch (er) {
          if (active && attempt === epoch && alive() && area.isConnected) { restore(); pw.fail(er); }
        }
      });
      area.append(form);
    } else {
      area.append(button(tr('Reveal seed'), { kind: 'secondary', iconName: 'eye', onClick: reveal }));
    }
  };
  conceal();
  const stopConcealing = onPrivacyHide(conceal);
  sheet.onPaneLeave(() => { active = false; epoch++; stopConcealing(); area.replaceChildren(); });
  sheet.setPane([
    notice('warn', 'alert', tr('Anyone with this seed controls the funds'), tr('Reveal it only to write it down, somewhere private. Never share it or type it into a website.')),
    area,
  ], { title: a.name, back, direction: 'forward' });
}

// ── Messages: verify and sign, in the official wallet's format ─────────────
// The message exactly as signed: line breaks kept; tabs, carriage returns, zero-width, direction and other invisible
// characters spelled out as tags, so what you see is what was (or will be) signed.
const INVISIBLE_CHAR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/u;
function messageText(message) {
  const box = h('div', { class: 'msg-box', translate: 'no' });
  let run = '';
  const flush = () => { if (run) { box.append(run); run = ''; } };
  for (const ch of message) {
    if (ch === '\n') { run += ch; continue; }
    if (ch === '\t' || INVISIBLE_CHAR.test(ch)) {
      flush();
      box.append(h('span', { class: 'cp', text: ch === '\t' ? 'TAB' : `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` }));
    } else run += ch;
  }
  flush();
  return box;
}
const edgeSpaceNote = (message) => (/^\s|\s$/.test(message) ? h('p', { class: 'hint', text: tr('It starts or ends with a space or a line break.') }) : null);
const byteCount = (n) => tr('{count, plural, one {{size} byte} other {{size} bytes}}', { count: n, size: fmtInt(n) });

// Paste a signed block; the result shows as soon as it parses. Nothing is sent anywhere.
function verifyMessagePane(sheet) {
  const ta = h('textarea', {
    class: 'input mono msg-input', rows: '5', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', translate: 'no',
    'aria-label': tr('Signed message'), placeholder: '{ "identity": …, "message": …, "signature": … }', 'data-autofocus': '',
  });
  const out = h('div', { class: 'pane-holder', 'aria-live': 'polite' });
  let timer = 0;
  const run = () => {
    autoGrow(ta);
    const text = ta.value.trim();
    if (!text) { fill(out); return; }
    const r = verifyMessage(text);
    if (r.error) { fill(out, h('p', { class: 'hint err', text: r.error })); return; }
    const who = labelFor(r.identity);
    fill(out,
      r.ok ? notice('ok', 'checkCircle', tr('Valid signature'), who ? tr('{name} signed exactly this message.', { name: who.name }) : tr('This address signed exactly this message.'))
        : notice('error', 'alert', tr('Signature doesn’t match'), tr('This address didn’t sign this exact message, or something in the block was changed.')),
      kv([
        [tr('Signed by'), partyBlock(r.identity, tr('Signed by')), { whole: true }],
        [tr('Message'), h('div', null, messageText(r.message), edgeSpaceNote(r.message)), { stack: true }],
        [tr('Size'), byteCount(r.bytes)],
      ]),
      r.ok && r.bytes === 32 ? notice('warn', 'alert', null, tr('This message is exactly 32 bytes, the size of a transaction fingerprint. This wallet won’t sign messages of that length.')) : null);
  };
  ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 150); });
  const paste = pasteButton(ta, tr('Paste'), (t) => { ta.value = t; run(); });
  sheet.onPaneLeave(() => clearTimeout(timer));
  sheet.setPane([
    h('p', { class: 'sheet-lead', text: tr('Paste a signed message to check that its address really signed it. Messages signed in the official Qubic wallet work too.') }),
    h('div', { class: 'input-wrap one' }, ta, h('div', { class: 'input-tools' }, paste)),
    out,
  ], { title: tr('Verify a message') });
}
// From the dashboard's Tools: each in a sheet of its own.
function openVerifyMessage() { verifyMessagePane(openSheet({ title: tr('Verify a message') })); }
function openSignMessage() { signMessagePane(openSheet({ title: tr('Sign a message') }), null, null, null); }

// Write → review the exact text → hold to sign → copy the signed block. Signed on this device; nothing is sent.
function signMessagePane(sheet, back, accountId = null, direction = 'forward') {
  const signers = state.accounts.filter((a) => a.kind === 'seed' && a.seed);
  if (!canSign() || !signers.length) {
    sheet.setPane([!canSign() ? notice('error', 'alert', tr('Signing is disabled'), signBlocked())
      : notice('info', 'info', tr('No account can sign'), tr('Signing needs an account with its seed. Watch-only addresses can’t sign.'))],
    { title: tr('Sign a message'), back, direction });
    return;
  }
  const current = currentAccount();
  let chosen = signers.find((a) => a.id === accountId) || (current && signers.find((a) => a.id === current.id)) || signers[0];
  // Password managers and Grammarly are told to ignore the message, as they are the seed fields: it may hold one.
  const ta = h('textarea', { class: 'input msg-input', rows: '4', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': tr('Message'), placeholder: tr('Write the message to sign'), 'data-autofocus': '',
    'data-1p-ignore': '', 'data-lpignore': 'true', 'data-gramm': 'false' });
  const counter = h('span', { class: 'aside', text: byteCount(0) });
  const hint = h('p', { class: 'hint', 'aria-live': 'polite' });
  const next = button(tr('Review'), { disabled: true, onClick: () => review() });
  // A complete seed of this wallet in the message is refused (red). 20+ letters in a row need a tick that they
  // aren't one (amber), and any edit clears it. signMessage checks both again when signing (see seedInMessage).
  // What it's checked against comes from messageSeedScope, for the note and for signing alike. Each run is derived once
  // while the sheet is open (see seedInMessage); the cache goes with the sheet.
  const derivedRuns = new Map();
  sheet.onCleanup(() => derivedRuns.clear());
  const notSeed = h('input', { type: 'checkbox' });
  const seedNote = h('div', { class: 'pane-holder', hidden: true });
  // The amber note said to screen readers from a live region that is always there (one that appears with its content
  // often isn't announced); the red note is an alert of its own.
  const seedSaid = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  let seedFound = null;
  const accountRow = (a, picking) => h(picking ? 'button' : 'div', {
    type: picking ? 'button' : null, class: 'from-row', role: picking ? 'radio' : null, 'aria-checked': picking ? String(a.id === chosen.id) : null,
    onClick: picking ? () => { chosen = a; paintPicker(); } : null,
  }, accountMain(a, shortId(a.identity, 6), 'row-sub mono', picking ? a.id === chosen.id : null));
  const picker = h('div', { class: 'picker', role: signers.length > 1 ? 'radiogroup' : null, 'aria-label': tr('Account to sign with') });
  const paintPicker = () => fill(picker, signers.length > 1 ? signers.map((a) => accountRow(a, true)) : accountRow(chosen, false));
  paintPicker();
  const update = () => {
    autoGrow(ta);
    const n = utf8(ta.value).length;
    counter.textContent = byteCount(n);
    const err = n === 32 ? tr('{error} Add or remove a character.', { error: errorText('MESSAGE_32') }) : n > MESSAGE_MAX_BYTES ? errorText('MESSAGE_LONG') : '';
    hint.className = `hint${err ? ' err' : ''}`;
    hint.textContent = err;
    // Over 8 KB isn't looked at: it can't be signed anyway. The note is redrawn only when the finding changes.
    const found = n > 0 && n <= MESSAGE_MAX_BYTES ? seedInMessage(ta.value, { ...messageSeedScope(), memo: derivedRuns }) : null;
    if (found !== seedFound) {
      seedFound = found;
      seedNote.hidden = !found;
      seedSaid.textContent = found === 'seedlike' ? errorText('MESSAGE_SEEDLIKE') : '';
      fill(seedNote, found === 'held' ? notice('error', 'alert', null, errorText('MESSAGE_SEED'))
        : found === 'seedlike' ? [notice('warn', 'alert', null, errorText('MESSAGE_SEEDLIKE')),
          h('label', { class: 'check' }, notSeed, h('span', { text: tr('I’m sure this isn’t a seed.') }))] : null);
    }
    next.disabled = !n || Boolean(err) || found === 'held' || (found === 'seedlike' && !notSeed.checked);
  };
  ta.addEventListener('input', () => { notSeed.checked = false; update(); });
  notSeed.addEventListener('change', update);
  const compose = (dir) => {
    sheet.setPane([
      h('div', { class: 'field' }, h('div', { class: 'field-label', text: tr('Sign with') }), picker),
      h('div', { class: 'field' }, h('label', { class: 'field-label' }, h('span', { text: tr('Message') }), counter), ta),
      hint,
      seedNote,
      seedSaid,
    ], { title: tr('Sign a message'), back, direction: dir, footer: [next] });
    update();
  };
  // Like a transfer, the message and the account are fixed when Review opens, and signed as shown.
  const review = () => {
    const message = ta.value;
    const signer = chosen;
    const seedLikeOk = notSeed.checked;
    // The wallet's seeds and addresses are read again when signing, so one added meanwhile is looked for too.
    const hold = holdButton(tr('Hold to sign'), () => {
      if (!ensureUnlocked() || !signer.seed) return;
      try {
        const scope = messageSeedScope();
        done(signMessage({ seed: signer.seed, account: signer, message, walletSeeds: scope.seeds, walletIds: scope.identities, seedLikeOk }));
      } catch (e) { hold.reset(); toast(messageOf(e), 'err', 8000); }
    });
    hold.ask = () => ({ title: tr('Sign this message?'), confirmLabel: tr('Sign'), message: tr('As {name}, {address}. Anyone with the signed message can check that this address signed it.', { name: signer.name, address: shortId(signer.identity, 6) }) });
    sheet.onPaneLeave(() => hold.dispose());
    sheet.setPane([
      h('p', { class: 'sheet-lead', text: tr('You’re signing this exact text. Check it, including any marked characters.') }),
      messageText(message),
      edgeSpaceNote(message),
      kv([
        [tr('Signed by'), h('div', { class: 'party-name' }, avatar(signer), h('span', { text: signer.name })), { stack: true }],
        [tr('Address'), addressText(signer.identity), { stack: true }],
        [tr('Size'), byteCount(utf8(message).length)],
      ]),
      notice('info', 'shield', null, tr('Signed on this device; nothing is sent. Anyone with the signed message can check that this address signed it, so only sign text you understand.')),
    ], { title: trc('screen title', 'Review'), back: () => compose('back'), direction: 'forward', footer: [hold] });
  };
  const done = (json) => {
    sheet.setPane([
      notice('ok', 'checkCircle', tr('Message signed'), tr('Share the whole block. It can be checked here or in the official Qubic wallet.')),
      h('pre', { class: 'signed-json', translate: 'no', text: json }),
    ], {
      title: tr('Signed'), direction: 'forward',
      footer: [button(tr('Copy signed message'), { iconName: 'copy', onClick: () => copyWithToast(json, tr('Signed message copied')) }), button(tr('Done'), { kind: 'ghost', onClick: back || (() => sheet.close()) })],
    });
  };
  compose(direction);
}

// ── Password fields ─────────────────────────────────────────────────────────
// Every password field works the same way, whatever its form says: its form's error line (error) is tied to it and
// clears as soon as you type again; Enter submits (each is in a form with a submit button); and it's emptied as soon
// as it's read for a check, so a password isn't left on the page while it's checked or after a failure, and when its
// pane or screen is left (onLeave: sheet.onPaneLeave, or onLeave for a screen).
function passwordInputs(inputs, error, onLeave) {
  if (!error.id) error.id = uid('hint');
  for (const input of inputs) {
    input.setAttribute('aria-describedby', error.id);
    input.addEventListener('input', () => { error.textContent = ''; for (const el of inputs) el.setAttribute('aria-invalid', 'false'); });
  }
  onLeave(() => { for (const input of inputs) input.value = ''; });
}
// A password you already have: the wallet's (autocomplete current-password) or a backup's ('off': it may not be the
// wallet's, so a saved one isn't offered). take() reads it and empties it; empty, it's focused and gives ''.
// fail(error): the check failed. It says why, marks the field and puts you back in it to type again.
function currentPasswordField({ label, placeholder = label, autocomplete = 'current-password', autofocus = false, error, onLeave }) {
  const input = h('input', { class: 'input', type: 'password', autocomplete, placeholder, 'aria-label': label, 'data-autofocus': autofocus });
  passwordInputs([input], error, onLeave);
  return {
    input,
    take() {
      const value = input.value;
      input.value = '';
      if (!value) input.focus();
      return value;
    },
    fail(er) {
      error.textContent = messageOf(er);
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    },
  };
}
// A new password and its repeat (autocomplete new-password), with the strength meter. check() says what's wrong with
// them, if anything; clear() empties them.
function passwordFields({ label = tr('New password'), repeat = tr('Repeat new password'), placeholder = tr('New password (min. {min} characters)', { min: MIN_PASSWORD }), error, onLeave }) {
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder, 'aria-label': label });
  const pw2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: repeat, 'aria-label': repeat });
  const meter = h('div', { class: 'meter', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
  pw.addEventListener('input', () => { meter.dataset.score = String(passwordScore(pw.value)); });
  passwordInputs([pw, pw2], error, onLeave);
  const check = () => {
    if (pw.value.length < MIN_PASSWORD) return tr('Use at least {min} characters.', { min: MIN_PASSWORD });
    if (passwordScore(pw.value) < 2) return tr('This password is too easy to guess.');
    if (pw.value !== pw2.value) return tr('The passwords don’t match.');
    return null;
  };
  return { pw, pw2, meter, check, clear: () => { pw.value = ''; pw2.value = ''; delete meter.dataset.score; } };
}

function openEnableEncryption() { enableEncryptionPane(openSheet({ title: tr('Encrypt wallet') }), null); }

// back === null → standalone sheet: no back button, closes when done.
function enableEncryptionPane(sheet, back) {
  const err = h('p', { class: 'hint err', role: 'alert' });
  const f = passwordFields({ error: err, onLeave: (fn) => sheet.onPaneLeave(fn) });
  const go = button(tr('Encrypt & save'), { type: 'submit', iconName: 'lock' });
  const form = h('form', { class: 'pane-holder', novalidate: true }, walletUsername(), f.pw, f.meter, f.pw2, err, go);
  let open = true; let saving = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!open || saving) return;
    const problem = f.check();
    if (problem) { err.textContent = problem; return; }
    const password = f.pw.value;
    f.clear();
    const alive = sessionGuard();
    const auth = () => open && alive();
    saving = true;
    const restore = busy(go, tr('Encrypting…'));
    try {
      // Wait for earlier edits and hold later ones until the snapshot is saved. Leaving this pane cancels the write;
      // edits made after leaving therefore can't be omitted from a vault that finishes encrypting in the background.
      // A wallet another tab already saved is never overwritten (EXISTS).
      await editWallet(async () => {
        if (!auth()) throw new AppError('CANCELLED', trLater('Cancelled.'));
        await Vault.create(password, vaultPayload(), {
          auth, expect: null, carry: async () => journalEntries(),
          onCommit: (v) => { if (alive()) { state.vault = v; state.mode = 'vault'; } },
        });
      });
      if (!auth()) return;
      toast(tr('Encrypted and saved on this device'));
      changed();
      if (back) back(); else sheet.close();
    } catch (er) {
      if (er.code === 'CANCELLED') return;
      // Saved, then erased in another tab before this one could finish: no key for a wallet that's gone; this wallet
      // stays session-only, as it was.
      if (er.code === 'GONE' && alive()) { state.vault = null; state.mode = 'session'; changed(); }
      if (auth()) { restore(); err.textContent = messageOf(er); }
    } finally {
      saving = false;
    }
  });
  sheet.onPaneLeave(() => { open = false; });
  sheet.setPane([
    h('p', { class: 'sheet-lead', text: tr('Your accounts will be encrypted with this password (Argon2id, 64 MiB → AES-256-GCM) and kept in this browser. Only ciphertext is stored.') }),
    form,
    notice('info', 'info', null, tr('The password can’t be recovered. If you forget it, restore the wallet from your written seeds.')),
  ], { title: tr('Encrypt wallet'), back, direction: back ? 'forward' : null });
}

function changePasswordPane(sheet, back) {
  const err = h('p', { class: 'hint err', role: 'alert' });
  const onLeave = (fn) => sheet.onPaneLeave(fn);
  const current = currentPasswordField({ label: tr('Current password'), autofocus: true, error: err, onLeave });
  const f = passwordFields({ error: err, onLeave });
  const go = button(tr('Change password'), { type: 'submit' });
  const form = h('form', { class: 'pane-holder', novalidate: true }, walletUsername(), current.input, f.pw, f.meter, f.pw2, err, go);
  let open = true;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Both passwords are read and checked now, before anything is awaited: leaving the pane clears the fields, and the
    // change must never go on with whatever they hold by then.
    const problem = !current.input.value ? tr('Enter your current password.') : f.check();
    if (problem) { err.textContent = problem; return; }
    // The current password leaves its field now; the new pair stays until the change is made, so after a wrong current
    // password only that is typed again.
    const oldPassword = current.take(); const newPassword = f.pw.value;
    // One authorisation for the whole change: closing the pane, locking or erasing cancels it at any step up to the
    // write, and no reload key is kept for a change that didn't happen.
    const alive = sessionGuard();
    const auth = () => open && alive();
    const oldKey = state.vault && state.vault.key;
    const restore = busy(go, tr('Re-encrypting…'));
    try {
      await Vault.open(oldPassword, { resume: false });
      if (!auth()) return;
      // Accounts and the journal of unsettled transfers are re-sealed under the new key in a single write. An
      // unreadable journal stops the change instead of being dropped.
      // Only on top of the record this tab unlocked (expect); the new key is this tab's from the moment it's written
      // (onCommit, still under the write lock), so writes queued behind it, like a send's journal entry, use it.
      await Vault.create(newPassword, vaultPayload(), {
        auth,
        expect: state.vault && state.vault.header,
        carry: async (stored) => Journal.merge(stored && stored.pending ? await Journal.read(oldKey, stored) : [], journalEntries(), settledHashes()),
        onCommit: (v) => { if (alive()) state.vault = v; },
      });
      f.clear();
      if (!alive()) return;
      toast(tr('Password changed'));
      if (open) back();
    } catch (er) {
      if (er.code === 'CANCELLED') return;
      // Erased or re-keyed in another tab right after the change was written: this tab can't go on with that key.
      if (er.code === 'GONE') { vaultLost(); return; }
      restore(); current.fail(er);
    }
  });
  sheet.onPaneLeave(() => { open = false; });
  sheet.setPane([form], { title: tr('Change password'), back, direction: 'forward' });
}

function networkPane(sheet, back) {
  const holder = h('div', { class: 'pane-holder' });
  const paint = () => {
    const n = state.net;
    // Answers that keep coming with the same tick are a stall, not plain "live" (see tickStall).
    const stall = tickStall();
    const live = stall ? tr('Live, no new tick for {minutes} min', { minutes: Math.floor(stall / 60000) }) : tr('Live');
    const status = !n.tickAt ? tr('Connecting…') : Date.now() - n.tickAt < 20000 ? live
      : n.tickErr ? tr('Error: {error}', { error: messageOf(n.tickErr) }) : tr('Stale');
    fill(holder, kv([
      [tr('RPC'), h('span', { class: 'mono', text: 'rpc.qubic.org' })],
      [tr('Status'), status],
      [tr('Latency'), netStats.latency != null ? tr('{ms} ms', { ms: fmtNum(netStats.latency) }) : '—'],
      [tr('Current tick'), n.tick ? `#${fmtInt(n.tick)}` : '—'],
      [tr('Epoch'), n.epoch ? String(n.epoch) : '—'],
      [tr('Archive tick'), archive.tick ? `#${fmtInt(archive.tick)}` : '—'],
      [tr('Tick time'), n.msPerTick ? tr('≈ {seconds} s', { seconds: fmtDecimals(n.msPerTick / 1000, 2) }) : tr('Measuring…')],
      [tr('Explorer'), explorerLink('tick', n.tick || 1, 'explorer.qubic.org')],
    ]));
  };
  paint();
  sheet.onPaneLeave(subscribe(paint));
  archiveTick().then(changed, () => {});
  sheet.setPane([
    holder,
    h('div', { class: 'group' },
      h('div', { class: 'item' }, itemText('globe', tr('Data sources'),
        tr('rpc.qubic.org (live, query, stats) · api.coingecko.com and api.gateio.ws (optional, Market data) · api.gateio.ws and api.mexc.com (optional, Exchange order books) · static.qubic.org (optional, Address labels). Nothing else can be contacted: the page’s Content-Security-Policy blocks every other host.')))),
  ], { title: tr('Network'), back, direction: 'forward', footer: [button(tr('Check now'), { kind: 'secondary', iconName: 'refresh', onClick: () => { loadTick(); archive.at = 0; archiveTick().then(changed, () => {}); } })] });
}

function selfTestPane(sheet, back) {
  const holder = h('div', { class: 'pane-holder' });
  const paint = () => {
    const st = state.selfTest;
    holder.replaceChildren(
      h('div', { class: 'status-hero' },
        h('div', { class: ['status-ring', st.status === 'pass' ? 'ok' : st.status === 'fail' ? 'err' : 'wait'] },
          st.status === 'pass' ? icon('shield', 30) : st.status === 'fail' ? icon('alert', 30) : faceLoader(36)),
        h('div', { class: 'status-title', text: st.status === 'pass' ? tr('All checks passed') : st.status === 'fail' ? tr('Self-test failed') : tr('Running…') }),
        h('p', { class: 'status-text', text: st.status === 'pass' ? tr('Completed in {ms} ms. Signing is enabled.', { ms: fmtNum(st.ms) }) : st.status === 'fail' ? tr('“{check}” failed. Creating, importing and sending are disabled.', { check: tr(st.failed) }) : '' })),
      h('div', { class: 'timeline' }, (st.steps || []).map((s, i) => {
        const failedHere = st.status === 'fail' && i === st.steps.length - 1;
        return h('div', { class: ['tl', failedHere ? 'fail' : 'done'] }, h('span', { class: 'tl-dot' }, icon(failedHere ? 'close' : 'check', 12, 2.5)), h('div', { text: tr(s) }));
      })));
  };
  paint();
  sheet.setPane([
    h('p', { class: 'sheet-lead', text: tr('Known-answer tests run at every launch, before any key is derived. They pin the embedded cryptography to values cross-checked against the production Qubic web wallet and the live network.') }),
    holder,
  ], { title: tr('Self-test'), back, direction: 'forward', footer: [button(tr('Run again'), { kind: 'secondary', iconName: 'refresh', onClick: async () => {
    await rerunSelfTest(paint);
  } })] });
}
// Run again from Settings: whether this device signs can change with it, and with it Send and the tools.
async function rerunSelfTest(paint) {
  state.selfTest = { status: 'running', steps: [] }; paint();
  await runSelfTest();
  versions.wallet++;
  paint(); changed();
}

function implementationPane(sheet, back) {
  const list = (items, ok) => h('div', { class: 'group' }, items.map(([t, s]) => h('div', { class: 'item' }, itemText(ok ? 'check' : 'close', t, s))));
  sheet.setPane([
    h('div', { class: 'group-title', text: tr('Implemented') }),
    list([
      [tr('Create, back up and verify seeds'), tr('crypto.getRandomValues with rejection sampling; the backup check retypes the whole seed')],
      [tr('Import seeds and watch-only addresses'), tr('Identity derived and checksum-verified locally')],
      [tr('Send QUBIC'), tr('Official SDK signing, local re-decode and signature check before broadcast')],
      [tr('Sign and verify messages'), tr('The official wallet’s format; messages of exactly 32 bytes are refused')],
      [tr('Real transaction status'), tr('Settled only when the archive’s record equals the signed transfer and the account’s live record agrees')],
      [tr('Receive with on-device QR code')],
      [tr('Balances, owned assets, history, explorer links'), tr('Live and query APIs at rpc.qubic.org')],
      [tr('Optional encrypted storage, auto-lock, session mode'), tr('Argon2id + AES-256-GCM; secrets in memory by default')],
      [tr('Stay unlocked on reload (encrypted mode, off by default)'), tr('Same tab, until auto-lock: the vault key wrapped in IndexedDB, its secret in the tab’s sessionStorage')],
      [tr('Unsettled transfers survive a reload or lock (encrypted mode)'), tr('Journalled before broadcast and tracked again; the account can’t send until they settle')],
      [tr('Price, 24h change and chart'), tr('Qubic RPC stats; CoinGecko optional')],
      [tr('Price calculator'), tr('Your balance at any QUBIC price or market cap')],
      [tr('Address book'), tr('Your own names for addresses; Send warns about look-alike addresses')],
      [tr('Exchange order books (opt-in)'), tr('QUBIC/USDT from Gate.io and MEXC, loaded only while open')],
      [tr('Value when sent or received'), tr('CoinGecko for the past year, Gate.io daily closes before that')],
    ], true),
    h('div', { class: 'group-title', text: tr('Not implemented') }),
    list([
      [tr('Sending assets or shares'), tr('Needs QX contract payloads (inputType 2) and their review')],
      [tr('Smart-contract calls'), tr('QX trading, QEarn, SendMany, IPO bids…')],
      [tr('Contract payouts in Activity'), tr('Incoming SendMany or dividends show in the balance, not as rows')],
      [tr('Scanning QR codes'), tr('Would need camera access and a decoder library')],
      [tr('An isolated signer'), tr('Seeds, signing and the network code share this page: a software wallet, not a hardware one')],
      [tr('Hardware wallets and official vault-file import')],
    ], false),
    h('div', { class: 'group-title', text: tr('Cryptography') }),
    notice('plain', 'shield', null, tr('Keys, signatures, hashing and transaction encoding come from the official Qubic TypeScript SDK (@qubic.org/crypto and @qubic.org/tx 1.0.0), embedded unmodified. The author’s own tests cross-checked them against the production web wallet’s WASM crypto and real mainnet transactions; that is not an independent audit. Residual risk: JavaScript can’t guarantee constant-time big-integer math or wipe strings from memory, so use this wallet on a device you trust.')),
  ], { title: tr('What’s implemented'), back, direction: 'forward' });
}
