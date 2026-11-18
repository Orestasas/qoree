// ── Send: the transfer's status ─────────────────────────────────────────────
function openPendingSheet(record) { sendStatus(openSheet({ title: tr('Transfer') }), record); }

// The face for each status: set while it signs and sends, hopeful while it waits for its tick, glad once it's in,
// worried when it can't be confirmed, sad when it failed.
const TRANSFER_MOODS = {
  signing: 'determined', broadcasting: 'determined', waiting: 'hopeful', confirming: 'hopeful', success: 'joyful',
  dismissed: 'content', unknown: 'worried', failed: 'sad', 'not-executed': 'sad', error: 'sad',
};

function sendStatus(sheet, record) {
  const holder = h('div', { class: 'pane-holder' });
  const footer = h('div', { class: 'status-actions' });
  // The top stays put between redraws, so the face changes its mood instead of starting over (and so do the
  // timeline's loaders, one per step). The face holds still: money is moving, so each status shows its face at once.
  const face = qoreeFace(TRANSFER_MOODS[record.status] || 'hopeful', 44, { still: true });
  const ring = h('div', { class: 'status-ring' }, face);
  const title = h('div', { class: 'status-title' });
  const text = h('p', { class: 'status-text' });
  const body = h('div', { class: 'status-body' });
  // Read out once at each change of status (a failure before anything was sent included), not at every redraw: the
  // text under the title counts down to the tick every few seconds.
  const said = h('p', { class: 'sr-only', role: 'status' });
  let saidStatus = null;
  append(holder, [h('div', { class: 'status-hero' }, ring, title, text, said), body]);
  const loaders = [];
  const activeLoader = (k) => {
    if (!loaders[k]) loaders[k] = faceLoader(14);
    else loaders[k].show('loading');  // a step that's active again (a retried broadcast): its loader restarts
    return loaders[k];
  };
  const paint = () => {
    const s = record.status;
    const tick = state.net.tick;
    sheet.setTitle(record.hash ? tr('Transfer') : s === 'error' ? tr('Not sent') : tr('Sending'));
    const ok = s === 'success';
    const bad = s === 'failed' || s === 'not-executed' || s === 'error';
    ring.className = ['status-ring', ok ? 'ok' : bad ? 'err' : s === 'unknown' ? 'warn' : s === 'dismissed' ? null : 'wait'].filter(Boolean).join(' ');
    face.show(TRANSFER_MOODS[s] || 'hopeful');
    const remaining = record.targetTick && tick ? Math.max(0, record.targetTick - tick) : null;
    // Short of its tick while the network's tick isn't moving: no countdown, and a notice that it can still go through.
    const short = (s === 'waiting' || s === 'unknown') && record.targetTick && tick && tick <= record.targetTick;
    const stalled = short ? tickStall() : 0;
    const eta = remaining != null && state.net.msPerTick && !stalled
      ? fmtDuration(remaining * state.net.msPerTick) : null;
    const words = transferWords(record, eta);
    title.textContent = words.title;
    text.textContent = words.text;
    if (s !== saidStatus) { saidStatus = s; said.textContent = tr('{title}. {text}', { title: words.title, text: words.text }); }
    fill(body,
      transferProgress(record, tick),
      s !== 'error' ? transferTimeline(record, tick, remaining, activeLoader) : null,
      stalled ? notice('warn', 'hourglass', tr('The network hasn’t passed this transfer’s tick yet'),
        tr('No new tick for {minutes} min (last seen #{lastTick}). It can still go through '
        + 'when the network moves on, so this account can’t send again until the network passes tick '
        + '#{targetTick} and the outcome is known.', { minutes: Math.floor(stalled / 60000), lastTick: fmtInt(tick), targetTick: fmtInt(record.targetTick) })) : null,
      record.note && s !== 'error' ? notice('warn', 'alert', null, tr(record.note)) : null,
      transferDetails(record));
    fill(footer, transferActions(sheet, record, tick));
  };
  paint();
  sheet.onPaneLeave(subscribe(paint));
  sheet.setPane([holder], { footer: [footer] });
}

// The status screen's title for a transfer, and the text under it. eta: the time left to its tick, if known.
function transferWords(record, eta) {
  const s = record.status;
  const titles = {
    signing: tr('Signing on this device'), broadcasting: tr('Broadcasting'), waiting: record.targetTick ? tr('Waiting for tick #{tick}', { tick: fmtInt(record.targetTick) }) : tr('Waiting'),
    confirming: tr('Confirming'), success: tr('Sent'), failed: tr('Transfer failed'), 'not-executed': tr('Not included'), unknown: tr('Status unknown'), dismissed: tr('Marked as checked'), error: tr('Not sent'),
  };
  const texts = {
    signing: tr('Building and signing the transaction locally.'),
    broadcasting: tr('Handing the signed transaction to the Qubic network.'),
    waiting: eta ? tr('About {time} until the target tick. You can close this; progress continues in Activity.', { time: eta }) : tr('You can close this; progress continues in Activity.'),
    confirming: tr('Tick reached. Checking the network archive for the transaction.'),
    success: tr('{amount} QUBIC arrived in tick #{tick}.', { amount: fmtInt(record.amount), tick: fmtInt(record.targetTick || 0) }),
    failed: tr('The transaction was included, but the network did not move the funds.'),
    'not-executed': tr('The network archive has no record of it in its tick, so it most likely didn’t execute. Check the explorer before trying again.'),
    // Marking it as checked is offered only once the network has passed its tick (see pastTarget).
    unknown: pastTarget(record)
      ? tr('This couldn’t be confirmed. Check the explorer for the final result. Until it’s settled or you mark it as '
        + 'checked, this account won’t send.')
      : tr('This couldn’t be confirmed, and the network now reads short of its tick, so it may still go through. Until '
        + 'it’s settled, this account won’t send.'),
    dismissed: tr('You marked this as checked on the explorer.'),
    error: record.note || tr('Nothing was sent.'),
  };
  return { title: titles[s] || s, text: texts[s] || '' };
}

// How far a waiting transfer is on the way to its tick, as a bar; null at any other time.
function transferProgress(record, tick) {
  if (!(record.status === 'waiting' && record.targetTick && record.startTick && tick)) return null;
  const frac = clamp((tick - record.startTick) / Math.max(1, record.targetTick - record.startTick), 0.04, 1);
  const bar = h('i');
  bar.style.width = `${(frac * 100).toFixed(1)}%`;
  return h('div', { class: 'progress', role: 'progressbar', 'aria-label': tr('On the way to the target tick'), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(frac * 100)) }, bar);
}

// The transfer's four steps: signed, broadcast, its tick, confirmed. loader(k): the loader of step k while it's active.
function transferTimeline(record, tick, remaining, loader) {
  const s = record.status;
  const final = FINAL.has(s) || s === 'error';
  // Each step's state is said in words too (the dot shows it only as a picture).
  const STEP_STATE = { done: tr('Done:'), fail: tr('Failed:'), active: tr('In progress:') };
  const step = (k, label, st, meta) => h('div', { class: ['tl', st] },
    h('span', { class: 'tl-dot' }, st === 'done' ? icon('check', 12, 2.5) : st === 'fail' ? icon('close', 12, 2.5)
      : st === 'active' ? loader(k) : null),
    h('div', null, h('div', null, h('span', { class: 'sr-only', text: `${STEP_STATE[st] || tr('Not yet:')} ` }), label), meta ? h('div', { class: 'tl-meta', text: meta }) : null));
  const signedDone = Boolean(record.hash);
  const broadcastDone = s !== 'signing' && s !== 'broadcasting' && s !== 'error';
  // Done only on the network's word: its tick is past the target, or the archive settled the transfer in it.
  const tickDone = ['success', 'failed', 'not-executed'].includes(s)
    || Boolean(tick && record.targetTick && tick > record.targetTick);
  // Included in its tick (sent or failed): it reached the network, whatever the broadcast reported.
  const reached = Boolean(record.peers) || s === 'success' || s === 'failed';
  return h('div', { class: 'timeline' },
    step(0, tr('Signed and verified on this device'), signedDone ? 'done' : s === 'error' ? 'fail' : 'active'),
    step(1, record.peers != null ? tr('{count, plural, one {Broadcast to # peer} other {Broadcast to # peers}}', { count: record.peers }) : tr('Broadcast to the network'),
      broadcastDone ? (reached ? 'done' : final ? '' : 'active') : s === 'broadcasting' ? 'active' : '', broadcastDone && !reached ? tr('Unconfirmed broadcast') : null),
    step(2, record.targetTick ? tr('Target tick #{tick}', { tick: fmtInt(record.targetTick) }) : tr('Target tick'), tickDone ? 'done' : s === 'waiting' ? 'active' : '',
      s === 'waiting' && remaining != null ? tr('{count, plural, one {{ticks} tick to go} other {{ticks} ticks to go}}', { count: remaining, ticks: fmtInt(remaining) }) : null),
    step(3, tr('Confirmed by the network archive'), s === 'success' ? 'done' : (s === 'failed' || s === 'not-executed') ? 'fail' : s === 'confirming' ? 'active' : ''));
}

// What was sent, once it's signed: the amount, the account it's from if that has left the wallet, where to, and its ID.
function transferDetails(record) {
  if (!record.hash) return null;
  const lab = labelFor(record.to);
  return kv([
    [tr('Amount'), hidden() ? MASK : `${fmtInt(record.amount)} QUBIC`],
    // Sent from an account that has since left the wallet: which one, as it's no longer listed.
    accountByIdentity(record.from) ? null
      : [tr('From'), h('div', null, h('div', { text: tr('A removed account') }), h('div', { class: 'mono', text: shortId(record.from, 6) }))],
    [tr('To'), h('div', null, lab ? h('div', { text: lab.name }) : null, h('div', { class: 'mono', text: shortId(record.to, 6) }))],
    [tr('Transaction'), h('div', null, h('div', { class: 'mono', text: shortId(record.hash, 8) }),
      h('button', { type: 'button', class: 'link-btn', text: tr('Copy ID'), onClick: () => copyWithToast(record.hash, tr('Transaction ID copied')) }))],
    record.targetTick ? [tr('Explorer'), explorerLink('tx', record.hash, tr('Open transaction'))] : null,
  ]);
}

// The status screen's buttons: retry the broadcast, mark it as checked, try again, and Done or Close.
function transferActions(sheet, record, tick) {
  const s = record.status;
  const final = FINAL.has(s) || s === 'error';
  const canRetry = record.encoded && s === 'waiting' && (!record.peers || record.note) && tick && record.targetTick && tick < record.targetTick - 1;
  // Offered only once the network has passed its tick (see pastTarget): before that it can still go through.
  const canMark = s === 'unknown' && record.hash && pastTarget(record);
  return [
    canRetry ? button(tr('Retry broadcast'), { kind: 'secondary', iconName: 'refresh', onClick: () => broadcastRecord(record) }) : null,
    canMark ? button(tr('I’ve checked it on the explorer'), { kind: 'secondary', onClick: async () => {
      const ok = await confirmDialog({ title: tr('Mark as checked?'), message: tr('Only do this once the explorer shows whether this transfer went through. Its account can send again afterwards.'), confirmLabel: tr('Mark as checked') });
      // Refused only if the network reads short of its tick again meanwhile; one a lookup settled meanwhile needs
      // nothing more.
      if (ok && record.status === 'unknown' && !dismissTransfer(record)) {
        toast(tr('The network hasn’t passed this transfer’s tick yet, so it can still go through.'), 'info');
      }
    } }) : null,
    (s === 'not-executed' || s === 'error') && record.draft && accountById(record.draft.fromId)
      ? button(tr('Try again'), { onClick: () => sendForm(sheet, { ...record.draft }, 'back') }) : null,
    button(final ? tr('Done') : tr('Close'), { kind: final && s === 'success' ? 'primary' : 'ghost', onClick: () => sheet.close() }),
  ];
}
