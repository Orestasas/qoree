// ═══════════════════════════════════════════════════════════════════════════
// 9. ONBOARDING: welcome, create, import, watch, protect, unlock
// `flow` carries a draft account between steps; its seed is dropped on exit.
// ═══════════════════════════════════════════════════════════════════════════
let flow = null;

function exitFlow() {
  const adding = flow && flow.adding;
  dropFlow();
  if (adding && state.phase === 'ready') showDashboard({ back: true });
  else showWelcome({ back: true });
}

/** @param {{ back?: () => void, right?: Child, title?: string, lead?: Child, body?: Child, foot?: Child, cls?: string }} parts */
function shell({ back, right, title, lead, body, foot, cls }) {
  return h('main', { class: ['screen', cls] },
    h('div', { class: 'screen-top arrive' }, back ? iconButton('back', tr('Back'), back, 'circle') : h('span'), right || h('span')),
    h('div', { class: 'screen-body arrive-children' },
      title ? h('div', null, h('h1', { class: 'screen-title', tabindex: '-1', text: title }), lead ? h('p', { class: 'screen-lead', text: lead }) : null) : null,
      body),
    foot ? h('div', { class: 'screen-foot arrive-children' }, foot) : null);
}

function selfTestBlocker() {
  if (!trustedContext()) return notice('error', 'alert', tr('Not loaded securely'), tr('{error} Open it over https, from localhost, or as a file on this device. Watch-only addresses still work.', { error: errorText('INSECURE') }));
  if (state.selfTest.status === 'pass') return null;
  if (state.selfTest.status === 'running') return notice('info', 'hourglass', tr('Running cryptography self-test…'), null);
  return notice('error', 'alert', tr('Cryptography self-test failed'),
    tr('Check “{check}” did not pass in this browser, so creating, importing and sending are disabled. Watch-only addresses still work.', { check: tr(state.selfTest.failed) }));
}
// Why seeds can't be used here, or null when they can.
const signBlocked = () => (canSign() ? null : trustedContext() ? errorText('SELF_TEST') : errorText('INSECURE'));

// ── Refused: a service worker on this address (see foreignWorker) ──────────
// Shown at startup in place of every other screen: no saved wallet is read, resumed or offered while one is here.
function showWorkerRefusal() {
  showScreen('worker', () => {
    const error = h('p', { class: 'hint err', role: 'alert' });
    const remove = button(tr('Remove it and reload'), {
      onClick: async () => {
        error.textContent = '';
        const restore = busy(remove, tr('Removing…'));
        if (await removeWorkers()) { location.reload(); return; }
        restore();
        error.textContent = tr('Couldn’t remove it. Remove it in your browser’s developer tools (under Service workers), '
          + 'then reload. Clearing this site’s data also removes it, but erases any wallet saved here: on a phone that '
          + 'is the only way, so have your seed first.');
      },
    });
    return shell({
      title: tr('Another page left code on this address'),
      lead: tr('It installed a service worker for {origin} in this browser. The wallet never installs one, '
        + 'so it won’t open while one is here.', { origin: location.origin }),
      body: [
        notice('error', 'alert', tr('It can stand in for the wallet'), tr('It can answer the wallet’s network requests, and '
          + 'on a later visit show its own page in place of the wallet. If you don’t know where it came from, treat '
          + 'any seed saved or typed on this address, and its password, as exposed, and move your funds to a new '
          + 'seed.')),
        notice('info', 'info', tr('Before you remove it'), tr('Close every other tab on this address, including other wallet '
          + 'tabs, and stop any other app served from it. Afterwards, serve the wallet alone, on an address used for '
          + 'nothing else.')),
      ],
      foot: [remove, error],
    });
  });
}

// ── Welcome ─────────────────────────────────────────────────────────────────
function showWelcome(opts = {}) {
  state.phase = 'welcome';
  showScreen('welcome', () => {
    const blocked = !canSign();
    const point = (ic, text) => h('li', null, icon(ic, 16), h('span', { text }));
    // One centred column: the logo at the top, the audit note at the bottom, everything else in the middle.
    return h('main', { class: 'screen welcome' },
      h('div', { class: 'welcome-top arrive' }, brandLogo(), languageChip()),
      h('div', { class: 'welcome-hero arrive-children' },
        h('h1', { class: 'welcome-title', tabindex: '-1' }, h('span', { text: tr('Your QUBIC,') }), h('span', { class: 'accent', text: tr('in your browser.') })),
        h('p', { class: 'welcome-lead', text: tr('Keep, send and receive QUBIC. Your seed stays on this device.') }),
        h('div', { class: 'welcome-actions' },
          button(tr('Create wallet'), { onClick: () => startCreate(false), disabled: blocked, block: false }),
          button(tr('Import seed'), { kind: 'secondary', onClick: () => showImport(false), disabled: blocked, block: false }),
          button(tr('Restore backup'), { kind: 'secondary', onClick: () => backupFilePane(openSheet({ title: tr('Restore backup') }), null, true), disabled: blocked || !secureStorageSupported(), block: false }),
          button(tr('Watch address'), { kind: 'secondary', onClick: () => showWatch(false), block: false })),
        h('ul', { class: 'welcome-points' },
          point('checkCircle', tr('No sign-up')), point('shield', tr('Signed on this device'))),
        selfTestBlocker(),
        trustedContext() && !secureStorageSupported() ? notice('info', 'info', tr('Encrypted storage unavailable here'), storageUnavailableReason()) : null),
      h('p', { class: 'fine arrive', text: tr('Not independently audited yet. Keep a written backup of every seed.') }));
  }, opts);
}

// ── Create: intro → seed → verify → protect ────────────────────────────────
function startCreate(adding) {
  const why = signBlocked(); if (why) { toast(why, 'err'); return; }
  flow = { origin: 'create', kind: 'seed', adding, seed: null };
  showCreateIntro();
}

function showCreateIntro(opts = {}) {
  showScreen('create-intro', () => {
    const ack = h('input', { type: 'checkbox' });
    const next = button(tr('Show my seed'), {
      disabled: true,
      onClick: () => {
        try { if (!flow.seed) flow.seed = generateSeed(); showSeed(); } catch (e) { toast(messageOf(e), 'err'); }
      },
    });
    ack.addEventListener('change', () => { next.disabled = !ack.checked; });
    const rule = (n, title, text) => h('div', { class: 'rule' }, h('div', { class: 'rule-n', text: String(n) }), h('p', null, h('b', { text: title }), text));
    return shell({
      back: exitFlow, right: stepDots(1, 4),
      title: tr('Before you begin'),
      lead: tr('Your seed is the master key to this wallet. Anyone who has it controls the funds.'),
      body: [
        h('div', { class: 'card' },
          rule(1, tr('Write it down, offline'), tr('Paper in a safe place beats screenshots, photos, notes apps and cloud drives.')),
          rule(2, tr('Never share it'), tr('No support agent, exchange or website will ever need your seed.')),
          rule(3, tr('There is no reset'), tr('If the seed is lost, the funds are gone. Nobody can recover them.'))),
        h('label', { class: 'check' }, ack, h('span', { text: tr('I understand that only I can protect or recover my seed.') })),
      ],
      foot: [next],
    });
  }, opts);
}

// The seed as one continuous run of 55 letters; monospace keeps every letter the same width. Hidden, it is 55 dots
// with a zero-width space between each (Safari won't break a run of dots, which then ran out of the box), left out for
// screen readers: the button over it says what it is.
function seedText(seed, revealed) {
  return h('p', { class: ['seed-text', !revealed && 'concealed'], translate: 'no', 'aria-hidden': revealed ? null : 'true' },
    revealed ? seed : Array(55).fill('•').join('\u200b'));
}
// A seed field: spellcheck, autofill, grammar and password-manager extensions and translation all kept away from it.
const seedArea = (label, masked = false) => h('textarea', { class: ['input mono', masked && 'masked'], rows: '3', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', translate: 'no', 'aria-label': label, placeholder: tr('55 lowercase letters'), 'data-autofocus': '', 'data-1p-ignore': '', 'data-lpignore': 'true', 'data-gramm': 'false' });

async function copySeedWithWarning(seed, allowed) {
  if (!allowed()) return;
  const ok = await confirmDialog({
    title: tr('Copy seed?'),
    message: tr('The clipboard can be read by other apps and synced to other devices. Writing the seed down is safer. Clear your clipboard after pasting it somewhere secure.'),
    confirmLabel: tr('Copy anyway'), danger: true,
  });
  if (!ok || !allowed()) return;
  const copied = await copyText(seed);
  toast(copied ? tr('Seed copied. Clear your clipboard after use.') : tr('Copy failed'), copied ? 'info' : 'err');
}

function showSeed(opts = {}) {
  showScreen('create-seed', () => {
    let revealed = false;
    let epoch = 0;
    const conceal = () => { epoch++; revealed = false; paint(); };
    const box = h('div', { class: 'seed-box' });
    const next = button(tr('I’ve written it down'), { disabled: true, onClick: () => showVerify() });
    const tools = h('div', { class: 'seed-tools', hidden: true },
      h('button', { type: 'button', class: 'chip-btn neutral', onClick: conceal }, icon('eyeOff', 16), h('span', { text: tr('Hide') })),
      h('button', { type: 'button', class: 'chip-btn neutral', onClick: () => {
        const grant = epoch;
        copySeedWithWarning(flow.seed, () => revealed && grant === epoch && !document.hidden);
      } }, icon('copy', 16), h('span', { text: tr('Copy') })));
    const paint = () => {
      box.replaceChildren(seedText(flow.seed, revealed));
      tools.hidden = !revealed;
      if (!revealed) {
        box.append(h('div', { class: 'seed-cover' }, button(tr('Reveal seed'), {
          kind: 'secondary', iconName: 'eye', block: false,
          onClick: () => { if (document.hidden) return; revealed = true; next.disabled = false; paint(); },
        })));
      }
    };
    paint();
    const stopConcealing = onPrivacyHide(conceal);
    onLeave(() => { epoch++; revealed = false; stopConcealing(); box.replaceChildren(); });
    return shell({
      back: () => showCreateIntro({ back: true }), right: stepDots(2, 4),
      title: tr('Your secret seed'),
      lead: tr('Write these 55 letters down exactly, in order. Next, you’ll type them back to check your copy.'),
      body: [box, tools, notice('warn', 'alert', null, tr('Make sure nobody can see your screen. Never screenshot or share your seed.'))],
      foot: [next],
    });
  }, opts);
}

// Backup check: type the whole seed back from the written copy (spaces and case don't matter).
function showVerify(opts = {}) {
  let failures = 0;
  showScreen('create-verify', () => {
    const ta = seedArea(tr('Seed from your written copy'));
    const counter = h('span', { class: 'aside', text: '0/55' });
    const hint = h('p', { class: 'hint', 'aria-live': 'polite' });
    const confirm = button(tr('Confirm'), { disabled: true, onClick: check });
    ta.addEventListener('input', () => {
      autoGrow(ta);
      const typed = normalizeSeed(ta.value);
      counter.textContent = `${Math.min(typed.length, 99)}/55`;
      markField(ta, hint, false);
      hint.className = 'hint'; hint.textContent = '';
      confirm.disabled = typed.length !== 55;
    });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!confirm.disabled) check(); } });
    function check() {
      const typed = normalizeSeed(ta.value);
      if (typed === flow.seed) { ta.value = ''; showProtect(); return; }
      failures++;
      let i = 0;
      while (i < 55 && typed[i] === flow.seed[i]) i++;
      markField(ta, hint, true);
      hint.className = 'hint err';
      hint.textContent = failures >= 3
        ? tr('Still not matching at letter {position}. Go back and compare your written copy with the screen.', { position: i + 1 })
        : tr('That doesn’t match your seed. The first difference is at letter {position}.', { position: i + 1 });
    }
    onLeave(() => { ta.value = ''; });
    return shell({
      back: () => showSeed({ back: true }), right: stepDots(3, 4),
      title: tr('Confirm your backup'),
      lead: tr('Type your seed from your written copy, all 55 letters.'),
      body: [
        h('div', { class: 'field' }, h('div', { class: 'field-label' }, h('span', { text: tr('Your seed') }), counter), ta),
        hint,
      ],
      foot: [confirm],
    });
  }, opts);
}

// ── Import ──────────────────────────────────────────────────────────────────
function showImport(adding, opts = {}) {
  const why = signBlocked(); if (why) { toast(why, 'err'); return; }
  flow = { origin: 'import', kind: 'seed', adding, seed: null };
  showScreen('import', () => {
    const ta = seedArea(tr('Seed'), true);
    const counter = h('span', { class: 'aside', text: '0/55' });
    const hint = h('p', { class: 'hint', 'aria-live': 'polite' });
    const preview = h('div', { class: 'preview-card', hidden: true });
    const next = button(tr('Continue'), { disabled: true, onClick: proceed });
    const toggle = iconButton('eye', tr('Show seed'), () => {
      const masked = ta.classList.toggle('masked');
      toggle.replaceChildren(icon(masked ? 'eye' : 'eyeOff', 20));
      toggle.setAttribute('aria-label', masked ? tr('Show seed') : tr('Hide seed'));
    });
    const paste = pasteButton(ta, tr('Paste'), (t) => { ta.value = t; update(); });
    let current = null;
    // The address this seed controls, looked up on the network (only the address is sent): a seed with one wrong letter
    // is a different, empty account, and a balance, or none ever received, shows which one this is. Never in the way of
    // Continue; an answer for a seed that has since changed is dropped.
    let lookup = 0; let lookTimer = 0;
    const lookUp = (identity, line) => {
      const mine = ++lookup;
      clearTimeout(lookTimer);
      lookTimer = setTimeout(async () => {
        let text; let warn = false;
        // Nothing is said once its session has ended (a lock, or another tab's change): see openSession.
        const alive = sessionGuard();
        const current = () => mine === lookup && alive();
        try {
          const b = await fetchBalance(identity);
          if (!current()) return;
          // Core forgets an account once it's emptied, so a record with nothing in it doesn't mean the address was never
          // used: only an empty history in the archive says that.
          const used = b.amount > 0n || b.lastInTick || b.lastOutTick || (await fetchHistory(identity, 0, 1)).total > 0;
          if (!current()) return;
          if (b.amount > 0n) text = hidden() ? tr('This address holds QUBIC.') : tr('Balance: {amount} QUBIC.', { amount: fmtInt(b.amount) });
          else if (used) text = tr('This address has been used. Its balance is 0 QUBIC.');
          else { warn = true; text = tr('This address has never received QUBIC. If you expected funds here, compare your seed letter by letter: one wrong letter opens a different, empty account.'); }
        } catch {
          if (!current()) return;
          text = tr('Couldn’t check this address on the network.');
        }
        line.className = warn ? 'hint warn' : 'hint';
        line.textContent = text;
      }, 400);
    };
    function update() {
      autoGrow(ta);
      const seed = normalizeSeed(ta.value);
      counter.textContent = `${Math.min(seed.length, 99)}/55`;
      const c = checkSeed(seed);
      current = null;
      lookup++;
      preview.hidden = true;
      markField(ta, hint, c.state === 'invalid');
      hint.className = `hint ${c.state === 'invalid' ? 'err' : c.state === 'weak' ? 'warn' : ''}`;
      hint.textContent = c.message || (c.state === 'empty' ? tr('Spaces and line breaks are ignored.') : '');
      if (c.state === 'valid' || c.state === 'weak') {
        try {
          const acct = deriveAccount(seed);
          const dupe = accountByIdentity(acct.identity);
          current = { seed, dupe };
          const found = dupe ? null : h('p', { class: 'hint', 'aria-live': 'polite', text: tr('Checking this address on the network…') });
          preview.replaceChildren(
            h('div', { class: 'preview-head' }, h('span', { text: tr('This seed controls') }), badge(tr('Derived on this device'), 'accent')),
            addressText(acct.identity),
            dupe ? h('p', { class: 'hint ' + (dupe.kind === 'seed' ? 'err' : 'ok'), text: dupe.kind === 'seed' ? tr('Already in this wallet as “{name}”.', { name: dupe.name }) : tr('Upgrades your watch-only “{name}” so it can send.', { name: dupe.name }) })
              : h('p', { class: 'hint', text: tr('Check that this is the address you expect before continuing.') }),
            found);
          if (found) lookUp(acct.identity, found);
          preview.hidden = false;
        } catch (e) { hint.className = 'hint err'; hint.textContent = messageOf(e); }
      }
      next.disabled = !current || (current.dupe && current.dupe.kind === 'seed') || state.selfTest.status !== 'pass';
    }
    function proceed() {
      if (!current) return;
      flow.seed = current.seed;
      ta.value = '';
      showProtect();
    }
    ta.addEventListener('input', update);
    update();
    onLeave(() => { ta.value = ''; current = null; lookup++; clearTimeout(lookTimer); });
    return shell({
      back: exitFlow, right: stepDots(1, 2),
      title: tr('Import a seed'),
      lead: tr('Enter your 55-letter Qubic seed. It is processed only on this device and never sent anywhere.'),
      body: [
        h('div', { class: 'field' },
          h('label', { class: 'field-label' }, h('span', { text: tr('Seed') }), counter),
          h('div', { class: 'input-wrap' }, ta, h('div', { class: 'input-tools' }, toggle, paste)),
          hint),
        preview,
      ],
      foot: [next],
    });
  }, opts);
}

// ── Text fields (shared with Send, Messages and the address book) ───────────
// Grow a textarea to fit its content (CSSOM writes are allowed by the CSP).
function autoGrow(ta) {
  if (!ta.isConnected) { requestAnimationFrame(() => { if (ta.isConnected) autoGrow(ta); }); return; }
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

// onChange(id, hint): the address once it's valid (else null), and the hint under the field, which it may rewrite.
// tools: extra icon buttons before Paste (e.g. the address book in Send). end: the end of the hint's line, for a short
// text action (Send's Save to address book).
function identityField({ onChange, autofocus = true, tools = [] }) {
  const ta = h('textarea', {
    class: 'input mono', rows: '2', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false',
    placeholder: tr('60-letter Qubic address'), 'aria-label': tr('Address'), 'data-autofocus': autofocus ? '' : null, 'data-1p-ignore': '', 'data-lpignore': 'true',
  });
  const counter = h('span', { class: 'aside', text: '0/60' });
  const hint = h('p', { class: 'hint', 'aria-live': 'polite' });
  const end = h('span', { class: 'field-end' });
  const set = (v) => { ta.value = v; update(); };
  const paste = pasteButton(ta, tr('Paste address'), (t) => set(normalizeIdentity(t).slice(0, 80)));
  function update() {
    const raw = ta.value;
    const id = normalizeIdentity(raw);
    if (raw !== id && /[a-z\s]/.test(raw)) {
      const pos = ta.selectionStart;
      ta.value = id;
      const at = Math.min(pos, id.length); ta.setSelectionRange(at, at);
    }
    autoGrow(ta);
    counter.textContent = `${Math.min(id.length, 99)}/60`;
    const c = checkIdentity(id);
    markField(ta, hint, c.state === 'invalid');
    hint.className = `hint ${c.state === 'invalid' ? 'err' : c.state === 'valid' ? 'ok' : ''}`;
    hint.replaceChildren();
    if (c.state === 'valid') hint.append(icon('checkCircle', 15), h('span', { text: tr('Valid address') }));
    else if (c.message) hint.append(h('span', { text: c.message }));
    onChange(c.state === 'valid' ? id : null, hint);
  }
  ta.addEventListener('input', update);
  return {
    el: h('div', { class: 'field' },
      h('label', { class: 'field-label' }, h('span', { text: tr('Address') }), counter),
      h('div', { class: ['input-wrap', !tools.length && 'one'] }, ta, h('div', { class: 'input-tools' }, ...tools, paste)),
      h('div', { class: 'field-foot' }, hint, end)),
    set,
    end,
  };
}

// ── Watch-only ──────────────────────────────────────────────────────────────
function showWatch(adding, opts = {}) {
  flow = { origin: 'watch', kind: 'watch', adding };
  showScreen('watch', () => {
    let current = null;
    const next = button(tr('Continue'), { disabled: true, onClick: () => { flow.identity = current; showProtect(); } });
    const field = identityField({
      onChange(id, hint) {
        current = id;
        const dupe = id && accountByIdentity(id);
        if (dupe) { hint.className = 'hint err'; hint.replaceChildren(h('span', { text: tr('Already in this wallet as “{name}”.', { name: dupe.name }) })); current = null; }
        else if (id && identityKind(id) !== 'user') { hint.className = 'hint warn'; hint.replaceChildren(h('span', { text: tr('This is a smart contract or burn address.') })); }
        next.disabled = !current;
      },
    });
    return shell({
      back: exitFlow, right: stepDots(1, 2),
      title: tr('Watch an address'),
      lead: tr('Follow any Qubic address’s balance and activity. No seed needed. You won’t be able to send from it.'),
      body: [field.el],
      foot: [next],
    });
  }, opts);
}

// ── Protect (first wallet: storage choice) / Name (adding) ─────────────────
function showProtect(opts = {}) {
  const adding = flow.adding;
  const total = flow.origin === 'create' ? 4 : 2;
  showScreen('protect', () => {
    const nameInput = h('input', { class: 'input', maxlength: '32', autocomplete: 'off', 'aria-label': tr('Account name'), value: defaultAccountName(flow.kind) });
    const error = h('p', { class: 'hint err', role: 'alert' });
    const secureOk = secureStorageSupported();
    let mode = secureOk ? 'vault' : 'session';
    const f = passwordFields({ label: tr('Password'), repeat: tr('Repeat password'), placeholder: tr('At least {min} characters', { min: MIN_PASSWORD }), error, onLeave });
    const pwHint = h('p', { class: 'hint', text: tr('A long passphrase of unrelated words is best. It can’t be recovered if forgotten.') });
    const pwBlock = h('div', { class: 'field' }, h('label', { class: 'field-label', text: tr('Password') }), walletUsername(), f.pw, f.meter, f.pw2, pwHint);
    const submitLabel = adding ? tr('Add account') : flow.origin === 'watch' ? tr('Start watching') : flow.origin === 'import' ? tr('Import wallet') : tr('Create wallet');
    const submit = button(submitLabel, { type: 'submit' });

    const choice = (value, title, text, rec, disabled) => {
      const el = h('button', { type: 'button', class: 'choice', role: 'radio', 'aria-checked': String(mode === value), disabled },
        h('span', { class: 'radio', 'aria-hidden': 'true' }),
        h('span', null, h('span', { class: 'choice-title' }, title, rec ? badge(tr('Recommended'), 'accent') : null), h('span', { class: 'choice-text', text })));
      el.addEventListener('click', () => { mode = value; sync(); });
      return el;
    };
    const vaultChoice = choice('vault', tr('Encrypt on this device'),
      secureOk ? tr('Saved in this browser, encrypted with your password (Argon2id + AES-256-GCM). Unlock with the password next time.') : storageUnavailableReason(), true, !secureOk);
    const sessionChoice = choice('session', tr('This session only'),
      tr('Nothing is saved. Closing this tab forgets the wallet; restore it later with your seed.'), false, false);
    function sync() {
      vaultChoice.setAttribute('aria-checked', String(mode === 'vault'));
      sessionChoice.setAttribute('aria-checked', String(mode === 'session'));
      pwBlock.hidden = mode !== 'vault';
    }

    const form = h('form', { class: 'screen-body-form', novalidate: true });
    let saving = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      if (!flow) return;
      const draft = { kind: flow.kind, name: nameInput.value, seed: flow.seed, identity: flow.identity };
      const alive = sessionGuard();
      // The save belongs to this screen: Back is off while it runs, and if the screen is left anyway (another tab's
      // wallet took over, a lock), the save is undone and the wallet doesn't open (see startWallet).
      const started = flow;
      const screen = view.el;
      const keep = () => alive() && flow === started && view.el === screen;
      const backBtn = screen && screen.querySelector('.screen-top .icon-btn');
      if (!adding && mode === 'vault') {
        const problem = f.check();
        if (problem) { error.textContent = problem; (passwordScore(f.pw.value) < 2 ? f.pw : f.pw2).focus(); return; }
      }
      const restore = busy(submit, mode === 'vault' && !adding ? tr('Encrypting…') : tr('Opening…'));
      saving = true;
      if (backBtn) backBtn.disabled = true;
      try {
        if (adding) {
          await addAccount(draft);
          if (!alive()) return;
          dropFlow();
          showDashboard();
          toast(tr('Account added'));
        } else {
          const password = f.pw.value;
          f.clear();
          await startWallet({ draft, mode, password, auth: keep });
          dropFlow();
        }
      } catch (err) {
        saving = false;
        if (backBtn) backBtn.disabled = false;
        if (err.code === 'CANCELLED' && !keep()) return;
        restore();
        error.textContent = messageOf(err);
      }
    });
    sync();
    const backTo = () => {
      if (saving || !flow) return;
      if (flow.origin === 'create') { if (flow.seed) showVerify({ back: true }); else exitFlow(); }
      else if (flow.origin === 'import') showImport(adding, { back: true });
      else showWatch(adding, { back: true });
    };
    append(form, [
      h('div', { class: 'field' }, h('label', { class: 'field-label', text: tr('Account name') }), nameInput),
      adding ? null : h('div', { class: 'field', role: 'radiogroup', 'aria-label': tr('Where to keep this wallet') },
        h('span', { class: 'field-label', text: tr('Where to keep it') }), vaultChoice, sessionChoice),
      adding ? null : pwBlock,
      error,
      h('div', { class: 'screen-foot' }, submit),
    ]);
    return shell({
      back: backTo, right: stepDots(total, total),
      title: adding ? tr('Name this account') : tr('Protect your wallet'),
      lead: adding ? tr('Shown in the account switcher. Only you see it.') : tr('Choose whether this browser should remember the wallet.'),
      body: [form],
    });
  }, opts);
}

// ── Unlock ──────────────────────────────────────────────────────────────────
let unlockFailures = 0;
let unlockNotBefore = 0;
function showUnlock(opts = {}) {
  // A locked screen holds no secrets: a create or import draft goes too, whatever led here (another tab saving a wallet
  // while this one was on Create or Import, for one).
  dropFlow();
  state.phase = 'locked';
  showScreen('unlock', () => {
    const error = h('p', { class: 'hint err', role: 'alert' });
    const pw = currentPasswordField({ label: tr('Password'), autofocus: true, error, onLeave });
    const submit = button(tr('Unlock'), { type: 'submit', iconName: 'lock' });
    let corrupt = false;
    try { Vault.readHeader(); } catch { corrupt = true; }
    const forgot = button(tr('Forgot password?'), { kind: 'ghost', onClick: forgotPassword });
    // Glad to see you while it's locked; it lights up in the accent colour when the password is right, and shakes its
    // head when it isn't.
    const greeter = qoreeFace('happy', 56);
    const dimGreeter = () => greeter.classList.remove('awake');
    const form = h('form', { novalidate: true }, h('div', { class: 'field' }, walletUsername(), pw.input, error), h('div', { class: 'screen-foot' }, submit, forgot));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!pw.input.value) { pw.input.focus(); return; }
      const wait = unlockNotBefore - Date.now();
      if (wait > 0) { error.textContent = tr('Too many attempts. Try again in {seconds}s.', { seconds: Math.ceil(wait / 1000) }); return; }
      error.textContent = '';
      pw.input.setAttribute('aria-invalid', 'false');
      const password = pw.take();
      // Fenced by the session: if the wallet is erased or reset while this runs, its result is thrown away and no
      // reload key is kept. Erasing can't start from here meanwhile.
      const auth = sessionGuard();
      const restore = busy(submit, tr('Unlocking…'));
      forgot.disabled = true;
      try {
        const opened = await Vault.open(password, { auth });
        unlockFailures = 0;
        // Before the wallet is taken in, so the checks in adoptVault still come right before it opens.
        if (!reducedMotion()) {
          greeter.classList.add('awake');
          await sleep(400);
        }
        // Taken in only if nothing superseded it; otherwise nothing stays (see adoptVault).
        await adoptVault(opened, auth);
        enterWallet({ reveal: true });
      } catch (err) {
        if (err.code === 'CANCELLED' || err.code === 'STALE') {
          // Superseded by a change in another tab: not a wrong password. Erased there: back to the start, even if its
          // notice never arrives. Still here: unlock again.
          if (state.phase !== 'locked' || !pw.input.isConnected) return;
          if (!Vault.exists()) { endSession(); return; }
          restore(); forgot.disabled = false;
          dimGreeter();
          error.textContent = tr('The wallet changed in another tab. Unlock again.');
          return;
        }
        restore();
        forgot.disabled = false;
        unlockFailures++;
        if (unlockFailures >= 3) unlockNotBefore = Date.now() + Math.min(30000, 1000 * 2 ** (unlockFailures - 3));
        pw.fail(err);
        if (greeter.classList.contains('awake')) dimGreeter(); else greeter.move('shake');
      }
    });
    return shell({
      cls: 'unlock', right: languageChip(),
      body: [
        h('div', { class: 'unlock-head arrive-children' }, h('div', { class: 'unlock-face' }, greeter),
          h('h1', { class: 'screen-title', tabindex: '-1', text: tr('Welcome back') }),
          h('p', { class: 'screen-lead', text: tr('Unlock your wallet to continue.') })),
        corrupt ? notice('error', 'alert', tr('Saved wallet unreadable'), tr('The encrypted data in this browser is damaged or in an unknown format. Restore from your seed and erase it.')) : null,
        form,
      ],
    });
  }, opts);
}

// Locked, unsettled transfers can't be counted, only seen to be there: the saved wallet has a journal part only while
// some are unsettled. Erasing forgets them and can't cancel them.
async function forgotPassword() {
  const stored = Vault.current();
  const journal = Boolean(stored && stored.pending);
  const ok = await confirmDialog({
    title: tr('Forgot your password?'),
    message: journal ? tr('The password can’t be recovered or reset. You can erase the encrypted wallet from this browser and import your seed again. Without your seed, erasing loses access to the funds for good.'
      + ' It still holds transfers you sent that hadn’t settled when it was last open. Erasing forgets them and won’t cancel them: check the explorer before sending again.')
      : tr('The password can’t be recovered or reset. You can erase the encrypted wallet from this browser and import your seed again. Without your seed, erasing loses access to the funds for good.'),
    confirmLabel: tr('Erase wallet from this browser'), danger: true, requireText: trLater('ERASE'),
  });
  if (ok && await forgetEverything()) toast(tr('Encrypted wallet erased from this browser'), 'info');
}

function enterWallet(opts = {}) {
  state.phase = 'ready';
  state.lastActivity = Date.now();
  showDashboard(opts);
  refreshAll();
}
