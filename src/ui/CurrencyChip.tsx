/**
 * Coins and gems, drawn in code (docs/assets.md: "the coin and gem chips").
 * A roughRect pill with the icon on the left and the count in Bitter 600.
 */
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg from 'react-native-svg';

import { color, font, type as typeScale } from './tokens';
import { RoughShape, hashString, useRough, type Point } from './useRough';

export interface CurrencyChipProps {
  kind: 'points' | 'coins' | 'steel' | 'gems';
  value: number;
  w?: number;
  h?: number;
  style?: ViewStyle;
}

export const COIN_GOLD = '#C99A2E';
const GOLD = COIN_GOLD;
const TEAL = '#2E7D6B';
/** Port City steel: an ink girder, drawn in the primary ballpoint violet. */
const STEEL = color.ink;

function format(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

export function CurrencyChip({ kind, value, w = 92, h = 30, style }: CurrencyChipProps) {
  const { roughRect, roughCircle, roughPolygon, roughLine } = useRough();
  const seed = hashString(`chip-${kind}`);
  const iconCx = h / 2 + 3;
  const iconCy = h / 2;
  const r = h * 0.3;

  const pill = roughRect(2, 2, w - 4, h - 4, {
    seed,
    strokeWidth: 1.4,
    fill: color.paper,
    fillStyle: 'solid',
  });

  const icon =
    kind === 'points'
      ? [
          roughCircle(iconCx, iconCy, r * 2, {
            seed: seed + 1,
            stroke: color.ink,
            strokeWidth: 1.4,
            fill: color.ink,
            fillStyle: 'hachure',
            hachureGap: 2.4,
            fillWeight: 1,
          }),
          roughLine(iconCx - r * 0.55, iconCy, iconCx + r * 0.55, iconCy, {
            seed: seed + 2,
            stroke: color.paper,
            strokeWidth: 1.2,
          }),
        ]
      : kind === 'coins'
      ? [
          roughCircle(iconCx, iconCy, r * 2, {
            seed: seed + 1,
            stroke: GOLD,
            strokeWidth: 1.4,
            fill: GOLD,
            fillStyle: 'hachure',
            hachureGap: 2.4,
            fillWeight: 1,
          }),
          roughCircle(iconCx, iconCy, r * 1.1, { seed: seed + 2, stroke: GOLD, strokeWidth: 1 }),
        ]
      : kind === 'steel'
      ? [
          // An I-beam seen end-on: two flanges and a web (docs/port-city §6's
          // "ink girder"). Deliberately angular — no curves, so it never reads
          // as a coin at chip size.
          roughPolygon(
            [
              [iconCx - r, iconCy - r * 0.9],
              [iconCx + r, iconCy - r * 0.9],
              [iconCx + r, iconCy - r * 0.45],
              [iconCx + r * 0.3, iconCy - r * 0.45],
              [iconCx + r * 0.3, iconCy + r * 0.45],
              [iconCx + r, iconCy + r * 0.45],
              [iconCx + r, iconCy + r * 0.9],
              [iconCx - r, iconCy + r * 0.9],
              [iconCx - r, iconCy + r * 0.45],
              [iconCx - r * 0.3, iconCy + r * 0.45],
              [iconCx - r * 0.3, iconCy - r * 0.45],
              [iconCx - r, iconCy - r * 0.45],
            ] as Point[],
            {
              seed: seed + 1,
              stroke: STEEL,
              strokeWidth: 1.3,
              fill: STEEL,
              fillStyle: 'hachure',
              hachureGap: 2.6,
              fillWeight: 0.8,
            },
          ),
        ]
      : [
          roughPolygon(
            [
              [iconCx - r, iconCy - r * 0.35],
              [iconCx - r * 0.5, iconCy - r],
              [iconCx + r * 0.5, iconCy - r],
              [iconCx + r, iconCy - r * 0.35],
              [iconCx, iconCy + r],
            ] as Point[],
            {
              seed: seed + 1,
              stroke: TEAL,
              strokeWidth: 1.4,
              fill: TEAL,
              fillStyle: 'hachure',
              hachureGap: 2.4,
              fillWeight: 1,
            },
          ),
          roughLine(iconCx - r, iconCy - r * 0.35, iconCx + r, iconCy - r * 0.35, {
            seed: seed + 2,
            stroke: TEAL,
            strokeWidth: 1,
          }),
        ];

  return (
    <View style={[{ width: w, height: h }, style]}>
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={StyleSheet.absoluteFill}>
        <RoughShape paths={pill} />
        {icon.map((paths, i) => (
          <RoughShape key={i} paths={paths} />
        ))}
      </Svg>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: iconCx + r + 6,
          right: 8,
          top: 0,
          bottom: 0,
          justifyContent: 'center',
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            color: color.ink,
            fontFamily: font.label,
            fontSize: typeScale.xs,
            textAlign: 'right',
          }}
        >
          {format(value)}
        </Text>
      </View>
    </View>
  );
}
