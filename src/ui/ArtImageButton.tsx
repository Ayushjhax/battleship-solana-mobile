/**
 * A button that is one piece of commissioned art, label and all (Back, Change
 * name, Sign out, the steppers). Press feel: a light haptic and a quick spring
 * down to 95% — transform only, so nothing pressable ever animates opacity.
 */
import { Image } from 'expo-image';
import { Pressable, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { haptic } from '@/audio/haptics';
import type { Asset } from './assets';

export function ArtImageButton({
  source,
  w,
  h,
  label,
  onPress,
  disabled = false,
  hitSlop,
  style,
}: {
  source: Asset;
  w: number;
  h: number;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  hitSlop?: number;
  style?: ViewStyle;
}) {
  const press = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
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
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[{ width: w, height: h }, style]}
    >
      <Animated.View style={[{ width: w, height: h, opacity: disabled ? 0.45 : 1 }, pressStyle]}>
        <Image source={source} style={{ width: w, height: h }} contentFit="contain" cachePolicy="memory-disk" />
      </Animated.View>
    </Pressable>
  );
}
