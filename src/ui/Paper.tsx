/**
 * The sheet: a page of a school exercise book.
 *
 *  - 'full' is the screen's page. It is a plain opaque sheet edge to edge —
 *    the display around the canvas is paper as well (Scale's PaperBackdrop
 *    continues these rules outward), so there is no desk, no shadow and no
 *    torn edge; those would draw a card lying on top of the page. Screens
 *    also use it as an opaque curtain, so it must stay opaque.
 *  - 'panel' is a bare sheet with a slightly hand-torn right edge, for the
 *    keyboard and notes laid on the page
 *  - graph rules: minor every cell in gridMinor, major every 5th in gridMajor,
 *    drawn as plain <Line> inside one memoised <G> that renders exactly once —
 *    200 rough lines would eat the frame budget
 *  - the red margin rule across the top, drawn WITH roughLine so it reads as pen
 */
import { memo, useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { ClipPath, Defs, G, Line, Path } from 'react-native-svg';

import { countRender } from './debug';
import { sheetPath as buildSheetPath } from './geometry';
import { CANVAS_H, CANVAS_W, PAPER_GRID, color } from './tokens';
import { RoughShape, hashString, roughLine } from './useRough';

export interface PaperProps {
  /** 'full' is the 800 x 360 page with desk and red rule; 'panel' is a bare sheet. */
  variant?: 'full' | 'panel';
  w?: number;
  h?: number;
  /** Stable key for the tear and the rule wobble. Two sheets, two keys. */
  seedKey?: string;
  children?: ReactNode;
}

/** How far in from the right edge the tear runs, per variant. */
const TEAR_INSET = { full: 12, panel: 6 } as const;

/** The red margin rule's own geometry, shared so it can be drawn twice. */
function marginRulePaths(w: number, seed: number) {
  return roughLine(-2, PAPER_GRID.ruleY, w + 2, PAPER_GRID.ruleY, {
    seed: seed + 7,
    stroke: color.ruleRed,
    strokeWidth: 1.3,
    roughness: 0.9,
    bowing: 0.7,
  });
}

/**
 * The red margin rule on its own, for screens that draw a strip over the top
 * of the sheet. Battle's HUD sits across y = 0..78 and buried the line the rest
 * of the game shows, so the one element meant to be constant was the one that
 * disappeared mid-match. Render this above that strip with the same `seedKey`
 * and the line is identical, wobble included.
 */
export function MarginRule({ w = CANVAS_W, seedKey = 'paper' }: { w?: number; seedKey?: string }) {
  const seed = hashString(`${seedKey}-full`);
  const paths = marginRulePaths(w, seed);
  return (
    <Svg
      width={w}
      height={PAPER_GRID.ruleY + 8}
      viewBox={`0 0 ${w} ${PAPER_GRID.ruleY + 8}`}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
    >
      <RoughShape paths={paths} />
    </Svg>
  );
}

export interface RulesProps {
  w: number;
  h: number;
}

/**
 * The rules alone, so the boot sequence can wipe them in under its own
 * ClipPath. Renders once — verify with countRender('GraphRules').
 */
export const GraphRules = memo(function GraphRules({ w, h }: RulesProps) {
  countRender('GraphRules');
  const { unit, major, anchorX, anchorY } = PAPER_GRID;
  const lines: ReactNode[] = [];

  const x0 = ((anchorX % unit) + unit) % unit;
  for (let x = x0, k = Math.round((x0 - anchorX) / unit); x <= w; x += unit, k++) {
    const isMajor = k % major === 0;
    lines.push(
      <Line
        key={`v${x}`}
        x1={x}
        y1={-6}
        x2={x}
        y2={h + 6}
        stroke={isMajor ? color.gridMajor : color.gridMinor}
        strokeWidth={isMajor ? 1 : 0.7}
      />,
    );
  }
  const y0 = ((anchorY % unit) + unit) % unit;
  for (let y = y0, k = Math.round((y0 - anchorY) / unit); y <= h; y += unit, k++) {
    const isMajor = k % major === 0;
    lines.push(
      <Line
        key={`h${y}`}
        x1={-6}
        y1={y}
        x2={w + 6}
        y2={y}
        stroke={isMajor ? color.gridMajor : color.gridMinor}
        strokeWidth={isMajor ? 1 : 0.7}
      />,
    );
  }
  return <G>{lines}</G>;
});

export function Paper({
  variant = 'full',
  w = CANVAS_W,
  h = CANVAS_H,
  seedKey = 'paper',
  children,
}: PaperProps) {
  countRender('Paper');
  const seed = hashString(`${seedKey}-${variant}`);
  const torn = variant === 'panel';
  const tearX = w - TEAR_INSET[variant];

  // The page runs past its own edges so nothing shows at the seam with the
  // backdrop; the panel keeps its tear.
  const sheetPath = useMemo(
    () => (torn ? buildSheetPath(w, h, tearX, 1.8, seed) : `M -6 -6 H ${w + 6} V ${h + 6} H -6 Z`),
    [torn, w, h, tearX, seed],
  );
  const clipId = `sheet-${seed}`;

  const rule = variant === 'full' ? marginRulePaths(w, seed) : null;

  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={StyleSheet.absoluteFill}>
        <Defs>
          <ClipPath id={clipId}>
            <Path d={sheetPath} />
          </ClipPath>
        </Defs>
        <Path d={sheetPath} fill={color.paper} />
        <G clipPath={`url(#${clipId})`}>
          <GraphRules w={w} h={h} />
          {rule ? <RoughShape paths={rule} /> : null}
        </G>
        {torn ? (
          // the fibrous edge of the tear
          <Path d={sheetPath} fill="none" stroke="#DDE3EA" strokeWidth={0.8} />
        ) : null}
      </Svg>
      {children ? <View style={StyleSheet.absoluteFill}>{children}</View> : null}
    </View>
  );
}
