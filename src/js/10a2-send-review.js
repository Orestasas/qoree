// ── Send: Review and Hold to send ───────────────────────────────────────────
// Review's hold and the look-alike check: Hold to send waits while the check still runs, and a hold in progress is
// cancelled whenever what the check says changes, so a late warning can't be held through. Returns a function that
// reads the check, applies it to the hold and hands it back.
function holdForCheck(hold, to, since) {
  let said = null;
  const keyOf = (check) => `${check.waiting}|${check.lines.map((w) => w.text).join('|')}`;
  const read = () => {
    const check = lookalikeWarnings(to, since);
    hold.disabled = check.waiting;
    const key = keyOf(check);
    if (said !== null && key !== said) hold.cancel();
    said = key;
    return check;
  };
  // For the moment the hold completes: whether the check now says something the screen doesn't show yet (a read that
  // landed in the hold's last frame, before the next repaint could cancel it). guard(send, repaint, asked) then resets
  // the hold and repaints instead of sending, as it does when the dialog's check (asked, see hold.check) has changed.
  read.stale = () => { const check = lookalikeWarnings(to, since); return check.waiting || keyOf(check) !== said; };
  read.guard = (send, repaint, asked = null) => {
    if (read.stale() || (asked && !asked())) { hold.reset(); repaint(); return false; }
    send();
    return true;
  };
  // For the dialog a short press or a screen reader gets instead of a hold (see holdButton's ask): what the check says
  // as the question is asked must still be what it says when it's answered, though the screen behind repainted.
  // holdButton hands what this returns to onConfirm when the dialog is answered (see confirmSend).
  hold.check = () => { const at = keyOf(lookalikeWarnings(to, since)); return () => keyOf(lookalikeWarnings(to, since)) === at; };
  return read;
}

// Hold to send's one way to send. The completed hold and the dialog a short press or a screen reader gets instead (see
// holdButton's ask) both confirm here, so the two can't drift: through the look-alike check's guard (asked: the
// dialog's check, see holdForCheck), then executeSend. Returns false if it didn't send.
function confirmSend(sheet, transfer, readCheck, repaint, asked = null) {
  return readCheck.guard(() => executeSend(sheet, transfer), repaint, asked);
}

// Review's Hold to send: the button, the question its dialog asks, and the look-alike check's hold on it (see
// holdForCheck). Returns the button and what reads the check.
function sendHold(sheet, transfer, { from, known, since, repaint }) {
  const hold = holdButton(tr('Hold to send'), (asked) => confirmSend(sheet, transfer, read, repaint, asked));
  hold.ask = () => ({ title: hidden() ? tr('Send this transfer?') : tr('Send {amount} QUBIC?', { amount: fmtInt(transfer.amount) }), confirmLabel: tr('Send'),
    message: known ? tr('To {name}, {address}, from {account}. Transfers can’t be reversed.', { name: known.name, address: shortId(transfer.to, 6), account: from.name })
      : tr('To {address}, from {account}. Transfers can’t be reversed.', { address: shortId(transfer.to, 6), account: from.name }),
    blocked: tr('Not sent: the address is still being checked. Confirm again in a moment.'),
    changed: tr('Not sent: the address check changed. Look it over, then confirm again.') });
  sheet.onPaneLeave(() => hold.dispose());
  const read = holdForCheck(hold, transfer.to, since);
  return { hold, read };
}

// What you review is what's signed: the transfer is copied out of the draft once, checked, frozen, and both shown and
// signed from that copy. Nothing that changes the draft afterwards reaches it.
function sendReview(sheet, draft) {
  const from = accountById(draft.fromId);
  const amount = /^\d{1,19}$/.test(draft.amountRaw || '') ? BigInt(draft.amountRaw) : 0n;
  if (!from || !from.seed || checkIdentity(draft.to).state !== 'valid' || amount <= 0n || amount > MAX_AMOUNT) { sendForm(sheet, draft, 'back'); return; }
  const transfer = Object.freeze({ fromId: from.id, from: from.identity, to: draft.to, amount });
  const p = priceInfo();
  const usd = p ? qubicToUsd(amount, p.price) : null;
  const known = labelFor(transfer.to);
  const tickValue = h('div', { class: 'num' });
  const tickMeta = h('div', { class: 'tl-meta' });
  const after = h('span', { class: 'num' });
  const paint = () => {
    const t = state.net.tick;
    tickValue.textContent = t ? `≈ #${fmtInt(t + state.prefs.tickOffset)}` : tr('Set when you confirm');
    tickMeta.textContent = t ? (state.net.msPerTick
      ? tr('current #{tick} + {offset} · ≈ {duration}', { tick: fmtInt(t), offset: state.prefs.tickOffset, duration: fmtDuration(state.prefs.tickOffset * state.net.msPerTick) })
      : tr('current #{tick} + {offset}', { tick: fmtInt(t), offset: state.prefs.tickOffset })) : '';
    const bal = dataFor(from.identity).balance;
    after.textContent = bal ? (hidden() ? MASK : `${fmtInt(bal.amount - amount)} QUBIC`) : '—';
  };
  paint();
  sheet.onPaneLeave(subscribe(paint));
  const warnings = recipientWarnings(transfer);
  // Sent only through confirmSend: if the look-alike check changed in the hold's last moment, or while the dialog was
  // open, it shows instead. The check is kept current (see watchCheck and holdForCheck): Hold to send waits for it, at
  // most LOOKALIKE_WAIT_MS from when the form opened, and a hold in progress is cancelled when what it says changes.
  const { hold: confirm, read: readCheck } = sendHold(sheet, transfer, { from, known, since: draft.checkSince, repaint: () => paintCheck() });
  const twinNote = h('div', { class: 'hints spaced', 'aria-live': 'polite' });
  const checkNote = h('div', { class: 'hints spaced', 'aria-live': 'polite' });
  // Under the address: how often you've sent there (see sentHereText), once the check has read enough to say.
  const sentNote = h('div', { class: 'tl-meta' });
  const paintCheck = () => {
    const check = readCheck();
    sentNote.textContent = check.twin ? '' : sentHereText(transfer.to) || '';
    const twins = check.twin ? 1 : 0;
    paintCheckLines(twinNote, check.lines.slice(0, twins), checkNotice);
    paintCheckLines(checkNote, check.lines.slice(twins), checkNotice,
      tr('{seconds, plural, one {Hold to send waits for it, at most # second.} other {Hold to send waits for it, at most # seconds.}}', { seconds: LOOKALIKE_WAIT_MS / 1000 }));
  };
  paintCheck();
  sheet.onPaneLeave(subscribe(paintCheck));
  watchCheck(sheet, draft.checkSince);
  sheet.setPane([
    h('div', { class: 'review-amount' }, h('div', { class: ['big', amountSize(fmtInt(amount))], text: fmtInt(amount) }), h('div', { class: 'unit', text: usd != null ? `QUBIC · ≈ ${fmtUsd(usd)}` : 'QUBIC' })),
    kv([
      [tr('From'), h('div', null, h('div', { text: from.name }), h('div', { class: 'mono subtle', text: shortId(transfer.from, 6) }))],
      [tr('To'), h('div', null, known ? h('div', { text: known.name }) : null, addressText(transfer.to), sentNote), { stack: true }],
      [tr('Network fee'), tr('None')],
      [tr('Target tick'), h('div', null, tickValue, tickMeta)],
      [tr('Balance after'), after],
    ]),
    ...warnings.map((w) => notice(w.level === 'err' ? 'error' : 'warn', 'alert', null, w.text)),
    twinNote,
    checkNote,
    notice('info', 'shield', null, tr('Signed on this device with the official Qubic cryptography, then verified locally before broadcast. Transfers can’t be reversed.')),
  ], { title: trc('screen title', 'Review'), back: () => sendForm(sheet, draft, 'back'), direction: 'forward', footer: [confirm] });
}
