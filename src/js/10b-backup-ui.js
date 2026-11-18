function backupPane(sheet, back) {
  const here = () => backupPane(sheet, back);
  sheet.setPane([
    h('p', { class: 'sheet-lead', text: tr('Back up all accounts, account names and saved addresses in one encrypted file. Keep the file and its password somewhere safe.') }),
    h('div', { class: 'group' },
      menuItem('download', tr('Download backup'), null, () => backupExportPane(sheet, here)),
      menuItem('checkCircle', tr('Check backup file'), tr('Reopen the downloaded file to check its password and contents'), () => backupFilePane(sheet, here, false))),
    notice('info', 'info', null, tr('To restore on a new device, choose Restore backup on the welcome screen. Existing wallets are never overwritten. This format is for qoree backups.')),
    notice('info', 'info', null, tr('Changing your wallet password does not change old backup files. They still use the password they were created with.')),
  ], { title: tr('Encrypted backup'), back });
}

function backupExportPane(sheet, back) {
  const vault = state.mode === 'vault';
  const err = h('p', { class: 'hint err', role: 'alert' });
  const onLeave = (fn) => sheet.onPaneLeave(fn);
  // With an encrypted wallet, its password; session only, a new one for the backup.
  const current = vault ? currentPasswordField({ label: tr('Current password'), error: err, onLeave }) : null;
  const f = vault ? null : passwordFields({ label: tr('Backup password'), repeat: tr('Repeat password'), error: err, onLeave });
  const pw = f ? f.pw : current.input;
  const go = button(tr('Prepare backup'), { type: 'submit', iconName: 'lock' });
  const result = h('div', { class: 'pane-holder', 'aria-live': 'polite' });
  const form = h('form', { class: 'pane-holder', novalidate: true }, walletUsername(), pw, f?.meter, f?.pw2, err, go);
  let open = true; let working = false; let epoch = 0; let url = null;
  const clear = () => { pw.value = ''; f?.clear(); epoch++; };
  const revoke = () => { if (url) URL.revokeObjectURL(url); url = null; };
  const stopPrivacy = onPrivacyHide(clear);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!open || working || !ensureUnlocked()) return;
    const problem = f?.check();
    if (problem) { err.textContent = problem; return; }
    let password = current ? current.take() : f.pw.value;
    if (!password) return;
    const alive = sessionGuard(); const token = ++epoch;
    const auth = () => open && alive() && token === epoch && state.phase === 'ready';
    f?.clear(); err.textContent = ''; result.replaceChildren(); revoke();
    working = true;
    const reset = busy(go, tr('Encrypting…'));
    try {
      const text = await Backup.create(password, auth);
      if (!auth()) return;
      url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const filename = `qoree-backup-${new Date().toISOString().slice(0, 10)}.qoree-backup`;
      const link = h('a', { class: 'btn btn-primary btn-block', href: url, download: filename }, icon('download', 18), h('span', { text: tr('Download backup') }));
      result.replaceChildren(
        h('p', { class: 'hint', text: tr('The encrypted file passed its read-back check. Download it, then use Check backup file to verify the saved copy.') }), link,
        button(tr('Check backup file'), { kind: 'secondary', onClick: () => backupFilePane(sheet, back, false) }));
    } catch (er) { if (auth()) (current ? current.fail(er) : (err.textContent = messageOf(er))); }
    finally { password = ''; working = false; if (open) reset(); }
  });
  sheet.onPaneLeave(() => { open = false; clear(); stopPrivacy(); revoke(); });
  sheet.setPane([
    h('p', { class: 'sheet-lead', text: vault
      ? tr('Enter your current wallet password. This backup will use the same password, with fresh encryption.')
      : tr('Choose a strong password for this backup. The wallet will remain session only.') }),
    form, result,
    notice('info', 'info', null, tr('The backup password cannot be recovered. Keep your written seeds as a separate recovery method.')),
  ], { title: tr('Download backup'), back });
}

function backupFilePane(sheet, back, restoring) {
  const title = restoring ? tr('Restore backup') : tr('Check backup file');
  // Any file can be picked: phones' pickers (Safari, Chrome) grey out an extension they don't know, .qoree-backup among
  // them, if the input lists types. What's picked is checked when it's read.
  const file = h('input', { class: 'input', type: 'file', 'aria-label': tr('Backup file') });
  const err = h('p', { class: 'hint err', role: 'alert' });
  const field = currentPasswordField({ label: tr('Backup password'), autocomplete: 'off', error: err, onLeave: (fn) => sheet.onPaneLeave(fn) });
  const pw = field.input;
  const result = h('div', { class: 'pane-holder', 'aria-live': 'polite' });
  const go = button(tr('Check backup file'), { type: 'submit', iconName: 'lock' });
  const form = h('form', { class: 'pane-holder', novalidate: true }, file, pw, err, go);
  let open = true; let working = false; let epoch = 0;
  const clear = () => { pw.value = ''; epoch++; };
  const stopPrivacy = onPrivacyHide(clear);
  file.addEventListener('change', () => { clear(); result.replaceChildren(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!open || working || (!restoring && !ensureUnlocked())) return;
    const chosen = file.files?.[0];
    if (!chosen || chosen.size <= 0 || chosen.size > BACKUP_MAX_BYTES) {
      err.textContent = tr('Choose a qoree backup file smaller than 1 MiB.'); return;
    }
    let password = field.take(); let payload = null;
    if (!password) return;
    const alive = sessionGuard(); const token = ++epoch;
    const auth = () => open && alive() && token === epoch;
    err.textContent = ''; result.replaceChildren(); working = true;
    const reset = busy(go, tr('Checking…'));
    try {
      const text = await chosen.text();
      backupAuth(auth);
      payload = await Backup.open(text, password, auth);
      backupAuth(auth);
      const summary = tr('Accounts: {accounts}. Saved addresses: {contacts}.', { accounts: payload.accounts.length, contacts: payload.contacts.length });
      if (restoring) {
        const yes = await confirmDialog({ title: tr('Restore backup'),
          message: joinSentences(summary, tr('This saves an encrypted wallet on this device using the backup password. Before sending, check recent transfers on the explorer: an older backup cannot know about later payments.')),
          confirmLabel: tr('Restore wallet') });
        if (!yes || !auth()) return;
        await Backup.restore(payload, password, auth);
        sheet.close();
        toast(tr('Backup restored'));
      } else {
        const current = vaultPayload();
        const matches = JSON.stringify(payload.accounts) === JSON.stringify(current.accounts)
          && JSON.stringify(payload.contacts) === JSON.stringify(current.contacts);
        result.replaceChildren(
          h('p', { class: 'sheet-lead', text: tr('Backup verified') }), h('p', { class: 'hint', text: summary }),
          notice(matches ? 'info' : 'warn', 'info', null, matches
            ? tr('All current accounts and saved addresses match this backup.')
            : tr('This file differs from your current wallet. Create a new backup to include your latest accounts and saved addresses.')));
      }
    } catch (er) { if (auth()) field.fail(er); }
    finally { password = ''; payload = null; working = false; if (open) reset(); }
  });
  sheet.onPaneLeave(() => { open = false; clear(); file.value = ''; stopPrivacy(); });
  sheet.setPane([
    h('p', { class: 'sheet-lead', text: tr('Choose an encrypted qoree backup and enter the password used when it was created. The file is opened locally and is never uploaded.') }),
    form, result,
  ], { title, back });
}
