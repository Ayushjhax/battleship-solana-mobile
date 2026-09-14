/**
 * The page under the letterbox. The 800 x 360 canvas is scaled to fit the
 * screen, and whatever the screen has left over used to show the wooden
 * desk. Now the whole screen is the exercise book: this fills the window
 * with paper and continues the sheet's graph rules and red margin rule
 * outward at the canvas's own pitch and anchor, so the composition reads as
 * one page rather than a card on a table.
 *
 * Drawn straight in the Scale root's own units (no viewBox — the root can be
 * smaller than the window, and a viewBox would then squeeze the drawing)
 * inside a group transformed by the canvas's (ox, oy, scale), the same
 * numbers that place the canvas box in that root, so the rules land exactly
 * on the canvas's — Paper.tsx's — rules at the seam. The red rule is drawn
 * only OUTSIDE the canvas: inside, Paper draws its own, and two rough
 * strokes on top of each other read as a doubled pen line.
 *
 * `rules={false}` gives plain paper — the boot sequence's sheet inks its
 * rules in as a beat, and a page already ruled around it would spoil that.
 */
import { memo, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { G, Line, Rect } from 'react-native-svg';

import { CANVAS_W, PAPER_GRID, color } from './tokens';
import { RoughShape, hashString, roughLine } from './useRough';

export interface PaperBackdropProps {
  width: number;
  height: number;
  scale: number;
  ox: number;
  oy: number;
  rules: boolean;
}

/** Canvas units drawn beyond the reported window on each side. */
const OVERDRAW = 400;

export const PaperBackdrop = memo(function PaperBackdrop({
  width,
  height,
  scale,
  ox,
  oy,
  rules,
}: PaperBackdropProps) {
  const { unit, major, anchorX, anchorY, ruleY } = PAPER_GRID;
  // The window's bounds in canvas units, pushed well out on every side: on
  // phones with a display cutout or rounded corners the root view can run
  // past what useWindowDimensions reports, and a rule that stops short there
  // leaves a blank strip at the edge. The view clips whatever is not needed.
  const x0 = -ox / scale - OVERDRAW;
  const y0 = -oy / scale - OVERDRAW;
  const x1 = (width - ox) / scale + OVERDRAW;
  const y1 = (height - oy) / scale + OVERDRAW;

  const lines: ReactNode[] = [];
  if (rules) {
    for (let k = Math.ceil((x0 - anchorX) / unit); anchorX + k * unit <= x1; k++) {
      const x = anchorX + k * unit;
      const isMajor = k % major === 0;
      lines.push(
        <Line
          key={`v${k}`}
          x1={x}
          y1={y0}
          x2={x}
          y2={y1}
          stroke={isMajor ? color.gridMajor : color.gridMinor}
          strokeWidth={isMajor ? 1 : 0.7}
        />,
      );
    }
    for (let k = Math.ceil((y0 - anchorY) / unit); anchorY + k * unit <= y1; k++) {
      const y = anchorY + k * unit;
      const isMajor = k % major === 0;
      lines.push(
        <Line
          key={`h${k}`}
          x1={x0}
          y1={y}
          x2={x1}
          y2={y}
          stroke={isMajor ? color.gridMajor : color.gridMinor}
          strokeWidth={isMajor ? 1 : 0.7}
        />,
      );
    }
  }

  const pen = { stroke: color.ruleRed, strokeWidth: 1.3, roughness: 0.9, bowing: 0.7 } as const;
  const seed = hashString('backdrop-rule');
  const ruleLeft = rules && x0 < 0 ? roughLine(x0 - 2, ruleY, 0, ruleY, { seed, ...pen }) : null;
  const ruleRight =
    rules && x1 > CANVAS_W
      ? roughLine(CANVAS_W, ruleY, x1 + 2, ruleY, { seed: seed + 1, ...pen })
      : null;

  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect
        x={-OVERDRAW * scale}
        y={-OVERDRAW * scale}
        width={width + OVERDRAW * scale * 2}
        height={height + OVERDRAW * scale * 2}
        fill={color.paper}
      />
      <G transform={`translate(${ox} ${oy}) scale(${scale})`}>
        {lines}
        {ruleLeft ? <RoughShape paths={ruleLeft} /> : null}
        {ruleRight ? <RoughShape paths={ruleRight} /> : null}
      </G>
    </Svg>
  );
});
