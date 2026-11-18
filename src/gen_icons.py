#!/usr/bin/env python3
"""Writes src/js/02-icons.js from the local Nucleo install (family ui, outline and a few glyphs, 18px):
each icon becomes a list of [tag, attrs] so the app can build it with createElementNS.
Usage: python3 src/gen_icons.py <Nucleo ui icons.json> src/js/02-icons.js"""
import json, sys, xml.etree.ElementTree as ET
icons_json, out = sys.argv[1], sys.argv[2]
WANT = {
  'send': 'arrow-up-right', 'receive': 'arrow-down', 'copy': 'copy', 'check': 'check', 'eye': 'eye', 'eyeOff': 'eye-slash',
  'refresh': 'refresh', 'settings': 'sliders', 'chevronDown': 'chevron-down', 'chevronRight': 'chevron-right', 'back': 'chevron-left',
  'close': 'xmark', 'plus': 'plus', 'lock': 'lock', 'shield': 'shield-check',
  'paste': 'clipboard', 'wallet': 'wallet', 'alert': 'triangle-warning', 'info': 'circle-info', 'trash': 'trash', 'key': 'key',
  'globe': 'globe', 'clock': 'clock', 'cube': 'cube', 'xCircle': 'circle-xmark', 'checkCircle': 'circle-check', 'share': 'share-up-right',
  'pencil': 'pen', 'sun': 'sun', 'chart': 'chart-line', 'tag': 'tag', 'layers': 'layers', 'databaseLock': 'database-lock',
  'databaseMinus': 'database-minus', 'sparkle': 'sparkle', 'hourglass': 'hourglass',
  'transfer': 'arrows-left-right-trail', 'palette': 'color-palette',
  'sign': 'feather', 'addressBook': 'address-book', 'userPlus': 'user-plus', 'book': 'book-open', 'heart': 'heart',
  'house': 'house', 'grid': 'grid', 'download': 'download-4', 'filter': 'bars-filter',
}
# Glyph (filled) icons, for the few places the design uses them: the Error notice, the white glyphs on the Tools'
# coloured squares, and the tab you're on in the phone tab bar.
WANT_GLYPH = {'xCircleFill': 'circle-xmark', 'calculatorFill': 'calculator-2', 'bookFill': 'book-open', 'addressBookFill': 'address-book',
              'signFill': 'feather', 'verifyFill': 'badge-check',
              'houseFill': 'house', 'clockFill': 'clock', 'gridFill': 'grid', 'settingsFill': 'sliders'}
KEEP = {'d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'fill', 'stroke',
        'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'fill-rule', 'clip-rule'}
OUTLINE = {'fill': 'none', 'stroke': 'currentColor', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': 'var(--nucleo-stroke-width, 1.5)'}
data = json.load(open(icons_json))
pools = {'outline': {}, 'glyph': {}}
for i in data['icons']:
    for fill, pool in pools.items():
        if fill in i['fills'] and '18px' in i['sizes']:
            pool.setdefault(i['label'], i)
result = {}
wanted = [(key, label, 'outline') for key, label in WANT.items()] + [(key, label, 'glyph') for key, label in WANT_GLYPH.items()]
for key, label, fill in wanted:
    icon = pools[fill].get(label)
    if not icon:
        sys.exit(f'missing nucleo ui {fill} 18px icon: {label}')
    root = ET.fromstring(f'<svg xmlns="http://www.w3.org/2000/svg">{icon["svg"]}</svg>')
    els = []
    def walk(node):
        for ch in node:
            tag = ch.tag.split('}')[-1]
            if tag == 'g':
                walk(ch); continue
            attrs = {k: v for k, v in ch.attrib.items() if k in KEEP}
            if all(attrs.get(k) == v for k, v in OUTLINE.items()):
                for k in OUTLINE:
                    del attrs[k]
            elif not attrs.get('fill'):
                # icon() keeps an element's own attributes only when its fill is set (not empty).
                sys.exit(f'{key}: element without the outline attributes has no fill')
            els.append([tag, attrs])
    walk(root)
    result[key] = els
body = json.dumps(result, separators=(',', ':'), ensure_ascii=True)
js = f"""// ═══════════════════════════════════════════════════════════════════════════
// 3. ICONS: Nucleo UI · outline (plus a few glyphs) · 18 px, generated from the
// local Nucleo install by gen_icons.py. Built with createElementNS (no HTML parsing).
// Stroke weight follows the Nucleo convention: --nucleo-stroke-width (default 1.5).
// ═══════════════════════════════════════════════════════════════════════════
// Attributes shared by every outline element (left out of the table; an element with its own fill keeps its own).
const NUCLEO_OUTLINE = {json.dumps(OUTLINE)};
const NUCLEO_UI_18 = {body};

// Icons that point the way you read (back, a row's chevron): the styles mirror them in right-to-left languages.
const DIRECTIONAL_ICONS = new Set(['back', 'chevronRight']);
function icon(name, size = 18, strokeWidth = null) {{
  const parts = NUCLEO_UI_18[name] || NUCLEO_UI_18.info;
  const el = svg('svg', {{ class: DIRECTIONAL_ICONS.has(name) ? 'nc-icon dir-icon' : 'nc-icon', width: size, height: size, viewBox: '0 0 18 18', fill: 'none', 'aria-hidden': 'true', focusable: 'false' }},
    parts.map(([tag, attrs]) => svg(tag, attrs.fill ? attrs : {{ ...NUCLEO_OUTLINE, ...attrs }})));
  if (strokeWidth != null) el.style.setProperty('--nucleo-stroke-width', String(strokeWidth));
  return el;
}}

// The official Qubic symbol (two bars; geometry from the Qubic brand SVG in qubic/qubic-typescript).
function qubicSymbol(height = 22) {{
  return svg('svg', {{ width: Math.round(height * 51.66 / 88.55 * 100) / 100, height, viewBox: '0 0 51.66 88.55', fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' }},
    svg('rect', {{ x: 0, y: 0, width: 22.14, height: 66.41, rx: 2.77 }}),
    svg('rect', {{ x: 29.52, y: 0, width: 22.14, height: 88.55, rx: 2.77 }}));
}}
// The wallet's logo (140 × 32): its mark, four quarter shapes 29.2 units square from (0.35, 0.3), then "qoree", all in
// the text colour, height given by where it sits. The letters are the first logo's q, o, r and e (from its "qorew"),
// the second e that same e moved 21.42 along, as far from the first as the o is from the r. The mark alone is the tab
// icon (applyTheme).
const QOREE_MARK = 'M0.34668 0.300049C7.77995 0.300049 13.8059 6.32597 13.8059 13.7592H0.34668V0.300049ZM16.089 13.7592C16.089 6.32597 22.1149 0.300049 29.5482 0.300049V13.7592H16.089ZM13.8059 29.5016C6.3726 29.5016 0.34668 23.4756 0.34668 16.0424H5.47938C5.47938 20.6392 9.20909 24.3689 13.8059 24.3689V29.5016ZM29.5482 16.0424C29.5482 23.4756 23.5223 29.5016 16.089 29.5016V24.3689C20.6858 24.3689 24.4155 20.6392 24.4155 16.0424H29.5482Z';
const QOREE_LETTERS = ['M58.3093 31.0833H52.7246V19.8407H52.6881C51.374 22.5419 49.1109 23.9654 46.2272 23.9654C41.336 23.9654 37.9048 19.9867 37.9048 14.0734C37.9048 8.1236 41.336 4.1814 46.2272 4.1814C49.1474 4.1814 51.447 5.60497 52.7611 8.30611H52.7976L53.6371 4.72892H58.3093V31.0833ZM48.1983 19.2202C50.9725 19.2202 52.9436 16.9936 52.9436 14.0734C52.9436 11.1168 50.9725 8.89014 48.1983 8.89014C45.4607 8.89014 43.4531 11.0803 43.4531 14.0734C43.4531 16.9936 45.4607 19.2202 48.1983 19.2202Z', 'M69.8831 24.1478C63.6413 24.1478 59.5166 20.1691 59.5166 14.0733C59.5166 7.97749 63.6413 3.99878 69.8831 3.99878C76.1615 3.99878 80.2862 7.97749 80.2862 14.0733C80.2862 20.1691 76.1615 24.1478 69.8831 24.1478ZM69.8831 19.5121C72.8763 19.5121 74.7744 17.4315 74.7744 14.0733C74.7744 10.7151 72.8763 8.63452 69.8831 8.63452C66.89 8.63452 64.9919 10.7151 64.9919 14.0733C64.9919 17.4315 66.89 19.5121 69.8831 19.5121Z', 'M92.0492 4.1449C95.2978 4.1449 97.5245 6.51752 97.9625 10.6787L93.2537 11.9563C93.0712 9.65668 92.0127 8.34261 90.4066 8.34261C88.326 8.34261 87.0484 10.1677 87.0484 13.2339V23.4179H81.4636V4.72893H85.9169L86.7564 7.75858H86.7929C87.815 5.49547 89.7496 4.1449 92.0492 4.1449Z', 'M109.24 24.1478C102.67 24.1478 98.0703 19.9866 98.0703 13.9638C98.0338 8.05049 102.159 3.99878 108.145 3.99878C113.985 3.99878 117.818 7.86798 117.854 13.4893C117.854 14.2193 117.745 15.0224 117.599 15.6064H103.801C104.13 18.3075 106.393 20.0596 109.459 20.0596C111.795 20.0596 113.985 19.0011 115.08 17.5045L118.256 19.9501C116.759 22.4322 113.255 24.1478 109.24 24.1478ZM103.765 12.3942H112.197C112.014 9.62007 110.444 7.97749 108.145 7.97749C105.809 7.97749 104.093 9.76608 103.765 12.3942Z'];
function qoreeLogo(height) {{
  return svg('svg', {{ class: 'qoree-logo', width: Math.round(height * 140 / 32 * 100) / 100, height, viewBox: '0 0 140 32', fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' }},
    svg('path', {{ d: QOREE_MARK, 'fill-rule': 'evenodd' }}), QOREE_LETTERS.map((d) => svg('path', {{ d }})),
    svg('path', {{ d: QOREE_LETTERS[3], transform: 'translate(21.42 0)' }}));
}}
// The logo at the head of the welcome and unlock screens.
function brandLogo() {{ return h('div', {{ class: 'brand-logo', role: 'img', 'aria-label': 'qoree' }}, qoreeLogo(24)); }}
// QUBIC asset logo: the official coin logo (dark symbol on Qubic teal), independent of the accent colour.
function qubicCoin() {{ return h('div', {{ class: 'token qubic', 'aria-hidden': 'true' }}, qubicSymbol(22)); }}
"""
open(out, 'w', encoding='utf-8').write(js)
print(f'wrote {len(result)} icons, {len(body)} bytes of path data')
