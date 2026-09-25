/**
 * A button on a blank plate from its own art (PLATES): green for the action,
 * cream for the rest, with a live label and an optional icon — for buttons
 * whose words change ("Processing…", "Finish credit", "Check payout") or whose
 * colour marks the selected tab. The plate nearest the button's shape is used,
 * so the hatching is never stretched more than a few percent.
 *
 * Two families: 'rivet' (PLATES, the points exchange's riveted plates) and
 * 'sketch' (SKETCH_PLATES, placement and the battle — the double pen frame
 * and the hatched green of the fleet screens).
 *
 * Press feel matches ArtImageButton: light haptic, a quick spring to 95%.
 */
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { haptic } from '@/audio/haptics';
import { PLATES, PLATE_ASPECTS, SKETCH_ASPECTS, SKETCH_PLATES, type Asset } from './assets';
import { artColor, font } from './tokens';

export type PlateTone = 'green' | 'cream';
export type PlateFamily = 'rivet' | 'sketch';

function nearestPlate(family: PlateFamily, tone: PlateTone, aspect: number): Asset {
  const aspects: readonly number[] = family === 'sketch' ? SKETCH_ASPECTS : PLATE_ASPECTS;
  let best = 0;
  aspects.forEach((a, i) => {
    if (Math.abs(a - aspect) < Math.abs((aspects[best] ?? a) - aspect)) best = i;
  });
  return (family === 'sketch' ? SKETCH_PLATES : PLATES)[tone][best] ?? null;
}

export function ArtPlate({
  tone,
  family = 'rivet',
  w,
  h,
  label,
  onPress,
  icon,
  iconSize,
  disabled = false,
  fontSize,
  accessibilityLabel,
  checked,
  style,
}: {
  tone: PlateTone;
  family?: PlateFamily;
  w: number;
  h: number;
  label: string;
  onPress?: () => void;
  icon?: Asset;
  iconSize?: number;
  disabled?: boolean;
  fontSize?: number;
  accessibilityLabel?: string;
  /** A choice in a group (the AI level): read out as a radio, checked or not. */
  checked?: boolean;
  style?: ViewStyle;
}) {
  const press = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const green = tone === 'green';
  const size = fontSize ?? Math.round(h * 0.44);
  const icn = iconSize ?? Math.round(h * 0.55);
  const body = (
    <Animated.View style={[{ width: w, height: h, opacity: disabled ? 0.5 : 1 }, pressStyle]}>
      <Image
        source={nearestPlate(family, tone, w / h)}
        style={StyleSheet.absoluteFill}
        contentFit="fill"
        cachePolicy="memory-disk"
      />
      <View style={[styles.content, { paddingHorizontal: Math.min(14, Math.round(w * 0.08)) }]}>
        {icon ? <Image source={icon} style={{ width: icn, height: icn }} contentFit="contain" /> : null}
        <Text
          style={[styles.label, green ? styles.onGreen : styles.onCream, { fontSize: size }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {label}
        </Text>
      </View>
    </Animated.View>
  );
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        press.value = withTiming(0.95, { duration: 70 });
        haptic('buttonPress');
      }}
      onPressOut={() => {
        press.value = withSpring(1, { damping: 11, stiffness: 360 });
      }}
      disabled={disabled}
      accessibilityRole={checked === undefined ? 'button' : 'radio'}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={checked === undefined ? { disabled } : { disabled, checked }}
      style={style}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingBottom: 1,
  },
  label: { fontFamily: font.display, flexShrink: 1 },
  onGreen: {
    color: '#F6FAF3',
    textShadowColor: 'rgba(8,40,14,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1.5,
  },
  onCream: { color: artColor.navy },
});
