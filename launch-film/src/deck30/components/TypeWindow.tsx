/**
 * TypeWindow — footage inside letters, with a fly-through of a counter.
 *
 * The letters are the real glyph outlines of the card face (Anton, extracted with opentype.js into
 * glyphs.data.json by scripts/deck30/glyphs.mjs) used as an SVG clipPath, so they stay crisp at any zoom. The
 * O's counter is its own contour: the black plate around the letters has a TRUE hole there, and `behind` (the
 * next scene) shows through it as the camera flies in.
 *
 * Layers: behind (only while flying) → the black plate (with the counter hole) → the footage clipped to the
 * letters → a hairline highlight on every edge → a light sweep, clipped to the letters.
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';
import G from '../glyphs.data.json';

type Word = keyof typeof G.words;

export const wordGeometry = (word: Word, width: number, cx: number, cy: number) => {
  const w = G.words[word];
  const [x0, y0, x1, y1] = w.bbox;
  const k = width / (x1 - x0);
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const toScreen = (x: number, y: number) => ({ x: cx + (x - mx) * k, y: cy + (y - my) * k });
  return { w, k, mx, my, toScreen };
};

/** centre (screen) and size of a glyph's counter, e.g. the O of VICTORY. */
export const counterOf = (word: Word, ch: string, width: number, cx: number, cy: number) => {
  const { w, toScreen, k } = wordGeometry(word, width, cx, cy);
  const g = w.glyphs.find((q) => q.char === ch && q.counters.length > 0)!;
  const [a, b, c, d] = g.counters[0].bbox;
  const p = toScreen((a + c) / 2, (b + d) / 2);
  return { x: p.x, y: p.y, w: (c - a) * k, h: (d - b) * k, d: g.counters[0].d };
};

export const TypeWindow: React.FC<{
  word: Word;
  id: string;
  width: number;
  cx: number;
  cy: number;
  /** camera zoom about `at` (screen px) */
  zoom?: number;
  at?: { x: number; y: number };
  /** the footage inside the letters (full frame; it zooms with the letters) */
  children: React.ReactNode;
  /** what the counter reveals once `hole` is on */
  behind?: React.ReactNode;
  hole?: boolean;
  /** 0..1 position of the light sweep across the word (undefined = none) */
  sweep?: number;
  plate?: string;
}> = ({ word, id, width, cx, cy, zoom = 1, at = { x: 960, y: 540 }, children, behind, hole = false, sweep, plate = '#000' }) => {
  const { w, k, mx, my } = wordGeometry(word, width, cx, cy);
  // path units → screen: translate(at) scale(zoom) translate(-at) translate(cx, cy) scale(k) translate(-mx, -my)
  const tf = `translate(${at.x} ${at.y}) scale(${zoom}) translate(${-at.x} ${-at.y}) translate(${cx} ${cy}) scale(${k}) translate(${-mx} ${-my})`;
  const o = w.glyphs.find((g) => g.char === 'O')!;
  const hairline = 1.6 / (k * zoom);
  const zoomStyle: React.CSSProperties = { transformOrigin: `${at.x}px ${at.y}px`, scale: String(zoom) };
  return (
    <AbsoluteFill>
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <defs>
          <clipPath id={`${id}-letters`} clipPathUnits="userSpaceOnUse">
            {w.glyphs.map((g, i) => (
              <path key={i} d={g.d} transform={tf} clipRule="evenodd" fillRule="evenodd" />
            ))}
          </clipPath>
          <mask id={`${id}-plate`} maskUnits="userSpaceOnUse" x={-100000} y={-100000} width={200000} height={200000}>
            <rect x={-100000} y={-100000} width={200000} height={200000} fill="#fff" />
            {hole && <path d={o.counters[0].d} transform={tf} fill="#000" />}
          </mask>
        </defs>
      </svg>
      {hole && behind}
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        <rect x={-100000} y={-100000} width={200000} height={200000} fill={plate} mask={`url(#${id}-plate)`} />
      </svg>
      <AbsoluteFill style={{ clipPath: `url(#${id}-letters)` }}>
        <AbsoluteFill style={zoomStyle}>{children}</AbsoluteFill>
        {sweep !== undefined && sweep > -0.2 && sweep < 1.2 && (
          <AbsoluteFill
            style={{
              background: `linear-gradient(105deg, rgba(255,255,255,0) ${sweep * 100 - 9}%, rgba(255,255,255,0.85) ${sweep * 100}%, rgba(200,190,255,0.5) ${sweep * 100 + 3}%, rgba(255,255,255,0) ${sweep * 100 + 9}%)`,
              mixBlendMode: 'screen',
            }}
          />
        )}
      </AbsoluteFill>
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {w.glyphs.map((g, i) => (
          <path key={i} d={g.d} transform={tf} fill="none" stroke="#F5F5F7" strokeOpacity={0.75} strokeWidth={hairline} />
        ))}
      </svg>
    </AbsoluteFill>
  );
};
