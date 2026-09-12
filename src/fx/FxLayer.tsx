/**
 * Renders what the battle effects put in the fx store: the shell in flight
 * with its dotted trail, hit/miss/mine bursts, the mine flash, the converging
 * crosshair. Every visual is its own leaf with its own Reanimated values —
 * the boards underneath never animate because of these.
 */
import { Image } from 'expo-image';
import { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';

import { BOARD_SIZE, CELL, type Point as BoardPoint } from '@/board/layout';
import { FX } from '@/ui/assets';
import { CANVAS_H, CANVAS_W, color, font, type as typeScale } from '@/ui/tokens';
import {
  RoughShape,
  hashString,
  roughCircle,
  roughLine,
  roughPolygon,
  roughRect,
  type PathInfo,
  type Point as RoughPoint,
} from '@/ui/useRough';
import { AIM_MS } from '@/state/battle';
import {
  useFx,
  type Aircraft as AircraftModel,
  type Bomb as BombModel,
  type Burst as BurstModel,
  type Crosshair as CrosshairModel,
  type InterceptFx as InterceptModel,
  type RadarFx as RadarModel,
  type Shell as ShellModel,
  type SubmarineFx as SubmarineModel,
  type TorpedoTrack as TorpedoModel,
} from './fxStore';

// ---------------------------------------------------------------------------
// Shell — arcs from the firing board to the target with a dotted trail
// ---------------------------------------------------------------------------

const SHELL_SIZE = 12;
const ARC_HEIGHT = 44;

const Shell = memo(function Shell({ shell }: { shell: ShellModel }) {
  const progress = useSharedValue(0);
  const trail = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, {
      duration: shell.durationMs,
      easing: Easing.inOut(Easing.quad),
    });
    trail.value = withSequence(
      withTiming(0.55, { duration: shell.durationMs * 0.6 }),
      withTiming(0, { duration: shell.durationMs * 0.4 }),
    );
  }, [shell, progress, trail]);

  const dot = useAnimatedStyle(() => {
    const p = progress.value;
    const x = shell.from.x + (shell.to.x - shell.from.x) * p;
    const y = shell.from.y + (shell.to.y - shell.from.y) * p - ARC_HEIGHT * Math.sin(Math.PI * p);
    return {
      transform: [
        { translateX: x - SHELL_SIZE / 2 },
        { translateY: y - SHELL_SIZE / 2 },
        { scale: 0.8 + 0.5 * Math.sin(Math.PI * p) },
      ],
    };
  });
  const trailStyle = useAnimatedStyle(() => ({ opacity: trail.value }));

  const paths = roughCircle(SHELL_SIZE / 2, SHELL_SIZE / 2, 7, {
    seed: hashString('shell'),
    stroke: color.ink,
    strokeWidth: 1.2,
    fill: color.ink,
    fillStyle: 'solid',
  });

  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, trailStyle]} pointerEvents="none">
        <Svg width={CANVAS_W} height={CANVAS_H} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}>
          <Line
            x1={shell.from.x}
            y1={shell.from.y}
            x2={shell.to.x}
            y2={shell.to.y}
            stroke={color.inkFaint}
            strokeWidth={1.4}
            strokeDasharray={[2, 5]}
            strokeLinecap="round"
          />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.shell, dot]} pointerEvents="none">
        <Svg width={SHELL_SIZE} height={SHELL_SIZE} viewBox={`0 0 ${SHELL_SIZE} ${SHELL_SIZE}`}>
          <RoughShape paths={paths} />
        </Svg>
      </Animated.View>
    </>
  );
});

// ---------------------------------------------------------------------------
// Bursts — explosion, splash, mine
// ---------------------------------------------------------------------------

const BURST = 44;
const BC = BURST / 2;

function burstPaths(kind: BurstModel['kind'], seed: number): (readonly PathInfo[])[] {
  const layers: (readonly PathInfo[])[] = [];
  if (kind === 'miss') {
    for (const [d, tint] of [
      [10, color.ink],
      [20, color.inkSoft],
      [30, color.inkFaint],
    ] as const) {
      layers.push(
        roughCircle(BC, BC, d, { seed: seed + d, stroke: tint, strokeWidth: 1.2, roughness: 1.6 }),
      );
    }
    return layers;
  }
  const tint = kind === 'mine' ? color.inkRed : color.ink;
  const blob: RoughPoint[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (Math.PI * 2 * k) / 8;
    const r = 4 + ((seed >> k) % 3);
    blob.push([BC + Math.cos(a) * r, BC + Math.sin(a) * r]);
  }
  layers.push(
    roughPolygon(blob, {
      seed,
      stroke: tint,
      strokeWidth: 1.2,
      fill: tint,
      fillStyle: 'solid',
      roughness: 1.4,
    }),
  );
  for (let k = 0; k < 8; k++) {
    const a = (Math.PI * 2 * k) / 8 + 0.2;
    const inner = 7 + (k % 2) * 2;
    const outer = 15 + ((seed >> (k + 3)) % 6);
    layers.push(
      roughLine(
        BC + Math.cos(a) * inner,
        BC + Math.sin(a) * inner,
        BC + Math.cos(a) * outer,
        BC + Math.sin(a) * outer,
        {
          seed: seed + 10 + k,
          stroke: k % 3 === 0 ? color.inkRed : tint,
          strokeWidth: 1.4,
        },
      ),
    );
  }
  return layers;
}

const Burst = memo(function Burst({ burst }: { burst: BurstModel }) {
  const scale = useSharedValue(0.3);
  const opacity = useSharedValue(1);
  const ms = burst.kind === 'miss' ? 260 : 320;
  useEffect(() => {
    scale.value = withTiming(burst.kind === 'miss' ? 1.15 : 1.3, {
      duration: ms,
      easing: Easing.out(Easing.cubic),
    });
    opacity.value = withSequence(
      withTiming(1, { duration: ms * 0.4 }),
      withTiming(0, { duration: ms * 0.6 }),
    );
  }, [burst, ms, scale, opacity]);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  const layers = burstPaths(
    burst.kind,
    hashString(`burst-${burst.kind}-${Math.round(burst.at.x)}-${Math.round(burst.at.y)}`),
  );
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: burst.at.x - BC,
          top: burst.at.y - BC,
          width: BURST,
          height: BURST,
        },
        style,
      ]}
    >
      <Svg width={BURST} height={BURST} viewBox={`0 0 ${BURST} ${BURST}`}>
        {layers.map((paths, i) => (
          <RoughShape key={i} paths={paths} />
        ))}
      </Svg>
    </Animated.View>
  );
});

// ---------------------------------------------------------------------------
// Flash — the mine's red wash over the boards
// ---------------------------------------------------------------------------

const Flash = memo(function Flash({ nonce }: { nonce: number }) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (nonce === 0) return;
    opacity.value = withSequence(
      withTiming(0.35, { duration: 40 }),
      withTiming(0, { duration: 260 }),
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

// ---------------------------------------------------------------------------
// Crosshair — four red arrows converging on the cell (IMG_9745)
// ---------------------------------------------------------------------------

const ARROW = 10;

const Crosshair = memo(function Crosshair({ crosshair }: { crosshair: CrosshairModel }) {
  const distance = useSharedValue(CELL * 0.95);
  useEffect(() => {
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
// Arsenal set pieces — aircraft, ordnance, torpedoes, radar and AA intercept
// ---------------------------------------------------------------------------

const PLANE_W = 66;
const PLANE_H = 38;

function PlaneArt({ aircraft, downed }: { aircraft: AircraftModel; downed: boolean }) {
  const source = downed
    ? FX.planeDowned
    : aircraft.kind === 'atomicBomber'
      ? FX.planeAtomic
      : aircraft.kind === 'torpedoBomber' || aircraft.kind === 'doubleTorpedoBomber'
        ? FX.planeTorpedo
        : FX.planeBomber;
  if (source) {
    return (
      <Image
        source={source}
        style={{ width: PLANE_W, height: PLANE_H }}
        contentFit="contain"
        tintColor={color.ink}
        cachePolicy="memory-disk"
      />
    );
  }
  const seed = hashString(`fx-plane-${aircraft.kind}`);
  const body = roughPolygon(
    [
      [2, 20],
      [24, 17],
      [34, 2],
      [40, 3],
      [38, 17],
      [63, 19],
      [64, 23],
      [38, 24],
      [41, 36],
      [35, 37],
      [24, 25],
      [2, 23],
    ],
    {
      seed,
      stroke: color.ink,
      strokeWidth: 1.6,
      fill: color.inkSoft,
      fillStyle: 'hachure',
      hachureGap: 2.4,
      fillWeight: 1,
    },
  );
  return (
    <Svg width={PLANE_W} height={PLANE_H} viewBox={`0 0 ${PLANE_W} ${PLANE_H}`}>
      <RoughShape paths={body} />
    </Svg>
  );
}

const Aircraft = memo(function Aircraft({ aircraft }: { aircraft: AircraftModel }) {
  const reduceMotion = useReducedMotion();
  const flight = useSharedValue(0);
  const crash = useSharedValue(0);
  useEffect(() => {
    flight.value = withTiming(1, {
      duration: reduceMotion ? 0 : aircraft.durationMs,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [aircraft.durationMs, flight, reduceMotion]);
  useEffect(() => {
    if (!aircraft.downedAt) return;
    crash.value = withTiming(1, {
      duration: reduceMotion ? 0 : 760,
      easing: Easing.in(Easing.cubic),
    });
  }, [aircraft.downedAt, crash, reduceMotion]);
  const style = useAnimatedStyle(() => {
    const down = crash.value;
    const flightX = aircraft.from.x + (aircraft.to.x - aircraft.from.x) * flight.value;
    const flightY = aircraft.from.y + (aircraft.to.y - aircraft.from.y) * flight.value;
    const crashX = aircraft.downedAt
      ? aircraft.downedAt.x + Math.sin(down * Math.PI * 3) * 30 * down
      : flightX;
    const crashY = aircraft.downedAt ? aircraft.downedAt.y + down * 105 : flightY;
    return {
      opacity: down > 0.86 ? Math.max(0, 1 - (down - 0.86) / 0.14) : 1,
      transform: [
        { translateX: (down > 0 ? crashX : flightX) - PLANE_W / 2 },
        { translateY: (down > 0 ? crashY : flightY) - PLANE_H / 2 },
        { rotate: `${(aircraft.from.x > aircraft.to.x ? 180 : 0) + down * 620}deg` },
        { scale: 1 - down * 0.45 },
      ],
    };
  });
  const smoke = roughCircle(7, 7, 10, {
    seed: hashString(`plane-smoke-${aircraft.id}`),
    stroke: color.inkSoft,
    strokeWidth: 1,
    fill: color.inkSoft,
    fillStyle: 'hachure',
    hachureGap: 2,
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.aircraft, style]}>
      {aircraft.downedAt ? (
        <View style={styles.smokeTrail}>
          {[0, 1, 2].map((index) => (
            <Svg
              key={index}
              width={14}
              height={14}
              viewBox="0 0 14 14"
              style={{
                position: 'absolute',
                left: -4 - index * 8,
                top: 11 + index * 2,
                opacity: 0.7 - index * 0.18,
              }}
            >
              <RoughShape paths={smoke} />
            </Svg>
          ))}
        </View>
      ) : null}
      <PlaneArt aircraft={aircraft} downed={Boolean(aircraft.downedAt)} />
    </Animated.View>
  );
});

const Bomb = memo(function Bomb({ bomb }: { bomb: BombModel }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, {
      duration: reduceMotion ? 0 : bomb.durationMs,
      easing: Easing.in(Easing.cubic),
    });
  }, [bomb.durationMs, progress, reduceMotion]);
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const x = bomb.from.x + (bomb.to.x - bomb.from.x) * p;
    const y = bomb.from.y + (bomb.to.y - bomb.from.y) * p - Math.sin(Math.PI * p) * 22;
    return {
      opacity: p > 0.92 ? (1 - p) / 0.08 : 1,
      transform: [
        { translateX: x - 7 },
        { translateY: y - 10 },
        { rotate: `${p * 160}deg` },
        { scale: bomb.kind === 'atomicBomber' ? 1.6 : 1 },
      ],
    };
  });
  const shape = roughPolygon(
    [
      [7, 1],
      [12, 7],
      [10, 17],
      [7, 20],
      [4, 17],
      [2, 7],
    ],
    {
      seed: hashString(`bomb-${bomb.id}`),
      stroke: color.inkRed,
      strokeWidth: 1.2,
      fill: color.inkRed,
      fillStyle: 'solid',
    },
  );
  return (
    <Animated.View pointerEvents="none" style={[styles.bomb, style]}>
      <Svg width={14} height={21} viewBox="0 0 14 21">
        <RoughShape paths={shape} />
      </Svg>
    </Animated.View>
  );
});

const Torpedo = memo(function Torpedo({ torpedo }: { torpedo: TorpedoModel }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, {
      duration: reduceMotion ? 0 : torpedo.durationMs,
      easing: Easing.inOut(Easing.quad),
    });
  }, [progress, reduceMotion, torpedo.durationMs]);
  const style = useAnimatedStyle(() => {
    const last = Math.max(0, torpedo.path.length - 1);
    const position = progress.value * last;
    const index = Math.min(last, Math.floor(position));
    const next = Math.min(last, index + 1);
    const mix = position - index;
    const a = torpedo.path[index] ?? torpedo.path[0] ?? { x: 0, y: 0 };
    const b = torpedo.path[next] ?? a;
    const x = a.x + (b.x - a.x) * mix;
    const y = a.y + (b.y - a.y) * mix;
    const angle = Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
    return {
      transform: [{ translateX: x - 8 }, { translateY: y - 3 }, { rotate: `${angle}deg` }],
    };
  });
  const body = roughRect(1, 1, 14, 5, {
    seed: hashString(`torpedo-${torpedo.id}`),
    stroke: color.inkRed,
    strokeWidth: 1,
    fill: color.inkRed,
    fillStyle: 'solid',
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.torpedo, style]}>
      <Svg width={16} height={7} viewBox="0 0 16 7">
        <RoughShape paths={body} />
      </Svg>
    </Animated.View>
  );
});

const Submarine = memo(function Submarine({ submarine }: { submarine: SubmarineModel }) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(0.25);
  const opacity = useSharedValue(0);
  useEffect(() => {
    scale.value = withTiming(1, {
      duration: reduceMotion ? 0 : 220,
      easing: Easing.out(Easing.cubic),
    });
    opacity.value = withTiming(1, { duration: reduceMotion ? 0 : 150 });
  }, [opacity, reduceMotion, scale]);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  const hull = roughPolygon(
    [
      [1, 14],
      [8, 7],
      [32, 7],
      [39, 14],
      [32, 20],
      [8, 20],
    ],
    {
      seed: hashString(`surface-${submarine.id}`),
      stroke: color.ink,
      strokeWidth: 1.4,
      fill: color.inkSoft,
      fillStyle: 'hachure',
      hachureGap: 2.2,
    },
  );
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: submarine.at.x - 20,
          top: submarine.at.y - 14,
          width: 40,
          height: 28,
        },
        style,
      ]}
    >
      <Svg width={40} height={28} viewBox="0 0 40 28">
        <RoughShape paths={hull} />
      </Svg>
    </Animated.View>
  );
});

const Radar = memo(function Radar({ radar }: { radar: RadarModel }) {
  const reduceMotion = useReducedMotion();
  const sweep = useSharedValue(0);
  const result = useSharedValue(0);
  useEffect(() => {
    sweep.value = withTiming(1, {
      duration: reduceMotion ? 0 : 520,
      easing: Easing.inOut(Easing.cubic),
    });
    result.value = withDelay(
      reduceMotion ? 0 : 520,
      withTiming(1, { duration: reduceMotion ? 0 : 150, easing: Easing.out(Easing.cubic) }),
    );
  }, [reduceMotion, result, sweep]);
  const line = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-80 + sweep.value * 340}deg` }],
  }));
  const chip = useAnimatedStyle(() => ({
    opacity: result.value,
    transform: [{ translateY: 4 * (1 - result.value) }],
  }));
  const rings = [0.32, 0.62, 0.94].map((fraction, index) =>
    roughCircle(radar.box.w / 2, radar.box.h / 2, Math.min(radar.box.w, radar.box.h) * fraction, {
      seed: hashString(`radar-${radar.id}-${index}`),
      stroke: color.inkGreen,
      strokeWidth: 1,
    }),
  );
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: radar.box.x,
        top: radar.box.y,
        width: radar.box.w,
        height: radar.box.h,
      }}
    >
      <Svg width={radar.box.w} height={radar.box.h} viewBox={`0 0 ${radar.box.w} ${radar.box.h}`}>
        {rings.map((paths, index) => (
          <RoughShape key={index} paths={paths} opacity={0.72} />
        ))}
      </Svg>
      <Animated.View
        style={[
          styles.radarLine,
          {
            left: radar.box.w / 2,
            top: radar.box.h / 2 - 1,
            width: Math.max(radar.box.w, radar.box.h) * 0.48,
          },
          line,
        ]}
      />
      <Animated.View
        style={[styles.radarChip, { left: radar.at.x - radar.box.x - 44, top: -28 }, chip]}
      >
        <Text style={styles.radarText}>{radar.count} cells</Text>
      </Animated.View>
    </View>
  );
});

const Intercept = memo(function Intercept({ intercept }: { intercept: InterceptModel }) {
  const reduceMotion = useReducedMotion();
  const flash = useSharedValue(0);
  const reveal = useSharedValue(intercept.revealed ? 1 : 0);
  useEffect(() => {
    flash.value = withSequence(
      withTiming(1, { duration: reduceMotion ? 0 : 100 }),
      withTiming(0.2, { duration: reduceMotion ? 0 : 300 }),
    );
  }, [flash, reduceMotion]);
  useEffect(() => {
    if (intercept.revealed) {
      reveal.value = withTiming(1, {
        duration: reduceMotion ? 0 : 150,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [intercept.revealed, reduceMotion, reveal]);
  const rays = useAnimatedStyle(() => ({
    opacity: flash.value,
    transform: [{ scale: 0.7 + flash.value * 0.6 }],
  }));
  const label = useAnimatedStyle(() => ({
    opacity: 1 - reveal.value * 0.15,
    transform: [{ scale: 1 + reveal.value * 0.04 }],
  }));
  const rayPaths = Array.from({ length: 8 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 8;
    return roughLine(
      24 + Math.cos(angle) * 10,
      24 + Math.sin(angle) * 10,
      24 + Math.cos(angle) * 22,
      24 + Math.sin(angle) * 22,
      {
        seed: hashString(`aa-ray-${intercept.id}-${index}`),
        stroke: color.inkRed,
        strokeWidth: 2,
      },
    );
  });
  return (
    <View
      pointerEvents="none"
      style={[styles.intercept, { left: intercept.at.x - 70, top: intercept.at.y - 45 }]}
    >
      <Animated.View
        style={[{ position: 'absolute', left: 46, top: 20, width: 48, height: 48 }, rays]}
      >
        <Svg width={48} height={48} viewBox="0 0 48 48">
          {rayPaths.map((paths, index) => (
            <RoughShape key={index} paths={paths} />
          ))}
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.shotDownStamp, label]}>
        <Text style={styles.shotDownText}>
          {intercept.revealed ? 'AA gun revealed' : 'Plane shot down!'}
        </Text>
      </Animated.View>
    </View>
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
      withTiming(0.96, { duration: reduceMotion ? 0 : 30 }),
      withTiming(0, { duration: reduceMotion ? 0 : 60 }),
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
          left: at.x,
          top: at.y,
          width: BOARD_SIZE,
          height: BOARD_SIZE,
          backgroundColor: color.paper,
        },
        style,
      ]}
    />
  );
});

// ---------------------------------------------------------------------------
// FxLayer
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

export function FxLayer() {
  const shells = useFx((s) => s.shells);
  const bursts = useFx((s) => s.bursts);
  const aircraft = useFx((s) => s.aircraft);
  const bombs = useFx((s) => s.bombs);
  const torpedoes = useFx((s) => s.torpedoes);
  const submarines = useFx((s) => s.submarines);
  const radars = useFx((s) => s.radars);
  const intercepts = useFx((s) => s.intercepts);
  const crosshair = useFx((s) => s.crosshair);
  const pendingShot = useFx((s) => s.pendingShot);
  const flashNonce = useFx((s) => s.flashNonce);
  const whiteFlashNonce = useFx((s) => s.whiteFlashNonce);
  const whiteFlashAt = useFx((s) => s.whiteFlashAt);
  return (
    <View pointerEvents="none" style={styles.canvas}>
      <Flash nonce={flashNonce} />
      <WhiteFlash nonce={whiteFlashNonce} at={whiteFlashAt} />
      {shells.map((shell) => (
        <Shell key={shell.id} shell={shell} />
      ))}
      {aircraft.map((item) => (
        <Aircraft key={item.id} aircraft={item} />
      ))}
      {bombs.map((bomb) => (
        <Bomb key={bomb.id} bomb={bomb} />
      ))}
      {torpedoes.map((torpedo) => (
        <Torpedo key={torpedo.id} torpedo={torpedo} />
      ))}
      {submarines.map((submarine) => (
        <Submarine key={submarine.id} submarine={submarine} />
      ))}
      {radars.map((radar) => (
        <Radar key={radar.id} radar={radar} />
      ))}
      {intercepts.map((intercept) => (
        <Intercept key={intercept.id} intercept={intercept} />
      ))}
      {bursts.map((burst) => (
        <Burst key={burst.id} burst={burst} />
      ))}
      {crosshair ? <Crosshair crosshair={crosshair} /> : null}
      {pendingShot ? <PendingMark at={pendingShot} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { position: 'absolute', left: 0, top: 0, width: CANVAS_W, height: CANVAS_H },
  shell: { position: 'absolute', left: 0, top: 0, width: SHELL_SIZE, height: SHELL_SIZE },
  arrow: { position: 'absolute', left: 0, top: 0, width: ARROW, height: ARROW },
  pendingMark: {
    position: 'absolute',
    width: CELL,
    height: CELL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingText: {
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.md,
    lineHeight: typeScale.md,
    marginTop: -6,
  },
  aircraft: { position: 'absolute', left: 0, top: 0, width: PLANE_W, height: PLANE_H },
  smokeTrail: { position: 'absolute', left: 2, top: 0, width: 30, height: PLANE_H },
  bomb: { position: 'absolute', left: 0, top: 0, width: 14, height: 21 },
  torpedo: { position: 'absolute', left: 0, top: 0, width: 16, height: 7 },
  radarLine: {
    position: 'absolute',
    height: 2,
    backgroundColor: color.inkGreen,
    transformOrigin: 'left center',
  },
  radarChip: {
    position: 'absolute',
    minWidth: 88,
    height: 28,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.paper,
    borderWidth: 1.4,
    borderColor: color.inkGreen,
  },
  radarText: {
    color: color.inkGreen,
    fontFamily: font.display,
    fontSize: typeScale.sm,
    fontVariant: ['tabular-nums'],
  },
  intercept: { position: 'absolute', width: 140, height: 90 },
  shotDownStamp: {
    position: 'absolute',
    left: 0,
    top: 0,
    minWidth: 140,
    height: 28,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.paper,
    borderWidth: 2,
    borderColor: color.inkRed,
    transform: [{ rotate: '-3deg' }],
  },
  shotDownText: { color: color.inkRed, fontFamily: font.display, fontSize: typeScale.sm },
});
