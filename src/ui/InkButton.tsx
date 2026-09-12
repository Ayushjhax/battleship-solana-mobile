/**
 * A button drawn with the pen. roughRect border, Bitter 600 label.
 *
 * Tones: 'ink' (violet outline), 'confirm' (inkGreen hachure fill, paper-white
 * label — Battle! / Choose), 'danger' (inkRed).
 *
 * Pressing re-draws the border with seed + 1 and drops the label one unit, so
 * it feels like the pen pressed harder. Light haptic on press-in. Never smaller
 * than 44 x 44 real pixels after scaling.
 */
import { useCallback, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityRole,
  type AccessibilityState,
  type ViewStyle,
} from 'react-native';
import Svg from 'react-native-svg';

import { haptic } from '@/audio/haptics';
import { useScale } from './Scale';
import { color, font, space, type as typeScale } from './tokens';
import { RoughShape, hashString, useRough } from './useRough';

export type InkButtonTone = 'ink' | 'confirm' | 'danger';

export interface InkButtonProps {
  label: string;
  onPress?: () => void;
  tone?: InkButtonTone;
  disabled?: boolean;
  /** Design units. Width defaults to a fit for the label. */
  w?: number;
  h?: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Stable key for the wobble. Defaults to the label. */
  seedKey?: string;
  style?: ViewStyle;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
}

const FONT_SIZE = {
  sm: typeScale.xs,
  md: typeScale.sm,
  lg: typeScale.md,
  xl: typeScale.xl,
} as const;
const MIN_REAL_PX = 44;

/** Bitter 600 averages ~0.56em per glyph; generous enough for short game labels. */
function fitWidth(label: string, fontSize: number): number {
  return Math.ceil(label.length * fontSize * 0.56 + space.lg * 2);
}

export function InkButton({
  label,
  onPress,
  tone = 'ink',
  disabled = false,
  w,
  h,
  size = 'md',
  seedKey,
  style,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
}: InkButtonProps) {
  const { scale } = useScale();
  const { roughRect } = useRough();
  const [pressed, setPressed] = useState(false);

  const fontSize = FONT_SIZE[size];
  const minUnits = Math.ceil(MIN_REAL_PX / scale);
  const width = Math.max(w ?? fitWidth(label, fontSize), minUnits);
  const height = Math.max(
    h ?? (size === 'xl' ? 60 : size === 'lg' ? 52 : size === 'sm' ? 36 : 44),
    minUnits,
  );

  const seed = hashString(`btn-${seedKey ?? label}`) + (pressed ? 1 : 0);
  const stroke = tone === 'confirm' ? color.inkGreen : tone === 'danger' ? color.inkRed : color.ink;
  const inset = 3;

  const border = roughRect(inset, inset, width - inset * 2, height - inset * 2, {
    seed,
    stroke,
    strokeWidth: tone === 'confirm' ? 1.8 : 1.6,
    ...(tone === 'confirm'
      ? { fill: color.inkGreen, fillStyle: 'hachure', hachureGap: 2.2, fillWeight: 1.9 }
      : {}),
  });

  const onPressIn = useCallback(() => {
    setPressed(true);
    haptic('buttonPress');
  }, []);
  const onPressOut = useCallback(() => setPressed(false), []);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ ...accessibilityState, disabled }}
      style={[{ width, height, opacity: disabled ? 0.45 : 1 }, style]}
    >
      <Svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={StyleSheet.absoluteFill}
      >
        <RoughShape paths={border} />
      </Svg>
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.labelBox,
          { transform: [{ translateY: pressed ? 1 : 0 }] },
        ]}
      >
        <Text
          numberOfLines={1}
          style={{
            color: tone === 'confirm' ? color.paper : stroke,
            fontFamily: size === 'xl' ? font.display : font.label,
            fontSize,
          }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  labelBox: { alignItems: 'center', justifyContent: 'center' },
});
