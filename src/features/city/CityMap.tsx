/**
 * The explorable harbour: the map, the fifteen buildings, their ribbons and
 * the selection marks, all in map pixels inside ONE view that one transform
 * puts on screen (cityLayout.ts). It fills the window, not the 800 x 360
 * canvas — the map is the page — so the gestures sit on an untransformed,
 * full-window view and every touch arrives in plain window dp: no canvas-scale
 * maths to get wrong.
 *
 * Gestures (react-native-gesture-handler + Reanimated, all on the UI thread):
 * - one-finger pan, clamped at the map's edges, released into a short
 *   withDecay glide (none under reduced motion);
 * - pinch, clamped to ZOOM.min..max, zooming about the fingers;
 * - tap, raced against both: a finger that moves far enough to pan is never a
 *   tap, so dragging across a building cannot select it. A tap that lands
 *   during a glide only stops the glide. Taps are hit-tested against the
 *   layout's boxes, front-most first, and handed to JS as a building index.
 *
 * A selected building lifts from its ground line (180 ms) and gains a violet
 * pen outline: its own silhouette, tinted, drawn just outside it.
 *
 * Nothing here re-renders while the map moves: offset and scale are shared
 * values and the transform is an animated style. React renders again only
 * when the selection changes, and then only the two buildings involved.
 */
import { Image } from 'expo-image';
import { forwardRef, memo, useEffect, useImperativeHandle, type Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { CITY_ART } from '@/ui/assets';
import { cityColor } from '@/ui/tokens';

import {
  BUILDINGS,
  HARBOUR_RIBBON,
  HIT_BOXES,
  INITIAL_FOCUS,
  MAP,
  ZOOM,
  clamp,
  coverScale,
  hitTest,
  offsetFor,
  offsetRange,
  zoomAbout,
  type Building,
} from './cityLayout';

/** Press feedback on the building: up and settle, 180 ms. */
const LIFT = { peak: 1.07, rest: 1.035, upMs: 70, settleMs: 110, dropMs: 150 } as const;
/** The violet outline round a selected building arrives in 200 ms. */
const MARK_MS = 200;
/**
 * The outline: the building's own silhouette, tinted ink, drawn a few map px
 * out in eight directions behind it — a pen line round exactly its shape.
 */
const OUTLINE_PX = 4.5;
const OUTLINE_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-0.71, -0.71],
  [0.71, -0.71],
  [-0.71, 0.71],
  [0.71, 0.71],
];
/** How far past the opening frame the entrance starts. */
const ENTER_ZOOM = 1.06;
/** Glide friction after a flick (Reanimated's default 0.998 slides too far). */
const DECELERATION = 0.994;
const RECENTRE_MS = 360;
/** A selected building lower than this (fraction of the window) is eased up, clear of the card. */
const CARD_TOP = 0.66;
const CARD_SPAN = [0.26, 0.74] as const;

const ease = Easing.out(Easing.cubic);

export interface CityMapHandle {
  /** Settle from just past the opening frame onto it. */
  enter(durationMs: number): void;
  /** Ease back to the opening frame (the compass). */
  recentre(): void;
}

export interface CityMapProps {
  /** The window, dp — what the map has to cover. */
  width: number;
  height: number;
  interactive: boolean;
  selectedIndex: number;
  /** Bumped on every tap of a building, so a repeat tap still answers. */
  tapCount: number;
  reduceMotion: boolean;
  onTap: (index: number) => void;
  onGesture: (kind: 'pan' | 'pinch', active: boolean) => void;
  /** The map image is on screen. */
  onMapShown: () => void;
}

export const CityMap = forwardRef(function CityMap(
  {
    width,
    height,
    interactive,
    selectedIndex,
    tapCount,
    reduceMotion,
    onTap,
    onGesture,
    onMapShown,
  }: CityMapProps,
  ref: Ref<CityMapHandle>,
) {
  const base0 = coverScale(width, height);
  const start = base0 * ZOOM.initial * (reduceMotion ? 1 : ENTER_ZOOM);
  const startAt = offsetFor(INITIAL_FOCUS, start, width, height);

  const vw = useSharedValue(width);
  const vh = useSharedValue(height);
  const base = useSharedValue(base0);
  const scale = useSharedValue(start);
  const ox = useSharedValue(startAt.x);
  const oy = useSharedValue(startAt.y);
  const reduced = useSharedValue(reduceMotion ? 1 : 0);

  const panFromX = useSharedValue(0);
  const panFromY = useSharedValue(0);
  const pinchFrom = useSharedValue(1);
  const anchorX = useSharedValue(0);
  const anchorY = useSharedValue(0);
  /** Decays still running (x and y each count one). */
  const gliding = useSharedValue(0);
  /** The current touch came down on a gliding map: it stops it, nothing more. */
  const caught = useSharedValue(0);

  useEffect(() => {
    reduced.value = reduceMotion ? 1 : 0;
  }, [reduceMotion, reduced]);

  // A resize (split screen, a fold) keeps the zoom and the point at the centre.
  useEffect(() => {
    if (vw.value === width && vh.value === height) return;
    const zoom = scale.value / base.value;
    const centre = {
      x: (vw.value / 2 - ox.value) / scale.value,
      y: (vh.value / 2 - oy.value) / scale.value,
    };
    const nextBase = coverScale(width, height);
    const next = nextBase * clamp(zoom, ZOOM.min, ZOOM.max);
    const at = offsetFor(centre, next, width, height);
    cancelAnimation(scale);
    cancelAnimation(ox);
    cancelAnimation(oy);
    vw.value = width;
    vh.value = height;
    base.value = nextBase;
    scale.value = next;
    ox.value = at.x;
    oy.value = at.y;
  }, [width, height, base, ox, oy, scale, vh, vw]);

  const frameTo = (focus: { x: number; y: number }, zoom: number, duration: number) => {
    const s = base.value * zoom;
    const at = offsetFor(focus, s, vw.value, vh.value);
    const timing = { duration, easing: ease };
    gliding.value = 0;
    scale.value = duration > 0 ? withTiming(s, timing) : s;
    ox.value = duration > 0 ? withTiming(at.x, timing) : at.x;
    oy.value = duration > 0 ? withTiming(at.y, timing) : at.y;
  };

  useImperativeHandle(ref, () => ({
    enter: (durationMs) => frameTo(INITIAL_FOCUS, ZOOM.initial, reduceMotion ? 0 : durationMs),
    recentre: () => frameTo(INITIAL_FOCUS, ZOOM.initial, reduceMotion ? 0 : RECENTRE_MS),
  }));

  // A selected building that would sit under the info card is eased up, clear of it.
  useEffect(() => {
    const b = BUILDINGS[selectedIndex];
    if (!b) return;
    const s = scale.value;
    const sx = ox.value + b.x * s;
    const bottom = oy.value + b.y * s;
    if (sx < vw.value * CARD_SPAN[0] || sx > vw.value * CARD_SPAN[1]) return;
    if (bottom <= vh.value * CARD_TOP) return;
    const [minY, maxY] = offsetRange(vh.value, MAP.h, s);
    const target = clamp(oy.value - (bottom - vh.value * CARD_TOP), minY, maxY);
    cancelAnimation(ox);
    cancelAnimation(oy);
    gliding.value = 0;
    oy.value = reduceMotion ? target : withTiming(target, { duration: 240, easing: ease });
  }, [selectedIndex, tapCount, reduceMotion, gliding, ox, oy, scale, vh, vw]);

  const catchGlide = () => {
    'worklet';
    caught.value = gliding.value > 0 ? 1 : 0;
    if (gliding.value > 0) {
      cancelAnimation(ox);
      cancelAnimation(oy);
      gliding.value = 0;
    }
  };

  const pan = Gesture.Pan()
    .enabled(interactive)
    .maxPointers(1)
    .minDistance(8)
    .onBegin(catchGlide)
    .onStart(() => {
      cancelAnimation(ox);
      cancelAnimation(oy);
      panFromX.value = ox.value;
      panFromY.value = oy.value;
      runOnJS(onGesture)('pan', true);
    })
    .onUpdate((e) => {
      const [minX, maxX] = offsetRange(vw.value, MAP.w, scale.value);
      const [minY, maxY] = offsetRange(vh.value, MAP.h, scale.value);
      ox.value = clamp(panFromX.value + e.translationX, minX, maxX);
      oy.value = clamp(panFromY.value + e.translationY, minY, maxY);
    })
    .onEnd((e) => {
      if (reduced.value) return;
      const [minX, maxX] = offsetRange(vw.value, MAP.w, scale.value);
      const [minY, maxY] = offsetRange(vh.value, MAP.h, scale.value);
      const settled = () => {
        'worklet';
        gliding.value = Math.max(0, gliding.value - 1);
      };
      gliding.value = 2;
      ox.value = withDecay(
        { velocity: e.velocityX, deceleration: DECELERATION, clamp: [minX, maxX] },
        settled,
      );
      oy.value = withDecay(
        { velocity: e.velocityY, deceleration: DECELERATION, clamp: [minY, maxY] },
        settled,
      );
    })
    .onFinalize(() => {
      runOnJS(onGesture)('pan', false);
    });

  const pinch = Gesture.Pinch()
    .enabled(interactive)
    .onBegin(catchGlide)
    .onStart((e) => {
      cancelAnimation(scale);
      cancelAnimation(ox);
      cancelAnimation(oy);
      pinchFrom.value = scale.value;
      anchorX.value = (e.focalX - ox.value) / scale.value;
      anchorY.value = (e.focalY - oy.value) / scale.value;
      runOnJS(onGesture)('pinch', true);
    })
    .onUpdate((e) => {
      const s = clamp(pinchFrom.value * e.scale, base.value * ZOOM.min, base.value * ZOOM.max);
      const at = zoomAbout(
        { x: anchorX.value, y: anchorY.value },
        { x: e.focalX, y: e.focalY },
        s,
        vw.value,
        vh.value,
      );
      scale.value = s;
      ox.value = at.x;
      oy.value = at.y;
    })
    .onFinalize(() => {
      runOnJS(onGesture)('pinch', false);
    });

  const tap = Gesture.Tap()
    .enabled(interactive)
    .maxDistance(10)
    .onEnd((e, success) => {
      if (!success || caught.value) return;
      const mx = (e.x - ox.value) / scale.value;
      const my = (e.y - oy.value) / scale.value;
      runOnJS(onTap)(hitTest(HIT_BOXES, mx, my));
    });

  const gesture = Gesture.Race(Gesture.Simultaneous(pan, pinch), tap);

  // RN scales about the view's centre; shift so map point p lands at o + p * s.
  const mapStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: ox.value + (MAP.w / 2) * (scale.value - 1) },
      { translateY: oy.value + (MAP.h / 2) * (scale.value - 1) },
      { scale: scale.value },
    ],
  }));

  const selected = BUILDINGS[selectedIndex] ?? null;

  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill} collapsable={false}>
        <Animated.View style={[styles.map, mapStyle]} pointerEvents="none">
          <Image
            source={CITY_ART.map}
            style={styles.mapImage}
            contentFit="fill"
            cachePolicy="memory-disk"
            onDisplay={onMapShown}
            onError={onMapShown}
            accessible={false}
          />
          <Image
            source={CITY_ART.harbourRibbon}
            style={[styles.abs, boxStyle(HARBOUR_RIBBON)]}
            contentFit="contain"
            accessible={false}
          />
          {BUILDINGS.map((b, i) => (
            <BuildingSprite
              key={b.id}
              building={b}
              index={i}
              selected={i === selectedIndex}
              pulse={i === selectedIndex ? tapCount : 0}
              reduceMotion={reduceMotion}
              onActivate={onTap}
            />
          ))}
          {BUILDINGS.map((b) =>
            b.labelBox && b.id in CITY_ART.labels ? (
              <Image
                key={`label-${b.id}`}
                source={CITY_ART.labels[b.id as keyof typeof CITY_ART.labels]}
                style={[styles.abs, boxStyle(b.labelBox)]}
                contentFit="contain"
                accessible={false}
              />
            ) : null,
          )}
        </Animated.View>
      </View>
    </GestureDetector>
  );
});

function boxStyle(box: { x: number; y: number; w: number; h: number }) {
  return { left: box.x, top: box.y, width: box.w, height: box.h };
}

const BuildingSprite = memo(function BuildingSprite({
  building,
  index,
  selected,
  pulse,
  reduceMotion,
  onActivate,
}: {
  building: Building;
  index: number;
  selected: boolean;
  pulse: number;
  reduceMotion: boolean;
  onActivate: (index: number) => void;
}) {
  const lift = useSharedValue(1);
  const ink = useSharedValue(0);
  const half = building.box.h / 2;

  useEffect(() => {
    if (!selected) ink.value = 0;
    else ink.value = reduceMotion ? 1 : withTiming(1, { duration: MARK_MS, easing: ease });
  }, [selected, reduceMotion, ink]);

  useEffect(() => {
    if (reduceMotion) {
      lift.value = 1;
      return;
    }
    lift.value = selected
      ? withSequence(
          withTiming(LIFT.peak, { duration: LIFT.upMs, easing: Easing.out(Easing.quad) }),
          withTiming(LIFT.rest, { duration: LIFT.settleMs, easing: Easing.inOut(Easing.quad) }),
        )
      : withTiming(1, { duration: LIFT.dropMs, easing: ease });
  }, [selected, pulse, reduceMotion, lift]);

  // Grows from its ground line, not its middle: shift by the half-height it gains.
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: half * (1 - lift.value) }, { scale: lift.value }],
  }));
  const outline = useAnimatedStyle(() => ({ opacity: 0.9 * ink.value }));

  return (
    <Animated.View
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${building.name}. Coming soon.`}
      accessibilityState={{ selected }}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={() => onActivate(index)}
      style={[styles.abs, boxStyle(building.box), style]}
    >
      {selected ? (
        <Animated.View style={[StyleSheet.absoluteFill, outline]} pointerEvents="none">
          {OUTLINE_OFFSETS.map(([dx, dy]) => (
            <Image
              key={`${dx},${dy}`}
              source={CITY_ART.buildings[building.id]}
              style={[
                StyleSheet.absoluteFill,
                { transform: [{ translateX: dx * OUTLINE_PX }, { translateY: dy * OUTLINE_PX }] },
              ]}
              contentFit="contain"
              tintColor={cityColor.ink}
              accessible={false}
            />
          ))}
        </Animated.View>
      ) : null}
      <Image
        source={CITY_ART.buildings[building.id]}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        cachePolicy="memory-disk"
        accessible={false}
      />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  map: { position: 'absolute', left: 0, top: 0, width: MAP.w, height: MAP.h },
  mapImage: { position: 'absolute', left: 0, top: 0, width: MAP.w, height: MAP.h },
  abs: { position: 'absolute' },
});
