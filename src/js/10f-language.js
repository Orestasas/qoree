// ═══════════════════════════════════════════════════════════════════════════
// 11d. LANGUAGE
// Picking the language: in Settings → Appearance, and on the welcome and unlock screens (a chip in the corner), so
// someone who doesn't read English can find it before there's a wallet. Each language is named in itself, without
// flags. Switching draws what's on screen again in the new language, Settings included where the switch was made.
// ═══════════════════════════════════════════════════════════════════════════
// The languages as a list to pick from, the one in use checked.
function languageList(onPick) {
  return h('div', { class: 'group', role: 'radiogroup', 'aria-label': tr('Language') },
    LANGUAGES.map((l) => h('button', { type: 'button', class: 'item', role: 'radio', 'aria-checked': String(l.id === lang.id), onClick: () => onPick(l.id) },
      h('span', { class: 'item-main' }, h('span', { class: 'item-title', lang: l.tag, dir: l.dir, text: l.name })),
      l.id === lang.id ? h('span', { class: 'item-end' }, icon('check', 18)) : null)));
}
// Said under the list while the language in use is one no native speaker has checked yet.
const unreviewedNote = () => (lang.reviewed ? null
  : h('p', { class: 'list-foot', text: tr('This translation is new and hasn’t been checked by a native speaker yet.') }));

// Settings → Appearance → Language.
function languagePane(sheet, back, direction = 'forward') {
  sheet.setPane([languageList((id) => setLanguage(id, 'settings')), unreviewedNote()], { title: tr('Language'), back, direction });
}

// The welcome and unlock screens: the language in use, in itself; a tap opens the list.
function languageChip() {
  return h('button', { type: 'button', class: 'chip-btn neutral lang-chip', 'aria-label': tr('Language: {name}', { name: lang.name }), onClick: openLanguageSheet },
    icon('globe', 16), h('span', { lang: lang.tag, dir: lang.dir, text: lang.name }));
}
function openLanguageSheet() {
  const sheet = openSheet({ title: tr('Language') });
  sheet.setPane([languageList((id) => { sheet.close(true); setLanguage(id); }), unreviewedNote()]);
}

// Uses the language from now on (it's saved with the other settings) and draws the screen again in it: the welcome,
// unlock or wallet screen, with Settings opened again at the language list when the change was made there. Other
// screens (creating or importing a wallet) have no picker, so they're never under a switch.
function setLanguage(id, from = null) {
  if (id === state.prefs.lang && id === lang.id) return;
  setPref('lang', id);
  applyLanguage();
  closeAllSheets(true);
  if (view.name === 'welcome') showWelcome({ reveal: true });
  else if (view.name === 'unlock') showUnlock({ reveal: true });
  else if (view.name === 'dashboard') {
    showDashboard({ reveal: true });
    if (from === 'settings') openSettings('language');
  }
}
