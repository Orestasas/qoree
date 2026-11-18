// Production seed-display handlers with a small DOM/event stand-in. Password checks are deferred so background,
// focus-return, navigation and lock races are deterministic; no real credentials or network are used.
const path = require('path');
const { pickFunction, runApp, mutable, SESSIONS } = require('./lib/load.cjs');
const { check, finish, harnessError } = require('./lib/check.cjs');
const SRC = path.resolve(process.argv[2]);
const app = mutable([['07-ui.js', 'onPrivacyHide'], ['08-onboarding.js', 'seedText'], ['08-onboarding.js', 'showSeed'],
  ['08-onboarding.js', 'copySeedWithWarning'], ['10-sheets.js', 'passwordInputs'], ['10-sheets.js', 'currentPasswordField'], ['10-sheets.js', 'revealSeedPane']]
  .map(([file, name]) => pickFunction(SRC, file, name)).join('\n'));
app.mutation('privacy-late-reveal', 'if (active && attempt === epoch && alive() && area.isConnected) reveal();',
  'if (active && alive() && area.isConnected) reveal();');
app.mutation('privacy-blur', "  window.addEventListener('blur', conceal);", '');
app.mutation('privacy-copy', 'if (!ok || !allowed()) return;', 'if (!ok) return;');
const SEED = 'abcdefghijklmnopqrstuvwxyz'.repeat(3).slice(0, 55);
// The lock screen, reached with a create or import draft open (another tab saved a wallet meanwhile): it drops the draft.
const unlock = mutable(pickFunction(SRC, '08-onboarding.js', 'showUnlock'));
unlock.mutation('unlock-keeps-draft', '  dropFlow();\n  state.phase', '  state.phase');
// Every form with a password field, built with the shared fields (passwordInputs, currentPasswordField, passwordFields):
// the unlock screen, Reveal seed, Encrypt wallet, Change password, Download backup (the wallet's password, or a new one
// for a session-only wallet) and Check backup file. Faults: typing leaves the error, leaving keeps the fields, a field
// read for a check keeps its password, and the backup file's password offered for autofill.
const forms = mutable([['07-ui.js', 'onPrivacyHide'], ['10-sheets.js', 'passwordInputs'], ['10-sheets.js', 'currentPasswordField'],
  ['10-sheets.js', 'passwordFields'], ['08-onboarding.js', 'showUnlock'], ['10-sheets.js', 'revealSeedPane'], ['10-sheets.js', 'enableEncryptionPane'],
  ['10-sheets.js', 'changePasswordPane'], ['10b-backup-ui.js', 'backupExportPane'], ['10b-backup-ui.js', 'backupFilePane']]
  .map(([file, name]) => pickFunction(SRC, file, name)).join('\n'));
forms.mutation('password-error-kept', "{ error.textContent = ''; for (const el of inputs) el.setAttribute('aria-invalid', 'false'); }", '{}');
forms.mutation('password-kept-on-leave', "  onLeave(() => { for (const input of inputs) input.value = ''; });\n", '');
forms.mutation('password-kept-while-checked', "      const value = input.value;\n      input.value = '';\n", '      const value = input.value;\n');
forms.mutation('backup-file-autocomplete', "autocomplete: 'off', error: err", 'error: err');
// Change password emptying the new pair along with a current password that may be wrong.
forms.mutation('change-clears-pair', '    const oldPassword = current.take(); const newPassword = f.pw.value;\n',
  '    const oldPassword = current.take(); const newPassword = f.pw.value;\n    f.clear();\n');
// mode: the wallet's ('vault' or 'session'). Each form: open() → { root, leave() }; checks never resolve.
function formsApp(mode) {
  return runApp(`
    const window = new EventTarget(); const document = new EventTarget(); document.hidden = false; document.activeElement = null;
    class Element {
      constructor(tag, props, children) {
        this.tag = tag; this.attrs = {}; this.listeners = {}; this.value = ''; this.isConnected = true; this.dataset = {}; this.files = null;
        this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
        for (const [k, v] of Object.entries(props || {})) {
          if (v == null || v === false) continue;
          if (k === 'text') this.text = v;
          else if (k.startsWith('on') && typeof v === 'function') this.addEventListener(k.slice(2).toLowerCase(), v);
          else this.attrs[k] = v === true ? '' : String(v);
        }
        this.children = children.flat(Infinity).filter((v) => v != null && v !== false);
      }
      addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
      fire(name, e = {}) { for (const fn of this.listeners[name] || []) fn({ preventDefault() {}, ...e }); }
      setAttribute(k, v) { this.attrs[k] = String(v); }
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
      focus() { document.activeElement = this; }
      select() {}
      replaceChildren(...c) { this.children = c.flat(Infinity).filter((v) => v != null); }
      append(...c) { this.children.push(...c.flat(Infinity).filter((v) => v != null)); }
      querySelectorAll(tag) { return this.children.flatMap((c) => (c instanceof Element ? [...(c.tag === tag ? [c] : []), ...c.querySelectorAll(tag)] : [])); }
      get textContent() { return (this.text || '') + this.children.map((c) => (c instanceof Element ? c.textContent : String(c))).join(''); }
      set textContent(value) { this.text = value; this.children = []; }
    }
    const h = (tag, props, ...children) => new Element(tag, props, children);
    const tr = (s) => s; const trLater = (s) => s; const icon = () => null; const notice = () => null; const walletUsername = () => null;
    const button = (text, props = {}) => h('button', { text, ...props });
    const uid = (() => { let n = 0; return (p) => p + '-' + ++n; })();
    const MIN_PASSWORD = 10; const passwordScore = () => 4; const BACKUP_MAX_BYTES = 1048576;
    const messageOf = (e) => e.message;
    ${SESSIONS}
    const state = { mode: ${JSON.stringify(mode)}, phase: 'ready', session: openSession(), vault: { key: 'key', header: {} } };
    const never = () => new Promise(() => {});
    const Vault = { readHeader() {}, open: never, create: never };
    const Backup = { create: never, open: never };
    const editWallet = never;
    const busy = () => () => {}; const ensureUnlocked = () => true; const backupAuth = () => {};
    const account = { id: 'test', name: 'Test', seed: 'seed' }; const accountById = () => account;
    let unlockFailures = 0; let unlockNotBefore = 0;
    const dropFlow = () => {}; const forgotPassword = () => {}; const languageChip = () => null;
    const qoreeFace = () => Object.assign(h('div'), { move() {} });
    const shell = (parts) => h('main', null, parts.body);
    let screen = null; let leave = null;
    const showScreen = (name, render) => { if (leave) leave(); leave = null; screen = render(); };
    const onLeave = (fn) => { const before = leave; leave = before ? () => { before(); fn(); } : fn; };
    const makeSheet = () => ({ nodes: [], cleanups: [], onPaneLeave(fn) { this.cleanups.push(fn); },
      setPane(nodes, opts = {}) { this.nodes = [nodes, opts.footer]; }, close() { this.cleanups.splice(0).forEach((fn) => fn()); } });
    const inSheet = (build) => { const sheet = makeSheet(); build(sheet); return { root: h('div', null, sheet.nodes), leave: () => sheet.close() }; };
    ${forms.text}
    return {
      document,
      unlock: () => { showUnlock(); return { root: screen, leave: () => { if (leave) leave(); } }; },
      reveal: () => inSheet((s) => revealSeedPane(s, 'test', () => {})),
      encrypt: () => inSheet((s) => enableEncryptionPane(s, () => {})),
      change: () => inSheet((s) => changePasswordPane(s, () => {})),
      backup: () => inSheet((s) => backupExportPane(s, () => {})),
      check: () => inSheet((s) => backupFilePane(s, () => {}, false)),
    };
  `, null);
}
function setup(mode = 'vault') {
  return runApp(`
    const window = new EventTarget(); const document = new EventTarget(); document.hidden = false;
    class Element {
      constructor(tag, props = {}, children = []) {
        this.tag = tag; this.props = props || {}; this.events = {}; this.value = ''; this.isConnected = true;
        Object.assign(this, this.props); this.children = children.flat(Infinity).filter(v => v != null);
      }
      addEventListener(name, fn) { this.events[name] = fn; }
      setAttribute(k, v) { this.props[k] = String(v); }
      focus() {}
      replaceChildren(...children) { this.children = children.flat(Infinity).filter(v => v != null); }
      append(...children) { this.children.push(...children.flat(Infinity).filter(v => v != null)); }
      querySelectorAll(tag) { return this.children.flatMap(c => c instanceof Element ? [...(c.tag === tag ? [c] : []), ...c.querySelectorAll(tag)] : []); }
      get textContent() { return (this.text || '') + this.children.map(c => c instanceof Element ? c.textContent : String(c)).join(''); }
      set textContent(value) { this.text = value; this.children = []; }
    }
    const h = (tag, props, ...children) => new Element(tag, props, children);
    const tr = s => s; const icon = () => null; const stepDots = () => null; const walletUsername = () => null;
    const uid = p => p + '-1';
    const button = (text, props = {}) => h('button', { text, ...props }); const notice = () => null;
    const shell = parts => h('main', null, parts.body, parts.foot);
    const flow = { seed: ${JSON.stringify(SEED)} };
    const account = { id: 'test', name: 'Test', seed: flow.seed };
    ${SESSIONS}
    const state = { mode: ${JSON.stringify(mode)}, phase: 'ready', session: openSession() };
    const accountById = () => account;
    const ensureUnlocked = () => state.phase === 'ready';
    const busy = el => { el.disabled = true; return () => { el.disabled = false; }; };
    const messageOf = () => 'Incorrect password.';
    const showVerify = () => {}; const showCreateIntro = () => {}; const toast = () => {};
    const clipboard = []; const copyText = async seed => { clipboard.push(seed); return true; };
    let confirm; const confirmDialog = () => new Promise(resolve => { confirm = resolve; });
    let screen, leave; const showScreen = (name, render) => { if (leave) leave(); leave = null; screen = render(); };
    const onLeave = fn => { leave = fn; };
    let pending;
    const Vault = { open: () => new Promise((resolve, reject) => { pending = { resolve, reject }; }) };
    const makeSheet = () => ({ nodes: [], cleanups: [],
      onPaneLeave(fn) { this.cleanups.push(fn); }, setPane(nodes) { this.nodes = nodes; },
      close() { this.cleanups.splice(0).forEach(fn => fn()); } });
    ${app.text}
    return { window, document, state, nextSession, flow, account, makeSheet, revealSeedPane, showSeed,
      screen: () => screen, leave: () => leave(), pending: () => pending, confirm: () => confirm(true), clipboard };
  `, null);
}
function find(node, test) {
  if (!node || typeof node !== 'object') return null;
  if (test(node)) return node;
  for (const child of node.children || []) { const hit = find(child, test); if (hit) return hit; }
  return null;
}
const click = (root, label) => {
  const target = find(root, n => n.tag === 'button' && n.textContent === label);
  if (!target) { check(`expected button remains available: ${label}`, false); return; }
  return target.onClick();
};
const hidden = root => !root.textContent.includes(SEED);
function event(t, name) {
  if (name === 'visibilitychange') { t.document.hidden = true; t.document.dispatchEvent(new Event(name)); }
  else t.window.dispatchEvent(new Event(name));
}
function foreground(t) { t.document.hidden = false; t.document.dispatchEvent(new Event('visibilitychange')); t.window.dispatchEvent(new Event('focus')); }
function pane(t) {
  const sheet = t.makeSheet(); t.revealSeedPane(sheet, 'test', () => {});
  const area = sheet.nodes[1];
  const submit = () => {
    const form = find(area, n => n.tag === 'form');
    if (!form) { check('authentication prompt remains available', false); return Promise.resolve(); }
    const pw = find(form, n => n.tag === 'input'); pw.value = 'synthetic test password';
    const done = form.events.submit({ preventDefault() {} });
    check('password field cleared when checking begins', pw.value === '');
    return done;
  };
  return { sheet, area, submit };
}
(async () => {
  {
    const t = setup('session'); t.showSeed(); const root = t.screen();
    check('new seed starts concealed', hidden(root));
    for (const name of ['blur', 'visibilitychange', 'pagehide']) {
      click(root, 'Reveal seed'); check(`new seed can be revealed before ${name}`, !hidden(root));
      event(t, name); check(`new seed removed from DOM on ${name}`, hidden(root));
      foreground(t); check('returning does not reveal or discard the draft', hidden(root) && t.flow.seed === SEED);
    }
    t.leave(); t.flow.seed = 'other'; event(t, 'blur');
    check('leaving unregisters concealment without repainting the old seed box', !root.textContent.includes('•') && hidden(root));
  }
  for (const name of ['blur', 'visibilitychange', 'pagehide']) {
    const t = setup(); const p = pane(t);
    check('saved seed starts behind password entry', hidden(p.area) && !!find(p.area, n => n.tag === 'form'));
    const done = p.submit(); event(t, name); foreground(t); t.pending().resolve(); await done;
    check(`password check cannot reveal after ${name}, even after returning`, hidden(p.area) && !!find(p.area, n => n.tag === 'form'));
    const retry = p.submit(); t.pending().resolve(); await retry;
    check('fresh authentication can reveal the saved seed', !hidden(p.area));
    event(t, name); foreground(t);
    check(`revealed saved seed concealed on ${name}, requiring fresh authentication`, hidden(p.area) && !!find(p.area, n => n.tag === 'form'));
    check('concealment preserves the wallet seed', t.account.seed === SEED);
    p.sheet.close();
  }
  {
    const t = setup(); const p = pane(t); const done = p.submit();
    p.sheet.close(); t.pending().resolve(); await done; event(t, 'blur');
    check('leaving during password check cannot repaint the closed pane', p.area.children.length === 0);
  }
  {
    const t = setup(); const p = pane(t); const done = p.submit();
    t.nextSession(); t.state.phase = 'locked'; t.account.seed = null; t.pending().resolve(); await done;
    check('locking during authentication prevents seed reveal', hidden(p.area));
  }
  {
    const t = setup(); const p = pane(t); const done = p.submit(); t.pending().reject(new Error('wrong')); await done;
    check('wrong password shows an error without revealing the seed', hidden(p.area) && p.area.textContent.includes('Incorrect password.'));
  }
  {
    const t = setup('session'); const p = pane(t);
    click(p.area, 'Reveal seed'); event(t, 'blur'); foreground(t);
    check('session-only seed is concealed without destroying the only in-memory copy', hidden(p.area) && t.account.seed === SEED && t.state.phase === 'ready');
    click(p.area, 'Reveal seed'); check('session-only seed can be explicitly revealed again', !hidden(p.area));
  }
  for (const mode of ['draft', 'session', 'vault']) {
    const t = setup(mode === 'draft' ? 'session' : mode);
    let root;
    if (mode === 'draft') { t.showSeed(); root = t.screen(); click(root, 'Reveal seed'); }
    else {
      const p = pane(t); root = p.area;
      if (mode === 'vault') { const done = p.submit(); t.pending().resolve(); await done; }
      else click(root, 'Reveal seed');
    }
    click(root, 'Copy'); event(t, 'blur'); foreground(t); t.confirm(); await Promise.resolve();
    check(`${mode}: a pending copy confirmation expires on focus loss`, t.clipboard.length === 0);
  }
  {
    const t = setup('session'); const p = pane(t);
    click(p.area, 'Reveal seed'); click(p.area, 'Copy'); t.confirm(); await Promise.resolve();
    check('explicit copying still works while the reveal remains authorized', t.clipboard[0] === SEED);
  }
  {
    const t = runApp(`
      let flow = { seed: ${JSON.stringify(SEED)} };
      const state = { phase: 'welcome' };
      const dropFlow = () => { if (flow) flow.seed = null; flow = null; };
      const showScreen = () => {};
      ${unlock.text}
      return { showUnlock, flow: () => flow, state };`, null);
    const draft = t.flow();
    t.showUnlock();
    check('reaching the lock screen drops a create or import draft and its seed', t.flow() === null && draft.seed === null && t.state.phase === 'locked');
  }
  // The shared password behaviour, in every form: the autocomplete each field asks for (current-password, new-password,
  // 'off' only for a backup file's password), the form's error cleared as soon as you type in any of its password
  // fields, a field emptied as soon as it's read for a check (Change password's new pair stays until the change is made,
  // so a wrong current password is the only one typed again), and all of them emptied when the form is left.
  {
    const FORMS = [['vault', 'unlock', ['current-password']], ['vault', 'reveal', ['current-password']],
      ['session', 'encrypt', ['new-password', 'new-password']], ['vault', 'change', ['current-password', 'new-password', 'new-password']],
      ['vault', 'backup', ['current-password']], ['session', 'backup', ['new-password', 'new-password']], ['vault', 'check', ['off']]];
    const passwords = (root) => {
      const out = [];
      (function walk(n) { if (!n || typeof n !== 'object') return; if (n.tag === 'input' && n.attrs.type === 'password') out.push(n); (n.children || []).forEach(walk); })(root);
      return out;
    };
    for (const [mode, name, autocomplete] of FORMS) {
      const label = `${name}${name === 'backup' ? ` (${mode})` : ''}`;
      const t = formsApp(mode);
      let f = t[name](); let fields = passwords(f.root);
      const got = fields.map((el) => el.getAttribute('autocomplete'));
      check(`password ${label}: autocomplete is ${autocomplete.join(', ')}`, got.join() === autocomplete.join(), got.join());
      const error = find(f.root, (n) => n.tag === 'p' && n.attrs.class === 'hint err');
      const cleared = fields.every((el) => { error.textContent = 'Incorrect password.'; el.value = 'x'; el.fire('input'); return error.textContent === ''; });
      check(`password ${label}: typing in a field clears the error`, Boolean(error) && fields.length > 0 && cleared);
      for (const el of fields) el.value = 'a typed password';
      f.leave();
      check(`password ${label}: leaving empties every field`, fields.every((el) => el.value === ''));
      f = t[name](); fields = passwords(f.root);
      for (const el of fields) el.value = 'a typed password';
      if (name === 'check') find(f.root, (n) => n.tag === 'input' && n.attrs.type === 'file').files = [{ size: 10, text: () => new Promise(() => {}) }];
      find(f.root, (n) => n.tag === 'form').fire('submit');
      const kept = name === 'change' ? fields.slice(1) : [];
      check(`password ${label}: emptied as soon as it's read for a check${kept.length ? ', the new pair kept' : ''}`,
        fields.every((el) => (kept.includes(el) ? el.value !== '' : el.value === '')), fields.map((el) => el.value || '(empty)').join(', '));
    }
  }
  finish('seed privacy');
})().catch(harnessError);
