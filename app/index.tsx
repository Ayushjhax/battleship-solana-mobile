/**
 * Boot. Runs the 1.8 s sequence (src/features/boot/BootSequence.tsx) while the
 * real boot work happens in parallel, then routes:
 *   no profile name -> /(onboarding)/name, otherwise -> /menu.
 *
 * Tap anywhere to skip to the end state. The OS reduce-motion setting cuts
 * straight to the held logo for 900 ms. The network never gates the boot: the
 * an existing gameplay session is read with a 2.5 s cap while verified Privy
 * bootstrap runs independently, and routing remains local-first.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { playSfx } from '@/audio/sfx';
import { BOOT_TIMELINE, BootSequence, type BootMode } from '@/features/boot/BootSequence';
import {
  BOOT_NETWORK_TIMEOUT_MS,
  PRIVY_HANDOFF_TIMEOUT_MS,
  ensureSession,
  withTimeout,
} from '@/net/auth';
import {
  cloudAsLocal,
  cloudHasProgress,
  profilesConflict,
  pullCloudProfile,
  type CloudProfile,
} from '@/net/profileSync';
import { useCloud } from '@/state/cloud';
import { useProfile, waitForProfileHydration } from '@/state/profile';
import { usePrivySync } from '@/state/privySync';
import { BACKGROUNDS } from '@/ui/assets';
import { Scale } from '@/ui/Scale';
import { CANVAS_W, color, font, type as typeScale } from '@/ui/tokens';

type Target = '/menu' | '/name' | '/progress';

function waitForPrivyBootstrap(timeoutMs: number): Promise<void> {
  const status = usePrivySync.getState().status;
  if (status === 'synced' || status === 'error') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const unsubscribe = usePrivySync.subscribe((state) => {
      if (state.status === 'synced' || state.status === 'error') finish();
    });
    const timer = setTimeout(finish, timeoutMs);
  });
}

/**
 * The gameplay user id for this launch. A session already on the device answers
 * at once and boot never waits. Without one — a first install, or the first
 * launch after a sign-out — PrivyProfileSync's verified handoff is the only
 * thing that can install it, so that wait gets its own budget instead of
 * sharing (and losing to) the Supabase read's. Returns null once it gives up.
 */
async function resolveGameplayUserId(): Promise<string | null> {
  const existing = await withTimeout(ensureSession(), BOOT_NETWORK_TIMEOUT_MS, null);
  if (existing) return existing;
  await waitForPrivyBootstrap(PRIVY_HANDOFF_TIMEOUT_MS);
  return withTimeout(ensureSession(), BOOT_NETWORK_TIMEOUT_MS, null);
}

/**
 * Decides the route. The local profile is the default; the network is
 * best-effort under one cap: read the handoff's session, pull the cloud row,
 * and only if a played-on cloud profile differs from a played-on local one
 * show the progress chooser. A reinstall (empty local, cloud has progress)
 * adopts the cloud silently — as does a returning sign-in, which
 * PrivyProfileSync has usually already merged by the time we get here.
 */
async function runBootWork(): Promise<Target> {
  await waitForProfileHydration();

  const userId = await resolveGameplayUserId();
  if (userId) useProfile.getState().setUserId(userId);

  const cloud = userId
    ? await withTimeout<CloudProfile | null>(
        (async () => {
          const row = await pullCloudProfile(userId);
          useCloud.getState().setProfile(row);
          return row;
        })(),
        BOOT_NETWORK_TIMEOUT_MS,
        null,
      )
    : null;

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
  // Reduced motion holds the end state from the first frame, so the logo — and
  // the background it pops in with — starts already revealed rather than
  // waiting on a timer that 'end' mode never runs.
  const [logoShown, setLogoShown] = useState(reduceMotion);
  const [restoring, setRestoring] = useState(false);
  const work = useRef<Promise<Target> | null>(null);
  const leaving = useRef(false);
  const mounted = useRef(true);

  // Kicked off once, before any timer or tap can ask for the result.
  useEffect(() => {
    mounted.current = true;
    if (work.current === null) work.current = runBootWork();
    return () => {
      mounted.current = false;
    };
  }, []);

  const leave = useCallback(async () => {
    if (leaving.current) return;
    leaving.current = true;
    // The account handoff can outlast the timeline on a fresh sign-in, so say
    // so rather than holding a silent page.
    const caption = setTimeout(() => {
      if (mounted.current) setRestoring(true);
    }, 400);
    const target = await (work.current ?? runBootWork());
    clearTimeout(caption);
    // A sign-out unmounts this tree mid-wait; navigating then would drop the
    // next account onto a stale route.
    if (!mounted.current) return;
    setRestoring(false);
    setMode('exit');
    // The native slide_from_right on the next screen starts on the next tick,
    // so the logo's exit and the menu's entrance overlap.
    setTimeout(() => router.replace(target), 16);
  }, [router]);

  // The timeline's side effects: two sound cues and the exit.
  useEffect(() => {
    if (mode !== 'play') return;
    const t = BOOT_TIMELINE;
    const timers = [
      setTimeout(() => playSfx('paperDrop'), t.paperDrop),
      setTimeout(() => {
        playSfx('penScratchLong');
        setLogoShown(true);
      }, t.logo),
      setTimeout(() => void leave(), t.exit),
    ];
    return () => timers.forEach(clearTimeout);
  }, [mode, leave]);

  // Reduce motion: hold the finished page, then go.
  useEffect(() => {
    if (!reduceMotion) return;
    const timer = setTimeout(() => void leave(), BOOT_TIMELINE.reduceMotionHold);
    return () => clearTimeout(timer);
  }, [reduceMotion, leave]);

  const skip = useCallback(() => {
    if (mode !== 'play') return;
    setMode('end');
    setLogoShown(true);
    void leave();
  }, [mode, leave]);

  return (
    // Transparent over the first page the root layout paints; the logo's own
    // backdrop fades in over it on the logo beat.
    <Scale transparent backgroundImage={logoShown ? BACKGROUNDS.logoReveal : undefined}>
      <BootSequence mode={mode} />
      {restoring ? (
        <Text style={styles.restoring} accessibilityLiveRegion="polite">
          Restoring your captain…
        </Text>
      ) : null}
      <Pressable onPress={skip} accessibilityLabel="Skip intro" style={StyleSheet.absoluteFill} />
    </Scale>
  );
}

const styles = StyleSheet.create({
  // Under the held logo, on the illustrated page.
  restoring: {
    position: 'absolute',
    left: 0,
    top: 258,
    width: CANVAS_W,
    color: color.inkSoft,
    fontFamily: font.body,
    fontSize: typeScale.xs,
    textAlign: 'center',
  },
});
