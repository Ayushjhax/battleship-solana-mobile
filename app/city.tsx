/**
 * The port city (P14). ONE static screen for this build: city-port.png
 * covering the canvas, pinch-to-zoom and pan (a plain Reanimated pinch +
 * pan, no map library), the player card top-left, currency chips top-right,
 * three building slots outlined in ink with a "Coming soon" ribbon, and the
 * Captain saying hello on the first visit only. There is no building system
 * — this screen exists to show where the metagame goes.
 *
 * The player's own place in it is the harbour: the marina under the bridge,
 * framed in solid ink (the coming-soon slots are dashed) with a pennant, a
 * "You are here" tag, the player's name on a ribbon and their record. The
 * map opens centred on it, and the home button (or a tap on the harbour)
 * brings it back to the centre at 2x. Nothing on the map animates on its
 * own — the brief's no-ambient-motion rule.
 *
 * The map is the whole screen, not a card on the page: it is centred on the
 * WINDOW (which may sit off the canvas centre when the safe-area insets are
 * uneven), its lowest zoom is whatever covers the window plus a margin, and
 * the pan is clamped so the image edge never comes inside the window. At that
 * zoom the 3:4 map (800x1067 at 1x) scrolls vertically — you open on the
 * harbour and pan down to the lighthouse. Both gestures write shared values;
 * the clamp runs on the UI thread.
 */
import { rankProgress } from '@engine/ranks';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { haptic } from '@/audio/haptics';
import { useSpendableCoins } from '@/state/locker';
import { useProfile } from '@/state/profile';
import { AssetSlot } from '@/ui/AssetSlot';
import { AVATARS, UI_ART } from '@/ui/assets';
import { CurrencyChip } from '@/ui/CurrencyChip';
import { InkButton } from '@/ui/InkButton';
import { InkIconButton } from '@/ui/InkIconButton';
import { RankBadge } from '@/ui/RankBadge';
import { Scale, useScale } from '@/ui/Scale';
import { SpeechBubble } from '@/ui/SpeechBubble';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';
import { RoughShape, hashString, useRough } from '@/ui/useRough';

// The map at 1x spans the canvas width: city-port.png is 768x1024, scaled to 800 wide.
const MAP_W = CANVAS_W;
const MAP_H = Math.round((CANVAS_W * 1024) / 768);
const MAX_SCALE = 3;
/** Canvas units the map must cover beyond the reported window on every side. */
const COVER_MARGIN = 40;
const CAPTAIN = { w: 150, h: 200 } as const;
const FOCUS_SCALE = 2;
const FOCUS_MS = 320;

/** The window in canvas units: its size, its centre, and the zoom that covers it. */
interface Viewport {
  readonly w: number;
  readonly h: number;
  readonly cx: number;
  readonly cy: number;
  readonly minScale: number;
}

/** Where the future buildings go, in map units (at 1x): the container docks, the old town by the cathedral, the lighthouse headland. */
const SLOTS: readonly { key: string; x: number; y: number; w: number; h: number; label: string }[] =
  [
    { key: 'docks', x: 596, y: 500, w: 132, h: 76, label: 'Shipyard' },
    { key: 'hall', x: 118, y: 506, w: 120, h: 80, label: 'Admiralty' },
    { key: 'tower', x: 418, y: 764, w: 104, h: 84, label: 'Lighthouse' },
  ];

/** The player's berth: the marina piers under the bridge, map units at 1x. */
const HARBOUR = { x: 236, y: 392, w: 168, h: 96 } as const;
/**
 * What the map centres on: a little above the box's middle, so at 2x the
 * whole marker — tag above, ribbon below — sits under the HUD strip.
 */
const HARBOUR_CENTRE = { x: HARBOUR.x + HARBOUR.w / 2, y: HARBOUR.y + 22 } as const;
const TAG_W = 96;
const TAG_H = 20;

function clamp(v: number, lo: number, hi: number): number {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

/**
 * The translation that puts a map point at the window centre at a given
 * zoom, clamped like the gestures clamp. The map view is centred on the
 * window and scales about its own centre, so a point p lands at
 * centre + (p - mapCentre) * zoom + t.
 */
function centreOn(
  point: { x: number; y: number },
  zoom: number,
  view: Viewport,
): { tx: number; ty: number } {
  'worklet';
  const maxX = Math.max(0, (MAP_W * zoom - view.w) / 2);
  const maxY = Math.max(0, (MAP_H * zoom - view.h) / 2);
  return {
    tx: clamp(-(point.x - MAP_W / 2) * zoom, -maxX, maxX),
    ty: clamp(-(point.y - MAP_H / 2) * zoom, -maxY, maxY),
  };
}

function Slot({ slot }: { slot: (typeof SLOTS)[number] }) {
  const { roughRect } = useRough();
  const outline = roughRect(2, 2, slot.w - 4, slot.h - 4, {
    seed: hashString(`slot-${slot.key}`),
    strokeWidth: 1.6,
    roughness: 1.4,
    fill: color.paper,
    fillStyle: 'hachure',
    hachureGap: 7,
    fillWeight: 0.6,
  });
  return (
    <View
      style={{ position: 'absolute', left: slot.x, top: slot.y, width: slot.w, height: slot.h }}
    >
      <Svg
        width={slot.w}
        height={slot.h}
        viewBox={`0 0 ${slot.w} ${slot.h}`}
        style={StyleSheet.absoluteFill}
      >
        <RoughShape paths={outline} dash={[6, 4]} />
      </Svg>
      <Text style={styles.slotLabel}>{slot.label}</Text>
      <View style={{ position: 'absolute', left: (slot.w - 184) / 2, bottom: -14 }}>
        <TitleRibbon title="Coming soon" w={184} h={26} size="sm" seedKey={`soon-${slot.key}`} />
      </View>
    </View>
  );
}

/**
 * The player's harbour. Solid double frame (the slots are dashed), a pennant
 * on the pole at the corner, "You are here" on a paper tag, the name ribbon
 * and the record. Boats stay visible: there is no fill. Tapping it centres
 * the map on it.
 */
function HomeHarbour({
  name,
  played,
  won,
  onPress,
}: {
  name: string;
  played: number;
  won: number;
  onPress: () => void;
}) {
  const { roughRect, roughLine, roughPolygon } = useRough();
  const seed = hashString('harbour-home');
  const { w, h } = HARBOUR;
  const outer = roughRect(2, 2, w - 4, h - 4, {
    seed,
    stroke: color.ink,
    strokeWidth: 2,
    roughness: 1.3,
    bowing: 0.9,
  });
  const inner = roughRect(6, 6, w - 12, h - 12, {
    seed: seed + 1,
    stroke: color.ink,
    strokeWidth: 1,
    roughness: 1.1,
  });
  // The pennant: pole up from the frame's corner, a red swallowtail flag.
  const pole = roughLine(10, 4, 10, -22, { seed: seed + 2, stroke: color.ink, strokeWidth: 1.6 });
  const flag = roughPolygon(
    [
      [11, -22],
      [34, -17],
      [26, -12],
      [34, -7],
      [11, -3],
    ],
    {
      seed: seed + 3,
      stroke: color.inkRed,
      strokeWidth: 1.1,
      fill: color.inkRed,
      fillStyle: 'hachure',
      hachureGap: 2.2,
      fillWeight: 1,
    },
  );
  const tag = roughRect(1, 1, TAG_W - 2, TAG_H - 2, {
    seed: seed + 4,
    stroke: color.inkRed,
    strokeWidth: 1.2,
    fill: color.paper,
    fillStyle: 'solid',
    roughness: 0.9,
  });
  const tagPin = roughPolygon(
    [
      [TAG_W / 2 - 5, TAG_H - 1],
      [TAG_W / 2 + 5, TAG_H - 1],
      [TAG_W / 2, TAG_H + 7],
    ],
    {
      seed: seed + 5,
      stroke: color.inkRed,
      strokeWidth: 1,
      fill: color.inkRed,
      fillStyle: 'solid',
    },
  );
  const record =
    played === 0
      ? 'No battles yet'
      : `${played} ${played === 1 ? 'battle' : 'battles'} · ${won} won`;
  // The ribbon grows with the name (1-14 characters) so it never truncates.
  const ribbonLabel = `${name}'s harbour`;
  const ribbonW = Math.min(270, Math.max(200, 72 + ribbonLabel.length * 8));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}'s harbour. You are here. ${record}.`}
      onPress={onPress}
      style={{
        position: 'absolute',
        left: HARBOUR.x,
        top: HARBOUR.y,
        width: w,
        height: h,
        overflow: 'visible',
      }}
    >
      <Svg
        width={w}
        height={h + 30}
        viewBox={`0 -30 ${w} ${h + 30}`}
        style={{ position: 'absolute', left: 0, top: -30 }}
        pointerEvents="none"
      >
        <RoughShape paths={outer} />
        <RoughShape paths={inner} />
        <RoughShape paths={pole} />
        <RoughShape paths={flag} />
      </Svg>
      <View pointerEvents="none" style={[styles.hereTag, { left: (w - TAG_W) / 2 }]}>
        <Svg
          width={TAG_W}
          height={TAG_H + 8}
          viewBox={`0 0 ${TAG_W} ${TAG_H + 8}`}
          style={StyleSheet.absoluteFill}
        >
          <RoughShape paths={tag} />
          <RoughShape paths={tagPin} />
        </Svg>
        <Text style={styles.hereText}>You are here</Text>
      </View>
      <View pointerEvents="none" style={styles.record}>
        <Text style={styles.recordText}>{record}</Text>
      </View>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: (w - ribbonW) / 2, bottom: -14 }}
      >
        <TitleRibbon title={ribbonLabel} w={ribbonW} h={26} size="sm" seedKey="harbour-name" />
      </View>
    </Pressable>
  );
}

export default function CityScreen() {
  return (
    // Plain paper behind: the map covers the window, so no rules should ever
    // peek out at an edge while it settles.
    <Scale backdrop="plain">
      <CityCanvas />
    </Scale>
  );
}

/** Inside the Scale provider, so the window-to-canvas maths is real. */
function CityCanvas() {
  const router = useRouter();
  const profile = useProfile();
  const coins = useSpendableCoins();
  const progress = rankProgress(profile.rankPoints);
  const [welcome, setWelcome] = useState(() => !useProfile.getState().hasVisitedCity);
  const name = profile.name || 'Sailor';

  useEffect(() => {
    if (!welcome) return;
    useProfile.getState().markCityVisited();
    const id = setTimeout(() => setWelcome(false), 5200);
    return () => clearTimeout(id);
  }, [welcome]);

  // ---- the window in canvas units: what the map has to cover ----
  const { width, height } = useWindowDimensions();
  const { scale: canvasScale, ox, oy } = useScale();
  const view = useMemo<Viewport>(() => {
    const w = width / canvasScale + COVER_MARGIN * 2;
    const h = height / canvasScale + COVER_MARGIN * 2;
    return {
      w,
      h,
      cx: (width / 2 - ox) / canvasScale,
      cy: (height / 2 - oy) / canvasScale,
      minScale: Math.max(1, w / MAP_W, h / MAP_H),
    };
  }, [width, height, canvasScale, ox, oy]);
  // "Zoomed in" is a clear step above whatever zoom the window itself needs.
  const focusZoom = Math.min(MAX_SCALE, Math.max(FOCUS_SCALE, view.minScale * 1.35));

  // ---- pinch + pan, clamped at the image edges; opens on the harbour ----
  const home = centreOn(HARBOUR_CENTRE, view.minScale, view);
  const scale = useSharedValue(view.minScale);
  const savedScale = useSharedValue(view.minScale);
  const tx = useSharedValue(home.tx);
  const ty = useSharedValue(home.ty);
  const savedTx = useSharedValue(home.tx);
  const savedTy = useSharedValue(home.ty);

  // A rotation or inset change moves the floor: keep the map covering the window.
  useEffect(() => {
    const zoom = Math.max(scale.value, view.minScale);
    const maxX = Math.max(0, (MAP_W * zoom - view.w) / 2);
    const maxY = Math.max(0, (MAP_H * zoom - view.h) / 2);
    scale.value = zoom;
    savedScale.value = zoom;
    tx.value = clamp(tx.value, -maxX, maxX);
    ty.value = clamp(ty.value, -maxY, maxY);
    savedTx.value = tx.value;
    savedTy.value = ty.value;
  }, [view, savedScale, savedTx, savedTy, scale, tx, ty]);

  // Zooms in on the harbour; pressed again while already there, eases back out.
  const focusHarbour = useCallback(() => {
    haptic('buttonPress');
    const here = centreOn(HARBOUR_CENTRE, scale.value, view);
    const atHarbour = Math.abs(tx.value - here.tx) < 2 && Math.abs(ty.value - here.ty) < 2;
    const zoom = atHarbour && scale.value > view.minScale + 0.05 ? view.minScale : focusZoom;
    const target = centreOn(HARBOUR_CENTRE, zoom, view);
    const timing = { duration: FOCUS_MS, easing: Easing.out(Easing.cubic) };
    scale.value = withTiming(zoom, timing);
    tx.value = withTiming(target.tx, timing);
    ty.value = withTiming(target.ty, timing);
    savedScale.value = zoom;
    savedTx.value = target.tx;
    savedTy.value = target.ty;
  }, [focusZoom, savedScale, savedTx, savedTy, scale, tx, ty, view]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = clamp(savedScale.value * e.scale, view.minScale, MAX_SCALE);
      const maxX = Math.max(0, (MAP_W * scale.value - view.w) / 2);
      const maxY = Math.max(0, (MAP_H * scale.value - view.h) / 2);
      tx.value = clamp(tx.value, -maxX, maxX);
      ty.value = clamp(ty.value, -maxY, maxY);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      const maxX = Math.max(0, (MAP_W * scale.value - view.w) / 2);
      const maxY = Math.max(0, (MAP_H * scale.value - view.h) / 2);
      tx.value = clamp(savedTx.value + e.translationX, -maxX, maxX);
      ty.value = clamp(savedTy.value + e.translationY, -maxY, maxY);
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const next = scale.value > view.minScale + 0.05 ? view.minScale : focusZoom;
      scale.value = withTiming(next, { duration: 260, easing: Easing.out(Easing.cubic) });
      savedScale.value = next;
      const maxX = Math.max(0, (MAP_W * next - view.w) / 2);
      const maxY = Math.max(0, (MAP_H * next - view.h) / 2);
      tx.value = withTiming(clamp(tx.value, -maxX, maxX), { duration: 260 });
      ty.value = withTiming(clamp(ty.value, -maxY, maxY), { duration: 260 });
      savedTx.value = clamp(tx.value, -maxX, maxX);
      savedTy.value = clamp(ty.value, -maxY, maxY);
    });

  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);
  const mapStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <View style={styles.root}>
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[styles.map, { left: view.cx - MAP_W / 2, top: view.cy - MAP_H / 2 }, mapStyle]}
        >
          <AssetSlot
            source={UI_ART.cityPort}
            w={MAP_W}
            h={MAP_H}
            label="city-port"
            tintColor={color.inkSoft}
            style={{ opacity: 0.85 }}
          />
          {SLOTS.map((slot) => (
            <Slot key={slot.key} slot={slot} />
          ))}
          <HomeHarbour
            name={name}
            played={profile.battlesPlayed}
            won={profile.battlesWon}
            onPress={focusHarbour}
          />
        </Animated.View>
      </GestureDetector>

      <View style={styles.title} pointerEvents="none">
        <TitleRibbon title="Port city" w={200} h={36} size="md" seedKey="city-title" />
      </View>
      {welcome ? (
        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText}>Pinch to zoom · drag to look around</Text>
        </View>
      ) : null}

      <View style={styles.topLeft} pointerEvents="box-none">
        <RankBadge
          name={profile.name || 'Sailor'}
          rank={progress.rank.name}
          current={progress.current}
          total={progress.total}
          avatar={{ source: AVATARS[profile.avatarId], tint: profile.avatarColor }}
          seedKey="city"
        />
      </View>
      <View style={styles.topRight} pointerEvents="box-none">
        <CurrencyChip kind="coins" value={coins} />
        <CurrencyChip kind="gems" value={profile.gems} />
      </View>
      <View style={styles.back}>
        <InkButton
          label="↩"
          size="lg"
          w={54}
          h={44}
          seedKey="city-back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/menu'))}
        />
      </View>
      <View style={styles.home}>
        <InkIconButton
          icon="home"
          size={44}
          accessibilityLabel="Centre the map on your harbour"
          onPress={focusHarbour}
        />
      </View>

      {welcome ? (
        <>
          <View pointerEvents="none" style={styles.captain}>
            <AssetSlot source={AVATARS.captain} w={CAPTAIN.w} h={CAPTAIN.h} label="captain" />
          </View>
          <View pointerEvents="none" style={styles.bubble}>
            <SpeechBubble
              text="Welcome to your port city! The berth with the flag is yours."
              tail="left"
              tailAt={0.3}
              w={250}
              seedKey="city-welcome"
            />
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // No clipping here: the map runs past the canvas to fill the window.
  root: { width: CANVAS_W, height: CANVAS_H, overflow: 'visible' },
  map: { position: 'absolute', width: MAP_W, height: MAP_H },
  topLeft: {
    position: 'absolute',
    left: space.md,
    top: space.sm,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
    backgroundColor: 'rgba(251, 252, 254, 0.85)',
  },
  topRight: {
    position: 'absolute',
    right: space.md,
    top: space.sm,
    flexDirection: 'row',
    gap: space.xs,
  },
  back: { position: 'absolute', left: space.md, bottom: space.sm },
  home: { position: 'absolute', left: space.md + 62, bottom: space.sm },
  title: { position: 'absolute', left: (CANVAS_W - 200) / 2, top: 4 },
  hint: {
    position: 'absolute',
    left: (CANVAS_W - 220) / 2,
    top: 44,
    width: 220,
    paddingVertical: 2,
    alignItems: 'center',
    backgroundColor: 'rgba(251, 252, 254, 0.85)',
  },
  hintText: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xxs },
  hereTag: { position: 'absolute', top: -38, width: TAG_W, height: TAG_H + 8 },
  hereText: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: TAG_H,
    lineHeight: TAG_H,
    textAlign: 'center',
    color: color.inkRed,
    fontFamily: font.label,
    fontSize: typeScale.xxs,
  },
  record: {
    position: 'absolute',
    right: 8,
    top: 9,
    paddingHorizontal: 4,
    backgroundColor: 'rgba(251, 252, 254, 0.85)',
  },
  recordText: { color: color.ink, fontFamily: font.label, fontSize: typeScale.xxs },
  captain: { position: 'absolute', left: 80, top: CANVAS_H - CAPTAIN.h + 40 },
  bubble: { position: 'absolute', left: 80 + CAPTAIN.w + 2, top: CANVAS_H - CAPTAIN.h + 46 },
  slotLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 8,
    textAlign: 'center',
    color: color.inkSoft,
    fontFamily: font.label,
    fontSize: typeScale.xxs,
  },
});
