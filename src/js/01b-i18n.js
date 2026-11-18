// ═══════════════════════════════════════════════════════════════════════════
// 2b. LANGUAGES
// The app's text is written in English in the code, inside tr(), or trLater() for text in a table made when the page
// loads (it's translated with tr() where it is shown). That English is the key: each language's table maps it to a translation, and text without one shows in English. assemble.py fills I18N
// from src/i18n/<id>.json, and refuses a translation whose placeholders aren't its English's.
// A message can hold placeholders, filled from vars, and plurals and selects in ICU MessageFormat's syntax:
//   'Sent to {name}'   '{count, plural, one {# account} other {# accounts}}'   '{kind, select, seed {…} other {…}}'
// A plural takes the language's own forms (zero, one, two, few, many, other, as Intl.PluralRules names them) or =n for
// an exact number; # is the number, written the language's way. A number filled in is written that way too; anything
// that needs its own format (an amount, a tick) comes formatted. In a right-to-left language each text filled in is
// isolated (U+2068…U+2069), so an address, an amount or a name in Latin letters keeps its own direction and doesn't
// reorder the words around it.
// ═══════════════════════════════════════════════════════════════════════════
const I18N = Object.freeze({ /* @@I18N@@ */ });
let lang = LANGUAGES[0];
const parsedMessages = new Map();
const pluralRules = new Map();

// The English text as it is: marks it for translation where it's shown.
function trLater(text) { return text; }
// The text in the language in use, its placeholders filled in.
function tr(text, vars) { return formatMessage(messageFor(text, text), vars, false).join(''); }
// tr() for English that needs another translation in one place (ctx names the place): the same words, said differently.
function trc(ctx, text, vars) { return formatMessage(messageFor(text, `${ctx}\u0004${text}`), vars, false).join(''); }
// Sentences said one after another: with a space between them, or none in Chinese, whose sentences run on.
const joinSentences = (...parts) => parts.filter(Boolean).join(lang.id === 'zh-Hans' ? '' : ' ');
// The English, filled in: an error's own message (for the console and the tests), whatever language is shown.
function trEnglish(text, vars) {
  const shown = lang;
  lang = LANGUAGES[0];
  try { return formatMessage(messageFor(text, text), vars, false).join(''); } finally { lang = shown; }
}

// The parsed translation, or the English when there's none or it doesn't parse (a broken translation never stops a
// screen from drawing).
function messageFor(text, key) {
  const table = I18N[lang.id];
  const local = table && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
  if (typeof local === 'string') { try { return parseMessage(local); } catch { /* the English below */ } }
  try { return parseMessage(text); } catch { return [text]; }
}

// A message as parts: text, { arg } for a placeholder, { arg, plural } or { arg, select } (each option's parts by its
// key), and { pound } for a plural's number.
function parseMessage(src) {
  const known = parsedMessages.get(src);
  if (known) return known;
  let i = 0;
  const bad = () => { throw new Error('malformed message'); };
  const space = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const word = () => {
    space();
    const m = /^=?[A-Za-z0-9_]+/.exec(src.slice(i));
    if (!m) bad();
    i += m[0].length;
    space();
    return m[0];
  };
  const parts = (inPlural) => {
    const out = [];
    let text = '';
    const flush = () => { if (text) { out.push(text); text = ''; } };
    while (i < src.length && src[i] !== '}') {
      if (src[i] === '{') { flush(); out.push(arg(inPlural)); } else if (src[i] === '#' && inPlural) { flush(); out.push({ pound: true }); i++; } else text += src[i++];
    }
    flush();
    return out;
  };
  const arg = (inPlural) => {
    i++;
    const name = word();
    if (src[i] === '}') { i++; return { arg: name }; }
    if (src[i] !== ',') bad();
    i++;
    const type = word();
    if ((type !== 'plural' && type !== 'select') || src[i] !== ',') bad();
    i++;
    const options = Object.create(null);
    space();
    while (src[i] !== '}') {
      if (i >= src.length) bad();
      const key = word();
      if (src[i] !== '{') bad();
      i++;
      options[key] = parts(inPlural || type === 'plural');
      if (src[i] !== '}') bad();
      i++;
      space();
    }
    i++;
    if (!options.other) bad();
    return { arg: name, [type]: options };
  };
  const out = parts(false);
  if (i < src.length) bad();
  parsedMessages.set(src, out);
  return out;
}

function pluralOf(n) {
  let rules = pluralRules.get(lang.intl);
  if (!rules) { rules = new Intl.PluralRules(lang.intl); pluralRules.set(lang.intl, rules); }
  return rules.select(n);
}

// The message filled in, as a list of strings (tr joins them). An element filled in gives its text, or stays an element
// in the list when keepNodes (a message laid out with elements in it). A Node is anything the DOM calls one; there's
// none where the tests run the app without a page.
const isNode = (v) => typeof Node === 'function' && v instanceof Node;
function formatMessage(message, vars, keepNodes) {
  const out = [];
  const isolate = lang.dir === 'rtl';
  const put = (v) => {
    if (isNode(v)) { out.push(v); return; }
    if (typeof out[out.length - 1] === 'string') out[out.length - 1] += v; else out.push(v);
  };
  const walk = (parts, count) => {
    for (const p of parts) {
      if (typeof p === 'string') { put(p); continue; }
      if (p.pound) { put(typeof count === 'number' ? fmtNum(count) : String(count ?? '')); continue; }
      const v = vars ? vars[p.arg] : undefined;
      if (p.plural) walk(p.plural[`=${v}`] || (typeof v === 'number' && p.plural[pluralOf(v)]) || p.plural.other, v);
      else if (p.select) walk(p.select[String(v)] || p.select.other, count);
      else if (v == null) put(`{${p.arg}}`);
      else if (isNode(v)) put(keepNodes ? v : v.textContent);
      else if (typeof v === 'number') put(fmtNum(v));
      else put(isolate ? `⁨${v}⁩` : String(v));
    }
  };
  walk(message, null);
  return out;
}

// The language to show: the one picked in Settings; else the first the browser asks for that the app has and a native
// speaker has reviewed (none before English, if English comes first); else English. Simplified Chinese is offered for
// zh, zh-CN, zh-SG and zh-Hans, not for Traditional (zh-TW, zh-HK, zh-MO, zh-Hant).
function pickLanguage(pref) {
  const picked = LANGUAGES.find((l) => l.id === pref);
  if (picked) return picked;
  const asked = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]).map((w) => String(w || '').toLowerCase());
  for (const w of asked) {
    const primary = w.split('-')[0];
    if (primary === 'en') break;
    const found = LANGUAGES.find((l) => l.reviewed && l.tag.split('-')[0].toLowerCase() === primary && (primary !== 'zh' || !/-(hant|tw|hk|mo)(-|$)/.test(w)));
    if (found) return found;
  }
  return LANGUAGES[0];
}

// Puts the language in use on the page: its lang and direction, and the tab's title.
function applyLanguage() {
  lang = pickLanguage(state.prefs.lang);
  const root = document.documentElement;
  root.lang = lang.tag;
  root.dir = lang.dir;
  document.title = tr('qoree · Qubic wallet');
}
