// Deck30 — real glyph outlines for TypeWindow (VICTORY. as a window) from the trailer's card face (Anton).
//   node scripts/deck30/glyphs.mjs      → src/deck30/glyphs.data.json
// Each word is laid out at a reference size with the font's own advances + kerning; every glyph keeps its
// contours separately so the O's counter (its inner contour) is available as a TRUE hole to fly through.
import opentype from 'opentype.js';
import fs from 'node:fs';

const font = opentype.parse(fs.readFileSync('node_modules/@fontsource/anton/files/anton-latin-400-normal.woff').buffer);
const SIZE = 1000; // reference font size (px); the component scales the whole word
const WORDS = { victory: 'VICTORY.' };
const TRACK = 0.012; // the trailer's card tracking (0.01 em), a hair more at this size

const round = (n) => Math.round(n * 10) / 10;
const toD = (cmds) => cmds.map((c) => {
  switch (c.type) {
    case 'M': return `M${round(c.x)} ${round(c.y)}`;
    case 'L': return `L${round(c.x)} ${round(c.y)}`;
    case 'Q': return `Q${round(c.x1)} ${round(c.y1)} ${round(c.x)} ${round(c.y)}`;
    case 'C': return `C${round(c.x1)} ${round(c.y1)} ${round(c.x2)} ${round(c.y2)} ${round(c.x)} ${round(c.y)}`;
    case 'Z': return 'Z';
  }
}).join('');
// signed area of a contour (from its on-curve points) → orientation
const area = (cmds) => {
  const pts = cmds.filter((c) => c.type !== 'Z').map((c) => [c.x, c.y]);
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i]; const [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; }
  return a / 2;
};
const bbox = (cmds) => {
  const xs = cmds.filter((c) => c.x !== undefined).map((c) => c.x), ys = cmds.filter((c) => c.y !== undefined).map((c) => c.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

const out = { font: 'Anton 400 (OFL)', size: SIZE, ascender: font.ascender / font.unitsPerEm * SIZE, words: {} };
for (const [key, text] of Object.entries(WORDS)) {
  const glyphs = font.stringToGlyphs(text);
  let x = 0;
  const items = [];
  glyphs.forEach((g, i) => {
    const p = g.getPath(x, 0, SIZE); // baseline at y = 0
    // split into contours
    const contours = [];
    let cur = [];
    for (const c of p.commands) { cur.push(c); if (c.type === 'Z') { contours.push(cur); cur = []; } }
    if (cur.length) contours.push(cur);
    const cs = contours.map((cmds) => ({ d: toD(cmds), area: area(cmds), bbox: bbox(cmds).map(round) }));
    // the outer contour has the largest |area|; contours with the opposite sign are counters (holes)
    const outer = cs.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a), cs[0]);
    items.push({ char: text[i], x: round(x), advance: round(g.advanceWidth / font.unitsPerEm * SIZE), d: toD(p.commands),
      counters: cs.filter((c) => Math.sign(c.area) !== Math.sign(outer.area)).map((c) => ({ d: c.d, bbox: c.bbox })), bbox: outer.bbox });
    const next = glyphs[i + 1];
    x += g.advanceWidth / font.unitsPerEm * SIZE + (next ? font.getKerningValue(g, next) / font.unitsPerEm * SIZE : 0) + TRACK * SIZE;
  });
  const all = items.flatMap((g) => [g.bbox[0], g.bbox[2]]), ys = items.flatMap((g) => [g.bbox[1], g.bbox[3]]);
  out.words[key] = { text, glyphs: items, bbox: [Math.min(...all), Math.min(...ys), Math.max(...all), Math.max(...ys)].map(round) };
  console.log(key, JSON.stringify(out.words[key].bbox), items.map((g) => `${g.char}:${g.counters.length}`).join(' '));
}
fs.writeFileSync('src/deck30/glyphs.data.json', JSON.stringify(out));
console.log('→ src/deck30/glyphs.data.json');
