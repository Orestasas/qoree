// ── Send: form → review → status ────────────────────────────────────────────
// The form; Review and Hold to send are in 10a2-send-review.js, signing and broadcast in 10a3-send-execute.js, the
// status screen in 10a4-send-status.js.
// fromId: the account to send from, if it's a seed account (Send again); otherwise the one on screen, or the first.
function openSendSheet({ to = '', amount = null, fromId = null } = {}) {
  const why = signBlocked(); if (why) { toast(why, 'err'); return; }
  if (state.journalProblem) { toast(errorText('JOURNAL'), 'err'); return; }
  const candidates = seedAccounts();
  if (!candidates.length) { toast(tr('Add an account with its seed to send'), 'info'); return; }
  const cur = currentAccount();
  const pick = candidates.find((a) => a.id === fromId) || (cur && cur.kind === 'seed' ? cur : candidates[0]);
  const draft = { fromId: pick.id, to, amountRaw: amount ? amount.toString() : '' };
  sendForm(openSheet({ title: tr('Send') }), draft);
}

function recipientWarnings(draft) {
  const out = [];
  if (!draft.to) return out;
  const from = accountById(draft.fromId);
  const kind = identityKind(draft.to);
  const known = state.labels.get(draft.to);
  if (from && draft.to === from.identity) out.push({ level: 'err', text: tr('This is the sending account itself.') });
  if (kind === 'burn') out.push({ level: 'err', text: tr('This is the burn address. Anything sent here is destroyed.') });
  if (kind === 'contract') out.push({ level: 'warn', text: known ? tr('{name} is a smart contract. A plain transfer to a contract is usually unrecoverable.', { name: known.name })
    : tr('This is a smart contract. A plain transfer to a contract is usually unrecoverable.') });
  // The look-alike check is shown beside these (lookalikeWarnings): it changes as outgoing transfers are read.
  return out;
}

// The look-alike check while a screen shows it: every seed account's outgoing transfers are read now, and read again
// on any change that makes a read due (Core's record of a transfer out, see sentDue; when none is due this costs
// nothing), and the screen is redrawn when the wait for the check runs out. since: when the screen started waiting.
function watchCheck(sheet, since) {
  loadKnownAddresses();
  sheet.onPaneLeave(subscribe(() => { loadKnownAddresses(); }));
  const left = since + LOOKALIKE_WAIT_MS - Date.now();
  if (left <= 0) return;
  const timer = setTimeout(changed, left + 50);
  sheet.onPaneLeave(() => clearTimeout(timer));
}
// Lines of the look-alike check (see lookalikeWarnings), painted into el only when their text changes. Each screen
// keeps the look-alike line and the others (the hourglass while the check runs, an amber line when it couldn't
// finish, a plain note for the owner's own cap) in two live regions, so a change to one isn't announced again with
// the other. line(w, text) draws one; waitText: what waits for the check on this screen, after the hourglass line.
function paintCheckLines(el, lines, line, waitText = '') {
  paintIf(el, lines.map((w) => w.text).join('|'),
    () => lines.map((w) => line(w, waitText && w.icon === 'hourglass' ? tr('{check} {wait}', { check: w.text, wait: waitText }) : w.text)));
}
const checkHint = (w, text) => h('p', { class: ['hint', w.level === 'warn' && 'warn'] },
  icon(w.icon, 15), h('span', { text }));
const checkNotice = (w, text) => notice(w.level === 'warn' ? 'warn' : 'info', w.icon, null, text);

// The form: from, to and how much. Review opens once all of it can be sent (see sendReview).
function sendForm(sheet, draft, direction = null) {
  const from = accountById(draft.fromId);
  if (!from) { sheet.close(); return; }
  // The look-alike check (see watchCheck). This send waits for it at most LOOKALIKE_WAIT_MS, counted once per draft:
  // Review and Back keep the same start.
  if (!draft.checkSince) draft.checkSince = Date.now();
  watchCheck(sheet, draft.checkSince);
  // The form edits the draft only while it's the pane on screen. A callback that lands after it was left (a paste
  // still reading the clipboard when Review opened) is ignored: it changes nothing, least of all a transfer under
  // review (which is a frozen copy anyway, see sendReview).
  let open = true;
  sheet.onPaneLeave(() => { open = false; });
  const isOpen = () => open;
  const fromData = dataFor(from.identity);
  if (!scopeAccounts().includes(from)) loadBalance(from); // off screen, it's read less often (see heartbeat)
  const review = button(tr('Review'), { disabled: true, onClick: () => sendReview(sheet, draft) });
  const back = () => sendForm(sheet, draft, 'back');
  const to = recipientField(sheet, draft, from, { back, isOpen, edited: validate });
  const amount = amountField(draft, fromData, { isOpen, edited: validate, enter: () => { if (!review.disabled) review.click(); } });
  const guard = h('div');

  function validate() {
    const { amt, err, bal } = amount.paint();
    const warnings = to.paint();
    const busyAccount = paintSendGuard(guard, from);
    review.disabled = !(draft.to && checkIdentity(draft.to).state === 'valid' && !warnings.some((w) => w.level === 'err')
      && amt && amt > 0n && !err && bal != null && !busyAccount && from.seed && canSign());
  }

  if (draft.to) to.field.set(draft.to);
  validate();
  const unsub = subscribe(validate);
  sheet.onPaneLeave(unsub);
  sheet.setPane([
    h('div', { class: 'field' }, h('span', { class: 'field-label', text: tr('From') }),
      seedAccounts().length > 1 ? fromRow(from, () => pickAccount(sheet, {
        title: tr('Send from'), accounts: seedAccounts(), selected: from.id,
        onPick: (a) => { draft.fromId = a.id; back(); }, back,
      })) : h('div', { class: 'from-row' }, accountMain(from, fromSub(from)))),
    to.el,
    h('div', { class: 'field' }, h('span', { class: 'field-label', text: tr('Amount') }), amount.box, amount.hint),
    guard,
  ], { title: tr('Send'), direction, footer: [review] });
}

// The form's To: the address (typed, pasted, or picked from the address book or your other accounts) and the notes
// under it. paint() draws those for the draft as it is and returns its warnings (see recipientWarnings).
function recipientField(sheet, draft, from, { back, isOpen, edited }) {
  const recipientNote = h('div', { class: 'hints' });
  const twinNote = h('div', { class: 'hints', 'aria-live': 'polite' });
  const checkNote = h('div', { class: 'hints', 'aria-live': 'polite' });
  const book = iconButton('addressBook', tr('Choose from address book'), () => contactsPane(sheet, back, {
    pick: (c) => { draft.to = c.identity; back(); },
  }));
  const field = identityField({
    autofocus: !draft.to,
    tools: [book],
    onChange(id) { if (!isOpen()) return; draft.to = id || ''; edited(); },
  });
  const others = state.accounts.filter((a) => a.id !== from.id);
  const picks = others.length ? h('div', { class: 'quick-picks' }, others.slice(0, 4).map((a) =>
    h('button', { type: 'button', class: 'chip-btn neutral', onClick: () => field.set(a.identity) }, icon('wallet', 14), h('span', { text: a.name })))) : null;
  const paint = () => {
    const warnings = recipientWarnings(draft);
    const check = lookalikeWarnings(draft.to, draft.checkSince);
    const twins = check.twin ? 1 : 0;
    paintCheckLines(twinNote, check.lines.slice(0, twins), checkHint);
    paintCheckLines(checkNote, check.lines.slice(twins), checkHint);
    // "Saved as", the label and "Save to address book" (at the end of the field's hint line) stay off for a warning
    // about the address itself (a static one or a look-alike), not while the check runs or couldn't finish: Add address
    // waits for it and asks.
    const clear = !warnings.length && !check.twin;
    const known = draft.to && clear ? labelFor(draft.to) : null;
    // How often you've sent here, under the name: a pasted address that isn't the usual one reads "haven't sent".
    const sentLine = draft.to && clear && checkIdentity(draft.to).state === 'valid' ? sentHereText(draft.to) : null;
    fill(recipientNote,
      warnings.map((w) => h('p', { class: `hint ${w.level === 'err' ? 'err' : 'warn'}` }, icon('alert', 15), h('span', { text: w.text }))),
      known ? h('p', { class: 'hint ok' }, icon(known.kind === 'contact' ? 'addressBook' : 'tag', 15),
        h('span', { text: known.kind === 'own' ? tr('Your account “{name}”', { name: known.name }) : known.kind === 'contact' ? tr('Saved as “{name}”', { name: known.name })
          : known.kind === 'exchange' ? tr('Exchange: {name}', { name: known.name }) : known.name })) : null,
      sentLine ? h('p', { class: 'hint' }, icon(knowledgeOf(draft.to) ? 'clock' : 'info', 15), h('span', { text: sentLine })) : null);
    fill(field.end, draft.to && clear && canSaveContact(draft.to)
      ? h('button', { type: 'button', class: 'link-btn sm', text: tr('Save to address book'), onClick: () => contactEditPane(sheet, { identity: draft.to, back, onSaved: back }) }) : null);
    return warnings;
  };
  return { field, paint, el: h('div', { class: 'field' }, field.el, picks, recipientNote, twinNote, checkNote) };
}

// The form's amount. Whole QUBIC only, and what you type is never turned into a different number. While only digits
// are typed, the field groups them itself. Once anything else is typed, pasted or dropped, the text stays exactly as
// entered (draft.amountText) and must parse strictly (see parseAmountText): "1.5" or "1,5" stay on screen with the
// reason, not as 15, until they're corrected; "2.5B" or "$25" stay as typed, with the QUBIC they come to shown under
// them. paint() draws what's under it (see paintAmount).
function amountField(draft, fromData, { isOpen, edited, enter }) {
  const amount = h('input', {
    class: 'amount-input', inputmode: 'numeric', autocomplete: 'off', placeholder: '0', 'aria-label': tr('Amount in QUBIC'), enterkeyhint: 'done',
    'data-autofocus': draft.to ? '' : null,
  });
  amount.value = draft.amountText || (draft.amountRaw ? groupDigits(draft.amountRaw) : '');
  let strict = Boolean(draft.amountText);
  const dollars = () => draft.amountUnit === 'usd';
  // A long amount steps down in size until all of it is in view (a phone's field shows about nine digits at full size).
  const fitAmount = () => {
    const sizes = ['', 'md', 'sm', 'xs'];
    let i = 0;
    do amount.dataset.size = sizes[i]; while (amount.scrollWidth > amount.clientWidth && ++i < sizes.length);
  };
  requestAnimationFrame(fitAmount);
  amount.addEventListener('input', (e) => {
    if (!isOpen()) return;
    const v = amount.value;
    if (dollars()) { draft.amountText = v; fitAmount(); edited(); return; }
    if ((e.inputType === 'insertText' || e.inputType === 'insertCompositionText') && /\D/.test(e.data || '')) strict = true;
    if (e.inputType && e.inputType.startsWith('insertFrom')) strict = true;
    let digits;
    // The field's own grouping, in any language: commas, or the narrow and plain no-break spaces French groups with.
    if (!strict && /^[\d,  ]*$/.test(v)) digits = v.replace(/\D/g, '');
    else {
      const r = parseAmountText(v);
      if (r.error || r.kind !== 'qubic') { draft.amountText = v; fitAmount(); edited(); return; }
      digits = r.digits; strict = false;
    }
    draft.amountText = '';
    draft.amountError = null;
    draft.amountRaw = regroupAmount(amount, digits);
    fitAmount();
    edited();
  });
  amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });
  // QUBIC or US dollars: a phone's number pad can't type "$", so the unit switches the field. Switching empties it.
  const unit = h('button', { type: 'button', class: 'amount-unit', onClick: () => {
    if (!isOpen()) return;
    draft.amountUnit = dollars() ? 'qubic' : 'usd';
    draft.amountText = ''; draft.amountRaw = ''; draft.amountError = null; strict = false;
    amount.value = '';
    paintUnit();
    fitAmount();
    edited();
    amount.focus();
  } });
  function paintUnit() {
    const usd = dollars();
    const to = usd ? tr('Switch to QUBIC') : tr('Switch to US dollars');
    unit.replaceChildren(h('span', { text: usd ? 'USD' : 'QUBIC' }), h('span', { class: 'sr-only', text: to }), icon('transfer', 14));
    unit.title = to;
    amount.setAttribute('aria-label', usd ? tr('Amount in US dollars') : tr('Amount in QUBIC'));
    amount.inputMode = usd ? 'decimal' : 'numeric';
  }
  paintUnit();
  const max = h('button', { type: 'button', class: 'chip-btn', text: tr('Max'), onClick: () => {
    if (!isOpen() || !fromData.balance) return;
    strict = false;
    draft.amountText = ''; draft.amountError = null;
    if (dollars()) { draft.amountUnit = 'qubic'; paintUnit(); }
    draft.amountRaw = fromData.balance.amount.toString();
    amount.value = groupDigits(draft.amountRaw);
    fitAmount();
    edited();
  } });
  const f = { input: amount, unit, dollars, usdLine: h('span'), availLine: h('span'), hint: h('p', { class: 'hint', 'aria-live': 'polite' }) };
  f.box = h('div', { class: 'amount-box' },
    h('div', { class: 'amount-row' }, amount, unit, max),
    h('div', { class: 'amount-meta' }, f.usdLine, f.availLine));
  f.paint = () => paintAmount(f, draft, fromData);
  return f;
}
// Typed digits back into the amount field, grouped (no leading zeros, at most 19 digits), with the caret after as many
// digits as were before it. Returns those digits.
function regroupAmount(input, typed) {
  const caret = input.selectionStart ?? input.value.length;
  const digitsBefore = input.value.slice(0, caret).replace(/\D/g, '').length;
  const digits = typed.replace(/^0+(?=\d)/, '').slice(0, 19);
  input.value = digits ? groupDigits(digits) : '';
  let pos = 0; let seen = 0;
  while (pos < input.value.length && seen < digitsBefore) { if (/\d/.test(input.value[pos])) seen++; pos++; }
  try { input.setSelectionRange(pos, pos); } catch { /* ignore */ }
  return digits;
}
// Under the amount: what it comes to, what's available, and why it can't be sent, if it can't. Returns the amount
// (null for none), that reason ('' for none) and the balance (null until it's read).
function paintAmount(f, draft, fromData) {
  const bal = fromData.balance ? fromData.balance.amount : null;
  const p = priceInfo();
  // Text kept as typed is read again each time, so dollars follow the price until Review takes the amount.
  const typed = draft.amountText ? parseAmountText(draft.amountText, { price: p && p.price, dollars: f.dollars() }) : { kind: 'qubic' };
  if (draft.amountText) { draft.amountRaw = typed.error ? '' : typed.digits; draft.amountError = typed.error || null; }
  f.unit.disabled = !f.dollars() && !p;
  const amt = draft.amountRaw ? BigInt(draft.amountRaw) : null;
  // Under the field, the other side of what's typed: the QUBIC that dollars or a short form come to, a long number in
  // short (so its zeros needn't be counted), and its dollar value.
  const qubic = (n) => tr('{amount} QUBIC', { amount: n });
  const lead = !amt ? '' : typed.kind === 'usd' ? `≈ ${qubic(fmtInt(amt))}` : typed.kind === 'short' ? `= ${qubic(fmtInt(amt))}`
    : amt >= 100000n ? qubic(fmtCompact(amt)) : '';
  const usd = amt && p && typed.kind !== 'usd' ? `≈ ${fmtUsd(qubicToUsd(amt, p.price))}` : '';
  f.usdLine.textContent = [lead, usd].filter(Boolean).join(' · ') || ' ';
  f.availLine.textContent = bal != null ? tr('Available {amount}', { amount: hidden() ? MASK : fmtInt(bal) }) : fromData.balanceErr ? tr('Balance unavailable') : tr('Loading balance…');
  let err = draft.amountError || '';
  if (!err && amt != null) {
    if (amt === 0n) err = tr('Enter an amount greater than zero.');
    else if (amt > MAX_AMOUNT) err = tr('A single Qubic transfer can carry at most {max} QUBIC.', { max: fmtInt(MAX_AMOUNT) });
    else if (bal != null && amt > bal) err = tr('That’s more than the available balance.');
  }
  f.hint.className = `hint ${err ? 'err' : ''}`;
  f.hint.textContent = err;
  markField(f.input, f.hint, Boolean(err), f.box);
  return { amt, err, bal };
}
// Under the form, why this account can't send now: sending is paused (see the journal), or a transfer from it is still
// open. Returns whether either holds.
function paintSendGuard(el, from) {
  const busyAccount = hasOpenTransfer(from.identity) || state.journalProblem;
  // Unconfirmed and past its tick, so it can be marked as checked (see pastTarget); otherwise still in progress.
  const unconfirmed = state.pending.some((x) => x.from === from.identity && x.status === 'unknown' && pastTarget(x));
  fill(el, !busyAccount ? null : state.journalProblem ? notice('error', 'alert', tr('Sending is paused'), errorText('JOURNAL'))
    : unconfirmed ? notice('warn', 'alert', tr('A transfer from this account is unconfirmed'),
      tr('Open it from Activity and check it on the explorer. Once you’ve marked it as checked, this account can send again.'))
      : notice('warn', 'hourglass', tr('A transfer from this account is in progress'),
        tr('Wait until it settles before sending another, so it’s clear which transfer did what.')));
  return busyAccount;
}
