/**
 * Renders what the battle effects put in the fx store: the shell in flight,
 * every sprite effect (explosions, splashes, smoke, the mine, the AA gun
 * firing), the aircraft with their shadows, bombs, torpedoes, the submarine,
 * the radar scope, stamps, the flashes, the converging crosshair.
 *
 * Every visual is its own leaf with its own Reanimated values and plays on
 * the UI thread — frames by sliding a strip (Sprite.tsx), motion by
 * transforms — so the boards underneath never re-render because of these.
 */
import { Image } from 'expo-image';
import { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { BOARD_SIZE, CELL, type Point as BoardPoint } from '@/board/layout';
import { BATTLE_ART, FX_ART, type FxStrip } from '@/ui/assets';
import { CANVAS_H, CANVAS_W, artColor, color, font } from '@/ui/tokens';
import { RoughShape, hashString, roughPolygon, roughRect } from '@/ui/useRough';
import { AIM_MS } from '@/state/battle';
import { SpriteStrip, useFrameClock } from './Sprite';
import {
  CRASH_MS,
  DIVE_MS,
  useFx,
  type Aircraft as AircraftModel,
  type AircraftKind,
  type Bomb as BombModel,
  type Crosshair as CrosshairModel,
  type RadarFx as RadarModel,
  type Shell as ShellModel,
  type SpriteFx as SpriteModel,
  type StampFx as StampModel,
  type SubmarineFx as SubmarineModel,
  type TorpedoTrack as TorpedoModel,
} from './fxStore';

// ---------------------------------------------------------------------------
// Shell — arcs from the firing board to the target, a dotted trail behind it
// ---------------------------------------------------------------------------

const SHELL = 11;
const ARC_HEIGHT = 46;
const TRAIL = 9;

function arcPoint(shell: ShellModel, p: number) {
  'worklet';
  return {
    x: shell.from.x + (shell.to.x - shell.from.x) * p,
    y: shell.from.y + (shell.to.y - shell.from.y) * p - ARC_HEIGHT * Math.sin(Math.PI * p),
  };
}

function TrailDot({ shell, progress, index }: { shell: ShellModel; progress: SharedValue<number>; index: number }) {
  const at = (index + 1) / (TRAIL + 1);
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const point = arcPoint(shell, at);
    const age = p - at;
    return {
      opacity: age < 0 ? 0 : Math.max(0, 0.55 - age * 1.4),
      transform: [{ translateX: point.x - 2 }, { translateY: point.y - 2 }],
    };
  });
  return <Animated.View style={[styles.trailDot, style]} />;
}

const Shell = memo(function Shell({ shell }: { shell: ShellModel }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, { duration: shell.durationMs, easing: Easing.inOut(Easing.quad) });
  }, [shell, progress]);

  const dot = useAnimatedStyle(() => {
    const p = progress.value;
    const point = arcPoint(shell, p);
    return {
      transform: [
        { translateX: point.x - SHELL / 2 },
        { translateY: point.y - SHELL / 2 },
        { scale: 0.75 + 0.55 * Math.sin(Math.PI * p) },
      ],
    };
  });

  return (
    <>
      {Array.from({ length: TRAIL }, (_, index) => (
        <TrailDot key={index} shell={shell} progress={progress} index={index} />
      ))}
      <Animated.View style={[styles.shell, dot]} pointerEvents="none">
        <Svg width={SHELL} height={SHELL} viewBox={`0 0 ${SHELL} ${SHELL}`}>
          <Circle cx={SHELL / 2} cy={SHELL / 2} r={SHELL / 2 - 0.6} fill={artColor.ink} />
          <Circle cx={SHELL / 2 - 1.6} cy={SHELL / 2 - 1.8} r={1.5} fill="#FFFFFF" opacity={0.8} />
        </Svg>
      </Animated.View>
    </>
  );
});

// ---------------------------------------------------------------------------
// Sprite effects — one run of a strip at a point
// ---------------------------------------------------------------------------

const STRIPS: Record<SpriteModel['kind'], FxStrip> = {
  explosionInk: FX_ART.explosionInk,
  explosionFire: FX_ART.explosionFire,
  explosionAtomic: FX_ART.explosionAtomic,
  explosionPuff: FX_ART.explosionPuff,
  mine: FX_ART.mine,
  smoke: FX_ART.smoke,
  smokeAtomic: FX_ART.smokeAtomic,
  turret: FX_ART.turret,
  splash: FX_ART.splash,
};

const SpriteEffect = memo(function SpriteEffect({ sprite }: { sprite: SpriteModel }) {
  const strip = STRIPS[sprite.kind];
  const frame = useFrameClock({ frames: strip.frames, durationMs: sprite.durationMs, delayMs: sprite.delayMs });
  const reduceMotion = useReducedMotion();
  const lift = useSharedValue(0);
  const shown = useSharedValue(sprite.delayMs ? 0 : 1);
  useEffect(() => {
    if (sprite.delayMs) shown.value = withDelay(sprite.delayMs, withTiming(1, { duration: 0 }));
    if (sprite.rise && !reduceMotion) {
      lift.value = withDelay(
        sprite.delayMs ?? 0,
        withTiming(1, { duration: sprite.durationMs, easing: Easing.out(Easing.quad) }),
      );
    }
  }, [lift, reduceMotion, shown, sprite]);
  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: -(sprite.rise ?? 0) * lift.value }],
  }));
  const height = sprite.width / strip.aspect;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.abs,
        { left: sprite.at.x - sprite.width / 2, top: sprite.at.y - height * (sprite.anchorY ?? 0.5) },
        style,
      ]}
    >
      <SpriteStrip strip={strip} width={sprite.width} frame={frame} />
    </Animated.View>
  );
});

// ---------------------------------------------------------------------------
// Flashes — the mine's red wash over the boards, the atomic white-out
// ---------------------------------------------------------------------------

const Flash = memo(function Flash({ nonce }: { nonce: number }) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (nonce === 0) return;
    opacity.value = withSequence(
      withTiming(0.32, { duration: 40 }),
      withTiming(0, { duration: 300 }),
    );
  }, [nonce, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: color.inkRed }, style]}
    />
  );
});

const WhiteFlash = memo(function WhiteFlash({
  nonce,
  at,
}: {
  nonce: number;
  at: BoardPoint | null;
}) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (nonce === 0 || !at) return;
    opacity.value = withSequence(
      withTiming(0.95, { duration: reduceMotion ? 0 : 40 }),
      withTiming(0.95, { duration: reduceMotion ? 0 : 70 }),
      withTiming(0, { duration: reduceMotion ? 0 : 420, easing: Easing.out(Easing.quad) }),
    );
  }, [at, nonce, opacity, reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  if (!at) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: at.x - 6,
          top: at.y - 6,
          width: BOARD_SIZE + 12,
          height: BOARD_SIZE + 12,
          backgroundColor: '#FFFBEF',
        },
        style,
      ]}
    />
  );
});

// ---------------------------------------------------------------------------
// Crosshair — four red arrows converging on the cell (IMG_9745)
// ---------------------------------------------------------------------------

const ARROW = 10;

const Crosshair = memo(function Crosshair({ crosshair }: { crosshair: CrosshairModel }) {
  const distance = useSharedValue(CELL * 0.95);
  useEffect(() => {
    distance.value = CELL * 0.95;
    distance.value = withTiming(CELL * 0.32, { duration: AIM_MS, easing: Easing.in(Easing.cubic) });
  }, [crosshair, distance]);

  const arrow = roughPolygon(
    [
      [ARROW / 2, 0],
      [ARROW, ARROW],
      [0, ARROW],
    ],
    {
      seed: hashString('aim-arrow'),
      stroke: color.inkRed,
      strokeWidth: 1.2,
      fill: color.inkRed,
      fillStyle: 'solid',
    },
  );
  const north = useAnimatedStyle(() => ({
    transform: [{ translateY: -distance.value }, { rotate: '180deg' }],
  }));
  const south = useAnimatedStyle(() => ({ transform: [{ translateY: distance.value }] }));
  const west = useAnimatedStyle(() => ({
    transform: [{ translateX: -distance.value }, { rotate: '90deg' }],
  }));
  const east = useAnimatedStyle(() => ({
    transform: [{ translateX: distance.value }, { rotate: '-90deg' }],
  }));

  const head = (
    <Svg width={ARROW} height={ARROW} viewBox={`0 0 ${ARROW} ${ARROW}`}>
      <RoughShape paths={arrow} />
    </Svg>
  );

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: crosshair.centre.x - ARROW / 2,
        top: crosshair.centre.y - ARROW / 2,
        width: ARROW,
        height: ARROW,
      }}
    >
      <Animated.View style={[styles.arrow, north]}>{head}</Animated.View>
      <Animated.View style={[styles.arrow, south]}>{head}</Animated.View>
      <Animated.View style={[styles.arrow, west]}>{head}</Animated.View>
      <Animated.View style={[styles.arrow, east]}>{head}</Animated.View>
    </View>
  );
});

// ---------------------------------------------------------------------------
// Aircraft — the plane's own frames, its shadow on the water, and the fall
// ---------------------------------------------------------------------------

/**
 * Per aircraft: its cell width on the canvas, and where the wings sit in the
 * cell (a fraction of its height, from scripts/battle-assets.sh) — the art
 * faces up and the wing line is the plane's centre, ahead of the cell's own
 * centre by (0.5 - wing) of its height. The double torpedo's two planes sit
 * ±PAIR of the width either side of the middle: one over each row it runs.
 */
const PLANES: Record<AircraftKind, { width: number; wing: number; shadow: 'single' | 'twin' | 'quad' }> = {
  torpedoBomber: { width: 62, wing: 0.335, shadow: 'single' },
  doubleTorpedoBomber: { width: 62, wing: 0.316, shadow: 'single' },
  bomber: { width: 72, wing: 0.37, shadow: 'twin' },
  atomicBomber: { width: 86, wing: 0.272, shadow: 'quad' },
};
const PAIR = 0.225;
/** The sun is high to the upper left: shadows fall down and to the right. */
const SHADOW_DX = 9;
const SHADOW_DY = 14;
const DROP_FRAMES_MS = 440;
/**
 * How far a downed plane drifts down the sheet as it falls — up it, over the
 * bottom rows, so the splash stays on the board.
 */
function fallOf(aircraft: AircraftModel): number {
  return aircraft.from.y > CANVAS_H - 110 ? -40 : 46;
}

function planeAt(aircraft: AircraftModel, p: number) {
  'worklet';
  return {
    x: aircraft.from.x + (aircraft.to.x - aircraft.from.x) * p,
    y: aircraft.from.y + (aircraft.to.y - aircraft.from.y) * p,
  };
}

function Shadow({
  aircraft,
  progress,
  crash,
  wobble,
  offset,
  width,
  source,
  aspect,
}: {
  aircraft: AircraftModel;
  progress: SharedValue<number>;
  crash: SharedValue<number>;
  wobble: SharedValue<number>;
  /** Across the flight line, canvas units (one of the double's pair). */
  offset: number;
  width: number;
  source: (typeof FX_ART)['shadows']['single']['source'];
  aspect: number;
}) {
  const dir = aircraft.to.x >= aircraft.from.x ? 1 : -1;
  const height = width / aspect;
  const fall = fallOf(aircraft);
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const c = crash.value;
    const at = planeAt(aircraft, p);
    // Coming down, the shadow closes on the plane.
    const x = at.x + dir * 34 * c + SHADOW_DX * (1 - c);
    const y = at.y + fall * c * c + SHADOW_DY * (1 - c) + offset;
    const fade = p < 0.08 ? p / 0.08 : p > 0.92 ? (1 - p) / 0.08 : 1;
    return {
      opacity: 0.3 * fade * (1 - c),
      transform: [
        { translateX: x - width / 2 },
        { translateY: y - height / 2 },
        { rotate: `${dir * 90 + (wobble.value - 0.5) * 2.4}deg` },
        { scale: 0.92 - 0.3 * c },
      ],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.abs, { width, height }, style]}>
      <Image source={source} style={StyleSheet.absoluteFill} contentFit="fill" />
    </Animated.View>
  );
}

const Aircraft = memo(function Aircraft({ aircraft }: { aircraft: AircraftModel }) {
  const reduceMotion = useReducedMotion();
  const plane = PLANES[aircraft.kind];
  const strip = FX_ART.aircraft[aircraft.kind];
  const width = plane.width;
  const height = width / strip.aspect;
  const dir = aircraft.to.x >= aircraft.from.x ? 1 : -1;
  const ahead = (0.5 - plane.wing) * height;
  const fall = fallOf(aircraft);
  const progress = useSharedValue(0);
  const crash = useSharedValue(0);
  const frame = useSharedValue(0);
  const wobble = useSharedValue(0.5);
  const crashed = useRef(false);

  useEffect(() => {
    progress.value = withTiming(1, { duration: reduceMotion ? 0 : aircraft.durationMs, easing: Easing.linear });
    if (aircraft.dropAtMs !== undefined) {
      frame.value = withDelay(
        aircraft.dropAtMs,
        withSequence(
          withTiming(1, { duration: 0 }),
          withTiming(5.999, { duration: DROP_FRAMES_MS, easing: Easing.linear }),
          withTiming(0, { duration: 0 }),
        ),
      );
    }
    if (!reduceMotion) wobble.value = withRepeat(withTiming(1, { duration: 520, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => {
      cancelAnimation(progress);
      cancelAnimation(frame);
      cancelAnimation(wobble);
    };
    // The run is planned once, when the plane is launched.
  }, []);

  // Shot down: it stops where it is, bursts, and spins into the sea.
  useEffect(() => {
    if (!aircraft.downed || crashed.current) return;
    crashed.current = true;
    const p = progress.value;
    cancelAnimation(progress);
    progress.value = p;
    cancelAnimation(frame);
    frame.value = 0;
    const at = planeAt(aircraft, p);
    const fx = useFx.getState();
    [
      { dx: -10, dy: -12, d: 0 },
      { dx: 12, dy: 6, d: 90 },
      { dx: -4, dy: 14, d: 170 },
    ].forEach((puff) =>
      fx.addSprite({ kind: 'explosionPuff', at: { x: at.x + puff.dx, y: at.y + puff.dy }, width: 24, durationMs: 420, delayMs: puff.d }),
    );
    fx.addSprite({ kind: 'explosionInk', at, width: 38, durationMs: 460, delayMs: 140 });
    fx.addSprite({ kind: 'smoke', at: { x: at.x + dir * 16, y: at.y + 20 }, width: 30, durationMs: 800, delayMs: 360, rise: 10 });
    fx.addSprite({
      kind: 'splash',
      at: { x: at.x + dir * 34, y: at.y + fall },
      width: 38,
      durationMs: 520,
      delayMs: CRASH_MS - 110,
      anchorY: 0.62,
    });
    crash.value = withTiming(1, { duration: reduceMotion ? 0 : CRASH_MS, easing: Easing.in(Easing.quad) });
  }, [aircraft, aircraft.downed, crash, dir, fall, frame, progress, reduceMotion]);

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const c = crash.value;
    const at = planeAt(aircraft, p);
    const x = at.x + dir * 34 * c - dir * ahead;
    const y = at.y + fall * c * c;
    const fade = p < 0.08 ? p / 0.08 : p > 0.92 ? (1 - p) / 0.08 : 1;
    return {
      opacity: fade * (c > 0.82 ? Math.max(0, 1 - (c - 0.82) / 0.18) : 1),
      transform: [
        { translateX: x - width / 2 },
        { translateY: y - height / 2 },
        { rotate: `${dir * 90 + (wobble.value - 0.5) * 2.4 + dir * 560 * c}deg` },
        { scale: 1 - 0.5 * c },
      ],
    };
  });

  const shadow = FX_ART.shadows[plane.shadow];
  const pair = aircraft.kind === 'doubleTorpedoBomber';
  return (
    <>
      {pair ? (
        <>
          <Shadow aircraft={aircraft} progress={progress} crash={crash} wobble={wobble} offset={-PAIR * width} width={width * 0.46} source={shadow.source} aspect={shadow.aspect} />
          <Shadow aircraft={aircraft} progress={progress} crash={crash} wobble={wobble} offset={PAIR * width} width={width * 0.46} source={shadow.source} aspect={shadow.aspect} />
        </>
      ) : (
        <Shadow aircraft={aircraft} progress={progress} crash={crash} wobble={wobble} offset={0} width={width * 0.9} source={shadow.source} aspect={shadow.aspect} />
      )}
      <Animated.View pointerEvents="none" style={[styles.abs, { width, height }, style]}>
        <SpriteStrip strip={strip} width={width} frame={frame} />
      </Animated.View>
    </>
  );
});

// ---------------------------------------------------------------------------
// Bomb — falls away from the eye onto its cell, then waits for its impact
// ---------------------------------------------------------------------------

const Bomb = memo(function Bomb({ bomb }: { bomb: BombModel }) {
  const strip = FX_ART.bomb;
  const width = bomb.kind === 'atomicBomber' ? 24 : 15;
  const frame = useFrameClock({ frames: strip.frames, durationMs: bomb.durationMs, reverse: true });
  const height = width / strip.aspect;
  return (
    <View pointerEvents="none" style={[styles.abs, { left: bomb.at.x - width / 2, top: bomb.at.y - height / 2, opacity: 0.85 }]}>
      <SpriteStrip strip={strip} width={width} frame={frame} />
    </View>
  );
});

// ---------------------------------------------------------------------------
// Torpedo — runs its path nose first, a wake and bubbles behind it
// ---------------------------------------------------------------------------

const TORPEDO_W = 18;
const TORPEDO_H = 8;
const BUBBLES = 6;

function pathAt(path: readonly BoardPoint[], p: number) {
  'worklet';
  const last = Math.max(0, path.length - 1);
  const position = Math.max(0, Math.min(1, p)) * last;
  const index = Math.min(last, Math.floor(position));
  const next = Math.min(last, index + 1);
  const mix = position - index;
  const a = path[index] ?? path[0] ?? { x: 0, y: 0 };
  const b = path[next] ?? a;
  return { x: a.x + (b.x - a.x) * mix, y: a.y + (b.y - a.y) * mix, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

function Bubble({ torpedo, progress, index }: { torpedo: TorpedoModel; progress: SharedValue<number>; index: number }) {
  const lag = (index + 1) * 0.035;
  const style = useAnimatedStyle(() => {
    const p = progress.value - lag;
    const at = pathAt(torpedo.path, p);
    const wiggle = index % 2 === 0 ? 2 : -2;
    return {
      opacity: p <= 0 || progress.value >= 1 ? 0 : 0.55 * (1 - index / BUBBLES),
      transform: [
        { translateX: at.x - 2 - Math.sin(at.angle) * wiggle },
        { translateY: at.y - 2 + Math.cos(at.angle) * wiggle },
        { scale: 1 + index * 0.18 },
      ],
    };
  });
  return (
    <Animated.View style={[styles.bubble, style]}>
      <Svg width={4} height={4} viewBox="0 0 4 4">
        <Circle cx={2} cy={2} r={1.5} fill="none" stroke="#FFFFFF" strokeWidth={0.9} />
      </Svg>
    </Animated.View>
  );
}

const Torpedo = memo(function Torpedo({ torpedo }: { torpedo: TorpedoModel }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, {
      duration: reduceMotion ? 0 : torpedo.durationMs,
      easing: Easing.bezier(0.3, 0, 0.6, 1),
    });
  }, [progress, reduceMotion, torpedo.durationMs]);
  const style = useAnimatedStyle(() => {
    const at = pathAt(torpedo.path, progress.value);
    return {
      transform: [
        { translateX: at.x - TORPEDO_W / 2 },
        { translateY: at.y - TORPEDO_H / 2 },
        { rotate: `${(at.angle * 180) / Math.PI}deg` },
      ],
    };
  });
  return (
    <>
      {Array.from({ length: BUBBLES }, (_, index) => (
        <Bubble key={index} torpedo={torpedo} progress={progress} index={index} />
      ))}
      <Animated.View pointerEvents="none" style={[styles.torpedo, style]}>
        <Svg width={TORPEDO_W} height={TORPEDO_H} viewBox={`0 0 ${TORPEDO_W} ${TORPEDO_H}`}>
          {/* The wake opens behind the tail; the body points along +x. */}
          <Line x1={0} y1={0.6} x2={6} y2={TORPEDO_H / 2} stroke="#FFFFFF" strokeWidth={1.1} opacity={0.9} />
          <Line x1={0} y1={TORPEDO_H - 0.6} x2={6} y2={TORPEDO_H / 2} stroke="#FFFFFF" strokeWidth={1.1} opacity={0.9} />
          <Path
            d={`M5 ${TORPEDO_H / 2 - 1.9} H14 Q17.6 ${TORPEDO_H / 2} 14 ${TORPEDO_H / 2 + 1.9} H5 Z`}
            fill={artColor.ink}
            stroke="#FFFFFF"
            strokeWidth={0.6}
          />
          <Rect x={4} y={TORPEDO_H / 2 - 2.6} width={1.6} height={5.2} fill={artColor.ink} />
        </Svg>
      </Animated.View>
    </>
  );
});

// ---------------------------------------------------------------------------
// Submarine — rises through its ripples, dives again when the attack ends
// ---------------------------------------------------------------------------

const SUB_W = 34;

const Submarine = memo(function Submarine({ submarine }: { submarine: SubmarineModel }) {
  const strip = FX_ART.submarine;
  const reduceMotion = useReducedMotion();
  const frame = useSharedValue(strip.frames - 0.001);
  useEffect(() => {
    frame.value = withTiming(0, { duration: reduceMotion ? 0 : 440, easing: Easing.out(Easing.quad) });
  }, [frame, reduceMotion, strip.frames]);
  useEffect(() => {
    if (!submarine.diving) return;
    frame.value = withTiming(strip.frames - 0.001, { duration: reduceMotion ? 0 : DIVE_MS, easing: Easing.in(Easing.quad) });
  }, [frame, reduceMotion, strip.frames, submarine.diving]);
  const height = SUB_W / strip.aspect;
  return (
    <View pointerEvents="none" style={[styles.abs, { left: submarine.at.x - SUB_W / 2, top: submarine.at.y - height / 2 }]}>
      <SpriteStrip strip={strip} width={SUB_W} frame={frame} />
    </View>
  );
});

// ---------------------------------------------------------------------------
// Radar — the scope sweeps over the 3x3, then the count
// ---------------------------------------------------------------------------

const SCOPE_W = 74;

const Radar = memo(function Radar({ radar }: { radar: RadarModel }) {
  const reduceMotion = useReducedMotion();
  const strip = FX_ART.radar;
  const frame = useFrameClock({ frames: strip.frames, durationMs: 560, loop: true });
  const scope = useSharedValue(0);
  const result = useSharedValue(0);
  const box = roughRect(1.5, 1.5, radar.box.w - 3, radar.box.h - 3, {
    seed: hashString(`radar-box-${radar.id}`),
    stroke: color.inkGreen,
    strokeWidth: 1.8,
    roughness: 1.1,
    fill: color.inkGreen,
    fillStyle: 'hachure',
    hachureGap: 5,
    fillWeight: 0.6,
  });
  useEffect(() => {
    result.value = withDelay(
      reduceMotion ? 0 : 900,
      withTiming(1, { duration: reduceMotion ? 0 : 200, easing: Easing.out(Easing.back(1.6)) }),
    );
    const out = Math.max(0, radar.durationMs - 260);
    scope.value = withSequence(
      withSpring(1, { damping: 12, stiffness: 180 }),
      withDelay(Math.max(0, out - 500), withTiming(0, { duration: 240 })),
    );
  }, [radar.durationMs, reduceMotion, result, scope]);
  const scopeStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, scope.value * 1.4),
    transform: [{ scale: 0.55 + 0.45 * scope.value }],
  }));
  const chipStyle = useAnimatedStyle(() => ({
    opacity: result.value,
    transform: [{ translateY: 6 * (1 - result.value) }, { scale: 0.85 + 0.15 * result.value }],
  }));
  const height = SCOPE_W / strip.aspect;
  const label = radar.count === 0 ? 'No ships here' : radar.count === 1 ? '1 ship cell' : `${radar.count} ship cells`;
  return (
    <View
      pointerEvents="none"
      style={[styles.abs, { left: radar.box.x, top: radar.box.y, width: radar.box.w, height: radar.box.h }]}
    >
      <Svg width={radar.box.w} height={radar.box.h} viewBox={`0 0 ${radar.box.w} ${radar.box.h}`} style={StyleSheet.absoluteFill}>
        <RoughShape paths={box} opacity={0.45} dash={[5, 3]} />
      </Svg>
      <Animated.View
        style={[styles.abs, { left: (radar.box.w - SCOPE_W) / 2, top: (radar.box.h - height) / 2 }, scopeStyle]}
      >
        <SpriteStrip strip={strip} width={SCOPE_W} frame={frame} />
      </Animated.View>
      <Animated.View style={[styles.radarChip, { left: radar.box.w / 2 - 56, top: -34 }, chipStyle]}>
        <Image source={BATTLE_ART.weaponRow} style={StyleSheet.absoluteFill} contentFit="fill" />
        <Text style={styles.radarText}>{label}</Text>
      </Animated.View>
    </View>
  );
});

// ---------------------------------------------------------------------------
// Stamp — a red word pressed onto the board
// ---------------------------------------------------------------------------

const Stamp = memo(function Stamp({ stamp }: { stamp: StampModel }) {
  const press = useSharedValue(0);
  useEffect(() => {
    press.value = withSpring(1, { damping: 9, stiffness: 240 });
  }, [press]);
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, press.value * 2),
    transform: [{ scale: 1.6 - 0.6 * press.value }, { rotate: '-5deg' }],
  }));
  const tone = stamp.tone === 'red' ? artColor.red : artColor.green;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.stamp, { left: stamp.at.x - 58, top: stamp.at.y - 44, borderColor: tone }, style]}
    >
      <Text style={[styles.stampText, { color: tone }]}>{stamp.text}</Text>
    </Animated.View>
  );
});

// ---------------------------------------------------------------------------
// PendingMark
// ---------------------------------------------------------------------------

/**
 * Online only: the shell has landed and the server hasn't answered yet. A
 * small ink "…" on the target cell — never a guessed hit or miss (P13).
 * Pulses gently so a slow round trip reads as waiting, not as frozen.
 */
const PendingMark = memo(function PendingMark({ at }: { at: CrosshairModel }) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(0.35);
  useEffect(() => {
    opacity.value = reduceMotion
      ? 1
      : withRepeat(withSequence(withTiming(1, { duration: 420 }), withTiming(0.35, { duration: 420 })), -1, false);
  }, [opacity, reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.pendingMark,
        { left: at.centre.x - CELL / 2, top: at.centre.y - CELL / 2 },
        style,
      ]}
    >
      <Text style={styles.pendingText}>…</Text>
    </Animated.View>
  );
});

// ---------------------------------------------------------------------------
// FxLayer
// ---------------------------------------------------------------------------

export function FxLayer() {
  const shells = useFx((s) => s.shells);
  const sprites = useFx((s) => s.sprites);
  const aircraft = useFx((s) => s.aircraft);
  const bombs = useFx((s) => s.bombs);
  const torpedoes = useFx((s) => s.torpedoes);
  const submarines = useFx((s) => s.submarines);
  const radars = useFx((s) => s.radars);
  const stamps = useFx((s) => s.stamps);
  const crosshair = useFx((s) => s.crosshair);
  const pendingShot = useFx((s) => s.pendingShot);
  const flashNonce = useFx((s) => s.flashNonce);
  const whiteFlashNonce = useFx((s) => s.whiteFlashNonce);
  const whiteFlashAt = useFx((s) => s.whiteFlashAt);
  // Planes fly above everything else in the sky; the atomic cloud rises over them.
  const [under, over] = splitSprites(sprites);
  return (
    <View pointerEvents="none" style={styles.canvas}>
      <Flash nonce={flashNonce} />
      {submarines.map((submarine) => (
        <Submarine key={submarine.id} submarine={submarine} />
      ))}
      {torpedoes.map((torpedo) => (
        <Torpedo key={torpedo.id} torpedo={torpedo} />
      ))}
      {bombs.map((bomb) => (
        <Bomb key={bomb.id} bomb={bomb} />
      ))}
      {under.map((sprite) => (
        <SpriteEffect key={sprite.id} sprite={sprite} />
      ))}
      {radars.map((radar) => (
        <Radar key={radar.id} radar={radar} />
      ))}
      {shells.map((shell) => (
        <Shell key={shell.id} shell={shell} />
      ))}
      {aircraft.map((item) => (
        <Aircraft key={item.id} aircraft={item} />
      ))}
      <WhiteFlash nonce={whiteFlashNonce} at={whiteFlashAt} />
      {over.map((sprite) => (
        <SpriteEffect key={sprite.id} sprite={sprite} />
      ))}
      {stamps.map((stamp) => (
        <Stamp key={stamp.id} stamp={stamp} />
      ))}
      {crosshair ? <Crosshair crosshair={crosshair} /> : null}
      {pendingShot ? <PendingMark at={pendingShot} /> : null}
    </View>
  );
}

function splitSprites(sprites: readonly SpriteModel[]): [SpriteModel[], SpriteModel[]] {
  const under: SpriteModel[] = [];
  const over: SpriteModel[] = [];
  for (const sprite of sprites) {
    if (sprite.kind === 'explosionAtomic' || sprite.kind === 'smokeAtomic' || sprite.kind === 'explosionPuff') {
      over.push(sprite);
    } else {
      under.push(sprite);
    }
  }
  return [under, over];
}

const styles = StyleSheet.create({
  canvas: { position: 'absolute', left: 0, top: 0, width: CANVAS_W, height: CANVAS_H },
  abs: { position: 'absolute', left: 0, top: 0 },
  shell: { position: 'absolute', left: 0, top: 0, width: SHELL, height: SHELL },
  trailDot: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 4,
    height: 4,
    backgroundColor: artColor.soft,
    transform: [{ rotate: '45deg' }],
  },
  arrow: { position: 'absolute', left: 0, top: 0, width: ARROW, height: ARROW },
  torpedo: { position: 'absolute', left: 0, top: 0, width: TORPEDO_W, height: TORPEDO_H },
  bubble: { position: 'absolute', left: 0, top: 0, width: 4, height: 4 },
  pendingMark: {
    position: 'absolute',
    width: CELL,
    height: CELL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingText: {
    color: artColor.ink,
    fontFamily: font.display,
    fontSize: 20,
    lineHeight: 20,
    marginTop: -6,
  },
  radarChip: {
    position: 'absolute',
    width: 112,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarText: { color: artColor.green, fontFamily: font.display, fontSize: 13 },
  stamp: {
    position: 'absolute',
    width: 116,
    height: 30,
    borderWidth: 2,
    backgroundColor: 'rgba(255, 252, 244, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stampText: { fontFamily: font.display, fontSize: 15 },
});
