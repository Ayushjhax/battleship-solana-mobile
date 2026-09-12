/** Haptics that respect the profile's toggle and never throw. */
import * as Haptics from 'expo-haptics';

import { useProfile } from '@/state/profile';

export type HapticId =
  'buttonPress' | 'shipPlaced' | 'miss' | 'hit' | 'sink' | 'mine' | 'rankUp' | 'invalidAction';

export function haptic(id: HapticId): void {
  if (!useProfile.getState().hapticsOn) return;
  const work =
    id === 'rankUp'
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : id === 'invalidAction'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        : Haptics.impactAsync(
            id === 'sink' || id === 'mine'
              ? Haptics.ImpactFeedbackStyle.Heavy
              : id === 'hit' || id === 'shipPlaced'
                ? Haptics.ImpactFeedbackStyle.Medium
                : Haptics.ImpactFeedbackStyle.Light,
          );
  void work.catch(() => {});
}
