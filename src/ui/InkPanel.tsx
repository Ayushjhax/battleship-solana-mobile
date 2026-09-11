/**
 * The double-stroke card: arsenal panel, avatar cards, modals.
 * Two nested roughRects 3 units apart over a white fill, plus a third stroke
 * offset down-right in inkFaint standing in for a shadow. Never the shadow
 * style props.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg from 'react-native-svg';

import { color, space } from './tokens';
import { RoughShape, hashString, useRough } from './useRough';

export interface InkPanelProps {
  w: number;
  h: number;
  seedKey: string;
  /** Inner padding for children, design units. */
  padding?: number;
  /** Paper by default; pass 'none' to let the sheet show through. */
  fill?: string | 'none';
  style?: ViewStyle;
  children?: ReactNode;
}

const GAP = 3;
const SHADOW = 3;

export function InkPanel({
  w,
  h,
  seedKey,
  padding = space.sm,
  fill = color.paper,
  style,
  children,
}: InkPanelProps) {
  const { roughRect } = useRough();
  const seed = hashString(`panel-${seedKey}`);

  // Leave room for the offset stroke so nothing is clipped at the edge.
  const outerW = w - SHADOW - 1;
  const outerH = h - SHADOW - 1;

  const shadow = roughRect(1 + SHADOW, 1 + SHADOW, outerW, outerH, {
    seed: seed + 2,
    stroke: color.inkFaint,
    strokeWidth: 1.4,
    roughness: 1.2,
  });
  const outer = roughRect(1, 1, outerW, outerH, {
    seed,
    strokeWidth: 1.7,
    ...(fill === 'none' ? {} : { fill, fillStyle: 'solid' }),
  });
  const inner = roughRect(1 + GAP, 1 + GAP, outerW - GAP * 2, outerH - GAP * 2, {
    seed: seed + 1,
    strokeWidth: 1.1,
    roughness: 1.1,
  });

  return (
    <View style={[{ width: w, height: h }, style]}>
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={StyleSheet.absoluteFill}>
        <RoughShape paths={shadow} />
        <RoughShape paths={outer} />
        <RoughShape paths={inner} />
      </Svg>
      <View style={{ flex: 1, padding: padding + GAP }}>{children}</View>
    </View>
  );
}
