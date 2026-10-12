/**
 * LockOnGrid — pixel words written by target locks on the game's board.
 *
 * The board is the game's battle layout drawn plainly in its tokens: two 10 x 10 grids, rows A–J and columns 1–10,
 * with a gutter of 40/28 cells between them (src/engine/types.ts, src/board/layout.ts). The word's letters are
 * 3 x 5 pixel glyphs; each letter is split into strokes, and every stroke gets one lock-on: corner brackets snap
 * onto it on its beat and its cells light up in ink. The period is the bit: a glowing square that lands after the
 * word on the drop's downbeat.
 *
 * Board units: one cell = 100. Left board x 0–1000, right board x 1143–2143, y 0–1000 (row A at the top).
 */
import React from 'react';
import { interpolate } from 'remotion';
import { C, EASE_IN, FONT, clamp } from '../../trailer45/theme';
import { BOARD } from '../copy';

export const CELL = 100;
export const GUTTER = (40 / 28) * CELL;
export const RIGHT = 10 * CELL + GUTTER;

/** a stroke = a set of [col, row] cells inside its letter */
type Stroke = readonly (readonly [number, number])[];
/** 3 x 5 glyphs as strokes, in writing order */
export const GLYPHS: Record<string, readonly Stroke[]> = {
  F: [[[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], [[1, 0], [2, 0]], [[1, 2]]],
  I: [[[0, 0], [1, 0], [2, 0]], [[1, 1], [1, 2], [1, 3]], [[0, 4], [1, 4], [2, 4]]],
  R: [[[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], [[1, 0], [2, 1]], [[1, 2]], [[2, 3], [2, 4]]],
  E: [[[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], [[1, 0], [2, 0]], [[1, 2]], [[1, 4], [2, 4]]],
};

/**
 * FIRE across the two boards, centred on the gutter so every gap reads the same:
 * F at left cols 4–6, I at left 8–10 | R at right 1–3, E at right 5–7, rows C–G; the period at right col 9, row G.
 */
export const LAYOUT: { ch: string; x: number; y: number }[] = [
  { ch: 'F', x: 3 * CELL, y: 2 * CELL },
  { ch: 'I', x: 7 * CELL, y: 2 * CELL },
  { ch: 'R', x: RIGHT + 0 * CELL, y: 2 * CELL },
  { ch: 'E', x: RIGHT + 4 * CELL, y: 2 * CELL },
];
export const PERIOD = { x: RIGHT + 8 * CELL, y: 6 * CELL };
/** the strokes in order, in board units */
export const STROKES = LAYOUT.flatMap((l) =>
  GLYPHS[l.ch].map((st) => {
    const cells = st.map(([c, r]) => [l.x + c * CELL, l.y + r * CELL] as const);
    const xs = cells.map((p) => p[0]);
    const ys = cells.map((p) => p[1]);
    return { cells, box: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + CELL, h: Math.max(...ys) - Math.min(...ys) + CELL } };
  }),
);
/** the word + period, for framing */
export const WORD_BOX = { x: 3 * CELL, y: 2 * CELL, w: PERIOD.x + CELL - 3 * CELL, h: 5 * CELL };

type View = { scale: number; cx: number; cy: number; fx: number; fy: number };
const sx = (v: View, x: number) => v.cx + (x - v.fx) * v.scale;
const sy = (v: View, y: number) => v.cy + (y - v.fy) * v.scale;

const Brackets: React.FC<{ x: number; y: number; w: number; h: number; p: number; a: number; thick: number }> = ({ x, y, w, h, p, a, thick }) => {
  const pad = (1 - p) * Math.max(w, h) * 0.45 + thick * 2;
  const L = Math.min(w, h) * 0.32 + 8;
  const col = C.accent;
  const corner = (cx: number, cy: number, dx: number, dy: number, k: string) => (
    <React.Fragment key={k}>
      <div style={{ position: 'absolute', left: dx > 0 ? cx : cx - L, top: cy - thick / 2, width: L, height: thick, background: col, boxShadow: `0 0 ${thick * 3}px ${col}` }} />
      <div style={{ position: 'absolute', left: cx - thick / 2, top: dy > 0 ? cy : cy - L, width: thick, height: L, background: col, boxShadow: `0 0 ${thick * 3}px ${col}` }} />
    </React.Fragment>
  );
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: a }}>
      {corner(x - pad, y - pad, 1, 1, 'tl')}
      {corner(x + w + pad, y - pad, -1, 1, 'tr')}
      {corner(x - pad, y + h + pad, 1, -1, 'bl')}
      {corner(x + w + pad, y + h + pad, -1, -1, 'br')}
    </div>
  );
};

/**
 * Draws the board in screen space. `frame` is a global frame; `lockFrames[i]` the frame stroke i locks on.
 * `view`: board point (fx, fy) lands at screen (cx, cy) at `scale` screen px per board unit.
 */
export const LockOnGrid: React.FC<{
  frame: number;
  view: View;
  lockFrames: readonly number[];
  periodFrame?: number;
  width?: number;
  height?: number;
}> = ({ frame, view, lockFrames, periodFrame, width = 1920, height = 1080 }) => {
  const s = view.scale;
  const line = Math.max(1, 2.2 * s);
  const boards = [0, RIGHT];
  const lines: React.ReactNode[] = [];
  for (const bx of boards) {
    for (let i = 0; i <= 10; i++) {
      const major = i === 0 || i === 10 || i === 5;
      lines.push(<line key={`v${bx}-${i}`} x1={sx(view, bx + i * CELL)} x2={sx(view, bx + i * CELL)} y1={sy(view, 0)} y2={sy(view, 1000)} stroke={major ? C.gridMajor : C.gridMinor} strokeWidth={major ? line * 1.4 : line} />);
      lines.push(<line key={`h${bx}-${i}`} y1={sy(view, i * CELL)} y2={sy(view, i * CELL)} x1={sx(view, bx)} x2={sx(view, bx + 1000)} stroke={major ? C.gridMajor : C.gridMinor} strokeWidth={major ? line * 1.4 : line} />);
    }
  }
  const coordSize = 34 * s;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width, height, background: C.paper, overflow: 'hidden' }}>
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
        {/* the paper's red margin rule, as on the game's sheet */}
        <line x1={0} x2={width} y1={sy(view, -260)} y2={sy(view, -260)} stroke={C.ruleRed} strokeWidth={3 * s + 1} opacity={0.75} />
        {lines}
        {boards.map((bx) => (
          <rect key={bx} x={sx(view, bx)} y={sy(view, 0)} width={1000 * s} height={1000 * s} fill="none" stroke={C.ink} strokeWidth={5 * s + 1} opacity={0.85} />
        ))}
      </svg>
      {/* faint coordinates, as the game labels them: 1–10 above, A–J beside each board */}
      {boards.flatMap((bx) => [
        ...Array.from({ length: BOARD.cols }, (_, i) => (
          <div key={`n${bx}${i}`} style={{ position: 'absolute', left: sx(view, bx + i * CELL), top: sy(view, -78), width: CELL * s, textAlign: 'center', fontFamily: FONT.game, fontWeight: 600, fontSize: coordSize, color: C.inkSoft, opacity: 0.5 }}>
            {i + 1}
          </div>
        )),
        ...BOARD.rows.split('').map((ch, i) => (
          <div key={`l${bx}${i}`} style={{ position: 'absolute', left: sx(view, bx - 72), top: sy(view, i * CELL + 50) - coordSize * 0.62, width: 60 * s, textAlign: 'center', fontFamily: FONT.game, fontWeight: 600, fontSize: coordSize, color: C.inkSoft, opacity: 0.5 }}>
            {ch}
          </div>
        )),
      ])}
      {/* lit cells + brackets */}
      {STROKES.map((st, i) => {
        const lf = lockFrames[i];
        const next = lockFrames[i + 1] ?? lf + 6;
        const snap = Math.max(1.5, Math.min(3, next - lf));
        const pre = frame - (lf - snap);
        if (pre < 0) return null;
        const p = interpolate(pre, [0, snap], [0, 1], { ...clamp, easing: EASE_IN });
        const lit = frame >= lf;
        const flare = lit ? interpolate(frame - lf, [0, 4], [1, 0], clamp) : 0;
        const bracketA = lit ? interpolate(frame - lf, [2, 7], [1, 0], clamp) : interpolate(pre, [0, 1], [0.4, 1], clamp);
        const b = st.box;
        return (
          <React.Fragment key={i}>
            {lit &&
              st.cells.map(([x, y], k) => (
                <div
                  key={k}
                  style={{
                    position: 'absolute',
                    left: sx(view, x) + line,
                    top: sy(view, y) + line,
                    width: CELL * s - line * 2,
                    height: CELL * s - line * 2,
                    background: flare > 0 ? `rgb(${Math.round(62 + (190 - 62) * flare)},${Math.round(47 + (180 - 47) * flare)},${Math.round(184 + (255 - 184) * flare)})` : C.ink,
                    boxShadow: `0 0 ${(6 + 30 * flare) * s}px rgba(124,108,255,${0.35 + 0.6 * flare}), inset 0 0 ${10 * s}px rgba(20,10,80,0.45)`,
                  }}
                />
              ))}
            {bracketA > 0.01 && <Brackets x={sx(view, b.x)} y={sy(view, b.y)} w={b.w * s} h={b.h * s} p={p} a={bracketA} thick={Math.max(3, 8 * s)} />}
          </React.Fragment>
        );
      })}
      {periodFrame !== undefined && frame >= periodFrame && (() => {
        const t = frame - periodFrame;
        const k = interpolate(t, [0, 1], [1.7, 1], clamp);
        const size = CELL * s * 0.86 * k;
        const x = sx(view, PERIOD.x + CELL / 2);
        const y = sy(view, PERIOD.y + CELL / 2);
        return (
          <div
            style={{
              position: 'absolute',
              left: x - size / 2,
              top: y - size / 2,
              width: size,
              height: size,
              background: '#E8E4FF',
              border: `${Math.max(2, size * 0.07)}px solid ${C.accent}`,
              boxShadow: `0 0 ${size * 0.4}px ${C.accent}, 0 0 ${size * 1.2}px ${C.accent}cc, 0 0 ${size * 3}px ${C.accent}88`,
            }}
          />
        );
      })()}
    </div>
  );
};
