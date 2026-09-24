/**
 * The shell HUD — part-07 §3 step 3.
 *
 * "Top left: shells as a row of ink shell icons plus the number. A hit makes
 * the spent shell fly back into the row (+1 pop, 220 ms). A mine takes three
 * with a red flash."
 *
 * EVERY DECISION IN HERE CAME FROM `shellHud.ts`. This file draws. It does
 * not add, subtract or compare — it is handed a `ShellFeedback` and a number
 * that both came from the server, and it animates. That split is what makes
 * §8.2 testable in a suite with no React renderer.
 */
import { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { color, font, space, type as typeScale } from '@/ui/tokens';
import { RoughShape, hashString, useRough } from '@/ui/useRough';

import { MINE_FLASH_MS, SHELL_POP_MS, shellRow, type ShellFeedback } from './shellHud';

/** How many icons the row draws before it gives up and just shows the number. */
const MAX_ICONS = 30;
const ICON_W = 7;
const ICON_H = 14;
const ICON_GAP = 2;

/** One shell: a stubby ink cartridge. Same pen as everything else. */
const ShellIcon = memo(function ShellIcon({ spent, index }: { spent: boolean; index: number }) {
  const { roughRect, roughPolygon } = useRough();
  const seed = hashString(`shell-${index % 8}`);
  const tint = spent ? color.inkFaint : color.ink;
  const body = roughRect(0.5, 4, ICON_W - 1, ICON_H - 5, {
    seed,
    stroke: tint,
    strokeWidth: 1,
    roughness: 0.9,
  });
  const tip = roughPolygon(
    [
      [0.5, 4],
      [ICON_W / 2, 0],
      [ICON_W - 0.5, 4],
    ],
    { seed: seed + 1, stroke: tint, strokeWidth: 1, roughness: 0.9 },
  );
  return (
    <Svg width={ICON_W} height={ICON_H}>
      <RoughShape paths={body} />
      <RoughShape paths={tip} />
    </Svg>
  );
});

export interface ShellRowProps {
  /** The server's number. Never a local count. */
  readonly shells: number;
  /** The budget the raid opened with, also the server's. */
  readonly budget: number;
  /** What just happened, from `shellFeedback()`. Null between actions. */
  readonly feedback: ShellFeedback | null;
  /** Bumped on every resolved action, so a repeat of the same feedback replays. */
  readonly nonce: number;
}

export function ShellRow({ shells, budget, feedback, nonce }: ShellRowProps) {
  const reduceMotion = useReducedMotion();
  const pop = useSharedValue(0);
  const flash = useSharedValue(0);

  useEffect(() => {
    if (!feedback || reduceMotion) return;

    if (feedback.popBack) {
      // §3 — the spent shell flies back into the row, 220 ms.
      pop.value = 0;
      pop.value = withSequence(
        withTiming(1, { duration: SHELL_POP_MS * 0.55, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: SHELL_POP_MS * 0.45, easing: Easing.in(Easing.quad) }),
      );
    }

    if (feedback.flash) {
      flash.value = 0;
      flash.value = withSequence(
        withTiming(1, { duration: MINE_FLASH_MS * 0.3 }),
        withTiming(0, { duration: MINE_FLASH_MS * 0.7 }),
      );
    }
  }, [feedback, flash, nonce, pop, reduceMotion]);

  const floatStyle = useAnimatedStyle(() => ({
    opacity: pop.value,
    transform: [{ translateY: -14 * pop.value }],
  }));
  const numberStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + 0.18 * pop.value }],
  }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  const { filled, empty } = shellRow(shells, budget);
  const icons = Math.min(budget, MAX_ICONS);
  const shownFilled = Math.round((filled / Math.max(1, budget)) * icons);

  return (
    <View style={styles.wrap} accessibilityLabel={`${shells} shells of ${budget}`}>
      <View style={styles.numberRow}>
        <Animated.View style={numberStyle}>
          <Text style={styles.number}>{shells}</Text>
        </Animated.View>
        <Text style={styles.budget}>{` / ${budget}`}</Text>

        {/* The floating label: "+1" on a refund, "-3" on a mine. */}
        {feedback?.label ? (
          <Animated.View style={[styles.float, floatStyle]} pointerEvents="none">
            <Text style={[styles.floatText, feedback.kind === 'mine' && styles.floatMine]}>
              {feedback.label}
            </Text>
          </Animated.View>
        ) : null}
      </View>

      <View style={styles.icons}>
        {Array.from({ length: icons }, (_, i) => (
          <ShellIcon key={i} index={i} spent={i >= shownFilled} />
        ))}
      </View>

      {/* The mine's red wash over the whole row. */}
      <Animated.View style={[styles.flash, flashStyle]} pointerEvents="none" />
      {empty === 0 && filled === 0 ? <Text style={styles.empty}>No shells left</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', gap: 2 },
  numberRow: { flexDirection: 'row', alignItems: 'baseline' },
  number: { color: color.ink, fontFamily: font.display, fontSize: typeScale.xl },
  budget: { color: color.inkSoft, fontFamily: font.label, fontSize: typeScale.sm },
  float: { position: 'absolute', left: 30, top: -4 },
  floatText: { color: color.inkGreen, fontFamily: font.display, fontSize: typeScale.md },
  floatMine: { color: color.inkRed },
  icons: {
    flexDirection: 'row',
    gap: ICON_GAP,
    width: MAX_ICONS * (ICON_W + ICON_GAP),
    flexWrap: 'wrap',
  },
  flash: {
    position: 'absolute',
    left: -4,
    top: -4,
    right: -4,
    bottom: -4,
    backgroundColor: color.inkRed,
  },
  empty: { color: color.inkRed, fontFamily: font.label, fontSize: typeScale.xxs },
});

// ---------------------------------------------------------------------------
// The star strip (§3 — "three empty star outlines that ink in as they are
// earned, and the destruction percentage rolling beneath")
// ---------------------------------------------------------------------------

export interface StarStripProps {
  readonly stars: number;
  readonly destruction: number;
  /** The star that just landed, for the stamp. Null when none did. */
  readonly landed: number | null;
}

const STAR_R = 13;

function StarShape({ inked, index }: { inked: boolean; index: number }) {
  const { roughPolygon } = useRough();
  const points: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? STAR_R : STAR_R * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    points.push([STAR_R + r * Math.cos(a), STAR_R + r * Math.sin(a)]);
  }
  const paths = roughPolygon(points, {
    seed: hashString(`raid-star-${index}`),
    stroke: inked ? color.ink : color.inkFaint,
    strokeWidth: inked ? 1.8 : 1.1,
    ...(inked
      ? { fill: color.ink, fillStyle: 'hachure' as const, hachureGap: 2.6, fillWeight: 1 }
      : {}),
  });
  return (
    <Svg width={STAR_R * 2} height={STAR_R * 2}>
      <RoughShape paths={paths} />
    </Svg>
  );
}

export function StarStrip({ stars, destruction, landed }: StarStripProps) {
  const reduceMotion = useReducedMotion();
  const stamp = useSharedValue(0);

  useEffect(() => {
    if (landed === null || reduceMotion) return;
    stamp.value = 0;
    stamp.value = withSequence(
      withTiming(1, { duration: 140, easing: Easing.out(Easing.back(2)) }),
      withTiming(0, { duration: 180 }),
    );
  }, [landed, reduceMotion, stamp]);

  const stampStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.35 * stamp.value }] }));
  const inked = Math.max(0, Math.min(3, Math.trunc(stars)));
  const percent = Math.round(Math.max(0, Math.min(1, destruction)) * 100);

  return (
    <View style={starStyles.wrap} accessibilityLabel={`${inked} stars, ${percent} percent destroyed`}>
      <View style={starStyles.row}>
        {[0, 1, 2].map((i) => (
          <Animated.View key={i} style={landed === i + 1 ? stampStyle : undefined}>
            <StarShape index={i} inked={i < inked} />
          </Animated.View>
        ))}
      </View>
      <Text style={starStyles.percent}>{percent}%</Text>
    </View>
  );
}

const starStyles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 1 },
  row: { flexDirection: 'row', gap: space.xs },
  percent: { color: color.ink, fontFamily: font.display, fontSize: typeScale.md },
});
