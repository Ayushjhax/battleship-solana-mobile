/**
 * The result (P14), drawn to its mockup on BACKGROUNDS.result. One composition
 * for both verdicts:
 *
 *   Win   the green "Victory" banner drops in, both captains — each the
 *         portrait they chose, in their colour — face each other across the
 *         results, gold coins fly from the loser to the winner, and the rank
 *         bar fills with a number roll.
 *   Loss  the same with the red "Defeat" banner and the coin flow reversed.
 *         Nothing else changes: a result screen that sulks makes people quit.
 *
 * Rank-up is the one extra beat: the badge swells, the rank name types on.
 * sfx rankUp.
 *
 * Where the numbers come from: offline results were queued into the profile
 * (battle.ts markFinished) before this route opened; an online match was
 * settled by the SERVER (0008), so `prepare()` mirrors its rewards into the
 * profile once (keyed by matchId, so a re-mount can't double count) — the
 * client never writes score columns to Supabase, only to its own store.
 * "Before" is simply "after minus the reward", in either case.
 */
import { REWARD, rankFor, rankProgress } from '@engine/ranks';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type ImageStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { playSfx } from '@/audio/sfx';
import { haptic } from '@/audio/haptics';
import { useMatchClient } from '@/net/match-client';
import { flushPendingWager } from '@/net/offlineWager';
import { usePoints, WAGER_STAKE } from '@/state/points';
import { useProfile } from '@/state/profile';
import { ArtImageButton } from '@/ui/ArtImageButton';
import { BACKGROUNDS, MATCHMAKING_ART, RESULT_ART, SETTINGS_ART, type Asset } from '@/ui/assets';
import { COIN_GOLD } from '@/ui/CurrencyChip';
import { portraitFor } from '@/ui/portraits';
import { Scale } from '@/ui/Scale';
import { CANVAS_W, artColor, color, font } from '@/ui/tokens';

// ---------------------------------------------------------------------------
// Timeline (ms from mount)
// ---------------------------------------------------------------------------

const T_CARDS = 80;
const T_COINS = 650;
const COIN_COUNT = 6;
const COIN_STAGGER = 90;
const COIN_FLIGHT = 720;
const T_ROLL = T_COINS + COIN_COUNT * COIN_STAGGER + 200; // counters + bar
const ROLL_MS = 900;
const T_RANK_UP = T_ROLL + ROLL_MS + 150;

// Layout — canvas units. The panel art (results-panel-frame, 796 x 503) is
// drawn at its own shape; its border sits 38 px down under the rope crown.
const PANEL_W = 356;
const PANEL_H = PANEL_W * (503 / 796);
const PANEL_X = (CANVAS_W - PANEL_W) / 2;
const PANEL_Y = 62;
const PANEL_BORDER = 38 * (PANEL_W / 796);
/** The captain cards: portrait frame (218 x 243), name ribbon, port and points. */
const PORTRAIT = { w: 94, h: 94 * (243 / 218) } as const;
const CARD_Y = 84;
const CARD_CX_LEFT = 116;
const CARD_CX_RIGHT = CANVAS_W - 116;
const COIN = 20;

interface Totals {
  readonly pointsBefore: number;
  readonly pointsAfter: number;
  readonly coinsBefore: number;
  readonly coinsAfter: number;
  readonly reward: { points: number; coins: number };
  /**
   * What the wager moved. Online this is the SERVER's own settlement, captured
   * before the socket is dropped; offline it is the fixed stake, since the
   * payout is still in flight when this screen opens.
   */
  readonly wager: { stake: number; prize: number } | null;
  /**
   * An online result this device has not mirrored into the profile yet. It is
   * applied from an effect, never while rendering: a store write during render
   * updates other subscribed components mid-render, which React rejects.
   */
  readonly settle: { matchId: string; won: boolean; reward: { points: number; coins: number } } | null;
}

/** The demo menu's forced results: shown as given, nothing written to the profile. */
export interface ForcedTotals {
  readonly pointsBefore: number;
  readonly pointsAfter: number;
  readonly coinsBefore: number;
  readonly coinsAfter: number;
}

/**
 * Works out every number this screen shows. PURE — it reads the stores but
 * writes nothing, so it is safe to run from a useState initialiser. The one
 * write it implies is handed back as `settle` for an effect to perform.
 */
function prepare(
  won: boolean,
  local: boolean,
  matchId: string,
  wagered: boolean,
  forced: ForcedTotals | null,
): Totals {
  if (forced) {
    return {
      ...forced,
      reward: {
        points: forced.pointsAfter - forced.pointsBefore,
        coins: forced.coinsAfter - forced.coinsBefore,
      },
      wager: null,
      settle: null,
    };
  }
  const profile = useProfile.getState();
  const over = !local ? useMatchClient.getState().over : undefined;
  const reward = over?.rewards ?? (won ? REWARD.win : REWARD.loss);

  // Offline results were already applied by the battle store before this route
  // opened, so the profile is the "after". An online one has not been applied
  // yet — unless this is a re-mount of a match already in settledMatchIds —
  // so the "after" is computed rather than read back.
  const unapplied =
    !local && matchId.length > 0 && !profile.settledMatchIds.includes(matchId);
  const pointsAfter = unapplied ? profile.rankPoints + reward.points : profile.rankPoints;
  const coinsAfter = unapplied ? profile.coins + reward.coins : profile.coins;

  return {
    pointsBefore: pointsAfter - reward.points,
    pointsAfter,
    coinsBefore: coinsAfter - reward.coins,
    coinsAfter,
    reward,
    wager: wagered
      ? (over?.wager ?? { stake: WAGER_STAKE, prize: won ? WAGER_STAKE * 2 : 0 })
      : null,
    settle: unapplied ? { matchId, won, reward } : null,
  };
}

function parseForced(raw: string | undefined): ForcedTotals | null {
  if (!raw) return null;
  const n = raw.split(',').map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) return null;
  return { pointsBefore: n[0]!, pointsAfter: n[1]!, coinsBefore: n[2]!, coinsAfter: n[3]! };
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** Rolls a number from `from` to `to` over `ms`, starting after `delay`. */
function useRoll(from: number, to: number, delay: number, ms: number, enabled = true): number {
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (!enabled) {
      setValue(to);
      return;
    }
    let raf = 0;
    let start = 0;
    const timer = setTimeout(() => {
      const step = (now: number) => {
        if (!start) start = now;
        const t = Math.min(1, (now - start) / ms);
        const eased = 1 - Math.pow(1 - t, 3);
        setValue(Math.round(from + (to - from) * eased));
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [from, to, delay, ms, enabled]);
  return value;
}

function Art({ source, style }: { source: Asset; style: ImageStyle }) {
  return (
    <Image
      source={source}
      style={[{ position: 'absolute' }, style]}
      contentFit="contain"
      cachePolicy="memory-disk"
      pointerEvents="none"
    />
  );
}

/**
 * One captain: their portrait inside the rope frame (the frame's hole is
 * x 23..196, y 22..206 of 218 x 243; the portrait art's picture is its middle
 * 78%, so it is cropped to the hole), the name ribbon, their port and points.
 */
function Card({
  side,
  name,
  points,
  avatarId,
  tint,
  flag,
}: {
  side: 'left' | 'right';
  name: string;
  points: number;
  avatarId: number;
  tint: string;
  flag: string;
}) {
  const reduceMotion = useReducedMotion();
  const x = useSharedValue(reduceMotion ? 0 : side === 'left' ? -200 : 200);
  useEffect(() => {
    x.value = withDelay(T_CARDS, withSpring(0, { duration: 560, dampingRatio: 0.74 }));
  }, [x]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const k = PORTRAIT.w / 218;
  const hole = { x: 23 * k, y: 22 * k, w: 173 * k, h: 184 * k };
  const pic = Math.max(hole.w, hole.h) / 0.78;
  const cx = side === 'left' ? CARD_CX_LEFT : CARD_CX_RIGHT;
  const right = side === 'right';
  return (
    <Animated.View style={[styles.card, { left: cx - 64 }, slide]}>
      <View style={{ width: PORTRAIT.w, height: PORTRAIT.h }}>
        <View style={[styles.hole, { left: hole.x, top: hole.y, width: hole.w, height: hole.h }]}>
          <Image
            source={portraitFor(avatarId, tint)}
            style={{ position: 'absolute', left: (hole.w - pic) / 2, top: (hole.h - pic) / 2, width: pic, height: pic }}
            contentFit="cover"
            cachePolicy="memory-disk"
            accessibilityIgnoresInvertColors
          />
        </View>
        <Image source={RESULT_ART.portraitFrame} style={StyleSheet.absoluteFill} contentFit="fill" />
      </View>
      <View style={styles.ribbon}>
        <Image source={RESULT_ART.nameRibbon} style={StyleSheet.absoluteFill} contentFit="fill" />
        <Text style={styles.cardName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {name}
        </Text>
      </View>
      <View style={[styles.cardMeta, right ? { flexDirection: 'row-reverse' } : null]}>
        <View style={styles.badge}>
          <Image source={RESULT_ART.countryBadge} style={StyleSheet.absoluteFill} contentFit="fill" />
          <Text style={styles.badgeText}>{flag}</Text>
        </View>
        <Text style={styles.cardPoints}>{points} pts</Text>
      </View>
    </Animated.View>
  );
}

/** One gold coin, thrown from `from` to `to` on a lob, spinning as it flies. */
function Coin({ index, from, to }: { index: number; from: number; to: number }) {
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    t.value = withDelay(
      T_COINS + index * COIN_STAGGER,
      withTiming(1, { duration: COIN_FLIGHT, easing: Easing.inOut(Easing.quad) }),
    );
  }, [index, reduceMotion, t]);
  const style = useAnimatedStyle(() => {
    const p = t.value;
    const lob = -Math.sin(p * Math.PI) * (52 + index * 7);
    return {
      opacity: p <= 0 || p >= 1 ? 0 : 1,
      transform: [
        { translateX: from + (to - from) * p - COIN / 2 },
        { translateY: lob },
        { scaleX: Math.cos(p * Math.PI * 3) },
      ],
    };
  });
  if (reduceMotion) return null;
  return (
    <Animated.View style={[styles.coin, style]} pointerEvents="none">
      <Image source={RESULT_ART.coin} style={StyleSheet.absoluteFill} contentFit="contain" />
    </Animated.View>
  );
}

/** The rank row: badge + name + progress bar; the rank-up beat lives here. */
function RankRow({ totals, rankedUp }: { totals: Totals; rankedUp: boolean }) {
  const reduceMotion = useReducedMotion();
  const after = rankProgress(totals.pointsAfter);
  const shown = useRoll(totals.pointsBefore, totals.pointsAfter, T_ROLL, ROLL_MS, !reduceMotion);
  // The bar reads against the band the rolling number is in right now.
  const live = rankProgress(shown);
  const [typed, setTyped] = useState(rankedUp ? '' : after.rank.name);
  const badge = useSharedValue(1);
  const beatStarted = useRef(false);

  useEffect(() => {
    if (!rankedUp || beatStarted.current) return;
    beatStarted.current = true;
    const t0 = reduceMotion ? 0 : T_RANK_UP;
    const timer = setTimeout(() => {
      playSfx('rankUp');
      haptic('rankUp');
      if (!reduceMotion) {
        badge.value = withSequence(
          withSpring(1.32, { duration: 320, dampingRatio: 0.55 }),
          withSpring(1, { duration: 420, dampingRatio: 0.7 }),
        );
      }
    }, t0);
    // The name types on, character by character, once the badge has swelled.
    const name = after.rank.name;
    const typers: ReturnType<typeof setTimeout>[] = [];
    const perChar = reduceMotion ? 0 : 55;
    for (let i = 1; i <= name.length; i++) {
      typers.push(setTimeout(() => setTyped(name.slice(0, i)), t0 + 260 + i * perChar));
    }
    return () => {
      clearTimeout(timer);
      typers.forEach(clearTimeout);
    };
  }, [after.rank.name, badge, rankedUp, reduceMotion]);

  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badge.value }] }));
  const ratio = live.total > 0 ? Math.min(1, live.current / live.total) : 1;
  return (
    <View style={styles.rankRow}>
      <Animated.View style={[styles.rankBadge, badgeStyle]}>
        <Image source={RESULT_ART.rankBadge} style={StyleSheet.absoluteFill} contentFit="contain" />
      </Animated.View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.rankName} numberOfLines={1}>
          {rankedUp ? typed || ' ' : after.rank.name}
          {rankedUp && typed.length < after.rank.name.length ? <Text style={styles.caret}>|</Text> : null}
        </Text>
        <View style={styles.barRow}>
          <View style={styles.bar}>
            <Image source={RESULT_ART.barFrame} style={StyleSheet.absoluteFill} contentFit="fill" />
            {ratio > 0 ? (
              <Image
                source={RESULT_ART.barFill}
                style={[styles.barFill, { width: Math.max(4, (BAR.w - BAR.inset * 2) * ratio) }]}
                contentFit="fill"
              />
            ) : null}
          </View>
          <Text style={styles.rankReadout}>
            {live.current}/{live.total}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export default function ResultScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    won?: string;
    local?: string;
    mode?: string;
    ruleset?: string;
    matchId?: string;
    wager?: string;
    oppName?: string;
    oppPoints?: string;
    oppAvatar?: string;
    oppTint?: string;
    oppFlag?: string;
    /** Demo menu only: pointsBefore,pointsAfter,coinsBefore,coinsAfter. */
    forced?: string;
  }>();
  const won = params.won === '1';
  const local = params.local !== '0';
  const mode = params.mode ?? (local ? 'ai' : 'online');
  const ruleset = params.ruleset === 'classic' ? 'classic' : 'advanced';
  const wagered = params.wager === '1';
  const reduceMotion = useReducedMotion();
  const pointBalance = usePoints((state) => state.balance);
  // An offline payout is not real until the server has taken it. Until then
  // the row says so rather than showing a total the backend never moved.
  const settling = usePoints((state) => state.pendingWagerSettlement !== null);
  const settlementFailed = usePoints((state) => state.wagerSettlementError !== null);

  // Applied exactly once per mount (and once per match across mounts).
  const [totals] = useState(() =>
    prepare(won, local, params.matchId ?? '', wagered, parseForced(params.forced)),
  );
  const rankedUp = rankFor(totals.pointsBefore).name !== rankFor(totals.pointsAfter).name;

  const myName = useProfile((s) => s.name);
  const myAvatarId = useProfile((s) => s.avatarId);
  const myTint = useProfile((s) => s.avatarColor);
  const myFlag = useProfile((s) => s.countryCode);
  const opponent = useMemo(
    () => ({
      name: params.oppName || 'Opponent',
      points: Number(params.oppPoints ?? 0) || 0,
      avatarId: Number(params.oppAvatar ?? 2) || 2,
      tint: params.oppTint || '#3A3A3A',
      flag: params.oppFlag || '??',
    }),
    [params.oppAvatar, params.oppFlag, params.oppName, params.oppPoints, params.oppTint],
  );

  const points = useRoll(0, totals.reward.points, T_ROLL, ROLL_MS, !reduceMotion);
  const coins = useRoll(
    totals.coinsBefore,
    totals.coinsAfter,
    T_COINS + COIN_COUNT * COIN_STAGGER,
    ROLL_MS,
    !reduceMotion,
  );

  useEffect(() => {
    const id = setTimeout(() => playSfx('coinFlow'), T_COINS);
    return () => clearTimeout(id);
  }, []);

  // Mirror the server's settlement into the profile so the menu reads right at
  // once. recordOnlineResult is keyed by match id, so a re-mount (or React
  // invoking this effect twice) cannot double count.
  useEffect(() => {
    const settle = totals.settle;
    if (!settle) return;
    useProfile.getState().recordOnlineResult(settle.matchId, settle.won, settle.reward);
  }, [totals]);

  // The result has already captured every server value it needs. Clear the
  // completed socket state so a later local game can never reuse this match.
  useEffect(() => {
    if (!local) useMatchClient.getState().disconnect();
  }, [local]);

  // An offline wager is settled from here: the stake was taken before the
  // first shot, so this is where a win is paid. It is idempotent and stays
  // queued until it lands, so a failure now costs the player nothing.
  useEffect(() => {
    if (usePoints.getState().pendingWagerSettlement) void flushPendingWager();
  }, []);

  // Ribbon drop
  const drop = useSharedValue(reduceMotion ? 0 : -80);
  useEffect(() => {
    drop.value = withSpring(0, { duration: 600, dampingRatio: 0.62 });
  }, [drop]);
  const ribbonStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drop.value }] }));

  const playAgain = () => {
    if (mode === 'hotseat') router.replace('/hotseat');
    else
      router.replace({
        pathname: '/placement',
        params: { mode: mode === 'online' ? 'online' : 'ai', ruleset, wager: wagered ? '1' : '0' },
      });
  };

  // Coins fly loser -> winner. Me on the left, them on the right.
  const coinFrom = won ? CARD_CX_RIGHT : CARD_CX_LEFT;
  const coinTo = won ? CARD_CX_LEFT : CARD_CX_RIGHT;

  const wagerLabel = settling
    ? settlementFailed
      ? won
        ? 'Wager won · payout pending'
        : 'Stake lost · confirming'
      : won
        ? 'Wager won · paying out…'
        : 'Stake lost · settling…'
    : won
      ? `Wager won · ${pointBalance} total`
      : `Stake lost · ${pointBalance} left`;

  const rows: { key: string; label: string; value: string; tone?: string }[] = [
    { key: 'points', label: 'Points gained', value: `+${points}` },
    { key: 'coins', label: 'Coins', value: `${coins}`, tone: COIN_GOLD },
  ];
  if (totals.wager) {
    // Both sides staked before the first shot, so the winner's pot is twice
    // the stake — a net +50 — and the loser is out the 50 they already paid.
    rows.push({
      key: 'wager',
      label: wagerLabel,
      value: won ? `+${totals.wager.prize}` : `-${totals.wager.stake}`,
      tone: settlementFailed ? artColor.soft : won ? artColor.green : color.inkRed,
    });
  }
  if (rankedUp) {
    rows.push({ key: 'rank', label: 'New rank', value: rankFor(totals.pointsAfter).name, tone: artColor.green });
  }

  return (
    <Scale backgroundImage={BACKGROUNDS.result}>
      <Art source={RESULT_ART.wordmark} style={styles.wordmark} />
      <Art source={RESULT_ART.oceansQuote} style={styles.quoteTopRight} />
      <Art source={won ? RESULT_ART.seasQuote : RESULT_ART.watersQuote} style={styles.quoteLowLeft} />
      <Art source={won ? MATCHMAKING_ART.goodCaptainsQuote : RESULT_ART.seasQuote} style={styles.quoteLowRight} />
      <Art source={RESULT_ART.gulls[0] ?? null} style={styles.gullA} />
      <Art source={RESULT_ART.gulls[2] ?? null} style={styles.gullB} />

      <Animated.View style={[styles.banner, ribbonStyle]} accessibilityRole="header" accessibilityLabel={won ? 'Victory' : 'Defeat'}>
        <Image
          source={won ? RESULT_ART.victoryBanner : RESULT_ART.defeatBanner}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
        />
      </Animated.View>

      <View style={styles.panel}>
        <Image source={RESULT_ART.panel} style={StyleSheet.absoluteFill} contentFit="fill" />
        <View style={styles.rows}>
          {rows.map((row, i) => (
            <View key={row.key} style={styles.row}>
              <Text style={styles.label} numberOfLines={1}>
                {row.label}
              </Text>
              <Text
                style={[styles.value, row.tone ? { color: row.tone } : null]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.65}
              >
                {row.value}
              </Text>
              {i < rows.length - 1 ? (
                <Image source={SETTINGS_ART.dashedDivider} style={styles.divider} contentFit="fill" />
              ) : null}
            </View>
          ))}
          <RankRow totals={totals} rankedUp={rankedUp} />
        </View>
      </View>

      <Card
        side="left"
        name={myName || 'You'}
        points={totals.pointsAfter}
        avatarId={myAvatarId}
        tint={myTint}
        flag={myFlag || '??'}
      />
      <Card
        side="right"
        name={opponent.name}
        points={opponent.points}
        avatarId={opponent.avatarId}
        tint={opponent.tint}
        flag={opponent.flag}
      />

      {Array.from({ length: COIN_COUNT }, (_, i) => (
        <Coin key={i} index={i} from={coinFrom} to={coinTo} />
      ))}

      <View style={styles.buttons}>
        <ArtImageButton source={RESULT_ART.playAgain} w={150} h={150 * (101 / 357)} label="Play again" onPress={playAgain} />
        <ArtImageButton
          source={RESULT_ART.menu}
          w={126}
          h={126 * (100 / 299)}
          label="Menu"
          onPress={() => router.replace('/menu')}
        />
      </View>
    </Scale>
  );
}

const BAR = { w: 168, h: 168 * (34 / 373), inset: 3 } as const;

const styles = StyleSheet.create({
  banner: { position: 'absolute', left: (CANVAS_W - 312) / 2, top: -1, width: 312, height: 66 },
  wordmark: { left: 6, top: 4, width: 80, height: 47 },
  quoteTopRight: { left: 604, top: 4, width: 70, height: 51 },
  quoteLowLeft: { left: 196, top: 296, width: 58, height: 48 },
  quoteLowRight: { left: 548, top: 294, width: 64, height: 50 },
  gullA: { left: 560, top: 40, width: 24, height: 12 },
  gullB: { left: 206, top: 50, width: 30, height: 16 },

  panel: { position: 'absolute', left: PANEL_X, top: PANEL_Y, width: PANEL_W, height: PANEL_H },
  rows: {
    position: 'absolute',
    left: 30,
    right: 30,
    top: PANEL_BORDER + 14,
    bottom: 20,
    justifyContent: 'center',
  },
  row: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  label: { flexShrink: 1, color: artColor.ink, fontFamily: font.label, fontSize: 16 },
  value: { maxWidth: '64%', color: artColor.ink, fontFamily: font.display, fontSize: 19, textAlign: 'right' },
  divider: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, opacity: 0.7 },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  rankBadge: { width: 34, height: 34 * (106 / 93) },
  rankName: { color: artColor.ink, fontFamily: font.display, fontSize: 16 },
  caret: { color: artColor.soft, fontFamily: font.body },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bar: { width: BAR.w, height: BAR.h },
  barFill: { position: 'absolute', left: BAR.inset, top: BAR.inset, height: BAR.h - BAR.inset * 2 },
  rankReadout: { color: artColor.ink, fontFamily: font.body, fontSize: 12, fontVariant: ['tabular-nums'] },

  card: { position: 'absolute', top: CARD_Y, width: 128, alignItems: 'center' },
  hole: { position: 'absolute', overflow: 'hidden' },
  ribbon: {
    width: 122,
    height: 122 * (62 / 256),
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  cardName: { color: artColor.ink, fontFamily: font.display, fontSize: 15 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  badge: { width: 38, height: 38 * (47 / 85), alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: artColor.red, fontFamily: font.display, fontSize: 12 },
  cardPoints: { color: artColor.ink, fontFamily: font.body, fontSize: 13 },
  coin: { position: 'absolute', top: CARD_Y + PORTRAIT.h / 2 - COIN / 2, left: 0, width: COIN, height: COIN },
  buttons: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: PANEL_Y + PANEL_H + 8,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 22,
  },
});
