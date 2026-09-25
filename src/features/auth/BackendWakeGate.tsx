/**
 * Holds the app still until the account handoff has landed.
 *
 * The match server suspends when idle, so the first sign-in after a quiet
 * spell waits on a cold start. Without this the player would race it: a new
 * captain would be typing a name into a screen that cannot save it and
 * collecting a welcome bonus the server has not granted yet, and a returning
 * one would be looking at blank onboarding while their profile was still in
 * flight. So nothing downstream of the handoff is allowed to happen until it
 * is done.
 *
 * It is a sibling of the Stack rather than a Modal so it covers whatever route
 * is up — the boot, onboarding or the menu — on the account screens' own
 * backdrop, and fades in and out over it instead of popping.
 *
 * It can always be escaped. Offline play is the whole game without a server,
 * so a failure offers "Play offline" rather than trapping anyone.
 */
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { useBackendWake } from '@/state/backendWake';
import { usePrivySync } from '@/state/privySync';
import { useProfile } from '@/state/profile';
import { BACKGROUNDS, PAPER_PANEL } from '@/ui/assets';
import { ImagePanel } from '@/ui/ImagePanel';
import { InkButton } from '@/ui/InkButton';
import { InkSpinner } from '@/ui/InkSpinner';
import { Scale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

/**
 * A warm server answers inside this, so the overlay never flashes up on a
 * normal launch — the loader only exists for waits worth explaining.
 */
const SHOW_AFTER_MS = 800;
/** After this the wait is worth apologising for rather than just counting. */
const LONG_WAIT_MS = 6_000;
/**
 * And after this, offer the way out. Holding onboarding back is right while
 * there is a reason to believe the server is coming; holding someone hostage
 * to a host that may never answer is not.
 */
const ESCAPE_AFTER_MS = 20_000;

// Matches paper-panel.png's own 728 x 260 aspect, so its scribbled border
// scales evenly instead of stretching to a different shape.
const PANEL_H = 196;
const PANEL_W = Math.round((PANEL_H * 728) / 260);

/** Onboarding routes the boot may have committed to before the handoff landed. */
const ONBOARDING = new Set(['/name', '/avatar']);

function elapsedSeconds(startedAt: number | null): number {
  if (!startedAt) return 0;
  return Math.max(0, Math.round((Date.now() - startedAt) / 1000));
}

export function BackendWakeGate() {
  const router = useRouter();
  const pathname = usePathname();
  const status = usePrivySync((s) => s.status);
  const syncError = usePrivySync((s) => s.error);
  const phase = useBackendWake((s) => s.phase);
  const startedAt = useBackendWake((s) => s.startedAt);
  const dismissed = useBackendWake((s) => s.dismissed);

  const [visible, setVisible] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const corrected = useRef(false);

  /**
   * 'skipped' means there is no server to wait for — none configured, hard
   * offline, or no connection. The game is local-first, so in that case it
   * must behave exactly as it always has: straight through, no loader.
   */
  const pending = status !== 'synced' && !dismissed && phase !== 'skipped';

  // Hold the overlay back briefly: an awake server resolves inside this and
  // the player sees nothing at all.
  useEffect(() => {
    if (!pending) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  // Count the wait out loud; a silent spinner on a 40-second cold start reads
  // as a hang.
  useEffect(() => {
    if (!visible) return;
    setSeconds(elapsedSeconds(startedAt));
    const id = setInterval(() => setSeconds(elapsedSeconds(startedAt)), 1000);
    return () => clearInterval(id);
  }, [visible, startedAt]);

  /**
   * The boot decides a route from the local profile alone, on a much shorter
   * clock than a cold start. A returning captain can therefore be sitting on
   * blank onboarding by the time their profile arrives — so once it has, put
   * them where that profile says they belong. Once per launch, and only from
   * onboarding, so it can never fight the player's own navigation.
   */
  useEffect(() => {
    if (status !== 'synced' || corrected.current) return;
    corrected.current = true;
    if (!ONBOARDING.has(pathname)) return;
    if (useProfile.getState().name.trim().length === 0) return;
    router.replace('/menu');
  }, [status, pathname, router]);

  const retry = useCallback(() => {
    useBackendWake.getState().reset();
    usePrivySync.getState().retry();
  }, []);

  const playOffline = useCallback(() => {
    useBackendWake.getState().dismiss();
  }, []);

  if (!visible) return null;

  const failed = status === 'error' || phase === 'unreachable';
  const waking = phase === 'waking';
  const waited = startedAt === null ? 0 : Date.now() - startedAt;
  const longWait = waited > LONG_WAIT_MS;
  // `seconds` ticks once a second, so this re-evaluates as the wait grows.
  const canEscape = !failed && waited > ESCAPE_AFTER_MS;

  const title = failed
    ? 'Cannot reach the match server'
    : waking
      ? 'Waking the match server'
      : 'Syncing your account';

  const body = failed
    ? (syncError ?? 'The server did not answer. Your fleet still sails offline.')
    : waking && longWait
      ? 'The server sleeps when nobody is playing and takes a moment to come back. Hold on — your progress is safe.'
      : 'One moment while your captain is brought aboard.';

  return (
    <Animated.View
      style={styles.root}
      pointerEvents="auto"
      entering={FadeIn.duration(260)}
      exiting={FadeOut.duration(220)}
    >
      <Scale backgroundImage={BACKGROUNDS.identity}>
        <View style={styles.card}>
          <ImagePanel source={PAPER_PANEL} w={PANEL_W} h={PANEL_H} padding={space.lg}>
            <View style={styles.header}>
              {failed ? null : <InkSpinner size={26} seedKey="backend-wake" />}
              <Text style={[styles.title, failed ? styles.titleFailed : null]} numberOfLines={1}>
                {title}
              </Text>
            </View>
            <Text style={styles.body}>{body}</Text>
            {failed ? (
              <View style={styles.actions}>
                <InkButton label="Try again" tone="confirm" w={150} h={42} size="sm" onPress={retry} />
                <InkButton label="Play offline" w={150} h={42} size="sm" onPress={playOffline} />
              </View>
            ) : (
              <>
                <Text style={styles.elapsed}>{seconds > 0 ? `${seconds}s` : 'connecting…'}</Text>
                {canEscape ? (
                  <View style={styles.actions}>
                    <InkButton label="Play offline" w={160} h={38} size="sm" onPress={playOffline} />
                  </View>
                ) : null}
              </>
            )}
          </ImagePanel>
        </View>
      </Scale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 900,
    elevation: 900,
  },
  card: { position: 'absolute', left: (CANVAS_W - PANEL_W) / 2, top: (CANVAS_H - PANEL_H) / 2 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  title: { color: color.ink, fontFamily: font.display, fontSize: typeScale.md },
  titleFailed: { color: color.inkRed },
  body: {
    color: color.inkSoft,
    fontFamily: font.body,
    fontSize: typeScale.xs,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: space.sm,
  },
  elapsed: {
    color: color.inkFaint,
    fontFamily: font.body,
    fontSize: typeScale.xxs,
    textAlign: 'center',
    marginTop: space.sm,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.md,
  },
});
