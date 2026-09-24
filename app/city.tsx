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
import { cityEnabled, isFlagOn, loadFlags } from '@/city/features';
import { useCity } from '@/city/store';
import { AmbientLayer } from '@/city/ui/AmbientLayer';
import { LivingWorldLayer } from '@/city/ui/LivingWorldLayer';
import { BuildingSheet } from '@/city/ui/BuildingSheet';
import { CityHud, WorkersSheet } from '@/city/ui/CityHud';
import { CityTour, OfflineBanner } from '@/city/ui/CityTour';
import { CollectFlightLayer, tokenCountFor, type Flight } from '@/city/ui/CollectFlight';
import { PlotLayer } from '@/city/ui/PlotLayer';
import { plotStateFor } from '@/city/ui/plotState';
import { TOUR_BEATS, advance, beatSatisfied, isFinished } from '@/city/ui/tourScript';
import { useCityActions } from '@/city/ui/useCityActions';
import { captainLineFor } from '@/city/ui/captainCopy';
import { serverNow } from '@/city/store';
import type { BuildingId } from '@engine/city';
import { useProfile } from '@/state/profile';
import { AssetSlot } from '@/ui/AssetSlot';
import { AVATARS, UI_ART } from '@/ui/assets';
import { CurrencyInfoChip } from '@/features/points/CurrencyInfoChip';
import { InkButton } from '@/ui/InkButton';
import { InkIconButton } from '@/ui/InkIconButton';
import { RankBadge } from '@/ui/RankBadge';
import { Scale, useScale } from '@/ui/Scale';
import { SpeechBubble } from '@/ui/SpeechBubble';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';
import { RoughShape, hashString, useRough } from '@/ui/useRough';
import { CITY_PALETTES, livingWorldState, rainWindowsForDay } from '@engine/liveWorld';
import { livingWorldConfig } from '@/city/features';

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
  const progress = rankProgress(profile.rankPoints);
  const [welcome, setWelcome] = useState(() => !useProfile.getState().hasVisitedCity);
  const name = profile.name || 'Sailor';
  const now = new Date();
  const localDayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const liveConfig = livingWorldConfig();
  const living = livingWorldState({
    localHour: now.getHours() + now.getMinutes() / 60,
    preference: profile.cityTimePreference,
    seasons: liveConfig?.seasonWindows ?? [],
    rain: rainWindowsForDay(localDayStart, (liveConfig?.weatherSeed ?? 11011) ^ localDayStart),
    now: now.getTime(),
  });

  // ---- Port City (Part 2). Every one of these is inert with the flag off. ----
  const [cityOn, setCityOn] = useState(false);
  const actions = useCityActions();
  const snapshot = useCity((s) => s.snapshot);
  const cityError = useCity((s) => s.error);
  const [openPlot, setOpenPlot] = useState<BuildingId | null>(null);
  const [workersOpen, setWorkersOpen] = useState(false);
  const [flights, setFlights] = useState<readonly Flight[]>([]);
  const [tourIndex, setTourIndex] = useState(-1);
  const [tourNudge, setTourNudge] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadFlags().then(() => {
      if (cancelled) return;
      const on = cityEnabled();
      setCityOn(on);
      if (!on) return;
      void actions.refresh();
      if (!useProfile.getState().hasSeenCityTour) setTourIndex(0);
    });
    return () => {
      cancelled = true;
    };
    // Once per mount, deliberately: the flag cannot change mid-screen, and an
    // endpoint that goes dark answers `feature-off`, which the banner already
    // handles. (`actions` is a stable object of useCallbacks.)
  }, []);

  /** A tour beat only advances on the action it actually asked for (§7). */
  const notifyTour = useCallback(
    (kind: 'tap-plot' | 'collect' | 'build' | 'acknowledge', buildingId?: BuildingId) => {
      setTourIndex((index) => {
        if (index < 0 || isFinished(index)) return index;
        const beat = TOUR_BEATS[index];
        if (!beat) return index;
        if (beatSatisfied(beat, { kind, ...(buildingId ? { buildingId } : {}) })) {
          setTourNudge(null);
          const next = advance(index);
          if (isFinished(next)) useProfile.getState().markCityTourSeen();
          return next;
        }
        setTourNudge(beat.nudge ?? beat.say);
        return index;
      });
    },
    [],
  );

  const skipTour = useCallback(() => {
    useProfile.getState().markCityTourSeen();
    setTourIndex(-1);
    setTourNudge(null);
  }, []);

  /** A ready plot collects on tap and throws tokens at the HUD chip (§3, §6). */
  const collectPlot = useCallback(
    async (id: BuildingId) => {
      const before = useCity.getState().snapshot;
      const view = plotStateFor(before, id, serverNow(useCity.getState()));
      const ok = await actions.collect(id);
      if (!ok || view.collectAmount <= 0) return;
      notifyTour('collect', id);
      const flight: Flight = {
        id: `${id}-${Date.now()}`,
        from: { x: CANVAS_W * 0.5, y: CANVAS_H * 0.5 },
        to: { x: CANVAS_W - 120, y: 18 },
        resource: view.collectResource ?? 'coins',
        count: tokenCountFor(view.collectAmount),
      };
      setFlights((prev) => [...prev, flight]);
    },
    [actions, notifyTour],
  );

  const buildPlot = useCallback(
    async (id: BuildingId) => {
      const ok = await actions.build(id);
      if (ok) notifyTour('build', id);
    },
    [actions, notifyTour],
  );

  /**
   * Part 8 — a BUILT Fleet Hall opens the hall itself rather than the upgrade
   * sheet: once it exists, what a player wants from that plot is the roster,
   * not "level 2 costs 12,000 steel". An unbuilt one still opens the sheet,
   * which is where they go to build it. Same for the Admiralty and its Flag
   * Hall (§5, "inside the Admiralty").
   */
  const openPlotSheet = useCallback(
    (id: BuildingId) => {
      haptic('buttonPress');
      const level = snapshot?.city.buildings[id]?.level ?? 0;
      if (level > 0 && isFlagOn('portCity.fleets')) {
        if (id === 'fleet_hall') {
          router.push('/fleet');
          return;
        }
        if (id === 'admiralty') {
          router.push('/flag-hall');
          return;
        }
      }
      // part-04 — a built Harbour Master's Office opens the Bounty Board.
      if (level > 0 && id === 'harbour_office' && isFlagOn('portCity.bounties')) {
        router.push('/bounties');
        return;
      }
      // part-09 — a built Newsstand opens the Gazette (and the puzzle from its
      // back page); a built Trade Docks opens the berths.
      if (level > 0 && id === 'newsstand' && isFlagOn('portCity.gazette')) {
        router.push('/gazette');
        return;
      }
      if (level > 0 && id === 'trade_docks' && isFlagOn('portCity.voyages')) {
        router.push('/voyages');
        return;
      }
      if (level > 0 && id === 'lighthouse' && isFlagOn('portCity.empire')) {
        router.push('/empire' as never);
        return;
      }
      if (level > 0 && id === 'lighthouse' && isFlagOn('portCity.worldBoss')) {
        router.push('/world-boss' as never);
        return;
      }
      // part-03 — the two cosmetic shops.
      if (level > 0 && isFlagOn('portCity.cosmetics')) {
        if (id === 'shipyard') {
          router.push('/shop?store=shipyard');
          return;
        }
        if (id === 'stationery') {
          router.push('/shop?store=stationery');
          return;
        }
      }
      setOpenPlot(id);
      notifyTour('tap-plot', id);
    },
    [notifyTour, router, snapshot],
  );

  const openView = useMemo(
    () =>
      openPlot ? plotStateFor(snapshot, openPlot, serverNow(useCity.getState())) : null,
    [openPlot, snapshot],
  );

  /** Seconds until the first busy worker frees up, for the Captain's line. */
  const nextWorkerFreeIn = useMemo(() => {
    if (!snapshot) return 0;
    const now = serverNow(useCity.getState());
    const ends = Object.values(snapshot.city.buildings)
      .map((b) => b.upgrading?.endsAt ?? 0)
      .filter((at) => at > now);
    if (ends.length === 0) return 0;
    return Math.max(0, Math.round((Math.min(...ends) - now) / 1000));
  }, [snapshot]);

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

  /**
   * Part 7 §1 — "Reached by tapping the <name>'s harbour nameplate in the
   * city." With `portCity.raids` OFF the nameplate does exactly what it does
   * today: it centres the map, and the plate keeps showing the battle record.
   * One conditional in the callback, so the component is untouched.
   */
  const raidsOn = isFlagOn('portCity.raids');
  const pressHarbour = useCallback(() => {
    if (raidsOn) {
      haptic('buttonPress');
      router.push('/harbour');
      return;
    }
    focusHarbour();
  }, [focusHarbour, raidsOn, router]);

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
            tintColor={living.theme === 'night' ? CITY_PALETTES.night.inkSoft : color.inkSoft}
            style={{ opacity: 0.85 }}
          />
          <LivingWorldLayer state={living} />
          {/* The old placeholder slots are exactly what the flag-off screen
              shows. With the city on, real plots replace them. */}
          {cityOn ? null : SLOTS.map((slot) => <Slot key={slot.key} slot={slot} />)}
          <HomeHarbour
            name={name}
            played={profile.battlesPlayed}
            won={profile.battlesWon}
            onPress={pressHarbour}
          />
          {/* Part 2. Children of the SAME transformed view as the harbour, so
              they inherit the pinch/pan with no synchronising code. */}
          {cityOn ? (
            <>
              {living.weather === 'rain' ? null : <AmbientLayer />}
              <PlotLayer
                zoom={scale}
                onOpen={openPlotSheet}
                onCollect={collectPlot}
                features={snapshot?.features ?? []}
              />
            </>
          ) : null}
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
      {cityOn ? (
        <CityHud
          onOpenWorkers={() => setWorkersOpen(true)}
          onCollectAll={() => {
            void actions.collectAll();
          }}
        />
      ) : (
        <View style={styles.topRight} pointerEvents="box-none">
          <CurrencyInfoChip kind="coins" value={profile.coins} />
          <CurrencyInfoChip kind="gems" value={profile.gems} />
        </View>
      )}
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

      {cityOn ? (
        <>
          <CollectFlightLayer
            flights={flights}
            onDone={(id) => setFlights((prev) => prev.filter((f) => f.id !== id))}
          />
          {cityError === 'offline' ? (
            <OfflineBanner message={captainLineFor('offline')} />
          ) : null}
          <BuildingSheet
            view={openView}
            busy={actions.busy}
            errorCode={actions.lastError?.buildingId === openPlot ? actions.lastError.code : null}
            nextWorkerFreeIn={nextWorkerFreeIn}
            onClose={() => {
              setOpenPlot(null);
              actions.clearError();
            }}
            onBuild={(id) => void buildPlot(id)}
            onSpeedUp={(id) => void actions.speedUp(id)}
            onCancel={(id) => void actions.cancel(id)}
            onCollect={(id) => void collectPlot(id)}
          />
          <WorkersSheet
            open={workersOpen}
            busy={actions.busy}
            errorCode={actions.lastError?.code ?? null}
            onClose={() => setWorkersOpen(false)}
            onBuy={() => void actions.buyWorker()}
          />
          {tourIndex >= 0 && !isFinished(tourIndex) ? (
            <CityTour
              index={tourIndex}
              nudge={tourNudge}
              onAdvance={() => notifyTour('acknowledge')}
              onSkip={skipTour}
            />
          ) : null}
        </>
      ) : null}

      {welcome && !cityOn ? (
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
