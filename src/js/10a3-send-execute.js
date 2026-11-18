// ── Send: sign and broadcast ────────────────────────────────────────────────
// Each change to state.pending, or to the status of a transfer in it, moves versions.pending (Activity's filters
// read it, see activitySourceKey).
// Signs and sends the reviewed transfer (see sendReview), from the account it was reviewed with and no other.
async function executeSend(sheet, transfer) {
  const acct = accountById(transfer.fromId);
  const from = acct && acct.identity === transfer.from ? acct : null;
  /** @type {PendingTransfer} */
  const record = {
    hash: null, from: transfer.from, to: transfer.to, amount: transfer.amount,
    targetTick: null, startTick: null, createdAt: Date.now(), status: 'signing', peers: null, note: null,
    draft: { fromId: transfer.fromId, to: transfer.to, amountRaw: transfer.amount.toString() },
  };
  sendStatus(sheet, record);
  const fail = (e) => { record.status = 'error'; record.note = messageOf(e); changed(); };
  if (!from || !from.seed || !ensureUnlocked()) { fail(new AppError('LOCKED')); return; }
  if (!trustedContext()) { fail(new AppError('INSECURE')); return; }
  // Claimed before anything is awaited: a second confirmation for this account fails here instead of racing this one.
  const claim = claimSend(from.identity);
  if (!claim) { fail(new AppError('BUSY')); return; }
  const alive = sessionGuard();
  try {
    if (!(await claim.ready)) throw new AppError('BUSY', trLater('A transfer from this account is being sent in another tab.'));
    const bal = dataFor(from.identity).balance;
    if (!bal || record.amount > bal.amount) throw new AppError('FUNDS', trLater('Insufficient balance. Nothing was sent.'));
    const t = await fetchTickInfo();
    if (!alive()) throw new AppError('LOCKED');
    const targetTick = t.tick + state.prefs.tickOffset;
    const signed = await signTransfer({ seed: from.seed, account: from, destination: transfer.to, amount: transfer.amount, targetTick, currentTick: t.tick });
    // Locked while signing: nothing has left this device, so it stops here.
    if (!alive()) throw new AppError('LOCKED');
    Object.assign(record, { hash: signed.hash, encoded: signed.encoded, targetTick, startTick: t.tick, status: 'broadcasting' });
    state.pending.unshift(record);
    versions.pending++;
    // Encrypted mode: sealed into the wallet record before it leaves this device. If that write fails, it isn't sent.
    try {
      await saveJournal({ strict: true });
    } catch (er) {
      state.pending = state.pending.filter((x) => x !== record);
      versions.pending++;
      record.hash = null;
      throw er.code === 'CANCELLED' || er.code === 'LOCKED' ? new AppError('LOCKED', trLater('The wallet locked before sending. Nothing was broadcast.'))
        : er.code === 'JOURNAL' || er.code === 'STALE' ? new AppError(er.code, [].concat(er.text, trLater('Nothing was broadcast.')), er.vars)
          : new AppError('STORAGE', trLater('The transfer couldn’t be saved before sending, so it wasn’t sent. Nothing left this device.'));
    }
    // Locked while that was being written: it's recorded but not broadcast; after unlocking it's reconciled (a signed
    // transfer that was never broadcast can't execute). Locking can't recall one that was already broadcast.
    if (!alive()) throw new AppError('LOCKED', trLater('The wallet locked before sending. Nothing was broadcast.'));
    changed();
  } catch (e) {
    releaseSend(from.identity);
    fail(e);
    return;
  }
  await broadcastRecord(record);
}

async function broadcastRecord(record) {
  record.status = 'broadcasting';
  versions.pending++;
  record.note = null;
  changed();
  try {
    const r = await broadcastTransaction(record.encoded);
    record.peers = r.peers;
    if (r.transactionId && r.transactionId !== record.hash) record.note = trLater('The node reported a different transaction ID than the one computed here. Check the explorer.');
    else if (r.peers === 0) record.note = trLater('No peers accepted the broadcast. You can retry until the target tick passes.');
  } catch (e) {
    record.peers = null;
    record.note = tr('{error} The transfer may not have reached the network. Its outcome will be checked once tick {tick} passes; you can also retry the broadcast.',
      { error: messageOf(e), tick: fmtInt(record.targetTick) });
  }
  record.status = 'waiting';
  versions.pending++;
  changed();
  trackPending();
}
