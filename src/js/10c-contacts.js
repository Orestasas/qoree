// ═══════════════════════════════════════════════════════════════════════════
// 11c. ADDRESS BOOK: addresses saved under your own names
// ═══════════════════════════════════════════════════════════════════════════
// An exchange deposit address, a friend. Sealed with the accounts in encrypted mode, kept in this tab's memory in
// session mode. Shown by name in Activity, transaction details and Send, and picked from Send.

// ── Screens ─────────────────────────────────────────────────────────────────
const contactRow = (c, onClick) => h('button', { type: 'button', class: 'item', onClick },
  contactAvatar(c),
  h('span', { class: 'item-main' }, h('span', { class: 'item-title', text: c.name }), h('span', { class: 'item-sub mono', text: shortId(c.identity, 6) })),
  h('span', { class: 'item-end' }, icon('chevronRight', 16)));

// The list. pick(contact): choosing a recipient for Send instead of managing the book.
function contactsPane(sheet, back, { pick = null, direction = 'forward' } = {}) {
  const again = () => contactsPane(sheet, back, { pick, direction: 'back' });
  const title = pick ? tr('Send to') : tr('Address book');
  const add = button(tr('Add address'), {
    kind: pick && state.contacts.length ? 'secondary' : 'primary', iconName: 'userPlus', disabled: state.contacts.length >= MAX_CONTACTS,
    onClick: () => contactEditPane(sheet, { back: again, onSaved: pick || again }),
  });
  const where = h('p', { class: 'fine', text: state.mode === 'vault' ? tr('Saved in your encrypted wallet on this device.') : tr('Session only: forgotten when you close this tab.') });
  if (!state.contacts.length) {
    sheet.setPane([emptyState(qoreeFace('content', 40), tr('No saved addresses yet'), tr('Save an exchange deposit address or a friend’s address, then send to it by name.')), where],
      { title, back, direction, footer: [add] });
    return;
  }
  const list = h('div', { class: 'group' });
  const query = h('input', {
    class: 'input', type: 'search', placeholder: tr('Search names or addresses'), 'aria-label': tr('Search the address book'),
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search', 'data-1p-ignore': '', 'data-lpignore': 'true',
  });
  const paint = () => {
    const q = query.value.trim().toLowerCase();
    const letters = q.replace(/\s+/g, '').toUpperCase();
    const rows = [...state.contacts].sort((a, b) => a.name.localeCompare(b.name))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (letters.length >= 3 && c.identity.includes(letters)));
    fill(list, rows.length ? rows.map((c) => contactRow(c, () => (pick ? pick(c) : contactDetailPane(sheet, c.id, again))))
      : h('div', { class: 'item' }, h('span', { class: 'item-main' }, h('span', { class: 'item-sub', text: tr('No saved address matches.') }))));
  };
  query.addEventListener('input', paint);
  paint();
  sheet.setPane([state.contacts.length > 5 ? query : null, list, where], { title, back, direction, footer: [add] });
}

// Before an address is saved: true once every question the look-alike check calls for has been answered "Save anyway":
// the look-alike (naming both addresses), or else that the check couldn't finish. A question is asked again when what
// the check says changes while one is open (a look-alike found meanwhile gets its own). false while the check still
// runs (Save waits for it), on Cancel, or once here() no longer holds.
async function saveAnyway(identity, since, here) {
  const answered = new Set();
  for (;;) {
    const check = lookalikeWarnings(identity, since);
    if (check.waiting) return false;
    let ask = null;
    if (check.twin) ask = { title: tr('This address looks like one you know'), message: check.lines[0].text };
    else if (!check.complete) {
      ask = { title: tr('Save without a full check?'), message: tr('This address couldn’t be checked against every address you’ve '
        + 'sent to. Compare every letter with where it really comes from, and save it only once you have.') };
    }
    if (!ask || answered.has(ask.message)) return true;
    if (!(await confirmDialog({ ...ask, confirmLabel: tr('Save anyway'), danger: true })) || !here()) return false;
    answered.add(ask.message);
  }
}

// Adding one. identity: prefilled (from a transaction or the Send form). onSaved(contact) runs after it is saved. The
// look-alike check (see watchCheck): Save waits for it at most LOOKALIKE_WAIT_MS, then asks first while the address
// resembles one you know or the check couldn't finish (see saveAnyway).
function contactEditPane(sheet, { identity = '', back = null, onSaved, direction = 'forward' }) {
  const since = Date.now();
  watchCheck(sheet, since);
  let current = null;
  let check = null; // lookalikeWarnings(current)
  let idHint = null; // the address field's own hint (a live region): it carries the look-alike line
  let twinSaid = null; // the look-alike line it carries
  const name = h('input', {
    class: 'input', maxlength: '32', autocomplete: 'off', 'aria-label': tr('Name'), placeholder: tr('e.g. Bitget deposit, Alex'), 'data-autofocus': '',
    'data-1p-ignore': '', 'data-lpignore': 'true',
  });
  // One save at a time: redraws while a save's question is open or it is being written must not re-enable Save.
  let saving = false;
  const save = button(tr('Save address'), { disabled: true, onClick: async () => {
    const id = current;
    if (saving || !id) return;
    saving = true;
    update();
    try {
      // A lock closes the dialog (false); a changed address is a different save.
      if (!(await saveAnyway(id, since, () => current === id && state.phase === 'ready'))) return;
      const restore = busy(save, tr('Saving…'));
      try {
        const c = await addContact({ name: name.value, identity: id });
        toast(tr('Address saved'));
        onSaved(c);
      } catch (e) {
        restore();
        toast(messageOf(e), 'err');
      }
    } finally {
      saving = false;
      update();
    }
  } });
  function update() { save.disabled = saving || !(current && name.value.trim()) || Boolean(check && check.waiting); }
  const say = (hint, kind, text) => { hint.className = `hint ${kind}`; hint.replaceChildren(icon('alert', 15), h('span', { text })); };
  const notes = h('div', { class: 'hints', 'aria-live': 'polite' });
  // The look-alike line takes the place of "Valid address" in the field's hint, written only when it changes (or the
  // field rewrote the hint); the hourglass and gap lines go under the field.
  const paintCheck = () => {
    check = current ? lookalikeWarnings(current, since) : null;
    const twin = check && check.twin ? check.lines[0].text : null;
    if (twin && twin !== twinSaid && idHint) say(idHint, 'warn', twin);
    twinSaid = twin;
    paintCheckLines(notes, check ? check.lines.slice(check.twin ? 1 : 0) : [], checkHint,
      tr('{seconds, plural, one {Save waits for it, at most # second.} other {Save waits for it, at most # seconds.}}', { seconds: LOOKALIKE_WAIT_MS / 1000 }));
    update();
  };
  const field = identityField({
    autofocus: false,
    onChange(id, hint) {
      idHint = hint;
      const problem = id && contactProblem(id);
      current = id && !problem ? id : null;
      if (problem) say(hint, 'err', tr(problem.text, problem.vars));
      else if (current && identityKind(current) === 'contract') say(hint, 'warn', tr('This is a smart contract. A plain transfer to a contract is usually unrecoverable.'));
      twinSaid = null; // the field rewrote its hint
      paintCheck();
    },
  });
  name.addEventListener('input', update);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !save.disabled) save.click(); });
  if (identity) field.set(identity);
  sheet.onPaneLeave(subscribe(paintCheck));
  sheet.setPane([
    h('div', { class: 'field' }, h('label', { class: 'field-label', text: tr('Name') }), name),
    field.el,
    notes,
    notice('info', 'info', null, tr('Copy the address from where it really comes from, like the exchange’s deposit page, and compare it there. A saved address is only as right as what was pasted.')),
  ], { title: tr('Add address'), back, direction, footer: [save] });
}

function contactDetailPane(sheet, id, back, direction = 'forward') {
  const c = contactById(id);
  if (!c) { back(); return; }
  let open = true; sheet.onPaneLeave(() => { open = false; }); // a rename that lands after you left mustn't bring this pane back
  const canSend = canSign() && seedAccounts().length > 0;
  sheet.setPane([
    h('div', { class: 'sheet-center' }, contactAvatar(c, 'xl'), h('div', { class: 'status-title', text: c.name }), badge(tr('Saved address'))),
    nameField(c.name, tr('Name'), (v) => renameContact(c.id, v), () => { if (open) contactDetailPane(sheet, id, back, null); }),
    kv([
      addressRow(c.identity),
      identityKind(c.identity) === 'contract' ? [tr('Type'), tr('Smart contract')] : null,
      [tr('Added'), fmtDay(c.createdAt)],
    ]),
    h('div', { class: 'group' },
      canSend ? menuItem('send', tr('Send to this address'), null, () => { sheet.close(); openSendSheet({ to: c.identity }); }) : null,
      menuItem('trash', tr('Remove from address book'), tr('Transfers to it stay in your activity.'), async () => {
        const ok = await confirmDialog({ title: tr('Remove “{name}”?', { name: c.name }), message: tr('It will no longer be named in this wallet. Nothing changes on the network.'), confirmLabel: tr('Remove'), danger: true });
        if (!ok) return;
        try {
          await removeContact(c.id);
          toast(tr('Address removed'), 'info');
          back();
        } catch (e) { toast(messageOf(e), 'err'); }
      }, { danger: true, chevron: false })),
  ], { title: tr('Saved address'), back, direction, keepScroll: direction == null });
}

// From the dashboard's Tools.
function openAddressBook() { contactsPane(openSheet({ title: tr('Address book') }), null, { direction: null }); }

// From a transaction or a signed message: save the other side. onSaved runs after the sheet closes.
function openSaveContact(identity, onSaved) {
  const sheet = openSheet({ title: tr('Add address') });
  contactEditPane(sheet, { identity, direction: null, onSaved: () => { sheet.close(); onSaved(); } });
}
// Worth offering "save": an address the book would take (see contactProblem: valid, not yours, not saved already, not
// the burn address), while it has room.
const canSaveContact = (identity) => state.phase === 'ready' && state.contacts.length < MAX_CONTACTS && isId(identity) && !contactProblem(identity);
