// ═══════════════════════════════════════════════════════════════════════════
// 11b. PRICE CALCULATOR
// What the QUBIC in scope would be worth at a price you type or pick. Plain arithmetic on what's already loaded
// (today's balance, today's price, the circulating supply from the Qubic RPC stats): nothing is fetched, and the
// result is labelled as hypothetical, never as a forecast.
// ═══════════════════════════════════════════════════════════════════════════
// The price as typed is read by parseDecimalInput ("0.0000012", "1,250.50", "1.250,50", "1250,5", "$ 0.000001"), the
// way the language in use writes numbers; it's written back in the same way.
function priceFieldText(p, unit) {
  if (p == null) return '';
  if (unit === 'billion') return fmtPlain(p * 1e9, 2);
  return fmtPlain(p, p === 0 ? 2 : priceDecimals(p));
}
const usdBig = (v) => fmtUsd(v, { compact: v >= 1e12 });
// What the calculator shows: the price typed and its unit, the accounts in view and their balances, the price and
// supply, and the settings (hidden balances, the price unit).
function whatIfKey(target, unit) {
  return [target, unit, versions.wallet, versions.balances, versions.market, versions.prefs].join('|');
}

function openWhatIfSheet() {
  const sheet = openSheet({ title: tr('Price calculator') });
  let unit = state.prefs.priceUnit;
  let target = priceInfo()?.price ?? null; // USD per QUBIC

  const value = h('p', { class: 'calc-value' });
  const basis = h('p', { class: 'calc-sub' });
  const reveal = h('button', { type: 'button', class: 'link-btn', text: tr('Show balances'), onClick: () => setPref('privacy', false) });
  const input = h('input', {
    class: 'amount-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done',
    placeholder: fmtPlain(0, 2), 'aria-label': tr('QUBIC price in US dollars'), 'data-autofocus': '',
  });
  const unitText = h('span', { class: 'amount-unit' });
  const times = h('span'); const capLine = h('span');
  // The dollar sign where the language puts it: before the number ($) or after it (French $US). A sign stands as tall
  // as the digits; a code (USD) reads as a label beside them.
  const mark = usdMark();
  const big = !mark.after && [...mark.text].length === 1;
  const markEl = h('span', { class: ['amount-unit', big && 'calc-dollar'], text: mark.text });
  const box = h('div', { class: 'amount-box' },
    h('div', { class: 'amount-row' }, mark.after ? [input, markEl, unitText] : [markEl, input, unitText]),
    h('div', { class: 'amount-meta' }, times, capLine));
  // A long price (0.000000398) beside a long unit (prix par QUBIC) can outgrow a phone's row: the digits shrink until the
  // whole price shows, rather than scrolling out of the field.
  const fit = () => {
    input.style.fontSize = '';
    for (let size = 30; size >= 20 && input.scrollWidth > input.clientWidth; size -= 2) input.style.fontSize = `${size}px`;
    if (big) markEl.style.fontSize = input.style.fontSize;
  };
  const chips = h('div', { class: 'calc-chips' });
  const capChips = h('div', { class: 'calc-chips' });
  const facts = h('div', { class: 'calc-facts' });

  const setTarget = (p) => { target = p; input.value = priceFieldText(p, unit); box.classList.remove('invalid'); fit(); paint(); };
  input.addEventListener('input', () => {
    const v = parseDecimalInput(input.value);
    box.classList.toggle('invalid', input.value.trim() !== '' && v == null);
    target = v == null ? null : unit === 'billion' ? v / 1e9 : v;
    fit();
    paint();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  const units = segmented([['unit', tr('Per QUBIC')], ['billion', tr('Per billion')]], unit, (u) => { unit = u; setTarget(target); }, tr('Price per'));

  const near = (a, b) => a != null && b != null && Math.abs(a - b) <= Math.abs(b) * 1e-9;
  // A preset price, highlighted while it's the one in the field.
  const chip = (text, p) => {
    const on = near(target, p);
    return h('button', { type: 'button', class: ['chip-btn', on ? 'brand' : 'neutral'], text, disabled: p == null, 'aria-pressed': String(on), onClick: () => setTarget(p) });
  };

  let shown = null;
  function paint() {
    const b = scopeBalance();
    const now = priceInfo()?.price ?? null;
    const circ = state.market.rpc && state.market.rpc.circulating;
    const masked = hidden();
    // Background refreshes notify every few seconds: redraw only when an input changed, so a tap never lands on a chip
    // being replaced.
    const key = whatIfKey(target, unit);
    if (key === shown) return;
    shown = key;
    const qubic = Number(b.total);
    const worth = b.loaded && target != null ? qubic * target : null;
    unitText.textContent = unit === 'billion' ? tr('per billion') : tr('per QUBIC');
    value.textContent = !b.loaded ? (b.failed ? '—' : tr('Loading balance…')) : worth == null ? '—' : masked ? MASK : usdBig(worth);
    basis.textContent = !b.loaded ? (b.failed ? tr('Balance unavailable') : '') : masked ? tr('Balances are hidden')
      : state.selection === 'all' ? tr('{amount} QUBIC across all accounts', { amount: fmtInt(b.total) }) : `${fmtInt(b.total)} QUBIC`;
    reveal.hidden = !masked;
    times.textContent = target != null && now ? tr('{multiple} today’s price', { multiple: fmtMultiple(target / now) }) : '';
    capLine.textContent = target != null && circ ? tr('Market cap ≈ {amount}', { amount: fmtUsd(circ * target, { compact: true }) }) : '';
    fill(chips, chip(tr('Today'), now), [2, 5, 10, 100].map((m) => chip(`${m}×`, now ? now * m : null)));
    fill(capChips, circ ? [h('span', { class: 'calc-chips-label', text: tr('Market cap') }),
      [1e9, 1e10, 1e11].map((cap) => chip(fmtUsd(cap, { compact: true }), cap / circ))] : null);
    const today = b.loaded && now ? qubic * now : null;
    const diff = worth != null && today != null ? worth - today : null;
    fill(facts, kv([
      [tr('Today’s price'), now ? (perBillion() ? tr('{price} per billion', { price: priceText(now) }) : priceText(now)) : '—'],
      [tr('Value today'), today == null ? '—' : masked ? MASK : usdBig(today)],
      diff != null ? [tr('Difference'), masked ? MASK : `${diff >= 0 ? '+' : MINUS}${usdBig(Math.abs(diff))}`] : null,
    ]));
  }
  setTarget(target);
  sheet.onCleanup(subscribe(paint));
  sheet.setPane([
    h('div', { class: 'calc-hero' }, h('p', { class: 'calc-label', text: tr('Your QUBIC would be worth') }), value, basis, reveal),
    h('div', { class: 'field' }, h('span', { class: 'field-label', text: tr('If QUBIC were') }), box, units),
    chips, capChips, facts,
    h('p', { class: 'calc-note', text: tr('Hypothetical: today’s balance × the price above. Not a forecast.') }),
  ], { title: tr('Price calculator') });
  requestAnimationFrame(fit);
  addEventListener('resize', fit);
  sheet.onCleanup(() => removeEventListener('resize', fit));
}
// 12.3× · 0.5× · 1,234× (no trailing zeros)
function fmtMultiple(m) {
  if (!Number.isFinite(m)) return '—';
  const digits = m >= 100 ? 0 : m >= 10 ? 1 : 2;
  return `${unmarked(numberFormat(`times${digits}`, { maximumFractionDigits: digits }).format(Number(m.toFixed(digits))))}×`;
}
