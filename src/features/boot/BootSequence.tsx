/**
 * The first 1.8 seconds — docs/brief.md 5.5. The only non-interactive motion
 * in the game, so every value below is driven on the UI thread by Reanimated
 * and nothing re-renders while it plays.
 *
 *   t=0     desk, nothing else
 *   t=120   the sheet drops in: translateY -40 -> 0, spring(14, 120), 1.5deg settle
 *   t=380   the red rule draws left to right (strokeDashoffset, 260ms ease-out)
 *   t=500   the grid wipes in: ONE ClipPath rect width 0 -> 800 over 420ms
 *   t=800   the logo fades/scales in (0.94 -> 1, 320ms) with an ink bleed
 *   t=1400  hold
 *   t=1800  the sheet slides left off-canvas over 260ms ('exit')
 *
 * `mode` is the only input: 'play' runs the timeline, 'end' snaps to the held
 * end state (skip / reduce-motion), 'exit' slides the sheet away.
 */
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { ClipPath, Defs, G, Path, Rect } from 'react-native-svg';

import { pathLength, sheetPath, splitSubpaths } from '@/ui/geometry';
import { LogoMark } from '@/ui/LogoMark';
import { GraphRules } from '@/ui/Paper';
import { CANVAS_H, CANVAS_W, PAPER_GRID, color } from '@/ui/tokens';
import { hashString, roughLine } from '@/ui/useRough';

export type BootMode = 'play' | 'end' | 'exit';

export interface BootSequenceProps {
  mode: BootMode;
}

export const BOOT_TIMELINE = {
  paperDrop: 120,
  rule: 380,
  ruleDuration: 260,
  grid: 500,
  gridDuration: 420,
  logo: 800,
  logoDuration: 320,
  hold: 1400,
  exit: 1800,
  exitDuration: 260,
  reduceMotionHold: 900,
} as const;

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedPath = Animated.createAnimatedComponent(Path);

const W = CANVAS_W;
const H = CANVAS_H;
const TEAR_X = W - 12;
const LOGO_W = 320;
const LOGO_H = 120;

export function BootSequence({ mode }: BootSequenceProps) {
  const seed = useMemo(() => hashString('paper-full'), []);
  const sheet = useMemo(() => sheetPath(W, H, TEAR_X, 3.2, seed), [seed]);

  // Same options as Paper's rule so the menu's sheet matches what just drew.
  const rule = useMemo(
    () =>
      roughLine(-2, PAPER_GRID.ruleY, TEAR_X - 4, PAPER_GRID.ruleY, {
        seed: seed + 7,
        stroke: color.ruleRed,
        strokeWidth: 1.3,
        roughness: 0.9,
        bowing: 0.7,
      }),
    [seed],
  );
  // Rough draws the double stroke as one path with two subpaths; split them so
  // both strokes sweep left to right together, each with its own dash length.
  const strokes = useMemo(
    () =>
      rule.flatMap((p) =>
        splitSubpaths(p.d).map((d) => ({ d, stroke: p.stroke, strokeWidth: p.strokeWidth })),
      ),
    [rule],
  );
  const ruleA = strokes[0];
  const ruleB = strokes[1];
  const lenA = useMemo(() => (ruleA ? pathLength(ruleA.d) : 0), [ruleA]);
  const lenB = useMemo(() => (ruleB ? pathLength(ruleB.d) : 0), [ruleB]);

  const sheetOpacity = useSharedValue(0);
  const sheetY = useSharedValue(-40);
  const sheetRot = useSharedValue(1.5);
  const ruleProgress = useSharedValue(0);
  const gridW = useSharedValue(0);
  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0.94);
  const exitX = useSharedValue(0);

  useEffect(() => {
    const all = [
      sheetOpacity,
      sheetY,
      sheetRot,
      ruleProgress,
      gridW,
      logoOpacity,
      logoScale,
      exitX,
    ];
    const t = BOOT_TIMELINE;

    if (mode === 'play') {
      sheetOpacity.value = withDelay(t.paperDrop, withTiming(1, { duration: 40 }));
      sheetY.value = withDelay(t.paperDrop, withSpring(0, { damping: 14, stiffness: 120 }));
      sheetRot.value = withDelay(t.paperDrop, withSpring(0, { damping: 14, stiffness: 120 }));
      ruleProgress.value = withDelay(
        t.rule,
        withTiming(1, { duration: t.ruleDuration, easing: Easing.out(Easing.cubic) }),
      );
      gridW.value = withDelay(
        t.grid,
        withTiming(W, { duration: t.gridDuration, easing: Easing.inOut(Easing.quad) }),
      );
      logoOpacity.value = withDelay(
        t.logo,
        withTiming(1, { duration: t.logoDuration, easing: Easing.out(Easing.quad) }),
      );
      logoScale.value = withDelay(
        t.logo,
        withTiming(1, { duration: t.logoDuration, easing: Easing.out(Easing.cubic) }),
      );
      return;
    }

    // 'end' and 'exit' both start from the fully drawn sheet.
    for (const v of all) cancelAnimation(v);
    sheetOpacity.value = 1;
    sheetY.value = 0;
    sheetRot.value = 0;
    ruleProgress.value = 1;
    gridW.value = W;
    logoOpacity.value = 1;
    logoScale.value = 1;

    if (mode === 'exit') {
      exitX.value = withTiming(-W - 20, {
        duration: t.exitDuration,
        easing: Easing.in(Easing.cubic),
      });
    } else {
      exitX.value = 0;
    }
  }, [mode, sheetOpacity, sheetY, sheetRot, ruleProgress, gridW, logoOpacity, logoScale, exitX]);

  const exitStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: exitX.value }],
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: sheetOpacity.value,
    transform: [{ translateY: sheetY.value }, { rotate: `${sheetRot.value}deg` }],
  }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));
  const wipeProps = useAnimatedProps(() => ({ width: gridW.value }));
  const ruleAProps = useAnimatedProps(() => ({
    strokeDashoffset: lenA * (1 - ruleProgress.value),
  }));
  const ruleBProps = useAnimatedProps(() => ({
    strokeDashoffset: lenB * (1 - ruleProgress.value),
  }));

  return (
    <Animated.View style={[styles.canvas, exitStyle]} pointerEvents="none">
      <Animated.View style={[styles.canvas, sheetStyle]}>
        <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <Defs>
            <ClipPath id="boot-sheet">
              <Path d={sheet} />
            </ClipPath>
            <ClipPath id="boot-wipe">
              <AnimatedRect x={0} y={0} height={H} animatedProps={wipeProps} />
            </ClipPath>
          </Defs>
          <Path d={sheet} fill={color.deskDark} opacity={0.7} transform="translate(3 3)" />
          <Path d={sheet} fill={color.paper} />
          <G clipPath="url(#boot-sheet)">
            <G clipPath="url(#boot-wipe)">
              <GraphRules w={W} h={H} />
            </G>
            {ruleA ? (
              <AnimatedPath
                d={ruleA.d}
                stroke={ruleA.stroke}
                strokeWidth={ruleA.strokeWidth}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={[lenA, lenA]}
                animatedProps={ruleAProps}
              />
            ) : null}
            {ruleB ? (
              <AnimatedPath
                d={ruleB.d}
                stroke={ruleB.stroke}
                strokeWidth={ruleB.strokeWidth}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={[lenB, lenB]}
                animatedProps={ruleBProps}
              />
            ) : null}
          </G>
          <Path d={sheet} fill="none" stroke="#DDE3EA" strokeWidth={0.8} />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.logo, logoStyle]}>
        <LogoMark w={LOGO_W} h={LOGO_H} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  canvas: { position: 'absolute', left: 0, top: 0, width: W, height: H },
  logo: {
    position: 'absolute',
    left: (W - LOGO_W) / 2,
    top: (H - LOGO_H) / 2 + 8,
    width: LOGO_W,
    height: LOGO_H,
  },
});
