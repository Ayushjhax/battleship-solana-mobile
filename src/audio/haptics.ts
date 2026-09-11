/** Haptics that respect the profile's toggle and never throw. */
import * as Haptics from 'expo-haptics';

import { useProfile } from '@/state/profile';

export type HapticStrength = 'light' | 'medium' | 'heavy';

const STYLE = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
} as const;

export function haptic(strength: HapticStrength): void {
  if (!useProfile.getState().hapticsOn) return;
  Haptics.impactAsync(STYLE[strength]).catch(() => {});
}
