// Languages (src/js 00–01b, src/i18n): the translation runtime (placeholders, plurals, selects, a broken translation
// falling back to English, right-to-left isolation), number and date formatting in each language (English exactly as
// it was before the app had languages), typed amounts read the way the language writes them, and every translation:
// it parses, fills in the same placeholders as its English, gives every plural form the language has, and formats.
// Usage: node i18n.cjs <src dir>
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const { check, fault, finish } = require('./lib/check.cjs');
const { appScript, runApp } = require('./lib/load.cjs');
const SRC = process.argv[2];

// The translations as assemble.py puts them in (all of them: a table's messages the code no longer has are harmless).
const tables = {};
const dir = path.join(SRC, 'i18n');
for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort() : []) tables[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const MARK = '/* @@I18N@@ */';
const embedded = Object.entries(tables).map(([id, t]) => `${JSON.stringify(id)}: Object.freeze(${JSON.stringify(t)})`).join(', ');
const code = appScript(SRC, ['00-config.js', '01-util.js', '01b-i18n.js']).replace(MARK, embedded);
globalThis.window = { isSecureContext: true };
// Node has a navigator of its own, which plain assignment doesn't replace.
const setNavigator = (value) => Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
setNavigator({ languages: ['en-US'] });
globalThis.document = { documentElement: {}, title: '' };
class FakeNode { constructor(t) { this.textContent = t; } }
globalThis.Node = FakeNode;
const app = runApp(`const state = { prefs: { lang: null, priceUnit: 'unit' } };\n${code}
return { state, LANGUAGES, tr, trc, trLater, formatMessage, messageFor, trEnglish, parseMessage, applyLanguage, pickLanguage, AppError, messageOf, errorText,
  setLang: (id) => { state.prefs.lang = id; applyLanguage(); }, fmtInt, fmtNum, groupDigits, fmtCompact, fmtUsd, usdParts, fmtPrice, fmtPct, fmtBillions,
  fmtPlain, timeAgo, fmtDuration, parseDecimalInput, parseWholeAmount };`, null);
const { LANGUAGES, tr, trc, setLang } = app;
const catalog = JSON.parse(execFileSync('python3', [path.join(SRC, 'i18n_catalog.py'), path.join(SRC, 'js'), '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 })).messages;

// ── English, exactly as before ──────────────────────────────────────────────
setLang('en');
const now = Date.now();
const english = [
  ['fmtInt', app.fmtInt(1234567n), '1,234,567'], ['fmtInt negative', app.fmtInt(-1234567n), '−1,234,567'], ['fmtInt zero', app.fmtInt(0n), '0'],
  ['groupDigits', app.groupDigits('1000000'), '1,000,000'], ['fmtCompact small', app.fmtCompact(12345), '12,345'],
  ['fmtCompact', app.fmtCompact(12345678901), '12.35B'], ['fmtCompact K', app.fmtCompact(150000), '150K'],
  ['fmtUsd', app.fmtUsd(1234.5), '$1,234.50'], ['fmtUsd tiny', app.fmtUsd(0.004), '<$0.01'], ['fmtUsd compact', app.fmtUsd(123456789, { compact: true }), '$123.46M'],
  ['fmtUsd none', app.fmtUsd(null), '—'], ['fmtUsd whole', app.fmtUsd(25, { whole: true }), '$25'],
  ['usdParts', JSON.stringify(app.usdParts(1234.5)), JSON.stringify({ major: '$1,234', minor: '.50' })],
  ['usdParts tiny', JSON.stringify(app.usdParts(0.004)), JSON.stringify({ major: '<$0', minor: '.01' })],
  ['fmtPrice tiny', app.fmtPrice(4.51e-7), '$0.000000451'], ['fmtPrice', app.fmtPrice(1.5), '$1.50'],
  ['fmtPct up', app.fmtPct(3.4), '+3.40%'], ['fmtPct down', app.fmtPct(-1.25), '−1.25%'], ['fmtPct flat', app.fmtPct(0.001), '0.00%'],
  ['fmtBillions', app.fmtBillions(1234567890n), '1.23'], ['fmtBillions small', app.fmtBillions(5000000n), '0.005'], ['fmtBillions zero', app.fmtBillions(0n), '0'],
  ['timeAgo now', app.timeAgo(now - 3000), 'just now'], ['timeAgo s', app.timeAgo(now - 15000), '15s ago'], ['timeAgo m', app.timeAgo(now - 180000), '3m ago'],
  ['timeAgo h', app.timeAgo(now - 7200000), '2h ago'], ['timeAgo d', app.timeAgo(now - 4 * 86400000), '4d ago'],
  ['fmtDuration s', app.fmtDuration(45000), '45s'], ['fmtDuration m', app.fmtDuration(185000), '3m 5s'],
  ['fmtPlain', app.fmtPlain(4.51e-7, 9), '0.000000451'],
];
for (const [name, got, want] of english) check(`English ${name}: ${want}`, got === (fault('english-format') && name === 'fmtUsd' ? '$1,234.5' : want), `got ${JSON.stringify(got)}`);

// ── The runtime ─────────────────────────────────────────────────────────────
check('tr: English as written', tr('Hold to send') === 'Hold to send');
check('tr: placeholders', tr('Sent {amount} to {name}', { amount: '1,000', name: 'Main' }) === 'Sent 1,000 to Main');
check('tr: a missing value stays visible', tr('To {name}') === 'To {name}');
check('tr: a number is formatted', tr('{n} items', { n: 12345 }) === '12,345 items');
const plural = '{count, plural, =0 {No accounts} one {# account} other {# accounts}}';
check('tr: plural =0', tr(plural, { count: 0 }) === 'No accounts');
check('tr: plural one', tr(plural, { count: 1 }) === '1 account');
check('tr: plural other', tr(plural, { count: 1500 }) === '1,500 accounts');
check('tr: select', tr('{kind, select, seed {With its seed} other {Watch-only}}', { kind: 'seed' }) === 'With its seed'
  && tr('{kind, select, seed {With its seed} other {Watch-only}}', { kind: 'watch' }) === 'Watch-only');
check('tr: # in a select inside a plural', tr('{n, plural, one {{k, select, a {# A} other {# B}}} other {# C}}', { n: 1, k: 'a' }) === '1 A');
check('tr: select keys are not inherited names', tr('{k, select, a {A} other {B}}', { k: 'constructor' }) === 'B');
const node = new FakeNode('link');
const rich = app.formatMessage(app.messageFor('Open {link} now', 'Open {link} now'), { link: node }, true);
check('an element can stay an element', rich.length === 3 && rich[0] === 'Open ' && rich[1] === node && rich[2] === ' now');
check('tr: an element in tr gives its text', tr('Open {link}', { link: node }) === 'Open link');
for (const bad of ['{', '}', '{a', '{a, plural, one {x}}', '{a, choice, other {x}}', '{a, plural, other {x}']) {
  let threw = false;
  try { app.parseMessage(bad); } catch { threw = true; }
  check(`parseMessage refuses ${JSON.stringify(bad)}`, threw);
}
const err = new app.AppError('WEAK_PASSWORD');
check('AppError: English message filled in', err.message === 'Use a password of at least 10 characters that isn’t easy to guess.', err.message);
check('messageOf: filled in', app.messageOf(err) === err.message);
const both = new app.AppError('JOURNAL', [app.trLater('First.'), app.trLater('Second {n}.')], { n: 2 });
check('AppError: a list of sentences', both.message === 'First. Second 2.' && app.messageOf(both) === 'First. Second 2.', both.message);
check('errorText', app.errorText('LOCKED') === 'The wallet is locked.');

// The same with a language's table: a translation, a broken one, a context, isolation in right-to-left text.
const fakeTable = { 'Hold to send': 'Mantén para enviar', 'Sent {amount} to {name}': 'Enviaste {amount} a {name}', 'Fine {x}': 'Bien {x', 'tile\u0004Send': 'Envío' };
const runWith = (id, table) => runApp(`const state = { prefs: { lang: ${JSON.stringify(id)} } };\n${appScript(SRC, ['00-config.js', '01-util.js', '01b-i18n.js']).replace(MARK, `${JSON.stringify(id)}: ${JSON.stringify(table)}`)}
applyLanguage(); return { tr, trc, trEnglish, lang: () => lang, fmtUsd, usdParts, fmtPct, groupDigits, parseDecimalInput, AppError, messageOf };`, null);
const es = runWith('es-419', fakeTable);
check('a translation is used', es.tr('Hold to send') === 'Mantén para enviar');
check('a translation fills placeholders', es.tr('Sent {amount} to {name}', { amount: '5', name: 'A' }) === 'Enviaste 5 a A');
check('a broken translation falls back to English', es.tr('Fine {x}', { x: '1' }) === 'Fine 1');
check('trc uses its own entry', es.trc('tile', 'Send') === 'Envío' && es.tr('Send') === 'Send');
check('trEnglish ignores the table', es.trEnglish('Hold to send') === 'Hold to send' && es.tr('Hold to send') === 'Mantén para enviar');
check('page lang and dir follow the language', globalThis.document.documentElement.lang === 'es-419' && globalThis.document.documentElement.dir === 'ltr');
const ar = runWith('ar', { 'To {name}': 'إلى {name}' });
check('right to left: a filled-in text is isolated', ar.tr('To {name}', { name: 'Main' }) === 'إلى ⁨Main⁩');
check('right to left: numbers are not', ar.tr('{n} items', { n: 5 }) === '5 items');
check('page dir is rtl for Arabic', globalThis.document.documentElement.dir === 'rtl');
const fr = runWith('fr-FR', {});
check('French dollars use a decimal comma', /1\s234,50/.test(fr.fmtUsd(1234.5)), fr.fmtUsd(1234.5));
check('French cents split at the comma', fr.usdParts(1234.5).minor.startsWith(',50'), JSON.stringify(fr.usdParts(1234.5)));
check('French percent', /^\+3,40\s%$/.test(fr.fmtPct(3.4)), fr.fmtPct(3.4));
check('no direction marks in Arabic amounts', !/[‎‏؜]/.test(ar.fmtUsd(1234.5) + ar.fmtPct(-2)), JSON.stringify(ar.fmtUsd(1234.5)));

// The browser's languages pick only a reviewed language, and Traditional Chinese never gets Simplified.
const pick = (langs, reviewed) => {
  setNavigator({ languages: langs });
  const saved = LANGUAGES.map((l) => l.reviewed);
  LANGUAGES.forEach((l) => { l.reviewed = l.id === 'en' || reviewed.includes(l.id); });
  const got = app.pickLanguage(null).id;
  LANGUAGES.forEach((l, i) => { l.reviewed = saved[i]; });
  return got;
};
check('unreviewed languages are never picked from the browser', pick(['fr-FR', 'en'], []) === 'en');
check('a reviewed language is picked from the browser', pick(['fr-CA', 'en'], ['fr-FR']) === 'fr-FR');
check('English first in the browser wins', pick(['en-GB', 'fr-FR'], ['fr-FR']) === 'en');
check('zh-TW is not given Simplified Chinese', pick(['zh-TW'], ['zh-Hans']) === 'en');
check('zh-CN is given Simplified Chinese', pick(['zh-CN'], ['zh-Hans']) === 'zh-Hans');
check('a picked language wins', app.pickLanguage('ar').id === 'ar');
setNavigator({ languages: ['en-US'] });

// ── Typed amounts ───────────────────────────────────────────────────────────
// [input, English, French]: what each reads it as (null: refused).
const typed = [
  ['5', 5, 5], ['12.5', 12.5, 12.5], ['12,5', 12.5, 12.5], ['1,250', 1250, 1.25], ['1.250', 1.25, null], ['1,250.50', 1250.5, 1250.5],
  ['1.250,50', 1250.5, 1250.5], ['1 250,50', 1250.5, 1250.5], ['$0.0000012', 0.0000012, 0.0000012], ['1,250,000', 1250000, 1250000],
  ['1.250.000', 1250000, 1250000], ['1,25,000', 125000, 125000], ['12,3,45', null, null], ['-5', null, null], ['1e5', null, null], ['abc', null, null], ['', null, null],
  ['5 USD', 5, 5], ['12,3456', 12.3456, 12.3456], ['1,2,3', null, null],
];
for (const [input, en, frWant] of typed) {
  check(`English reads ${JSON.stringify(input)} as ${en}`, app.parseDecimalInput(input) === en, `got ${app.parseDecimalInput(input)}`);
  check(`French reads ${JSON.stringify(input)} as ${frWant}`, fr.parseDecimalInput(input) === frWant, `got ${fr.parseDecimalInput(input)}`);
}
check('whole amounts accept the French grouping', app.parseWholeAmount('1 000 000').digits === '1000000');

// ── Every translation ───────────────────────────────────────────────────────
const englishKeys = Object.keys(catalog);
check('the code has messages', englishKeys.length > 0, `${englishKeys.length}`);
for (const key of englishKeys) {
  let ok = true;
  try { app.parseMessage(catalog[key].text); } catch { ok = false; }
  if (!ok) check(`English parses: ${key}`, false);
}
// A message's placeholders: { name: [kind, option keys] }.
function shape(msg) {
  const out = {};
  const walk = (parts) => {
    for (const p of parts) {
      if (typeof p === 'string' || p.pound) continue;
      const options = p.plural || p.select;
      out[p.arg] = [p.plural ? 'plural' : p.select ? 'select' : 'arg', options ? Object.keys(options) : []];
      if (options) for (const o of Object.values(options)) walk(o);
    }
  };
  walk(app.parseMessage(msg));
  return out;
}
// Values to format a message with: 3 for a plural, a select's first option, a marked text otherwise (or 3 where the
// translation counts what English fills in as it is).
const sample = (s, local = {}) => Object.fromEntries(Object.entries(s).map(([k, [kind, keys]]) => [k, kind === 'plural' || (local[k] && local[k][0] === 'plural') ? 3
  : kind === 'select' ? keys.find((x) => x !== 'other') || 'other' : `‹${k}›`]));
for (const l of LANGUAGES.filter((x) => x.id !== 'en')) {
  const table = tables[l.id];
  if (!table) { check(`${l.id}: has a translation file`, false); continue; }
  const forms = new Intl.PluralRules(l.intl).resolvedOptions().pluralCategories;
  const t = runWith(l.id, table);
  let bad = 0; let done = 0; let missing = 0; let same = 0;
  for (const key of englishKeys) {
    const local = table[key];
    if (local === undefined) { missing++; continue; }
    const fail = (why) => { bad++; check(`${l.id}: ${why}: ${key.slice(0, 70)}`, false); };
    let s; let e;
    try { s = shape(local); } catch { fail('the translation does not parse'); continue; }
    try { e = shape(catalog[key].text); } catch { continue; }
    if (JSON.stringify(Object.keys(s).sort()) !== JSON.stringify(Object.keys(e).sort())) { fail(`placeholders ${Object.keys(s)} vs ${Object.keys(e)}`); continue; }
    for (const [name, [kind, keys]] of Object.entries(s)) {
      // A number English fills in as it is may take plural forms in a translation (agreement English doesn't need).
      if (kind !== e[name][0] && !(kind === 'plural' && e[name][0] === 'arg')) fail(`{${name}} is a ${kind}, in English a ${e[name][0]}`);
      if (kind === 'plural') {
        const wrong = keys.filter((k) => !forms.includes(k) && !/^=\d+$/.test(k));
        // Spanish and French "many" is for exact millions; without it the "other" text is used.
        const lacking = forms.filter((f) => !keys.includes(f) && !(f === 'many' && ['es-419', 'fr-FR'].includes(l.id)));
        if (wrong.length) fail(`{${name}} has forms ${l.id} doesn't use: ${wrong}`);
        if (lacking.length) fail(`{${name}} lacks the plural forms ${lacking}`);
      }
      if (kind === 'select') {
        const lacking = e[name][1].filter((k) => !keys.includes(k));
        if (lacking.length) fail(`{${name}} lacks the options ${lacking}`);
      }
    }
    const vars = sample(e, s);
    const { ctx, text } = catalog[key];
    const out = ctx ? t.trc(ctx, text, vars) : t.tr(text, vars);
    // Kept as the English on purpose (a ticker, "QUBIC/USDT") is fine; English coming out of a different translation
    // means it didn't parse.
    if (local === text) same++;
    else if (out === (ctx ? t.trEnglish(text, vars) : t.trEnglish(text, vars)) && Object.keys(e).length === 0) fail('comes out in English');
    if (/\{[A-Za-z0-9_]+\}/.test(out)) fail(`a placeholder is left: ${out.slice(0, 60)}`);
    done++;
  }
  const stale = Object.keys(table).filter((k) => !catalog[k]).length;
  check(`${l.id}: every translation is well formed`, bad === 0, `${done} translated, ${missing} shown in English${stale ? `, ${stale} no longer in the code` : ''}`);
  console.log(`     ${l.id}: ${done} of ${englishKeys.length} messages translated${missing ? `; ${missing} shown in English` : ''}${same ? `; ${same} kept as in English` : ''}`);
}
finish('language');
