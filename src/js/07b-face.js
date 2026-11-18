// ═══════════════════════════════════════════════════════════════════════════
// 8b. THE FACE
// ═══════════════════════════════════════════════════════════════════════════
// The logo's mark is a face: two leaves for eyes over a smile. Here it is four tiles (the eyes on top, the mouth
// below), each one rounded box with its own four corner radii and a round hole, so a leaf can turn into a ring, a lid
// or a bowl without a cut, and one mood morphs into the next. A tile is 40 units wide, the gap between tiles 17% of
// that, the face centred on (60, 60); qoreeFace('happy') is the mark. Inked in currentColor, and decorative: the text
// beside a face says what it means.
const FACE_C = 40;
const FACE_GAP = 0.17;
const FACE_RING = 0.38;        // a ring's width, of the tile
const KAPPA = 0.5522847498;    // a quarter circle as a cubic Bézier
const FACE_MORPH = 720;        // ms for one mood to become another; the tiles start 45 ms apart
const FACE_STAGGER = [0, 45, 90, 135];
const FACE_REST = 60000;       // ms a mood keeps up its moves (and breathing) before the face rests, still

// A tile: i, the insets from its top, right, bottom and left; r, its corner radii from the top left round; h, a hole
// (centre x, centre y, radius). All in tile widths.
const faceTile = (i, r, hole) => ({ i, r, h: hole });
const FACE_CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
// o: which corner is rounded (0 top left, then clockwise); an arch is rounded on both corners of side o.
function tileOf(kind, o = 0) {
  const r = [0, 0, 0, 0];
  if (kind === 'quarter' || kind === 'qring') {
    r[o] = 1;
    const [x, y] = FACE_CORNERS[(o + 2) % 4];
    return faceTile([0, 0, 0, 0], r, [x, y, kind === 'qring' ? 1 - FACE_RING : 0]);
  }
  if (kind === 'arch') { r[o] = 0.5; r[(o + 1) % 4] = 0.5; }
  if (kind === 'semi') {
    // the half of the tile away from side o, rounded along side o: a dome (o 0) or a bowl (o 2)
    const i = [0, 0, 0, 0];
    i[o] = 0.5; r[o] = 0.5; r[(o + 1) % 4] = 0.5;
    const [x, y] = [[0.5, 1], [0, 0.5], [0.5, 0], [1, 0.5]][o];
    return faceTile(i, r, [x, y, 0]);
  }
  return faceTile([0, 0, 0, 0], r, [0.5, 0.5, 0]);
}
const twinTile = (t) => [t, faceTile(t.i.slice(), t.r.slice(), t.h.slice())];
const FACE_EYES = {
  leaf: () => [tileOf('quarter', 1), tileOf('quarter', 0)],
  slant: () => [tileOf('qring', 1), tileOf('qring', 0)],
  closed: () => twinTile(faceTile([0.36, 0, 0.14, 0], [0.5, 0.5, 0, 0], [0.5, 0.86, 0.18])),
  relaxed: () => twinTile(faceTile([0.14, 0, 0.36, 0], [0, 0, 0.5, 0.5], [0.5, 0.14, 0.18])),
  wide: () => twinTile(tileOf('arch', 0)),
  down: () => twinTile(faceTile([0.5, 0, 0, 0], [0, 0, 0.5, 0.5], [0.5, 0.5, 0])),
  // one eye up, the other at half height: a raised brow (side 1: the other eye)
  raised: (side = 0) => (side ? [tileOf('arch', 0), tileOf('semi', 0)] : [tileOf('semi', 0), tileOf('arch', 0)]),
};
const FACE_MOUTHS = {
  smile: () => [tileOf('qring', 3), tileOf('qring', 2)],
  laugh: () => [tileOf('quarter', 3), tileOf('quarter', 2)],
  gasp: () => [tileOf('quarter', 0), tileOf('quarter', 1)],
  frown: () => [tileOf('qring', 0), tileOf('qring', 1)],
  line: () => twinTile(faceTile([0, 0, 0.5, 0], [0, 0, 0, 0], [0.5, 0.5, 0])),
  flat: () => [tileOf('semi', 2), tileOf('semi', 2)],
};
const facePose = (eyes, mouth) => ({ g: FACE_GAP, tiles: [...FACE_EYES[eyes](), ...FACE_MOUTHS[mouth]()] });

// Each mood: its pose and what it does while it shows. enter plays once on arrival; loop repeats, a pause from every
// (a range, ms) after each; breathe is a slow rise and fall in the styles (.face.breathing); alt, a second pose a
// glance turns to and back from (the alt move).
const MOODS = {
  happy: { pose: facePose('leaf', 'smile'), loop: ['blink'], every: [2500, 5000] },
  sleepy: { pose: facePose('relaxed', 'line'), yawn: FACE_MOUTHS.gasp(), breathe: true, loop: ['yawn'], every: [5000, 9000], first: 2400 },
  determined: { pose: facePose('slant', 'line'), loop: ['nod', 'nod'], every: [700, 1400] },
  hopeful: { pose: facePose('wide', 'smile'), loop: ['bob', 'blink'], every: [1200, 2400] },
  joyful: { pose: facePose('closed', 'laugh'), enter: ['hop', 'hop'], loop: ['blink'], every: [3000, 6000] },
  delighted: { pose: facePose('closed', 'smile'), enter: ['pop'], loop: ['pop'], every: [900, 1700] },
  content: { pose: facePose('relaxed', 'smile'), breathe: true },
  worried: { pose: facePose('wide', 'frown'), loop: ['shiver', 'blink'], every: [1500, 3000] },
  sad: { pose: facePose('down', 'frown'), loop: ['slowblink'], every: [2500, 5000] },
  // searching: glances from one raised brow to the other
  confused: { pose: facePose('raised', 'flat'), alt: { g: FACE_GAP, tiles: [...FACE_EYES.raised(1), ...FACE_MOUTHS.flat()] }, loop: ['alt', 'blink'], every: [600, 1300] },
  loading: { loader: true },
};

// The moves, as [ms, apply(fx, progress)]: fx holds each eye's height, the body's offset, turn and scale, how far the
// mouth is open (a yawn) and how far the face has turned to its alt pose.
const squashEyes = (o, k) => { o.eyes[0] *= k; o.eyes[1] *= k; };
// up over the first quarter, held, down over the last
const plateau = (p) => { const e = (x) => x * x * (3 - 2 * x); return p < 0.25 ? e(p / 0.25) : p > 0.75 ? e((1 - p) / 0.25) : 1; };
const FACE_FX = {
  blink: [190, (o, p) => squashEyes(o, 1 - 0.86 * Math.sin(Math.PI * p))],
  slowblink: [440, (o, p) => squashEyes(o, 1 - 0.9 * Math.sin(Math.PI * p))],
  hop: [440, (o, p) => { o.body.dy -= 7 * Math.sin(Math.PI * p); }],
  pop: [380, (o, p) => { o.body.s *= 1 + 0.08 * Math.sin(Math.PI * p); }],
  nod: [460, (o, p) => { o.body.dy += 3 * Math.sin(Math.PI * p); }],
  bob: [760, (o, p) => { o.body.dy -= 3 * Math.sin(Math.PI * p); }],
  shiver: [420, (o, p) => { o.body.dx += 1.3 * Math.sin(10 * Math.PI * p) * (1 - p); }],
  shake: [520, (o, p) => { o.body.dx += 5 * Math.sin(7 * Math.PI * p) * (1 - p); }],
  yawn: [1800, (o, p) => { const k = Math.sin(Math.PI * p) ** 0.6; o.mouth = Math.max(o.mouth, k); squashEyes(o, 1 - 0.45 * k); }],
  alt: [1700, (o, p) => { o.alt = Math.max(o.alt, plateau(p)); }],
};
const stillFx = () => ({ eyes: [1, 1], body: { dx: 0, dy: 0, rot: 0, s: 1 }, mouth: 0, alt: 0 });

// ── Drawing ─────────────────────────────────────────────────────────────────
const n2 = (v) => Math.round(v * 100) / 100;
const faceCells = (g) => { const s = (FACE_C * (1 + g)) / 2; return [[60 - s, 60 - s], [60 + s, 60 - s], [60 - s, 60 + s], [60 + s, 60 + s]]; };
// A tile as a path: always the same commands, so any tile tweens into any other. Tiles reach a quarter unit past their
// cells, so neighbouring shapes meet without a seam; one thinner than a hairline draws nothing.
function tilePath(cx, cy, p) {
  const C = FACE_C;
  const bleed = Math.max(0, Math.min(0.25, C * (1 - p.i[1] - p.i[3]) * 0.25, C * (1 - p.i[0] - p.i[2]) * 0.25));
  const x0 = cx - C / 2 + p.i[3] * C - bleed; const y0 = cy - C / 2 + p.i[0] * C - bleed;
  const x1 = cx + C / 2 - p.i[1] * C + bleed; const y1 = cy + C / 2 - p.i[2] * C + bleed;
  const w = x1 - x0; const ht = y1 - y0;
  if (w < 0.9 || ht < 0.9) return '';
  let [a, b, d, e] = p.r.map((v) => Math.max(0, v) * C);
  // corners that together outrun a side all shrink by the same share
  const fit = (s, len) => (s > len ? len / s : 1);
  const f = Math.min(fit(a + b, w), fit(b + d, ht), fit(d + e, w), fit(e + a, ht));
  a *= f; b *= f; d *= f; e *= f;
  const k = 1 - KAPPA;
  return `M${n2(x0 + a)} ${n2(y0)}L${n2(x1 - b)} ${n2(y0)}C${n2(x1 - b * k)} ${n2(y0)} ${n2(x1)} ${n2(y0 + b * k)} ${n2(x1)} ${n2(y0 + b)}`
    + `L${n2(x1)} ${n2(y1 - d)}C${n2(x1)} ${n2(y1 - d * k)} ${n2(x1 - d * k)} ${n2(y1)} ${n2(x1 - d)} ${n2(y1)}`
    + `L${n2(x0 + e)} ${n2(y1)}C${n2(x0 + e * k)} ${n2(y1)} ${n2(x0)} ${n2(y1 - e * k)} ${n2(x0)} ${n2(y1 - e)}`
    + `L${n2(x0)} ${n2(y0 + a)}C${n2(x0)} ${n2(y0 + a * k)} ${n2(x0 + a * k)} ${n2(y0)} ${n2(x0 + a)} ${n2(y0)}Z`;
}

// ── Morphing ────────────────────────────────────────────────────────────────
// A shape that flips which way it curves (a smile into a frown, an open eye into a lid) passes through a short bar,
// the way a mouth flattens before it frowns, instead of bulging into a blob halfway.
const FACE_HUB = faceTile([0.31, 0, 0.31, 0], [0.12, 0.12, 0.12, 0.12], [0.5, 0.5, 0]);
const curveOf = (p) => (p.r[2] + p.r[3]) - (p.r[0] + p.r[1]);
const flips = (a, b) => { const ca = curveOf(a); const cb = curveOf(b); return (ca > 0.4 && cb < -0.4) || (ca < -0.4 && cb > 0.4); };
// t can pass 1 a little: the spring overshoots. direct: no detour through the bar. lin: the hole grows and shrinks
// with the shape, so a ring never passes through a solid disc.
function mixTile(a, b, t, direct, lin) {
  if (!direct && flips(a, b)) return t < 0.5 ? mixTile(a, FACE_HUB, t * 2, true) : mixTile(FACE_HUB, b, t * 2 - 1, true);
  const L = (x, y) => x + (y - x) * t;
  const ha = a.h[2] < 1e-4 ? [b.h[0], b.h[1], 0] : a.h;
  const hb = b.h[2] < 1e-4 ? [ha[0], ha[1], 0] : b.h;
  let hole;
  if (Math.hypot(hb[0] - ha[0], hb[1] - ha[1]) > 0.3) {
    // a hole that has to cross the tile closes where it is and opens where it lands, never passing through as a speck
    hole = t < 0.5 ? [ha[0], ha[1], ha[2] * clamp(1 - t / 0.3, 0, 1)]
      : [hb[0], hb[1], hb[2] * (t <= 1 ? clamp((t - 0.75) / 0.25, 0, 1) : 1 + (t - 1) * 0.5)];
  } else {
    let r = L(ha[2], hb[2]);
    if (!lin && a.h[2] < 1e-4 && b.h[2] >= 1e-4) r = hb[2] * clamp((t - 0.45) / 0.55, 0, 1);
    else if (!lin && b.h[2] < 1e-4 && a.h[2] >= 1e-4) r = ha[2] * clamp(1 - t / 0.55, 0, 1);
    hole = [L(ha[0], hb[0]), L(ha[1], hb[1]), Math.max(0, r)];
  }
  return { i: a.i.map((v, j) => Math.max(-0.04, L(v, b.i[j]))), r: a.r.map((v, j) => Math.max(0, L(v, b.r[j]))), h: hole };
}
const mixPose = (A, B, t, direct, lin) => ({ g: Math.max(0, A.g + (B.g - A.g) * t), tiles: A.tiles.map((a, k) => mixTile(a, B.tiles[k], t, direct, lin)) });
const faceSpring = (t) => (t >= 1 ? 1 : 1 - Math.exp(-6.5 * t) * Math.cos(8.5 * t));
const smoother = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10));
// winds back a touch before the turn and overshoots a touch as it lands
const backInOut = (x) => (x < 0.5 ? ((2 * x) ** 2 * (3.525 * 2 * x - 2.525)) / 2 : ((2 * x - 2) ** 2 * (3.525 * (2 * x - 2) + 2.525) + 2) / 2);

// ── The loader ──────────────────────────────────────────────────────────────
// Four small squares spin up into a ring; when it stops, the ring's top arcs become the eyes and the face smiles,
// then it melts back into squares. One pass is 3.54 s, after 0.3 s as squares.
const seedTile = () => faceTile([0.34, 0.34, 0.34, 0.34], [0, 0, 0, 0], [0.5, 0.5, 0]);
const LOAD_SEEDS = { g: FACE_GAP, tiles: [seedTile(), seedTile(), seedTile(), seedTile()] };
const LOAD_RING = { g: FACE_GAP, tiles: [tileOf('qring', 0), tileOf('qring', 1), ...FACE_MOUTHS.smile()] };
const LOAD_FACE = MOODS.happy.pose;
function loaderAt(ms) {
  const t = ms - 300;
  if (t < 0) return { pose: LOAD_SEEDS, angle: 0 };
  const c = t % 3540;
  if (c < 1200) {
    // one turn: the squares wait a moment, grow into the ring over the first part, and stay a ring to the end
    const u = c / 1200;
    const pose = u < 0.14 ? LOAD_SEEDS : u < 0.44 ? mixPose(LOAD_SEEDS, LOAD_RING, smoother((u - 0.14) / 0.3), true, true) : LOAD_RING;
    return { pose, angle: 360 * backInOut(u) };
  }
  if (c < 1340) return { pose: LOAD_RING, angle: 0 };
  if (c < 2640) return { pose: mixPose(LOAD_RING, LOAD_FACE, smoother((c - 1340) / 500), true, true), angle: 0 };
  return { pose: mixPose(LOAD_FACE, LOAD_SEEDS, smoother((c - 2640) / 600), true, true), angle: 0 };
}

// ── One face ────────────────────────────────────────────────────────────────
// All faces draw from one animation frame loop, and only while something on one is moving: between moves a face
// waits on a timer. A face taken off the page stops for good.
const faceDrawers = new Set();
let faceFrame = 0;
function faceTick(now) {
  faceFrame = 0;
  for (const step of [...faceDrawers]) step(now);
  if (faceDrawers.size) faceFrame = requestAnimationFrame(faceTick);
}
function faceWake(step) {
  faceDrawers.add(step);
  if (!faceFrame) faceFrame = requestAnimationFrame(faceTick);
}
let faceSerial = 0;
// Writes an attribute only when it changes, so a frame that only moves the body leaves the tiles alone. null removes it.
function putAttr(el, name, value) {
  const v = value == null ? null : String(value);
  if (el.getAttribute(name) === v) return;
  if (v == null) el.removeAttribute(name); else el.setAttribute(name, v);
}
// Spread over [0, 1) without Math.random: each pause is a step of the golden ratio along.
let faceJitter = 0;
const nextJitter = () => { faceJitter = (faceJitter + 0.6180339887) % 1; return faceJitter; };

// mood: a key of MOODS; size: px; still: drawn without motion (no moves, no breathing, each mood shown at once, as under
// Reduce Motion), for screens where money is moving. The element has show(mood) to change it and move(name) for a
// one-off move.
function qoreeFace(mood, size, { still = false } = {}) {
  const id = `qf${++faceSerial}`;
  const holes = []; const masks = []; const paths = []; const groups = [];
  for (let k = 0; k < 4; k++) {
    holes.push(svg('circle', { cx: 60, cy: 60, r: 0, fill: '#000' }));
    masks.push(svg('mask', { id: `${id}-${k}`, maskUnits: 'userSpaceOnUse', x: -40, y: -40, width: 200, height: 200 },
      svg('rect', { x: -40, y: -40, width: 200, height: 200, fill: '#fff' }), holes[k]));
    paths.push(svg('path', { fill: 'currentColor' }));
    groups.push(svg('g', null, paths[k]));
  }
  const spinG = svg('g', null, groups);
  const bodyG = svg('g', null, spinG);
  const root = h('span', { class: 'face', 'aria-hidden': 'true' },
    svg('svg', { width: size, height: size, viewBox: '15 15 90 90', focusable: 'false' }, svg('defs', null, masks), bodyG));

  let M = null;            // the mood showing (or arriving)
  let cur = null;          // its pose once settled
  let morph = null;        // { from, to, t0, fxFrom } while changing
  let ev = null;           // the move under way: { name, t0 }
  let queue = [];          // moves to play next (a mood's entrance)
  let loopAt = 0;
  let timer = 0;
  let loaderT0 = 0;
  let restAt = 0; let resting = false; let restTimer = 0;
  let shown = null; let lastFx = stillFx();
  // Nothing moves: a still face, or Reduce Motion (the loader keeps its own Reduce Motion ring).
  const calm = () => still || reducedMotion();

  function draw(pose, fx) {
    const cells = faceCells(pose.g);
    for (let k = 0; k < 4; k++) {
      const p = pose.tiles[k]; const [cx, cy] = cells[k];
      putAttr(paths[k], 'd', tilePath(cx, cy, p));
      const r = Math.max(0, p.h[2] * FACE_C);
      if (r > 0.05) {
        putAttr(holes[k], 'cx', n2(cx - FACE_C / 2 + p.h[0] * FACE_C));
        putAttr(holes[k], 'cy', n2(cy - FACE_C / 2 + p.h[1] * FACE_C));
        putAttr(holes[k], 'r', n2(r));
      }
      putAttr(paths[k], 'mask', r > 0.05 ? `url(#${id}-${k})` : null);
      const sy = k < 2 ? fx.eyes[k] : 1;
      putAttr(groups[k], 'transform', sy >= 0.999 ? null : `translate(${n2(cx)} ${n2(cy)}) scale(1 ${sy.toFixed(3)}) translate(${n2(-cx)} ${n2(-cy)})`);
    }
    const b = fx.body;
    const still = Math.abs(b.dx) < 0.01 && Math.abs(b.dy) < 0.01 && Math.abs(b.rot) < 0.01 && Math.abs(b.s - 1) < 0.0005;
    putAttr(bodyG, 'transform', still ? null : `translate(${n2(b.dx)} ${n2(b.dy)}) rotate(${b.rot.toFixed(2)} 60 60) translate(60 60) scale(${b.s.toFixed(4)}) translate(-60 -60)`);
  }
  const setAngle = (a) => putAttr(spinG, 'transform', Math.abs(a % 360) < 0.01 ? null : `rotate(${a.toFixed(2)} 60 60)`);

  function stop() {
    clearTimeout(timer); timer = 0;
    clearTimeout(restTimer); restTimer = 0;
    faceDrawers.delete(frame);
  }
  // The next move: the entrance first, then the loop with a pause after each.
  function later(ms) {
    clearTimeout(timer); timer = 0;
    if (performance.now() + ms > restAt) return;
    timer = setTimeout(() => {
      timer = 0;
      if (!root.isConnected || calm() || morph) return;
      const name = queue.length ? queue.shift() : M.loop ? M.loop[loopAt++ % M.loop.length] : null;
      if (!name) return;
      ev = { name, t0: performance.now() };
      faceWake(frame);
    }, ms);
  }
  // A minute after it settles (or last moved) the face rests: no more moves, no breathing, until it's shown a new mood
  // or moved.
  function arm() {
    resting = false;
    root.classList.toggle('breathing', Boolean(M.breathe));
    restAt = performance.now() + FACE_REST;
    clearTimeout(restTimer);
    restTimer = setTimeout(() => { restTimer = 0; resting = true; root.classList.remove('breathing'); }, FACE_REST);
  }
  function settled() {
    ev = null; loopAt = 0;
    queue = M.enter ? M.enter.slice() : [];
    arm();
    if (queue.length || M.loop) later(queue.length ? 60 : M.first || 450 + 600 * nextJitter());
  }

  // Off the page: it may not have been put there yet (a moment's grace after each show), or it was taken away.
  let born = 0;
  let placed = false;
  function frame(now) {
    if (!root.isConnected) { if (placed || now - born > 2000) stop(); return; }
    placed = true;
    let pose = cur; let fx = stillFx(); let moving = false;
    if (M.loader) {
      const r = loaderAt(now - loaderT0);
      pose = r.pose; setAngle(r.angle); moving = true;
    } else if (morph) {
      const t = now - morph.t0;
      if (t >= FACE_MORPH + FACE_STAGGER[3]) { cur = pose = morph.to; morph = null; settled(); } else {
        pose = {
          g: morph.from.g + (morph.to.g - morph.from.g) * faceSpring(clamp(t / FACE_MORPH, 0, 1)),
          tiles: morph.from.tiles.map((a, k) => mixTile(a, morph.to.tiles[k], faceSpring(clamp((t - FACE_STAGGER[k]) / FACE_MORPH, 0, 1)))),
        };
        // whatever move was under way eases out, and the face gives a little as it changes
        const k = clamp(t / FACE_MORPH, 0, 1); const q = 1 - clamp(faceSpring(k), 0, 1); const f = morph.fxFrom;
        fx = { eyes: [1 + (f.eyes[0] - 1) * q, 1 + (f.eyes[1] - 1) * q], body: { dx: f.body.dx * q, dy: f.body.dy * q, rot: f.body.rot * q, s: (1 + (f.body.s - 1) * q) * (1 - 0.035 * Math.sin(Math.PI * k)) }, mouth: 0, alt: 0 };
        moving = true;
      }
    }
    if (!morph && ev) {
      const [ms, apply] = FACE_FX[ev.name];
      const p = (now - ev.t0) / ms;
      if (p >= 1) {
        ev = null;
        if (M.loop || queue.length) later(queue.length ? 150 : M.every[0] + (M.every[1] - M.every[0]) * nextJitter());
      } else { apply(fx, Math.max(0, p)); moving = true; }
    }
    // a yawn opens the mouth
    if (fx.mouth > 0.001 && M.yawn) {
      const tiles = pose.tiles.slice();
      tiles[2] = mixTile(tiles[2], M.yawn[0], fx.mouth, true); tiles[3] = mixTile(tiles[3], M.yawn[1], fx.mouth, true);
      pose = { g: pose.g, tiles };
    }
    // a glance turns to the mood's other pose and back
    if (fx.alt > 0.001 && M.alt) pose = { g: pose.g, tiles: pose.tiles.map((t, k) => mixTile(t, M.alt.tiles[k], fx.alt, true)) };
    draw(pose, fx);
    shown = pose; lastFx = fx;
    if (!moving) faceDrawers.delete(frame);
  }

  // Showing the mood it already shows changes nothing while it's alive; one that stopped (taken off the page and put
  // back) starts again.
  root.show = (name, { instant = false } = {}) => {
    const next = MOODS[name];
    if (!next || (next === M && (still || timer || restTimer || resting || faceDrawers.has(frame) || (!M.loop && !M.loader)))) return;
    const was = M;
    M = next;
    stop();
    ev = null; queue = []; resting = false;
    born = performance.now(); placed = false;
    root.classList.toggle('breathing', Boolean(M.breathe) && !still);
    root.classList.toggle('turning', Boolean(M.loader) && reducedMotion());
    if (M.loader) {
      // Reduce Motion: the ring, turned slowly by the styles
      if (reducedMotion()) { cur = LOAD_RING; setAngle(0); draw(cur, stillFx()); return; }
      // drawn now, so a button that goes busy right before a long task never shows an empty space
      loaderT0 = performance.now();
      setAngle(0); draw(LOAD_SEEDS, stillFx());
      faceWake(frame);
      return;
    }
    setAngle(0);
    if (!was || was === M || was.loader || instant || calm() || !shown) {
      morph = null; cur = M.pose; draw(cur, stillFx()); shown = cur; lastFx = stillFx();
      if (!calm()) settled();
      return;
    }
    morph = { from: shown, to: M.pose, t0: performance.now(), fxFrom: lastFx };
    faceWake(frame);
  };
  // A one-off move on top of the mood, such as a shake.
  root.move = (name) => {
    if (!FACE_FX[name] || calm() || morph || M.loader) return;
    clearTimeout(timer); timer = 0;
    arm();
    ev = { name, t0: performance.now() };
    faceWake(frame);
  };
  root.show(mood);
  return root;
}

// The loader in place of a spinner.
const faceLoader = (size) => qoreeFace('loading', size);
