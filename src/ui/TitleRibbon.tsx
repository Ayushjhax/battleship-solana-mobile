/**
 * The ribboned title frame from IMG_9754 / IMG_9769: a roughRect banner with
 * two folded, swallow-tailed ribbon ends behind it. Reused by the progress,
 * arena and result screens.
 */
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg from 'react-native-svg';

import { ribbonShapes } from './geometry';
import { color, font, type as typeScale } from './tokens';
import { RoughShape, hashString, useRough } from './useRough';

export interface TitleRibbonProps {
  title: string;
  /** Total width including the ribbon ends, design units. */
  w?: number;
  h?: number;
  size?: 'sm' | 'md' | 'lg';
  seedKey?: string;
  style?: ViewStyle;
}

export function TitleRibbon({
  title,
  w = 340,
  h = 44,
  size = 'lg',
  seedKey,
  style,
}: TitleRibbonProps) {
  const { roughRect, roughPolygon } = useRough();
  const seed = hashString(`ribbon-${seedKey ?? title}`);

  const { leftEnd, rightEnd, leftFold, rightFold, banner: b, svgH } = ribbonShapes(w, h);

  const endOpts = {
    strokeWidth: 1.4,
    fill: color.inkFaint,
    fillStyle: 'hachure',
    hachureGap: 3.4,
    fillWeight: 1,
  } as const;

  const left = roughPolygon(leftEnd, { seed: seed + 1, ...endOpts });
  const right = roughPolygon(rightEnd, { seed: seed + 2, ...endOpts });
  const foldL = roughPolygon(leftFold, {
    seed: seed + 3,
    strokeWidth: 1,
    fill: color.inkSoft,
    fillStyle: 'solid',
  });
  const foldR = roughPolygon(rightFold, {
    seed: seed + 4,
    strokeWidth: 1,
    fill: color.inkSoft,
    fillStyle: 'solid',
  });
  const banner = roughRect(b.x, b.y, b.w, b.h, {
    seed,
    strokeWidth: 1.8,
    fill: color.paper,
    fillStyle: 'solid',
  });

  return (
    <View style={[{ width: w, height: svgH }, style]}>
      <Svg width={w} height={svgH} viewBox={`0 0 ${w} ${svgH}`} style={StyleSheet.absoluteFill}>
        <RoughShape paths={left} />
        <RoughShape paths={right} />
        <RoughShape paths={foldL} />
        <RoughShape paths={foldR} />
        <RoughShape paths={banner} />
      </Svg>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: b.x,
          top: b.y,
          width: b.w,
          height: b.h,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            color: color.ink,
            fontFamily: font.display,
            fontSize: size === 'lg' ? typeScale.lg : size === 'md' ? typeScale.md : typeScale.sm,
          }}
        >
          {title}
        </Text>
      </View>
    </View>
  );
}
