/**
 * Renders the image if the asset has landed (see src/ui/assets.ts), otherwise
 * a labelled rough placeholder at the exact declared size — so every screen
 * is buildable before the art exists. Use it EVERYWHERE an image goes:
 *
 *   <AssetSlot source={SHIPS.battleship} w={112} h={28} label="battleship" />
 */
import { Image } from 'expo-image';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg from 'react-native-svg';

import type { Asset } from './assets';
import { color, font, type as typeScale } from './tokens';
import { RoughShape, hashString, useRough } from './useRough';

export interface AssetSlotProps {
  source?: Asset;
  w: number;
  h: number;
  label: string;
  /** Line art is pure black and tinted at runtime; defaults to ink. */
  tintColor?: string | null;
  style?: ViewStyle;
}

export function AssetSlot({ source, w, h, label, tintColor = color.ink, style }: AssetSlotProps) {
  const { roughRect, roughLine } = useRough();

  if (source) {
    return (
      <View style={[{ width: w, height: h }, style]}>
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          tintColor={tintColor ?? undefined}
          cachePolicy="memory-disk"
        />
      </View>
    );
  }

  const seed = hashString(`slot-${label}-${w}x${h}`);
  const faint = { stroke: color.inkFaint, strokeWidth: 1, roughness: 0.9 } as const;
  const frame = roughRect(1, 1, w - 2, h - 2, { seed, ...faint });
  const cross1 = roughLine(1, 1, w - 1, h - 1, { seed: seed + 1, ...faint });
  const cross2 = roughLine(w - 1, 1, 1, h - 1, { seed: seed + 2, ...faint });
  const showLabel = w >= 40 && h >= 14;

  return (
    <View style={[{ width: w, height: h }, style]}>
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={StyleSheet.absoluteFill}>
        <RoughShape paths={frame} dash={[4, 3]} />
        <RoughShape paths={cross1} opacity={0.5} />
        <RoughShape paths={cross2} opacity={0.5} />
      </Svg>
      {showLabel ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
          <Text
            numberOfLines={1}
            style={{
              color: color.inkFaint,
              backgroundColor: color.paper,
              paddingHorizontal: 3,
              fontFamily: font.body,
              fontSize: typeScale.xxs,
            }}
          >
            {label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
