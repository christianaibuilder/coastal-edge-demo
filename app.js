/* Coastal Edge Outdoor Services — design preview
   One renderer draws an isometric cutaway of a paver job (subgrade, base, sand, pavers, joints,
   sealer). The hero plays it by scroll position; the studio re-lays it with the pattern and blend
   you pick; the restore section draws the same yard twice (faded vs sealed) behind a drag handle.
   No libraries. Nothing here sends data anywhere. */
(() => {
'use strict';
document.documentElement.classList.add('js');

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIO = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const NARROW = () => innerWidth < 861;
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ---------- colour ---------- */
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgbHsl(r, g, b) { r /= 255; g /= 255; b /= 255; const M = Math.max(r, g, b), m = Math.min(r, g, b); let h = 0, s = 0; const l = (M + m) / 2; if (M !== m) { const d = M - m; s = l > .5 ? d / (2 - M - m) : d / (M + m); switch (M) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; default: h = (r - g) / d + 4; } h /= 6; } return [h, s, l]; }
function hsl(h, s, l, a = 1) { return `hsla(${(h * 360).toFixed(1)},${(clamp(s, 0, 1) * 100).toFixed(1)}%,${(clamp(l, 0, 1) * 100).toFixed(1)}%,${a})`; }

/* ---------- geometry: patterns in plan feet ---------- */
const FT = { brick: [1 / 3, 2 / 3], large: [1, 2] };            // 4x8 in, 12x24 in
function rect(x, y, w, h) { return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; }
function clipPoly(poly, W, H) {                                    // Sutherland–Hodgman against [0,W]x[0,H]
  const edges = [[p => p[0] >= 0, (a, b) => ix(a, b, 0, 0)], [p => p[0] <= W, (a, b) => ix(a, b, 0, W)], [p => p[1] >= 0, (a, b) => ix(a, b, 1, 0)], [p => p[1] <= H, (a, b) => ix(a, b, 1, H)]];
  let out = poly;
  for (const [inside, cut] of edges) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); }
      else if (inside(a)) out.push(cut(a, b));
    }
    if (!out.length) return null;
  }
  return out;
  function ix(a, b, axis, v) { const t = (v - a[axis]) / (b[axis] - a[axis]); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
}
function area(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
function centroid(p) { let x = 0, y = 0; for (const q of p) { x += q[0]; y += q[1]; } return [x / p.length, y / p.length]; }
function rotate(poly, ang, cx, cy) { const c = Math.cos(ang), s = Math.sin(ang); return poly.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]); }

function genRunning(W, H, pw, ph, ang = 0) {
  const out = [], R = Math.hypot(W, H);
  for (let row = -2, y = -R; y < R * 2; row++, y += ph) {
    const off = (row & 1) ? pw / 2 : 0;
    for (let x = -R - off; x < R * 2; x += pw) out.push(rect(x, y, pw, ph));
  }
  return finish(out, W, H, ang);
}
function genHerringbone(W, H, s, ang) {                            // staircases of 1x2 bricks, unit s
  const out = [], R = Math.ceil(Math.hypot(W, H) / s) + 4;
  for (let k = -R; k <= R; k++) for (let n = -R; n <= R; n++) {
    out.push(rect((2 * n - k) * s, (2 * n + k) * s, 2 * s, s));
    out.push(rect((2 * n + 2 - k) * s, (2 * n + k) * s, s, 2 * s));
  }
  return finish(out, W, H, ang);
}
function genBasket(W, H, s) {
  const out = [], R = Math.ceil(Math.max(W, H) / s) + 2;
  for (let i = -1; i <= R; i++) for (let j = -1; j <= R; j++) {
    const x = 2 * i * s, y = 2 * j * s;
    if ((i + j) & 1) { out.push(rect(x, y, s, 2 * s)); out.push(rect(x + s, y, s, 2 * s)); }
    else { out.push(rect(x, y, 2 * s, s)); out.push(rect(x, y + s, 2 * s, s)); }
  }
  return finish(out, W, H, 0);
}
function genAshlar(W, H) {                                         // 9x9, 6x9, 9x6, 6x6 in a 15 in module, rows shifted
  const u = .25, out = [], M = 5 * u, R = Math.ceil(Math.max(W, H) / M) + 2;
  for (let j = -1; j <= R; j++) for (let i = -1; i <= R; i++) {
    const x = i * M + ((j & 1) ? 2 * u : 0), y = j * M;
    out.push(rect(x, y, 3 * u, 3 * u)); out.push(rect(x + 3 * u, y, 2 * u, 3 * u));
    out.push(rect(x, y + 3 * u, 3 * u, 2 * u)); out.push(rect(x + 3 * u, y + 3 * u, 2 * u, 2 * u));
  }
  return finish(out, W, H, 0);
}
function finish(polys, W, H, ang) {
  const out = [];
  for (let p of polys) {
    if (ang) p = rotate(p, ang, W / 2, H / 2);
    const c = clipPoly(p, W, H);
    if (c && area(c) > 0.03) out.push(c);
  }
  return out;
}
function genBorder(W, H, b) {                                      // soldier course, bricks across the band
  const s = FT.brick[0], out = [];
  for (let x = 0; x < W; x += s) { out.push(rect(x, 0, s, b)); out.push(rect(x, H - b, s, b)); }
  for (let y = b; y < H - b; y += s) { out.push(rect(0, y, b, s)); out.push(rect(W - b, y, b, s)); }
  return finish(out, W, H, 0);
}

const PATTERNS = {
  hb45: { name: 'Herringbone 45°', note: 'Tightest interlock. What we lay under driveways.', gen: (W, H) => genHerringbone(W, H, FT.brick[0], Math.PI / 4) },
  hb90: { name: 'Herringbone 90°', note: 'Same lock, squared to the house. Driveways and patios.', gen: (W, H) => genHerringbone(W, H, FT.brick[0], 0) },
  running: { name: 'Running bond', note: 'Classic brick look. Walkways and pool decks.', gen: (W, H) => genRunning(W, H, FT.brick[1], FT.brick[0]) },
  basket: { name: 'Basketweave', note: 'Pairs of pavers turned each way. Patios and paths.', gen: (W, H) => genBasket(W, H, FT.brick[0]) },
  ashlar: { name: '3-piece ashlar', note: 'Three sizes in a random-looking fit. Patios and pool decks.', gen: (W, H) => genAshlar(W, H) },
  large: { name: 'Large format 12×24', note: 'Big, calm, modern. Pool decks in travertine or porcelain.', gen: (W, H) => genRunning(W, H, FT.large[1], FT.large[0]) },
};
const BLENDS = {
  tampa: { name: 'Tampa blend', hexes: ['#C9A97C', '#5B5651', '#B86B41', '#8C7A66', '#D8B98F', '#6E6459'] },
  shell: { name: 'Shell sand', hexes: ['#D8C4A3', '#CDB58F', '#E2D2B5', '#C4A97F', '#D1BB98'] },
  charcoal: { name: 'Charcoal', hexes: ['#4E4F53', '#5E5F64', '#3F4044', '#6B6C71', '#56575B'] },
  ivory: { name: 'Travertine ivory', hexes: ['#E7DDCC', '#DFD3BE', '#EEE6D8', '#D9CCB6', '#E3D8C6'] },
  terra: { name: 'Terracotta mix', hexes: ['#B9603B', '#C8744D', '#A9542F', '#D2875F', '#B06A48'] },
};
const SIZES = { patio: { name: 'Patio 14 × 10', W: 14, H: 10 }, walk: { name: 'Walkway 4 × 18', W: 4, H: 18 }, drive: { name: 'Driveway 18 × 16', W: 18, H: 16 } };

/* ---------- build a job (pavers with colours and lay order) ---------- */
const TP = .2, TS = .083, TB = .5, SUB = .3;                        // paver, sand, base, shown subgrade (ft)
function buildJob(o) {
  const { W, H, pattern, blend, border, seed = 7 } = o;
  const r = rng(seed);
  const b = border ? FT.brick[1] : 0;
  let polys = PATTERNS[pattern].gen(W, H);
  if (b) polys = polys.map(p => clipPoly(p.map(([x, y]) => [x, y]), W, H)).map(p => shrinkTo(p, b, W, H)).filter(Boolean);
  const list = polys.map(p => ({ poly: p, c: centroid(p), border: false }));
  if (b) for (const p of genBorder(W, H, b)) list.push({ poly: p, c: centroid(p), border: true });
  const field = BLENDS[blend].hexes, edgeHexes = (blend === 'charcoal' ? BLENDS.shell : BLENDS.charcoal).hexes;
  list.sort((a, c) => (a.border - c.border) || ((a.c[0] + a.c[1]) - (c.c[0] + c.c[1])));
  const nField = list.filter(x => !x.border).length, nBorder = list.length - nField;
  list.forEach((p, i) => {
    const hexes = p.border ? edgeHexes : field;
    const [h, s, l] = rgbHsl(...hexRgb(hexes[Math.floor(r() * hexes.length)]));
    p.h = h + (r() - .5) * .02; p.s = s; p.l = clamp(l + (r() - .5) * .08, .05, .95);
    // every paver must have landed by lay = 1, so orders stop at .93 (a paver lands .055 after its order)
    p.order = p.border ? .80 + .13 * ((i - nField) / Math.max(1, nBorder)) : .80 * (i / Math.max(1, nField)) + (r() - .5) * .025;
    p.order = clamp(p.order, 0, .93);
  });
  // joint weed spots for the "before" look: along a few edges
  const weeds = [];
  for (const p of list) for (let i = 0; i < p.poly.length; i++) { if (r() < .18) { const a = p.poly[i], c = p.poly[(i + 1) % p.poly.length]; const t = .2 + r() * .6; weeds.push([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, .4 + r() * .8]); } }
  // speckle points for base/dirt textures
  const speck = []; for (let i = 0; i < 260; i++) speck.push([r() * W, r() * H, r()]);
  return { W, H, list, weeds, speck, pattern, blend, border: b };
  function shrinkTo(p, b, W, H) { return clipPoly(p.map(([x, y]) => [x - b, y - b]), W - 2 * b, H - 2 * b)?.map(([x, y]) => [x + b, y + b]) || null; }
}

/* ---------- the renderer ---------- */
const C30 = Math.cos(Math.PI / 6), S30 = .5, ZX = 1.9;             // vertical exaggeration so the layers read
function makeView(cw, ch, W, H, zTop, zBot, lay) {
  const dw = (W + H) * C30, dh = (W + H) * S30 + (zTop - zBot) * ZX;
  const s = Math.min(cw * lay.w / dw, ch * lay.h / dh);
  const totalH = dh * s;
  const ox = cw * lay.cx - (W - H) * C30 * s / 2, oy = ch * lay.cy - totalH / 2 + zTop * ZX * s;
  return { s, ox, oy, P: (u, v, z) => [ox + (u - v) * C30 * s, oy + (u + v) * S30 * s - z * ZX * s] };
}
function poly(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); }
function inset(p, g) { const c = centroid(p); return p.map(([x, y]) => { const dx = x - c[0], dy = y - c[1], d = Math.hypot(dx, dy) || 1; const k = Math.max(0, d - g) / d; return [c[0] + dx * k, c[1] + dy * k]; }); }

/* scene: {job, dig, base, sand, lay, edge, joint, seal, fade, weeds, lay:{cx,cy,w,h}} all 0..1 */
function renderScene(ctx, cw, ch, sc) {
  const { job } = sc, { W, H } = job;
  const T = TP + TS + TB, zBot = -(T + SUB);
  const V = makeView(cw, ch, W, H, .55, zBot, sc.layout);
  const P = V.P, s = V.s;
  ctx.clearRect(0, 0, cw, ch);
  // ground plane shadow
  ctx.save(); ctx.filter = 'blur(' + Math.round(s * .9) + 'px)';
  poly(ctx, [P(-.6, -.6, zBot), P(W + .9, -.6, zBot), P(W + .9, H + .9, zBot), P(-.6, H + .9, zBot)]);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill(); ctx.restore();

  const digZ = -sc.dig * T;                                          // current top of the undug soil
  const baseTop = -T + sc.base * TB, sandTop = -T + TB + sc.sand * TS;
  const bands = [                                                    // side bands, bottom to top: [z0, z1, right, front]
    [zBot, -T, '#4A3728', '#3B2B1F'],
    [-T, digZ, '#6B4F3A', '#56402E'],
  ];
  if (sc.base > 0) bands.push([-T, baseTop, '#8F8B84', '#777470']);
  if (sc.sand > 0) bands.push([-T + TB, sandTop, '#CDB68E', '#B9A27C']);
  const topZ = sc.sand > 0 ? sandTop : sc.base > 0 ? baseTop : digZ;
  for (const [z0, z1, cr, cf] of bands) {
    if (z1 <= z0 + 1e-4) continue;
    poly(ctx, [P(W, 0, z0), P(W, H, z0), P(W, H, z1), P(W, 0, z1)]); ctx.fillStyle = cr; ctx.fill();   // right face (u = W)
    poly(ctx, [P(0, H, z0), P(W, H, z0), P(W, H, z1), P(0, H, z1)]); ctx.fillStyle = cf; ctx.fill();   // front face (v = H)
  }
  // top face of whatever is on top
  const topCol = sc.sand > 0 ? '#D9C49C' : sc.base > 0 ? '#9A968F' : sc.dig > .02 ? '#7A5A42' : '#5E7D47';
  poly(ctx, [P(0, 0, topZ), P(W, 0, topZ), P(W, H, topZ), P(0, H, topZ)]); ctx.fillStyle = topCol; ctx.fill();
  if (sc.dig <= .02) {                                               // lawn: a few blade strokes
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
    for (const [u, v, k] of job.speck) { if (k > .5) continue; const [x, y] = P(u, v, 0); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 1, y - 3 - k * 4); ctx.stroke(); }
  } else if (sc.sand <= 0 && sc.lay <= 0) {                          // dirt or gravel speckles
    for (const [u, v, k] of job.speck) { const [x, y] = P(u, v, topZ); ctx.fillStyle = sc.base > 0 ? (k > .5 ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.22)') : 'rgba(0,0,0,.18)'; ctx.fillRect(x, y, 1.5 + k, 1 + k); }
  }
  // the pavers
  if (sc.lay > 0) {
    const gap = .022, jointL = lerp(.22, .62, sc.joint), jointS = lerp(.05, .32, sc.joint), jointH = .09;
    // joint fill shows through the gaps: paint the paver area in joint colour first
    poly(ctx, [P(0, 0, 0), P(W, 0, 0), P(W, H, 0), P(0, H, 0)]); ctx.fillStyle = hsl(jointH, jointS, jointL); ctx.fill();
    for (const p of job.list) {
      const e = clamp((sc.lay - p.order) / .055, 0, 1);
      if (e <= 0) continue;
      const drop = REDUCED ? 0 : (1 - easeOut(e)) * .7;
      const S = lerp(p.s * .85, p.s * 1.25, sc.seal) * lerp(1, .45, sc.fade);
      const L = lerp(p.l * 1.04, p.l * .88, sc.seal) * lerp(1, 1.18, sc.fade);
      const top = inset(p.poly, gap);
      ctx.globalAlpha = Math.min(1, e * 2.2);
      // side faces along edges whose outward normal points toward the viewer (+u or +v)
      for (let i = 0; i < top.length; i++) {
        const a = top[i], b = top[(i + 1) % top.length];
        const nx = (b[1] - a[1]), ny = -(b[0] - a[0]);               // outward for a counter-clockwise polygon in plan
        const dot = nx + ny; if (dot <= 0) continue;
        const k = nx > ny ? .78 : .62;
        poly(ctx, [P(a[0], a[1], drop), P(b[0], b[1], drop), P(b[0], b[1], drop - TP), P(a[0], a[1], drop - TP)]);
        ctx.fillStyle = hsl(p.h, S, L * k); ctx.fill();
      }
      poly(ctx, top.map(([u, v]) => P(u, v, drop))); ctx.fillStyle = hsl(p.h, S, L); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // soldier-course edge line reads as the border; edge restraint sits just outside the front edges
    if (sc.edge > 0) {
      ctx.globalAlpha = sc.edge;
      const w = .07;
      poly(ctx, [P(W, 0, 0), P(W + w, 0, 0), P(W + w, H + w, 0), P(0, H + w, 0), P(0, H, 0), P(W, H, 0)]); ctx.fillStyle = '#2B2F33'; ctx.fill();
      poly(ctx, [P(W + w, 0, 0), P(W + w, H + w, 0), P(W + w, H + w, -TP), P(W + w, 0, -TP)]); ctx.fillStyle = '#1C1F22'; ctx.fill();
      poly(ctx, [P(0, H + w, 0), P(W + w, H + w, 0), P(W + w, H + w, -TP), P(0, H + w, -TP)]); ctx.fillStyle = '#15181B'; ctx.fill();
      ctx.globalAlpha = 1;
    }
    // weeds and haze for the "before" look
    if (sc.weeds > 0) {
      ctx.globalAlpha = sc.weeds;
      for (const [u, v, k] of job.weeds) { const [x, y] = P(u, v, 0); ctx.fillStyle = k > .8 ? '#5C7A2E' : '#486A2A'; ctx.beginPath(); ctx.ellipse(x, y, 1.6 + k * s * .05, 1 + k * s * .03, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    if (sc.fade > 0) { poly(ctx, [P(0, 0, 0), P(W, 0, 0), P(W, H, 0), P(0, H, 0)]); ctx.fillStyle = 'rgba(235,228,214,' + (.16 * sc.fade) + ')'; ctx.fill(); }
    // sealer gloss sweeps across the top face
    if (sc.seal > 0 && sc.lay >= .999) {
      ctx.save(); poly(ctx, [P(0, 0, 0), P(W, 0, 0), P(W, H, 0), P(0, H, 0)]); ctx.clip();
      const [x0, y0] = P(0, 0, 0), [x1, y1] = P(W, H, 0);
      const t = sc.sealSweep == null ? 1 : sc.sealSweep;
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      const m = clamp(t, 0, 1);
      g.addColorStop(Math.max(0, m - .25), 'rgba(255,255,255,0)'); g.addColorStop(m, 'rgba(255,255,255,' + (.16 * sc.seal) + ')'); g.addColorStop(Math.min(1, m + .25), 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch); ctx.restore();
    }
  }
}
function fitCanvas(c) { const r = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr)); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } return [w, h]; }

/* ---------- the film ---------- */
const film = $('#film'), filmCanvas = $('#film-canvas'), filmPhoto = $('#film-photo'), filmCopy = $('.film-copy'), filmTitle = $('#film-title'), filmSub = $('#film-sub'), filmActions = $('.film-actions'), filmBar = $('#film-bar'), filmDone = $('#film-done'), jobCard = $('#job-card');
const heroJob = buildJob({ W: 12, H: 9, pattern: 'hb45', blend: 'tampa', border: true, seed: 11 });
const CH = [
  { at: 0, title: 'Pavers, built <em>from the ground up.</em>', sub: 'Patios, driveways and pool decks across Pinellas County. Scroll to watch one go in, layer by layer.', layer: null },
  { at: .07, title: 'Dig to depth. <em>Compact the ground.</em>', sub: 'Nine to ten inches down for a patio, deeper for a driveway, then the soil gets compacted before anything goes in.', layer: 'dig' },
  { at: .21, title: 'Six inches of base, <em>in lifts.</em>', sub: 'Crushed base, compacted in layers instead of dumped in one go. This is the part a cheap job skips, and the reason pavers sink.', layer: 'base' },
  { at: .35, title: 'One inch of sand, <em>screeded flat.</em>', sub: 'Concrete sand pulled level across the base. Never stone dust, never thicker to hide a low spot.', layer: 'sand' },
  { at: .43, title: 'Set in pattern. <em>Cut tight.</em>', sub: 'Laid from a straight line, pulled from several bundles so the color mixes, cut to the edge, then run with a plate compactor.', layer: 'paver' },
  { at: .73, title: 'Locked <em>at the edge.</em>', sub: 'Edge restraint spiked into the base around the outside, so the field cannot creep.', layer: 'paver' },
  { at: .78, title: 'Polymeric sand, <em>swept and set.</em>', sub: 'Fills every joint, sets up hard, and keeps the weeds and ants out.', layer: 'joint' },
  { at: .865, title: 'Sealed, <em>and the color comes up.</em>', sub: 'A color-enhancing sealer sixty to ninety days after the install, once the pavers have cured.', layer: 'seal' },
  { at: .935, title: 'Your yard, <em>finished.</em>', sub: 'That one is a Coastal Edge pool deck in Pinellas. Every photo below is a real job.', layer: null },
];
let fTarget = 0, fShown = -1, fChapter = -1, fLayout = null, watching = null;
window.__ce = { film: () => ({ target: fTarget, shown: fShown, chapter: fChapter, pavers: heroJob.list.length }), ba: () => baPos };
function filmLayout() { fLayout = NARROW() ? { cx: .5, cy: .42, w: .9, h: .55 } : { cx: .66, cy: .5, w: .5, h: .72 }; }
function seg(p, a, b) { return clamp((p - a) / (b - a), 0, 1); }
function drawFilm(p) {
  const [cw, ch] = fitCanvas(filmCanvas); const ctx = filmCanvas.getContext('2d');
  const base1 = seg(p, .21, .27), base2 = seg(p, .295, .34);
  const sc = {
    job: heroJob, layout: fLayout,
    dig: easeIO(seg(p, .07, .2)),
    base: Math.max(0, base1 * .5 + base2 * .5),
    sand: easeIO(seg(p, .35, .43)),
    lay: seg(p, .43, .73),
    edge: seg(p, .73, .775),
    joint: easeIO(seg(p, .78, .86)),
    seal: easeOut(seg(p, .865, .93)), sealSweep: seg(p, .865, .95),
    fade: 0, weeds: 0,
  };
  renderScene(ctx, cw, ch, sc);
  const photo = seg(p, .935, .985);
  filmPhoto.style.opacity = photo; filmCanvas.style.opacity = 1 - photo * .9;
  filmBar.style.width = (p * 100).toFixed(1) + '%';
  filmDone.classList.toggle('show', p > .97);
  const ch_ = CH.reduce((k, c, i) => (p >= c.at ? i : k), 0);
  if (ch_ !== fChapter) { setChapter(ch_); }
}
function setChapter(i) {
  const was = fChapter; fChapter = i; const c = CH[i];
  const swap = () => { filmTitle.innerHTML = c.title; filmSub.textContent = c.sub; filmCopy.classList.remove('swap'); };
  if (was < 0 || REDUCED) swap(); else { filmCopy.classList.add('swap'); setTimeout(swap, 180); }
  filmActions.classList.toggle('gone', i > 0);
  jobCard.classList.toggle('show', i > 0 && i < CH.length - 1);
  const order = ['dig', 'base', 'sand', 'paver', 'joint', 'seal'], idx = order.indexOf(c.layer);
  $$('#layers li').forEach(li => { const k = order.indexOf(li.dataset.layer); li.classList.toggle('now', k === idx); li.classList.toggle('done', idx > -1 && k < idx); });
}
function filmProgressFromScroll() { const r = film.getBoundingClientRect(); const total = film.offsetHeight - innerHeight; return clamp(-r.top / Math.max(1, total), 0, 1); }
function tick() {
  if (!REDUCED) fShown = fShown < 0 ? fTarget : lerp(fShown, fTarget, .14); else fShown = fTarget;
  if (Math.abs(fShown - fTarget) < .0006) fShown = fTarget;
  drawFilm(fShown);
  if (fShown !== fTarget) requestAnimationFrame(tick); else ticking = false;
}
let ticking = false;
function onScroll() { fTarget = filmProgressFromScroll(); $('#nav').classList.toggle('solid', scrollY > 40); if (!ticking) { ticking = true; requestAnimationFrame(tick); } }
filmLayout(); addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', () => { filmLayout(); fShown = -1; onScroll(); studioDraw(1); baRender(); });
onScroll();

// "Watch it go in": drive the window through the film over ~10 s; any touch or wheel hands control back
$('#watch').addEventListener('click', () => {
  const top = film.offsetTop, end = top + film.offsetHeight - innerHeight, t0 = performance.now(), D = REDUCED ? 10 : 11000;
  cancelWatch();
  const step = now => { const t = clamp((now - t0) / D, 0, 1); scrollTo({ top: lerp(top, end, easeIO(t)), behavior: 'instant' }); /* the page's CSS smooth-scroll would otherwise restart every frame and go nowhere */ if (t < 1 && watching) watching = requestAnimationFrame(step); else watching = null; };
  watching = requestAnimationFrame(step);
});
function cancelWatch() { if (watching) { cancelAnimationFrame(watching); watching = null; } }
addEventListener('wheel', cancelWatch, { passive: true }); addEventListener('touchstart', cancelWatch, { passive: true }); addEventListener('keydown', cancelWatch);

/* ---------- the studio ---------- */
const stCanvas = $('#studio-canvas'), stTag = $('#studio-tag'), patNote = $('#pattern-note');
const st = { pattern: 'hb45', blend: 'tampa', size: 'patio', border: true, seal: true, job: null, anim: null };
function radio(el, items, current, onPick, swatch) {       // a row of chips acting as one radio group
  el.innerHTML = '';
  for (const [id, it] of Object.entries(items)) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.setAttribute('role', 'radio'); b.dataset.id = id;
    b.innerHTML = (swatch ? `<span class="swatch" style="--c1:${it.hexes[0]};--c2:${it.hexes[1]};--c3:${it.hexes[2]};--c4:${it.hexes[3]}"></span>` : '') + it.name;
    b.setAttribute('aria-checked', String(current() === id));
    b.addEventListener('click', () => { [...el.children].forEach(x => x.setAttribute('aria-checked', String(x === b))); onPick(id); });
    el.appendChild(b);
  }
}
const chips = (el, items, key, onPick, swatch) => radio(el, items, () => st[key], id => { st[key] = id; onPick(); }, swatch);
function studioBuild() { const sz = SIZES[st.size]; st.job = buildJob({ W: sz.W, H: sz.H, pattern: st.pattern, blend: st.blend, border: st.border, seed: 3 }); stTag.textContent = `${PATTERNS[st.pattern].name} · ${BLENDS[st.blend].name} · ${sz.W} × ${sz.H} ft`.toUpperCase(); patNote.textContent = PATTERNS[st.pattern].note; }
function studioDraw(lay) {
  if (!st.job) return;
  const [cw, ch] = fitCanvas(stCanvas); const ctx = stCanvas.getContext('2d');
  const sz = SIZES[st.size], tall = sz.H > sz.W * 1.6;
  renderScene(ctx, cw, ch, { job: st.job, layout: { cx: .5, cy: .5, w: tall ? .7 : .9, h: .82 }, dig: 1, base: 1, sand: 1, lay, edge: lay >= .999 ? 1 : 0, joint: 1, seal: st.seal ? 1 : 0, sealSweep: 1, fade: 0, weeds: 0 });
}
function studioRelay() {
  studioBuild();
  if (st.anim) cancelAnimationFrame(st.anim);
  if (REDUCED) { studioDraw(1); return; }
  const t0 = performance.now(), D = 1100;
  const step = now => { const t = clamp((now - t0) / D, 0, 1); studioDraw(easeIO(t)); if (t < 1) st.anim = requestAnimationFrame(step); else st.anim = null; };
  st.anim = requestAnimationFrame(step);
}
chips($('#pattern-chips'), PATTERNS, 'pattern', studioRelay);
chips($('#blend-chips'), BLENDS, 'blend', studioRelay, true);
chips($('#size-chips'), SIZES, 'size', studioRelay);
$('#border-toggle').addEventListener('change', e => { st.border = e.target.checked; studioRelay(); });
$('#seal-toggle').addEventListener('change', e => { st.seal = e.target.checked; studioDraw(1); });
$('#relay').addEventListener('click', studioRelay);
studioBuild(); studioDraw(1);
// lay it the first time it scrolls into view
new IntersectionObserver((es, o) => { if (es.some(e => e.isIntersecting)) { studioRelay(); o.disconnect(); } }, { threshold: .35 }).observe(stCanvas);

/* ---------- before / after ---------- */
const ba = $('#ba'), baCanvas = $('#ba-canvas'), baHandle = $('#ba-handle');
let baPos = .5, baBefore = null, baAfter = null;
const baJob = buildJob({ W: 14, H: 8, pattern: 'running', blend: 'tampa', border: true, seed: 5 });
function baRender() {
  const [cw, ch] = fitCanvas(baCanvas);
  const layout = { cx: .5, cy: .5, w: .92, h: .86 };
  baBefore = document.createElement('canvas'); baBefore.width = cw; baBefore.height = ch;
  renderScene(baBefore.getContext('2d'), cw, ch, { job: baJob, layout, dig: 1, base: 1, sand: 1, lay: 1, edge: 1, joint: .35, seal: 0, fade: 1, weeds: 1 });
  baAfter = document.createElement('canvas'); baAfter.width = cw; baAfter.height = ch;
  renderScene(baAfter.getContext('2d'), cw, ch, { job: baJob, layout, dig: 1, base: 1, sand: 1, lay: 1, edge: 1, joint: 1, seal: 1, sealSweep: 1, fade: 0, weeds: 0 });
  baDraw();
}
function baDraw() {
  const ctx = baCanvas.getContext('2d'), cw = baCanvas.width, ch = baCanvas.height, x = Math.round(cw * baPos);
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = '#1B2229'; ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(baBefore, 0, 0);
  ctx.save(); ctx.beginPath(); ctx.rect(x, 0, cw - x, ch); ctx.clip(); ctx.fillStyle = '#1B2229'; ctx.fillRect(x, 0, cw - x, ch); ctx.drawImage(baAfter, 0, 0); ctx.restore();
  baHandle.style.left = (baPos * 100) + '%'; baHandle.setAttribute('aria-valuenow', Math.round(baPos * 100));
}
function baSet(clientX) { const r = ba.getBoundingClientRect(); baPos = clamp((clientX - r.left) / r.width, .03, .97); baDraw(); }
let baDrag = false;
ba.addEventListener('pointerdown', e => { baDrag = true; baSet(e.clientX); ba.setPointerCapture?.(e.pointerId); });
addEventListener('pointermove', e => { if (baDrag) baSet(e.clientX); });
addEventListener('pointerup', () => { baDrag = false; });
baHandle.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') { baPos = clamp(baPos - .05, .03, .97); baDraw(); } if (e.key === 'ArrowRight') { baPos = clamp(baPos + .05, .03, .97); baDraw(); } });
baRender();

/* ---------- the estimator (sample numbers for the preview) ---------- */
const TYPES = { patio: { name: 'Patio', adj: [0, 0], unit: 'patio' }, walkway: { name: 'Walkway', adj: [0, 0], unit: 'walkway' }, driveway: { name: 'Driveway', adj: [2, 3], unit: 'driveway' }, pool: { name: 'Pool deck', adj: [3, 5], unit: 'pool deck' }, restore: { name: 'Restore & seal', adj: null, unit: 'restoration' } };
const MATS = { concrete: { name: 'Concrete pavers', rate: [12, 18] }, stone: { name: 'Travertine / natural stone', rate: [18, 28] }, porcelain: { name: 'Porcelain', rate: [22, 32] } };
const PRESETS = [['12 × 16 patio', 192], ['Walkway', 120], ['2-car driveway', 600], ['Pool deck', 800]];
const RESTORE = [1.5, 2.5], SEAL_ADD = [1, 1.75], DEMO_ADD = [2, 3], MIN = 1500;
const es = { type: 'patio', mat: 'concrete', area: 400, demo: false, seal: false };
const fmt = n => '$' + (Math.round(n / 50) * 50).toLocaleString('en-US');
function estimate() {
  const t = TYPES[es.type]; let lo, hi; const inc = [];
  if (!t.adj) { lo = es.area * RESTORE[0]; hi = es.area * RESTORE[1]; inc.push('Pressure wash and joint clean', 'Fresh polymeric sand, pavers reset where needed', 'Color-enhancing sealer'); }
  else {
    const m = MATS[es.mat]; lo = es.area * (m.rate[0] + t.adj[0]); hi = es.area * (m.rate[1] + t.adj[1]);
    inc.push('Excavation and compacted base', m.name + ', set in your pattern', 'Edge restraint and polymeric sand');
    if (es.type === 'driveway') inc.push('Deeper base, built for vehicles');
    if (es.type === 'pool') inc.push('Coping and drainage detail');
    if (es.demo) { lo += es.area * DEMO_ADD[0]; hi += es.area * DEMO_ADD[1]; inc.push('Old concrete removed and hauled'); }
    if (es.seal) { lo += es.area * SEAL_ADD[0]; hi += es.area * SEAL_ADD[1]; inc.push('Sealed after curing'); }
  }
  lo = Math.max(MIN, lo); hi = Math.max(lo + 400, hi);
  $('#est-price').textContent = fmt(lo) + ' – ' + fmt(hi);
  $('#est-sub').textContent = `${es.area.toLocaleString('en-US')} sq ft ${t.unit}${t.adj ? ' in ' + MATS[es.mat].name.toLowerCase() : ''}, ${t.adj ? 'installed' : 'cleaned, re-sanded and sealed'}.`;
  $('#est-includes').innerHTML = inc.map(x => `<li>${x}</li>`).join('');
  $('#material-group').hidden = !t.adj; $('#addon-group').hidden = !t.adj;
  $('#area-out').textContent = es.area.toLocaleString('en-US') + ' sq ft';
}
radio($('#type-chips'), TYPES, () => es.type, id => { es.type = id; estimate(); });
radio($('#material-chips'), MATS, () => es.mat, id => { es.mat = id; estimate(); });
(function () { const el = $('#preset-chips'); for (const [name, a] of PRESETS) { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = `${name} · ${a} sq ft`; b.onclick = () => { es.area = a; $('#area').value = a; estimate(); }; el.appendChild(b); } })();
$('#area').addEventListener('input', e => { es.area = +e.target.value; estimate(); });
$('#addon-demo').addEventListener('change', e => { es.demo = e.target.checked; estimate(); });
$('#addon-seal').addEventListener('change', e => { es.seal = e.target.checked; estimate(); });
$('#studio-to-estimate').addEventListener('click', () => { es.mat = st.blend === 'ivory' ? 'stone' : 'concrete'; const el = $('#material-chips'); [...el.children].forEach(x => x.setAttribute('aria-checked', String(x.dataset.id === es.mat))); estimate(); });
estimate();

/* ---------- forms and modal: a preview sends nothing ---------- */
const modal = $('#modal');
function openModal() { $('#modal-summary').textContent = $('#est-price').textContent + ' · ' + $('#est-sub').textContent; modal.hidden = false; $('#modal-note').hidden = true; $('#m-name').focus(); }
function closeModal() { modal.hidden = true; }
$('#est-cta').addEventListener('click', openModal);
$('#modal-x').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
function previewSubmit(form, noteId, who) {
  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = form.querySelector('input[type=text]'), phone = form.querySelector('input[type=tel]');
    const note = $(noteId);
    if (!name.value.trim() || !phone.value.trim()) { note.textContent = 'Add a name and a phone number so Brent can call you back.'; note.hidden = false; return; }
    note.textContent = `Thanks, ${name.value.trim().split(' ')[0]}. This is a design preview, so nothing was sent. On the live site this goes straight to ${who}.`; note.hidden = false;
  });
}
previewSubmit($('#lead-form'), '#form-note', "Brent's phone");
previewSubmit($('#modal-form'), '#modal-note', "Brent's phone with your estimate attached");

/* ---------- reveals ---------- */
const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { threshold: .12, rootMargin: '0px 0px -5% 0px' });
$$('.reveal').forEach(el => io.observe(el));
})();
