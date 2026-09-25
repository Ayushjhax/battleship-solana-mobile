/**
 * Matchmaking (P13). The fleet is already placed — placement.tsx sends the
 * player here with the layout sitting in the placement store — so the
 * moment the server says `matched`, `ready` goes out and the arena reveal
 * plays while the other side finishes placing.
 *
 *   searching   "Finding an opponent", an ink radar sweep, the live count
 *               from Supabase Presence on lobby:{mode}, an elapsed timer,
 *               Cancel.
 *   matched     on BACKGROUNDS.matchFound: the arena banner drops in with its
 *               name, both captains' cards slide in from the sides, VS stamps
 *               down between them, hold 2 s, route to /battle.
 *   failed      an InkPanel with the reason, "Try again" / "Back to menu".
 *
 * The Realtime match channel `match:{matchId}` (emotes only — never game
 * state, that is the socket's) is opened here during the reveal so it is
 * already joined when the battle starts; battle.tsx takes it over (chat.ts
 * ref-counts the subscription across the route change).
 */
import { validateSubmission } from '@engine/match';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { haptic } from '@/audio/haptics';
import { playSfx } from '@/audio/sfx';
import { FlagBadge } from '@/features/flags/FlagBadge';
import { createMatchHandoff } from '@/features/matchmaking/handoff';
import { subscribeEmotes } from '@/net/chat';
import { failureCopy, useMatchClient } from '@/net/match-client';
import { cancelPointWager } from '@/net/points';
import { useOnlineCount } from '@/net/presence';
import { toLayoutPayload, type OpponentSummary } from '@/net/protocol';
import { usePlacement } from '@/state/placement';
import { usePoints } from '@/state/points';
import { useProfile } from '@/state/profile';
import { ArtImageButton } from '@/ui/ArtImageButton';
import { ArtPlate } from '@/ui/ArtPlate';
import { BACKGROUNDS, MATCH_ART, MATCHMAKING_ART, PROFILE_ART } from '@/ui/assets';
import { portraitFor } from '@/ui/portraits';
import { Scale } from '@/ui/Scale';
import { VSlicedImage } from '@/ui/SlicedImage';
import { CANVAS_H, CANVAS_W, artColor, color, font } from '@/ui/tokens';
import { hashString } from '@/ui/useRough';

const REVEAL_HOLD_MS = 2000;
const ARENAS = [
  'Black Harbor',
  'Gull Reach',
  'The Narrows',
  'Ironwater Sound',
  'Saltmarsh',
] as const;

function arenaFor(matchId: string): string {
  return ARENAS[hashString(matchId) % ARENAS.length] as string;
}

// ---------------------------------------------------------------------------
// Radar — the commissioned radar split in two by scripts/color-assets.sh: the
// still disc and its red sweep, which turns about the hub (both 380 x 384 with
// the hub at their centre, so a plain rotate pivots it exactly).
// ---------------------------------------------------------------------------

const RADAR = { w: 150, h: 150 * (384 / 380) } as const;

function Radar() {
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    turn.value = withRepeat(withTiming(360, { duration: 3200, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(turn);
  }, [reduceMotion, turn]);
  const rotate = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  return (
    <View style={{ width: RADAR.w, height: RADAR.h }} accessibilityLabel="Radar sweeping for an opponent">
      <Image source={MATCHMAKING_ART.radarBase} style={StyleSheet.absoluteFill} contentFit="fill" />
      <Animated.View style={[StyleSheet.absoluteFill, rotate]} pointerEvents="none">
        <Image source={MATCHMAKING_ART.radarSweep} style={StyleSheet.absoluteFill} contentFit="fill" />
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Arena reveal
// ---------------------------------------------------------------------------

/** player-card.png is 531 x 264; the card is drawn at that shape. */
const CARD = { w: 232, h: 232 * (264 / 531), top: 136, inset: 40 } as const;
const PORTRAIT = 78;
const BANNER = { w: 300, h: 300 * (249 / 767), top: 2 } as const;
/** The ribbon's blank band, where the live arena name sits (banner px 155..612, 124..188). */
const BANNER_BAND = { x: 155 / 767, w: 457 / 767, y: 124 / 249, h: 64 / 249 } as const;
const VERSUS = { w: 118, h: 118 * (162 / 244) } as const;

/**
 * One captain's card: their chosen portrait, name, rank points and port. The
 * right card mirrors the left, as in the mockup. It slides in from its side.
 */
function PlayerCard({ summary, side }: { summary: OpponentSummary; side: 'left' | 'right' }) {
  const reduceMotion = useReducedMotion();
  const x = useSharedValue(reduceMotion ? 0 : side === 'left' ? -360 : 360);
  useEffect(() => {
    if (reduceMotion) return;
    x.value = withDelay(120, withSpring(0, { damping: 15, stiffness: 150, mass: 0.9 }));
  }, [reduceMotion, x]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const right = side === 'right';
  return (
    <Animated.View
      style={[
        styles.card,
        { left: right ? CANVAS_W - CARD.inset - CARD.w : CARD.inset },
        slide,
      ]}
    >
      <Image source={MATCH_ART.playerCard} style={StyleSheet.absoluteFill} contentFit="fill" />
      <View style={[styles.cardRow, right ? { flexDirection: 'row-reverse' } : null]}>
        <Image
          source={portraitFor(summary.avatarId, summary.avatarColor)}
          style={{ width: PORTRAIT, height: PORTRAIT }}
          contentFit="contain"
          cachePolicy="memory-disk"
          accessibilityIgnoresInvertColors
        />
        <View style={[styles.cardText, right ? { alignItems: 'flex-end' } : null]}>
          <Text style={styles.cardName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {summary.name}
          </Text>
          <Text style={styles.cardPoints}>{summary.rankPoints} pts</Text>
          <FlagBadge code={summary.countryCode} w={34} style={styles.badge} />
        </View>
      </View>
    </Animated.View>
  );
}

/**
 * The reveal, held ~2 s before the battle (REVEAL_HOLD_MS): the arena banner
 * drops and settles, the captains slide in from their sides, then VS stamps
 * down between them with a thump. Transform-only, so the timing is safe to cut
 * short, and it all sits on BACKGROUNDS.matchFound behind.
 */
function ArenaReveal({
  matchId,
  you,
  opponent,
}: {
  matchId: string;
  you: OpponentSummary;
  opponent: OpponentSummary;
}) {
  const reduceMotion = useReducedMotion();
  const drop = useSharedValue(reduceMotion ? 0 : -120);
  const tilt = useSharedValue(reduceMotion ? 0 : -4);
  const stamp = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    drop.value = withSpring(0, { damping: 12, stiffness: 140 });
    tilt.value = withSpring(0, { damping: 8, stiffness: 120 });
    stamp.value = withDelay(620, withSpring(1, { damping: 10, stiffness: 220, mass: 0.8 }));
    const thump = setTimeout(() => {
      haptic('hit');
      playSfx('shipPlace');
    }, 660);
    return () => clearTimeout(thump);
  }, [drop, reduceMotion, stamp, tilt]);
  const ribbon = useAnimatedStyle(() => ({
    transform: [{ translateY: drop.value }, { rotate: `${tilt.value}deg` }],
  }));
  // From oversized and turned to set in place: scale 2.4 -> 1, -18deg -> 0.
  const versus = useAnimatedStyle(() => ({
    transform: [{ scale: 2.4 - 1.4 * stamp.value }, { rotate: `${-18 * (1 - stamp.value)}deg` }],
  }));
  const tagline = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - stamp.value) * -6 }] }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image source={MATCH_ART.strategyQuote} style={styles.quoteTopLeft} contentFit="contain" />
      <Image source={MATCH_ART.pathsQuote} style={styles.quoteLowLeft} contentFit="contain" />
      <Image source={MATCH_ART.oceansQuote} style={styles.quoteTopRight} contentFit="contain" />
      <Image source={MATCH_ART.buildersQuote} style={styles.quoteLowRight} contentFit="contain" />
      <Image source={MATCH_ART.gullTop} style={styles.revealGullB} contentFit="contain" />
      <Image source={MATCH_ART.gullSmall} style={styles.revealGullC} contentFit="contain" />

      <Animated.View style={[styles.banner, ribbon]}>
        <Image source={MATCH_ART.banner} style={StyleSheet.absoluteFill} contentFit="fill" />
        <View style={styles.bannerBand}>
          <Text style={styles.arena} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {arenaFor(matchId)}
          </Text>
        </View>
      </Animated.View>
      <Animated.View style={[styles.tagline, tagline]}>
        <Image source={MATCH_ART.tagline} style={StyleSheet.absoluteFill} contentFit="contain" />
      </Animated.View>

      <PlayerCard summary={you} side="left" />
      <PlayerCard summary={opponent} side="right" />
      <Animated.View style={[styles.versus, versus]}>
        <Image source={MATCH_ART.versus} style={StyleSheet.absoluteFill} contentFit="contain" />
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export default function SearchingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ wager?: string; opponent?: string }>();
  const wagered = params.wager === '1';
  const opponentKind = params.opponent === 'bot' ? 'bot' : 'player';
  const ruleset = usePlacement((s) => s.ruleset);
  const status = useMatchClient((s) => s.status);
  const failure = useMatchClient((s) => s.failure);
  const matchId = useMatchClient((s) => s.matchId);
  const serverYou = useMatchClient((s) => s.you);
  const myCountry = useProfile((s) => s.countryCode);
  // Your own flag is the one you picked on this device; the server's row can
  // trail it by a sync.
  const you = useMemo(
    () => (serverYou ? { ...serverYou, countryCode: myCountry || serverYou.countryCode } : null),
    [myCountry, serverYou],
  );
  const opponent = useMatchClient((s) => s.opponent);
  const queuedCount = useMatchClient((s) => s.onlineCount);
  const presenceCount = useOnlineCount(ruleset);
  const [elapsed, setElapsed] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const startedAt = useRef(Date.now());

  // Queue once. The client is idempotent across a re-mount.
  useEffect(() => {
    useMatchClient.getState().queue(ruleset, { wagered, opponent: opponentKind });
  }, [opponentKind, ruleset, wagered]);

  useEffect(() => {
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)),
      500,
    );
    return () => clearInterval(id);
  }, []);

  // Back from the background: probe the socket now instead of waiting out a backoff.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') useMatchClient.getState().nudge();
    });
    return () => sub.remove();
  }, []);

  // Warm up the emote channel while the reveal plays — see chat.ts.
  useEffect(() => {
    if (!matchId) return;
    return subscribeEmotes(matchId);
  }, [matchId]);

  // matched -> ready -> reveal -> battle. The sequencing lives in
  // src/features/matchmaking/handoff.ts so the race it once had is testable:
  // sending the fleet is once per match, and the reveal timer must survive the
  // `matched` -> `active` flip that lands inside the hold.
  const handoff = useMemo(
    () =>
      createMatchHandoff({
        holdMs: REVEAL_HOLD_MS,
        currentMatchId: () => useMatchClient.getState().matchId,
        onReady: () => {
          const placement = usePlacement.getState();
          const profile = useProfile.getState();
          const self = useMatchClient.getState().you;
          // Keep the local identity in step with what the server just told us.
          if (self && profile.userId !== self.id) profile.setUserId(self.id);

          // Classic carries no arsenal; the server's reducer rejects one that does.
          const arsenal = placement.ruleset === 'advanced' ? placement.arsenal : [];
          // Checked against the same rules the server will apply. Sending a
          // layout it refuses would leave us waiting out the 90 s deadline,
          // after which the server auto-places a fleet the player never
          // arranged — the loss that made this worth checking twice.
          const check = validateSubmission(placement.ruleset, placement.ships, arsenal);
          if (!check.ok) {
            console.error(`[online] refusing to send an invalid layout: ${check.reason}`);
            useMatchClient.getState().failLayout(check.reason);
            return;
          }
          useMatchClient.getState().ready(toLayoutPayload(placement.ships, arsenal));
        },
        onNavigate: () => router.replace('/battle'),
      }),
    [router],
  );

  useEffect(() => handoff.dispose, [handoff]);

  useEffect(() => {
    handoff.sync({
      matchId,
      hasPlayers: Boolean(you && opponent),
      cancelling: status === 'cancelling' || status === 'failed',
    });
  }, [handoff, matchId, you, opponent, status]);

  const onCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    const requestId = useMatchClient.getState().wagerRequestId;
    try {
      await useMatchClient.getState().cancelQueue();
      if (wagered && requestId) {
        const result = await cancelPointWager(requestId);
        if (result.balance !== null) usePoints.getState().sync(result.balance);
      }
    } catch (error) {
      // Socket close cleanup still performs the idempotent refund. Keep the
      // player moving; the next points refresh reads the same server balance.
      console.warn('[wager] cancellation confirmation failed:', error);
    } finally {
      router.back();
    }
  };

  const count = presenceCount ?? queuedCount;
  // Exactly what handoff.sync() schedules the reveal on, so the screen and
  // the timer can never disagree about whether we are revealing. Left as a
  // chain rather than a Boolean() so it still narrows matchId/you/opponent.
  const revealReady = status !== 'failed' && status !== 'cancelling';
  const revealing = revealReady && matchId && you && opponent;

  return (
    <Scale backgroundImage={revealing ? BACKGROUNDS.matchFound : BACKGROUNDS.identity}>
      {revealing ? (
        <ArenaReveal matchId={matchId} you={you} opponent={opponent} />
      ) : status === 'failed' ? (
        <View style={styles.centre}>
          <View style={{ width: FAILED.w, height: FAILED.h }}>
            <VSlicedImage slices={PROFILE_ART.accountPanel} w={FAILED.w} h={FAILED.h} style={StyleSheet.absoluteFill} />
            <View style={styles.failedBox}>
              <Text style={styles.failedTitle}>
                {failure?.reason === 'insufficient_points'
                  ? 'Not enough points'
                  : failure?.reason === 'match_cancelled'
                    ? 'Match cancelled'
                    : failure?.reason === 'layout_rejected'
                      ? 'Fleet not accepted'
                      : failure?.reason === 'already_searching'
                        ? 'Already searching'
                        : 'No connection'}
              </Text>
              <Text style={styles.failedBody}>
                {failure ? failureCopy(failure) : 'The match server is out of reach.'}
              </Text>
              <View style={styles.buttons}>
                <ArtPlate
                  tone="green"
                  w={158}
                  h={36}
                  fontSize={16}
                  label={
                    failure?.reason === 'insufficient_points'
                    ? 'Buy points'
                    : failure?.reason === 'layout_rejected'
                      ? 'Arrange fleet'
                      : 'Try again'
                  }
                  onPress={() => {
                    if (failure?.reason === 'insufficient_points') {
                      useMatchClient.getState().disconnect();
                      router.replace('/points');
                    } else if (failure?.reason === 'layout_rejected') {
                      // Retrying would send the same refused fleet. Back to the
                      // board; disconnecting refunds a wager that never started.
                      useMatchClient.getState().disconnect();
                      if (router.canGoBack()) router.back();
                      else router.replace('/placement?mode=online');
                    } else {
                      useMatchClient.getState().retry();
                    }
                  }}
                />
                <ArtPlate
                  tone="cream"
                  w={158}
                  h={36}
                  fontSize={16}
                  label="Back to menu"
                  onPress={() => {
                    useMatchClient.getState().disconnect();
                    router.replace('/menu');
                  }}
                />
              </View>
            </View>
          </View>
        </View>
      ) : (
        <>
          <Image source={MATCHMAKING_ART.goodCaptainsQuote} style={styles.quoteLeft} contentFit="contain" />
          <Image source={MATCHMAKING_ART.differentCaptainsQuote} style={styles.quoteRight} contentFit="contain" />
          <Image source={MATCHMAKING_ART.gulls[0]} style={styles.gullA} contentFit="contain" />
          <Image source={MATCHMAKING_ART.gulls[2]} style={styles.gullB} contentFit="contain" />
          <Image source={MATCHMAKING_ART.gulls[4]} style={styles.gullC} contentFit="contain" />

          <ArtImageButton
            source={MATCHMAKING_ART.back}
            w={58}
            h={37}
            label="Cancel and go back"
            disabled={cancelling || status === 'cancelling'}
            style={styles.back}
            onPress={() => void onCancel()}
          />
          <Image source={MATCHMAKING_ART.banner} style={styles.searchBanner} contentFit="contain" />

          <Image source={MATCHMAKING_ART.radarDashLeft} style={[styles.radarDash, { left: RADAR_X - 26 }]} contentFit="contain" />
          <View style={styles.radar}>
            <Radar />
          </View>
          <Image source={MATCHMAKING_ART.radarDashRight} style={[styles.radarDash, { left: RADAR_X + RADAR.w + 8 }]} contentFit="contain" />

          <View style={styles.titleRow} accessibilityLiveRegion="polite">
            <Image source={MATCHMAKING_ART.navyDashLeft} style={styles.titleDash} contentFit="contain" />
            <Text style={styles.title}>
              {cancelling || status === 'cancelling' ? 'Returning your wager' : 'Finding an opponent'}
            </Text>
            <Image source={MATCHMAKING_ART.navyDashRight} style={styles.titleDash} contentFit="contain" />
          </View>
          <Text style={styles.meta}>
            {cancelling || status === 'cancelling'
              ? 'Confirming balance with the game server'
              : status === 'connecting'
                ? 'Raising the match server'
                : status === 'queued'
                  ? 'In line'
                  : 'Connecting'}
            {' · '}
            {formatElapsed(elapsed)}
            {count !== null ? ` · ${count} ${count === 1 ? 'sailor' : 'sailors'} online` : ''}
          </Text>
          {wagered ? <Text style={styles.wager}>50-point stake · 100-point prize</Text> : null}
          <View style={styles.cancelRow}>
            <Image source={MATCHMAKING_ART.navyDashLeft} style={styles.cancelDash} contentFit="contain" />
            <ArtImageButton
              source={MATCHMAKING_ART.cancel}
              w={132}
              h={132 * (111 / 334)}
              label={cancelling || status === 'cancelling' ? 'Refunding' : 'Cancel'}
              disabled={cancelling || status === 'cancelling'}
              onPress={() => void onCancel()}
            />
            <Image source={MATCHMAKING_ART.navyDashRight} style={styles.cancelDash} contentFit="contain" />
          </View>
        </>
      )}
    </Scale>
  );
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

const FAILED = { w: 440, h: 214 } as const;
const RADAR_X = (CANVAS_W - RADAR.w) / 2;
const RADAR_Y = 56;

const styles = StyleSheet.create({
  centre: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: CANVAS_W,
    height: CANVAS_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  back: { position: 'absolute', left: 10, top: 10 },
  searchBanner: { position: 'absolute', left: (CANVAS_W - 228) / 2, top: -2, width: 228, height: 228 * (135 / 593) },
  radar: { position: 'absolute', left: RADAR_X, top: RADAR_Y },
  radarDash: { position: 'absolute', top: RADAR_Y + RADAR.h / 2 - 20, width: 18, height: 38 },
  titleRow: {
    position: 'absolute',
    left: 0,
    width: CANVAS_W,
    top: RADAR_Y + RADAR.h + 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  titleDash: { width: 10, height: 24 },
  title: { color: artColor.ink, fontFamily: font.display, fontSize: 28, lineHeight: 34 },
  meta: {
    position: 'absolute',
    left: 0,
    width: CANVAS_W,
    top: RADAR_Y + RADAR.h + 40,
    color: artColor.navy,
    fontFamily: font.body,
    fontSize: 15,
    textAlign: 'center',
  },
  wager: {
    position: 'absolute',
    left: 0,
    width: CANVAS_W,
    top: RADAR_Y + RADAR.h + 60,
    color: artColor.green,
    fontFamily: font.label,
    fontSize: 13,
    textAlign: 'center',
  },
  cancelRow: {
    position: 'absolute',
    left: 0,
    width: CANVAS_W,
    top: 304,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  cancelDash: { width: 9, height: 20 },
  quoteLeft: { position: 'absolute', left: 64, top: 86, width: 64, height: 67 },
  quoteRight: { position: 'absolute', left: 604, top: 142, width: 72, height: 64 },
  gullA: { position: 'absolute', left: 190, top: 64, width: 22, height: 10 },
  gullB: { position: 'absolute', left: 552, top: 58, width: 26, height: 9 },
  gullC: { position: 'absolute', left: 160, top: 92, width: 20, height: 10 },
  failedBox: { position: 'absolute', left: 34, right: 34, top: 56, bottom: 24, alignItems: 'center' },
  banner: {
    position: 'absolute',
    left: (CANVAS_W - BANNER.w) / 2,
    top: BANNER.top,
    width: BANNER.w,
    height: BANNER.h,
  },
  bannerBand: {
    position: 'absolute',
    left: BANNER_BAND.x * BANNER.w,
    width: BANNER_BAND.w * BANNER.w,
    top: BANNER_BAND.y * BANNER.h,
    height: BANNER_BAND.h * BANNER.h,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arena: { color: artColor.ink, fontFamily: font.display, fontSize: 24 },
  tagline: {
    position: 'absolute',
    left: (CANVAS_W - 176) / 2,
    top: BANNER.top + BANNER.h - 1,
    width: 176,
    height: 176 * (59 / 388),
  },
  card: { position: 'absolute', top: CARD.top, width: CARD.w, height: CARD.h },
  cardRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 17,
  },
  cardText: { flex: 1, gap: 2 },
  cardName: { color: artColor.navy, fontFamily: font.display, fontSize: 21 },
  cardPoints: { color: artColor.navy, fontFamily: font.body, fontSize: 15 },
  badge: { marginTop: 4 },
  versus: {
    position: 'absolute',
    left: (CANVAS_W - VERSUS.w) / 2,
    top: CARD.top + (CARD.h - VERSUS.h) / 2,
    width: VERSUS.w,
    height: VERSUS.h,
  },
  quoteTopLeft: { position: 'absolute', left: 44, top: 2, width: 80, height: 76 },
  quoteLowLeft: { position: 'absolute', left: 176, top: 12, width: 62, height: 63 },
  quoteTopRight: { position: 'absolute', left: 716, top: 8, width: 70, height: 63 },
  quoteLowRight: { position: 'absolute', left: 594, top: 18, width: 55, height: 62 },
  revealGullB: { position: 'absolute', left: 538, top: 16, width: 26, height: 9 },
  revealGullC: { position: 'absolute', left: 560, top: 38, width: 19, height: 8 },
  failedTitle: { color: color.inkRed, fontFamily: font.display, fontSize: 22, textAlign: 'center' },
  failedBody: {
    color: artColor.navy,
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 6,
  },
  buttons: { flexDirection: 'row', gap: 14, marginTop: 'auto' },
});
