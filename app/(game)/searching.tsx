/**
 * Matchmaking (P13). The fleet is already placed — placement.tsx sends the
 * player here with the layout sitting in the placement store — so the
 * moment the server says `matched`, `ready` goes out and the arena reveal
 * plays while the other side finishes placing.
 *
 *   searching   "Finding an opponent", an ink radar sweep, the live count
 *               from Supabase Presence on lobby:{mode}, an elapsed timer,
 *               Cancel.
 *   matched     a TitleRibbon drops in with the arena name, both player
 *               cards slide in from the sides, hold 2 s, route to /battle.
 *   failed      an InkPanel with the reason, "Try again" / "Back to menu".
 *
 * The Realtime match channel `match:{matchId}` (emotes only — never game
 * state, that is the socket's) is opened here during the reveal so it is
 * already joined when the battle starts; battle.tsx takes it over (chat.ts
 * ref-counts the subscription across the route change).
 */
import { validateSubmission } from '@engine/match';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { AvatarCard, FlagChip } from '@/features/battle/Hud';
import { subscribeEmotes } from '@/net/chat';
import { failureCopy, useMatchClient } from '@/net/match-client';
import { cancelPointWager } from '@/net/points';
import { useOnlineCount } from '@/net/presence';
import { toLayoutPayload, type OpponentSummary } from '@/net/protocol';
import { usePlacement } from '@/state/placement';
import { usePoints } from '@/state/points';
import { useProfile } from '@/state/profile';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';
import { RoughShape, hashString, useRough, type Point } from '@/ui/useRough';

const REVEAL_HOLD_MS = 2000;
const ARENAS = ['Black Harbor', 'Gull Reach', 'The Narrows', 'Ironwater Sound', 'Saltmarsh'] as const;

function arenaFor(matchId: string): string {
  return ARENAS[hashString(matchId) % ARENAS.length] as string;
}

// ---------------------------------------------------------------------------
// Radar sweep
// ---------------------------------------------------------------------------

function RadarSweep({ size = 150 }: { size?: number }) {
  const { roughCircle, roughLine, roughPath } = useRough();
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    turn.value = withRepeat(withTiming(360, { duration: 2400, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(turn);
  }, [reduceMotion, turn]);
  const rotate = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));

  const c = size / 2;
  const seed = hashString('radar');
  const rings = [0.98, 0.66, 0.34].map((k, i) =>
    roughCircle(c, c, (size - 6) * k, {
      seed: seed + i,
      stroke: i === 0 ? color.ink : color.inkFaint,
      strokeWidth: i === 0 ? 1.6 : 1,
      roughness: 0.9,
    }),
  );
  const cross = [
    roughLine(c, 4, c, size - 4, { seed: seed + 7, stroke: color.inkFaint, strokeWidth: 0.9 }),
    roughLine(4, c, size - 4, c, { seed: seed + 8, stroke: color.inkFaint, strokeWidth: 0.9 }),
  ];
  // The sweep: a needle plus a faint trailing wedge.
  const wedge: Point[] = [[c, c]];
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 - (i / 8) * (Math.PI / 5);
    wedge.push([c + (c - 6) * Math.cos(a), c + (c - 6) * Math.sin(a)]);
  }
  const sweep = [
    roughPath(wedge, {
      seed: seed + 9,
      stroke: color.inkFaint,
      strokeWidth: 0.6,
      fill: color.inkFaint,
      fillStyle: 'hachure',
      hachureGap: 4,
      roughness: 0.8,
    }),
    roughLine(c, c, c, 6, { seed: seed + 10, stroke: color.inkRed, strokeWidth: 1.8, roughness: 0.6 }),
  ];

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={StyleSheet.absoluteFill}>
        {rings.map((p, i) => (
          <RoughShape key={i} paths={p} />
        ))}
        {cross.map((p, i) => (
          <RoughShape key={`x${i}`} paths={p} />
        ))}
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, rotate]}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {sweep.map((p, i) => (
            <RoughShape key={i} paths={p} />
          ))}
        </Svg>
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Arena reveal
// ---------------------------------------------------------------------------

function PlayerCard({
  summary,
  side,
  seedKey,
}: {
  summary: OpponentSummary;
  side: 'left' | 'right';
  seedKey: string;
}) {
  const reduceMotion = useReducedMotion();
  const x = useSharedValue(side === 'left' ? -320 : 320);
  useEffect(() => {
    x.value = reduceMotion ? 0 : withSpring(0, { duration: 520, dampingRatio: 0.72 });
  }, [reduceMotion, x]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const w = 250;
  const h = 96;
  return (
    <Animated.View style={[{ position: 'absolute', top: 178, [side]: 46 }, slide]}>
      <InkPanel w={w} h={h} seedKey={`reveal-${seedKey}`} padding={space.sm}>
        <View style={[styles.cardRow, side === 'right' ? { flexDirection: 'row-reverse' } : null]}>
          <AvatarCard avatarId={summary.avatarId} tint={summary.avatarColor} seedKey={seedKey} />
          <View style={[styles.cardText, side === 'right' ? { alignItems: 'flex-end' } : null]}>
            <Text style={styles.cardName} numberOfLines={1}>
              {summary.name}
            </Text>
            <Text style={styles.cardPoints}>{summary.rankPoints} pts</Text>
            <FlagChip code={summary.countryCode ?? '??'} seedKey={seedKey} />
          </View>
        </View>
      </InkPanel>
    </Animated.View>
  );
}

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
  const drop = useSharedValue(-90);
  useEffect(() => {
    drop.value = reduceMotion ? 0 : withSpring(0, { duration: 560, dampingRatio: 0.6 });
  }, [drop, reduceMotion]);
  const ribbon = useAnimatedStyle(() => ({ transform: [{ translateY: drop.value }] }));
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[styles.ribbon, ribbon]}>
        <TitleRibbon title={arenaFor(matchId)} w={380} h={50} seedKey="arena" />
      </Animated.View>
      <PlayerCard summary={you} side="left" seedKey="me" />
      <PlayerCard summary={opponent} side="right" seedKey="them" />
      <Text style={styles.versus}>vs</Text>
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
  const you = useMatchClient((s) => s.you);
  const opponent = useMatchClient((s) => s.opponent);
  const queuedCount = useMatchClient((s) => s.onlineCount);
  const presenceCount = useOnlineCount(ruleset);
  const [elapsed, setElapsed] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const startedAt = useRef(Date.now());
  const readySent = useRef<string | null>(null);

  // Queue once. The client is idempotent across a re-mount.
  useEffect(() => {
    useMatchClient.getState().queue(ruleset, { wagered, opponent: opponentKind });
  }, [opponentKind, ruleset, wagered]);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 500);
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

  // matched: send the fleet at once. Once per match id — the ref is the guard,
  // so a re-render or a status change never re-sends it.
  useEffect(() => {
    if (status === 'cancelling' || status === 'failed') return;
    if (!matchId || !you || !opponent) return;
    if (readySent.current === matchId) return;
    readySent.current = matchId;

    const placement = usePlacement.getState();
    const profile = useProfile.getState();
    // Keep the local identity in step with what the server just told us.
    if (profile.userId !== you.id) profile.setUserId(you.id);

    // Classic carries no arsenal; the server's reducer rejects one that does.
    const arsenal = placement.ruleset === 'advanced' ? placement.arsenal : [];
    // Checked against the same rules the server will apply. Sending a layout
    // it refuses would leave us waiting out the 90 s deadline, after which the
    // server auto-places a fleet the player never arranged.
    const check = validateSubmission(placement.ruleset, placement.ships, arsenal);
    if (!check.ok) {
      console.error(`[online] refusing to send an invalid layout: ${check.reason}`);
      useMatchClient.getState().failLayout(check.reason);
      return;
    }
    useMatchClient.getState().ready(toLayoutPayload(placement.ships, arsenal));
  }, [matchId, you, opponent, status]);

  /**
   * The reveal holds, then the battle screen takes over. This MUST be its own
   * effect: the server broadcasts a state the instant it accepts a layout, so
   * `status` goes matched -> active well inside the hold. Sharing an effect
   * with the `ready` send above meant that change tore the timer down, and the
   * guard on the re-run returned before scheduling another — the reveal then
   * sat on screen forever and the match never started.
   *
   * Arriving while the opponent is still placing is expected and handled:
   * ConnectionOverlay shows "waiting for opponent" until the first turn.
   */
  const revealReady = Boolean(matchId && you && opponent) && status !== 'failed' && status !== 'cancelling';
  useEffect(() => {
    if (!revealReady || !matchId) return;
    const timer = setTimeout(() => {
      const client = useMatchClient.getState();
      if (client.matchId !== matchId) return;
      if (client.status === 'failed' || client.status === 'cancelling') return;
      router.replace('/battle');
    }, REVEAL_HOLD_MS);
    return () => clearTimeout(timer);
  }, [matchId, revealReady, router]);

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
  // Same condition the reveal timer runs on, so the two can never disagree.
  const revealing = revealReady && matchId && you && opponent;

  return (
    <Scale>
      <Paper variant="full" />

      {revealing ? (
        <ArenaReveal matchId={matchId} you={you} opponent={opponent} />
      ) : status === 'failed' ? (
        <View style={styles.centre}>
          <InkPanel w={420} h={190} seedKey="search-failed" padding={space.md}>
            <Text style={styles.failedTitle}>
              {failure?.reason === 'insufficient_points'
                ? 'Not enough points'
                : failure?.reason === 'match_cancelled'
                  ? 'Match cancelled'
                  : failure?.reason === 'layout_rejected'
                    ? 'Fleet not accepted'
                    : 'No connection'}
            </Text>
            <Text style={styles.failedBody}>
              {failure ? failureCopy(failure) : 'The match server is out of reach.'}
            </Text>
            <View style={styles.buttons}>
              <InkButton
                label={
                  failure?.reason === 'insufficient_points'
                    ? 'Buy points'
                    : failure?.reason === 'layout_rejected'
                      ? 'Arrange fleet'
                      : 'Try again'
                }
                tone="confirm"
                w={150}
                seedKey="search-retry"
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
              <InkButton
                label="Back to menu"
                w={150}
                seedKey="search-menu"
                onPress={() => {
                  useMatchClient.getState().disconnect();
                  router.replace('/menu');
                }}
              />
            </View>
          </InkPanel>
        </View>
      ) : (
        <View style={styles.centre}>
          <RadarSweep />
          <Text style={styles.title}>{cancelling || status === 'cancelling' ? 'Returning your wager' : 'Finding an opponent'}</Text>
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
            {count !== null ? ` · ${count} sailors online` : ''}
          </Text>
          {wagered ? <Text style={styles.wager}>50-point stake · 100-point prize</Text> : null}
          <InkButton
            label={cancelling || status === 'cancelling' ? 'Refunding…' : 'Cancel'}
            w={140}
            seedKey="search-cancel"
            style={styles.cancel}
            disabled={cancelling || status === 'cancelling'}
            onPress={() => void onCancel()}
          />
        </View>
      )}
    </Scale>
  );
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

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
  title: {
    marginTop: space.sm,
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.xl,
  },
  meta: {
    marginTop: 4,
    color: color.inkSoft,
    fontFamily: font.body,
    fontSize: typeScale.sm,
  },
  wager: {
    marginTop: 3,
    color: color.inkGreen,
    fontFamily: font.label,
    fontSize: typeScale.xs,
  },
  cancel: { marginTop: space.md },
  ribbon: { position: 'absolute', left: (CANVAS_W - 380) / 2, top: 78 },
  versus: {
    position: 'absolute',
    left: 0,
    width: CANVAS_W,
    top: 210,
    textAlign: 'center',
    color: color.inkRed,
    fontFamily: font.display,
    fontSize: typeScale.xl,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cardText: { flex: 1, gap: 4 },
  cardName: { color: color.ink, fontFamily: font.display, fontSize: typeScale.md },
  cardPoints: { color: color.inkSoft, fontFamily: font.label, fontSize: typeScale.xs },
  failedTitle: { color: color.inkRed, fontFamily: font.display, fontSize: typeScale.lg, marginBottom: 4 },
  failedBody: {
    color: color.ink,
    fontFamily: font.body,
    fontSize: typeScale.sm,
    lineHeight: Math.round(typeScale.sm * 1.35),
    flexGrow: 1,
  },
  buttons: { flexDirection: 'row', gap: space.md, justifyContent: 'flex-end' },
});
