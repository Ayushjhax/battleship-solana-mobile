/**
 * The result (P14). One composition for both verdicts:
 *
 *   Win   TitleRibbon "Victory", an ink laurel flanking the panel, both cards
 *         facing each other, coins flying from the loser's card to the
 *         winner's, the rank bar filling with a number roll.
 *   Loss  the same, muted — 70 % ink, no laurel, coin flow reversed. Nothing
 *         else changes: a result screen that sulks makes people quit.
 *
 * Rank-up is the one extra beat: the badge scales up, the new shield inks
 * itself over the old, the rank name types on. sfx rankUp.
 *
 * Where the numbers come from: offline results were queued into the profile
 * (battle.ts markFinished) before this route opened; an online match was
 * settled by the SERVER (0008), so `prepare()` mirrors its rewards into the
 * profile once (keyed by matchId, so a re-mount can't double count) — the
 * client never writes score columns to Supabase, only to its own store.
 * "Before" is simply "after minus the reward", in either case.
 */
import { REWARD, rankFor, rankProgress, type Rank } from '@engine/ranks';
import { salvageBonusPercent } from '@engine/city';
import { useCity } from '@/city/store';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
import Svg from 'react-native-svg';

import { playSfx } from '@/audio/sfx';
import { haptic } from '@/audio/haptics';
import { AvatarCard, FlagChip } from '@/features/battle/Hud';
import { useMatchClient } from '@/net/match-client';
import { flushPendingWager } from '@/net/offlineWager';
import { usePoints, WAGER_STAKE } from '@/state/points';
import { useProfile } from '@/state/profile';
import { COIN_GOLD } from '@/ui/CurrencyChip';
import { chevronPoints, laurelBranch, shieldPoints } from '@/ui/geometry';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';
import { RoughShape, hashString, useRough } from '@/ui/useRough';

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
const MUTED = 0.7;

// Layout
const CARD_Y = 128;
const CARD_X_LEFT = 62;
const CARD_X_RIGHT = CANVAS_W - 62 - 54;
const PANEL_W = 336;
const PANEL_H = 176;
const PANEL_X = (CANVAS_W - PANEL_W) / 2;
const PANEL_Y = 92;

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
  /** Steel the server credited to the Scrapyard, or null (part-02 §8). */
  readonly salvage: { steel: number } | null;
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
      salvage: null,
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
    // Port City part-02 §8. Whatever the SERVER credited, or null. This screen
    // never computes salvage: an offline match has not synced yet when it
    // opens, so it simply shows no line rather than a guess.
    salvage: over?.salvage ?? null,
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

function Laurel({ side }: { side: 'left' | 'right' }) {
  const { roughPolygon, roughPath } = useRough();
  const h = 150;
  const w = 60;
  const { stem, leaves } = laurelBranch(side, h);
  const seed = hashString(`laurel-${side}`);
  const stemPath = roughPath(stem, {
    seed,
    stroke: color.inkGreen,
    strokeWidth: 1.6,
    roughness: 0.9,
  });
  const leafPaths = leaves.map((leaf, i) =>
    roughPolygon(leaf.points, {
      seed: seed + 1 + i,
      stroke: color.inkGreen,
      strokeWidth: 1,
      fill: color.inkGreen,
      fillStyle: 'hachure',
      hachureGap: 2.6,
      fillWeight: 0.8,
      roughness: 0.8,
    }),
  );
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <RoughShape paths={stemPath} />
      {leafPaths.map((p, i) => (
        <RoughShape key={i} paths={p} />
      ))}
    </Svg>
  );
}

function Card({
  side,
  name,
  points,
  avatarId,
  tint,
  flag,
  seedKey,
}: {
  side: 'left' | 'right';
  name: string;
  points: number;
  avatarId: number;
  tint: string;
  flag: string;
  seedKey: string;
}) {
  const reduceMotion = useReducedMotion();
  const x = useSharedValue(reduceMotion ? 0 : side === 'left' ? -160 : 160);
  useEffect(() => {
    x.value = withDelay(T_CARDS, withSpring(0, { duration: 560, dampingRatio: 0.74 }));
  }, [x]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const right = side === 'right';
  return (
    <Animated.View
      style={[
        styles.card,
        {
          left: side === 'left' ? CARD_X_LEFT : CARD_X_RIGHT,
          alignItems: right ? 'flex-end' : 'flex-start',
        },
        slide,
      ]}
    >
      <AvatarCard avatarId={avatarId} tint={tint} seedKey={seedKey} />
      <Text style={styles.cardName} numberOfLines={1}>
        {name}
      </Text>
      <View style={[styles.cardMeta, right ? { flexDirection: 'row-reverse' } : null]}>
        <FlagChip code={flag} seedKey={seedKey} />
        <Text style={styles.cardPoints}>{points} pts</Text>
      </View>
    </Animated.View>
  );
}

/** One coin, thrown from `from` to `to` on a lob. */
function Coin({ index, from, to }: { index: number; from: number; to: number }) {
  const { roughCircle } = useRough();
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);
  const seed = hashString(`coin-${index}`);
  useEffect(() => {
    if (reduceMotion) return;
    t.value = withDelay(
      T_COINS + index * COIN_STAGGER,
      withTiming(1, { duration: COIN_FLIGHT, easing: Easing.inOut(Easing.quad) }),
    );
  }, [index, reduceMotion, t]);
  const style = useAnimatedStyle(() => {
    const p = t.value;
    const lob = -Math.sin(p * Math.PI) * (46 + index * 6);
    return {
      opacity: p <= 0 || p >= 1 ? 0 : 1,
      transform: [{ translateX: from + (to - from) * p }, { translateY: lob }],
    };
  });
  const face = roughCircle(9, 9, 14, {
    seed,
    stroke: COIN_GOLD,
    strokeWidth: 1.4,
    fill: COIN_GOLD,
    fillStyle: 'hachure',
    hachureGap: 2.2,
    fillWeight: 1,
  });
  const rim = roughCircle(9, 9, 8, { seed: seed + 1, stroke: COIN_GOLD, strokeWidth: 1 });
  if (reduceMotion) return null;
  return (
    <Animated.View style={[styles.coin, style]} pointerEvents="none">
      <Svg width={18} height={18} viewBox="0 0 18 18">
        <RoughShape paths={face} />
        <RoughShape paths={rim} />
      </Svg>
    </Animated.View>
  );
}

/** The shield from RankBadge at a larger size, so the new one can ink over the old. */
function Shield({ seedKey, size = 1 }: { seedKey: string; size?: number }) {
  const { roughPolygon } = useRough();
  const w = 34 * size;
  const h = 40 * size;
  const seed = hashString(`rank-${seedKey}`);
  const shield = roughPolygon(shieldPoints(w, h, 2), {
    seed,
    strokeWidth: 1.5,
    fill: color.inkFaint,
    fillStyle: 'hachure',
    hachureGap: 3,
    fillWeight: 1,
  });
  const chevron = roughPolygon(chevronPoints(w), {
    seed: seed + 1,
    stroke: color.ink,
    strokeWidth: 1,
    fill: color.ink,
    fillStyle: 'solid',
  });
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <RoughShape paths={shield} />
      <RoughShape paths={chevron} />
    </Svg>
  );
}

/** The rank row: shield + name + progress bar; the rank-up beat lives here. */
function RankRow({ totals, rankedUp }: { totals: Totals; rankedUp: boolean }) {
  const { roughRect } = useRough();
  const reduceMotion = useReducedMotion();
  const before = rankProgress(totals.pointsBefore);
  const after = rankProgress(totals.pointsAfter);
  const shown = useRoll(totals.pointsBefore, totals.pointsAfter, T_ROLL, ROLL_MS, !reduceMotion);
  // The bar reads against the band the rolling number is in right now.
  const live = rankProgress(shown);
  const [typed, setTyped] = useState(rankedUp ? '' : after.rank.name);
  const badge = useSharedValue(1);
  const oldShield = useSharedValue(1);
  const newShield = useSharedValue(rankedUp ? 0 : 1);
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
          withSpring(1.28, { duration: 320, dampingRatio: 0.55 }),
          withSpring(1, { duration: 420, dampingRatio: 0.7 }),
        );
        oldShield.value = withTiming(0, { duration: 380 });
        newShield.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
      } else {
        oldShield.value = 0;
        newShield.value = 1;
      }
    }, t0);
    // The name types on, character by character, once the shield has inked.
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
  }, [after.rank.name, badge, newShield, oldShield, rankedUp, reduceMotion]);

  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badge.value }] }));
  const oldStyle = useAnimatedStyle(() => ({ opacity: oldShield.value }));
  const newStyle = useAnimatedStyle(() => ({
    opacity: newShield.value,
    transform: [{ scale: 0.7 + 0.3 * newShield.value }],
  }));

  const BAR_W = 180;
  const BAR_H = 10;
  const ratio = live.total > 0 ? Math.min(1, live.current / live.total) : 1;
  const outline = roughRect(1, 1, BAR_W - 2, BAR_H - 2, {
    seed: hashString('result-bar'),
    strokeWidth: 1.2,
  });
  const fill =
    ratio > 0
      ? roughRect(2, 2, Math.max(2, (BAR_W - 4) * ratio), BAR_H - 4, {
          seed: hashString('result-bar-fill'),
          stroke: 'none',
          fill: color.inkGreen,
          fillStyle: 'solid',
        })
      : null;

  const oldRank: Rank = before.rank;
  return (
    <View style={styles.rankRow}>
      <Animated.View style={[{ width: 34, height: 40 }, badgeStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, oldStyle]}>
          <Shield seedKey={`old-${oldRank.name}`} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, newStyle]}>
          <Shield seedKey={`new-${after.rank.name}`} />
        </Animated.View>
      </Animated.View>
      <View style={{ gap: 3 }}>
        <Text style={styles.rankName} numberOfLines={1}>
          {rankedUp ? typed || ' ' : after.rank.name}
          {rankedUp && typed.length < after.rank.name.length ? (
            <Text style={styles.caret}>|</Text>
          ) : null}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <View style={{ width: BAR_W, height: BAR_H }}>
            <Svg
              width={BAR_W}
              height={BAR_H}
              viewBox={`0 0 ${BAR_W} ${BAR_H}`}
              style={StyleSheet.absoluteFill}
            >
              {fill ? <RoughShape paths={fill} /> : null}
              <RoughShape paths={outline} />
            </Svg>
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

  /**
   * The Scrapyard's bonus percentage, read from the cached city snapshot —
   * itself a server number, never derived from the battle. 0 when the city
   * has never been opened, which just omits the suffix.
   */
  const scrapBonus = useMemo(() => {
    const level = useCity.getState().snapshot?.city.buildings.scrapyard.level ?? 0;
    return salvageBonusPercent(level);
  }, []);

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
  const coinFrom = won ? CARD_X_RIGHT + 18 : CARD_X_LEFT + 18;
  const coinTo = won ? CARD_X_LEFT + 18 : CARD_X_RIGHT + 18;

  return (
    <Scale>
      <Paper variant="full" />
      <View style={[StyleSheet.absoluteFill, { opacity: won ? 1 : MUTED }]}>
        <Animated.View style={[styles.ribbon, ribbonStyle]}>
          <TitleRibbon title={won ? 'Victory' : 'Defeat'} w={300} h={48} seedKey="result" />
        </Animated.View>

        {won ? (
          <>
            <View style={[styles.laurel, { left: PANEL_X - 58 }]}>
              <Laurel side="left" />
            </View>
            <View style={[styles.laurel, { left: PANEL_X + PANEL_W - 2 }]}>
              <Laurel side="right" />
            </View>
          </>
        ) : null}

        <View style={{ position: 'absolute', left: PANEL_X, top: PANEL_Y }}>
          <InkPanel w={PANEL_W} h={PANEL_H} seedKey="result-panel" padding={space.md}>
            <View style={styles.rows}>
              <View style={styles.row}>
                <Text style={styles.label}>Points gained</Text>
                <Text style={styles.value}>+{points}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Coins</Text>
                <Text style={[styles.value, { color: COIN_GOLD }]}>{coins}</Text>
              </View>
              {/* part-02 §8: one line, the server's number, no recomputation. */}
              {totals.salvage && totals.salvage.steel > 0 ? (
                <View style={styles.row}>
                  <Text style={styles.label} numberOfLines={1}>
                    Salvaged
                  </Text>
                  <Text style={styles.value}>
                    {totals.salvage.steel} steel → Scrapyard
                    {scrapBonus > 0 ? `  +${scrapBonus}% Scrapyard` : ''}
                  </Text>
                </View>
              ) : null}

              {totals.wager ? (
                <View style={styles.row}>
                  <Text style={styles.label} numberOfLines={1}>
                    {settling
                      ? settlementFailed
                        ? won
                          ? 'Wager won · payout pending'
                          : 'Stake lost · confirming'
                        : won
                          ? 'Wager won · paying out…'
                          : 'Stake lost · settling…'
                      : won
                        ? `Wager won · ${pointBalance} total`
                        : `Stake lost · ${pointBalance} left`}
                  </Text>
                  <Text
                    style={[
                      styles.value,
                      { color: settlementFailed ? color.inkSoft : won ? color.inkGreen : color.inkRed },
                    ]}
                  >
                    {/* Both sides staked before the first shot, so the winner's
                        pot is twice the stake — a net +50 — and the loser is
                        out the 50 they already paid. */}
                    {won ? `+${totals.wager.prize}` : `-${totals.wager.stake}`}
                  </Text>
                </View>
              ) : null}
              {rankedUp ? (
                <View style={styles.row}>
                  <Text style={styles.label}>New rank</Text>
                  <Text style={[styles.value, { color: color.inkGreen }]}>
                    {rankFor(totals.pointsAfter).name}
                  </Text>
                </View>
              ) : null}
              <RankRow totals={totals} rankedUp={rankedUp} />
            </View>
          </InkPanel>
        </View>

        <Card
          side="left"
          name={myName || 'You'}
          points={totals.pointsAfter}
          avatarId={myAvatarId}
          tint={myTint}
          flag={myFlag}
          seedKey="me"
        />
        <Card
          side="right"
          name={opponent.name}
          points={opponent.points}
          avatarId={opponent.avatarId}
          tint={opponent.tint}
          flag={opponent.flag}
          seedKey="them"
        />

        {Array.from({ length: COIN_COUNT }, (_, i) => (
          <Coin key={i} index={i} from={coinFrom} to={coinTo} />
        ))}
      </View>

      <View style={styles.buttons}>
        <InkButton label="Play again" tone="confirm" size="md" w={150} h={38} onPress={playAgain} />
        <InkButton label="Menu" size="md" w={110} h={38} onPress={() => router.replace('/menu')} />
      </View>
    </Scale>
  );
}

const styles = StyleSheet.create({
  ribbon: { position: 'absolute', left: (CANVAS_W - 300) / 2, top: 14 },
  laurel: { position: 'absolute', top: PANEL_Y + 8 },
  rows: { flex: 1, justifyContent: 'space-between' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { color: color.inkSoft, fontFamily: font.label, fontSize: typeScale.sm },
  value: { color: color.ink, fontFamily: font.display, fontSize: typeScale.md },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  rankName: { color: color.ink, fontFamily: font.display, fontSize: typeScale.sm },
  caret: { color: color.inkSoft, fontFamily: font.body },
  rankReadout: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xxs },
  card: { position: 'absolute', top: CARD_Y, width: 120, gap: 4 },
  cardName: { color: color.ink, fontFamily: font.display, fontSize: typeScale.sm, maxWidth: 120 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  cardPoints: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xxs },
  coin: { position: 'absolute', top: CARD_Y + 18, left: 0, width: 18, height: 18 },
  buttons: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 296,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.md,
  },
});
