/**
 * Boot. Runs the 1.8 s sequence (src/features/boot/BootSequence.tsx) while the
 * real boot work happens in parallel, then routes:
 *   no profile name -> /(onboarding)/name, otherwise -> /menu.
 *
 * Tap anywhere to skip to the end state. The OS reduce-motion setting cuts
 * straight to the held logo for 900 ms. The network never gates the boot: the
 * anonymous sign-in runs with a 2.5 s cap and the route is decided from the
 * local profile.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { playSfx } from '@/audio/sfx';
import { BOOT_TIMELINE, BootSequence, type BootMode } from '@/features/boot/BootSequence';
import { BOOT_NETWORK_TIMEOUT_MS, ensureSession, withTimeout } from '@/net/auth';
import {
  cloudAsLocal,
  cloudHasProgress,
  profilesConflict,
  pullCloudProfile,
  type CloudProfile,
} from '@/net/profileSync';
import { useCloud } from '@/state/cloud';
import { useProfile, waitForProfileHydration } from '@/state/profile';
import { Scale } from '@/ui/Scale';

type Target = '/menu' | '/name' | '/progress';

/**
 * Decides the route. The local profile is the default; the network is
 * best-effort under one cap: sign in, pull the cloud row, and only if a
 * played-on cloud profile differs from a played-on local one show the
 * progress chooser. A reinstall (empty local, cloud has progress) adopts the
 * cloud silently.
 */
async function runBootWork(): Promise<Target> {
  await waitForProfileHydration();

  const cloud = await withTimeout<CloudProfile | null>(
    (async () => {
      const userId = await ensureSession();
      if (!userId) return null;
      useProfile.getState().setUserId(userId);
      const row = await pullCloudProfile(userId);
      useCloud.getState().setProfile(row);
      return row;
    })(),
    BOOT_NETWORK_TIMEOUT_MS,
    null,
  );

  const local = useProfile.getState();
  if (cloud && profilesConflict(local, cloud)) return '/progress';
  if (cloud && cloudHasProgress(cloud) && local.name.trim().length === 0) {
    local.mergeRemote(cloudAsLocal(cloud));
    return '/menu';
  }
  return local.name.trim() ? '/menu' : '/name';
}

export default function Boot() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [mode, setMode] = useState<BootMode>(reduceMotion ? 'end' : 'play');
  const work = useRef<Promise<Target> | null>(null);
  const leaving = useRef(false);

  // Kicked off once, before any timer or tap can ask for the result.
  useEffect(() => {
    if (work.current === null) work.current = runBootWork();
  }, []);

  const leave = useCallback(async () => {
    if (leaving.current) return;
    leaving.current = true;
    const target = await (work.current ?? runBootWork());
    setMode('exit');
    // The native slide_from_right on the next screen starts on the next tick,
    // so the sheet's exit and the menu's entrance overlap.
    setTimeout(() => router.replace(target), 16);
  }, [router]);

  // The timeline's side effects: two sound cues and the exit.
  useEffect(() => {
    if (mode !== 'play') return;
    const t = BOOT_TIMELINE;
    const timers = [
      setTimeout(() => playSfx('paperDrop'), t.paperDrop),
      setTimeout(() => playSfx('penScratchLong'), t.rule),
      setTimeout(() => void leave(), t.exit),
    ];
    return () => timers.forEach(clearTimeout);
  }, [mode, leave]);

  // Reduce motion: hold the finished sheet, then go.
  useEffect(() => {
    if (!reduceMotion) return;
    const timer = setTimeout(() => void leave(), BOOT_TIMELINE.reduceMotionHold);
    return () => clearTimeout(timer);
  }, [reduceMotion, leave]);

  const skip = useCallback(() => {
    if (mode !== 'play') return;
    setMode('end');
    void leave();
  }, [mode, leave]);

  return (
    <Scale>
      <BootSequence mode={mode} />
      <Pressable onPress={skip} accessibilityLabel="Skip intro" style={StyleSheet.absoluteFill} />
    </Scale>
  );
}
