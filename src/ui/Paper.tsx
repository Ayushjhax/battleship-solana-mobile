/**
 * The sheet: a school exercise book lying on a dark wooden desk.
 *
 *  - desk behind it (assets/images/board/desk-wood.jpg once it lands, flat
 *    color.desk until then)
 *  - the paper, with a slightly hand-torn right edge
 *  - graph rules: minor every cell in gridMinor, major every 5th in gridMajor,
 *    drawn as plain <Line> inside one memoised <G> that renders exactly once —
 *    200 rough lines would eat the frame budget
 *  - the red margin rule across the top, drawn WITH roughLine so it reads as pen
 */
import { Image } from 'expo-image';
import { memo, useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { ClipPath, Defs, G, Line, Path, Rect } from 'react-native-svg';

import { BOARD_ART } from './assets';
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
  const tearX = w - TEAR_INSET[variant];
  const amp = variant === 'full' ? 3.2 : 1.8;

  const sheetPath = useMemo(() => buildSheetPath(w, h, tearX, amp, seed), [w, h, tearX, amp, seed]);
  const clipId = `sheet-${seed}`;

  const rule =
    variant === 'full'
      ? roughLine(-2, PAPER_GRID.ruleY, tearX - 4, PAPER_GRID.ruleY, {
          seed: seed + 7,
          stroke: color.ruleRed,
          strokeWidth: 1.3,
          roughness: 0.9,
          bowing: 0.7,
        })
      : null;

  const showDeskImage = variant === 'full' && BOARD_ART.deskWood != null;

  return (
    <View style={{ width: w, height: h }}>
      {showDeskImage ? (
        <Image
          source={BOARD_ART.deskWood}
          contentFit="cover"
          style={StyleSheet.absoluteFill}
          cachePolicy="memory-disk"
        />
      ) : null}
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={StyleSheet.absoluteFill}>
        <Defs>
          <ClipPath id={clipId}>
            <Path d={sheetPath} />
          </ClipPath>
        </Defs>
        {variant === 'full' && !showDeskImage ? (
          <Rect x={0} y={0} width={w} height={h} fill={color.desk} />
        ) : null}
        {variant === 'full' ? (
          // The sheet's shadow on the desk, drawn as a shape — never a shadow prop.
          <Path d={sheetPath} fill={color.deskDark} opacity={0.7} transform="translate(3 3)" />
        ) : null}
        <Path d={sheetPath} fill={color.paper} />
        <G clipPath={`url(#${clipId})`}>
          <GraphRules w={w} h={h} />
          {rule ? <RoughShape paths={rule} /> : null}
        </G>
        {/* the fibrous edge of the tear */}
        <Path d={sheetPath} fill="none" stroke="#DDE3EA" strokeWidth={0.8} />
      </Svg>
      {children ? <View style={StyleSheet.absoluteFill}>{children}</View> : null}
    </View>
  );
}
