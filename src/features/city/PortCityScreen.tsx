/**
 * The Port City preview (app/city.tsx). One visit, four states, owned by
 * PortCityVisit (visit.ts) — this component only draws them:
 *
 *   entering    the map and buildings are resolved behind a paper veil, then
 *               the veil lifts while the map settles onto the harbour and the
 *               HUD slides in (440 ms). Exploration time starts after that.
 *   exploring   drag, flick, pinch; tap a building for its card.
 *   comingSoon  the popup, once, after three finds and 10 s, or after 25 s.
 *               The map is frozen underneath; the countdown runs after the
 *               popup has arrived.
 *   exiting     the veil comes back down (280 ms), then home.
 *
 * Every way out — the home tile, the popup's button, the countdown, system
 * back (and Escape where there is a keyboard) — is visit.exit(), which acts
 * once. Home is router.dismissTo('/menu'): back to the menu already under us
 * (or in place of this screen if there is none), never a second menu on top,
 * never this preview left underneath. If something else has taken the screen
 * by then (a resumed match), the exit does nothing.
 *
 * Nothing here buys, builds, collects or writes anything: it is a preview.
 */
import { useNavigation, useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Image as RNImage,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { haptic } from '@/audio/haptics';
import { useSpendableCoins } from '@/state/locker';
import { useProfile } from '@/state/profile';
import { CITY_ART, type Asset } from '@/ui/assets';
import { Scale } from '@/ui/Scale';
import { color } from '@/ui/tokens';

import { BUILDINGS, BUILDING_BY_ID, type BuildingId } from './cityLayout';
import { CityHud } from './CityHud';
import { CityMap, type CityMapHandle } from './CityMap';
import { ComingSoonPopup } from './ComingSoonPopup';
import { useVisit } from './useVisit';

/** Durations, ms. Reduced motion keeps short fades and drops every movement. */
const MOTION = {
  full: { enter: 440, popupIn: 300, exit: 280 },
  reduced: { enter: 180, popupIn: 150, exit: 160 },
} as const;

/** The longest the veil waits on the art before lifting anyway. */
const ART_WAIT_MS = 1500;

/** Everything the first frame and the popup draw, warmed before the veil lifts. */
const PRELOAD: readonly Asset[] = [
  CITY_ART.map,
  ...Object.values(CITY_ART.buildings),
  ...Object.values(CITY_ART.labels),
  CITY_ART.title,
  CITY_ART.hint,
  CITY_ART.popupPanel,
  CITY_ART.returnHome,
];

function preloadArt(): Promise<unknown> {
  const uris = PRELOAD.flatMap((asset) =>
    typeof asset === 'number' ? [RNImage.resolveAssetSource(asset).uri] : [],
  );
  return Promise.race([
    Image.prefetch(uris, 'memory-disk').catch(() => false),
    new Promise((resolve) => setTimeout(resolve, ART_WAIT_MS)),
  ]);
}

const ease = Easing.out(Easing.cubic);

export function PortCityScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const reduceMotion = useReducedMotion();
  const motion = reduceMotion ? MOTION.reduced : MOTION.full;
  const profile = useProfile();
  const coins = useSpendableCoins();

  const window = useWindowDimensions();
  const [view, setView] = useState({ w: window.width, h: window.height });
  const map = useRef<CityMapHandle>(null);
  const [tapCount, setTapCount] = useState(0);

  const goHome = useCallback(() => {
    // Something else took the screen in the meantime: leave it be.
    if (!navigation.isFocused()) return;
    router.dismissTo('/menu');
  }, [navigation, router]);

  const [visit, snap] = useVisit({
    onExit: goHome,
    popupEnterMs: motion.popupIn,
    exitMs: motion.exit,
  });

  // ---- entering: resolve the art, then lift the veil ----
  const [mapShown, setMapShown] = useState(false);
  const [artWarm, setArtWarm] = useState(false);
  useEffect(() => {
    let live = true;
    void preloadArt().then(() => live && setArtWarm(true));
    // A map that never reports (an asset error) must not hold the screen shut.
    const cap = setTimeout(() => live && setMapShown(true), ART_WAIT_MS);
    return () => {
      live = false;
      clearTimeout(cap);
    };
  }, []);
  const artReady = mapShown && artWarm;

  const veil = useSharedValue(1);
  const hudIn = useSharedValue(0);
  useEffect(() => {
    if (!artReady) return;
    veil.value = withTiming(0, { duration: motion.enter, easing: ease });
    hudIn.value = withTiming(1, { duration: motion.enter, easing: ease });
    map.current?.enter(motion.enter);
    const timer = setTimeout(() => visit.ready(), motion.enter);
    return () => clearTimeout(timer);
    // Keyed on artReady alone: the entrance plays once per visit, and a
    // reduced-motion change part-way through does not replay it.
  }, [artReady]);

  // ---- exiting: the veil comes back down, then visit calls goHome ----
  useEffect(() => {
    if (snap.phase !== 'exiting') return;
    veil.value = withTiming(1, { duration: motion.exit, easing: Easing.in(Easing.quad) });
  }, [snap.phase, motion.exit, veil]);

  // Under the popup the HUD steps back, so its PORT CITY ribbon never stacks
  // with the popup's COMING SOON one; the wash already blocks its buttons.
  const popupUp = snap.popup !== 'hidden';
  useEffect(() => {
    if (!popupUp) return;
    hudIn.value = withTiming(0, { duration: motion.popupIn, easing: ease });
  }, [popupUp, motion.popupIn, hudIn]);

  // The city counts as visited (the flag the old screen's welcome used).
  useEffect(() => {
    if (!useProfile.getState().hasVisitedCity) useProfile.getState().markCityVisited();
  }, []);

  // ---- system back, and Escape on a keyboard, are the home button ----
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        visit.exit('back');
        return true;
      });
      const target = globalThis as unknown as {
        addEventListener?: (type: string, fn: (e: { key?: string }) => void) => void;
        removeEventListener?: (type: string, fn: (e: { key?: string }) => void) => void;
      };
      const onKey = (e: { key?: string }) => {
        if (e.key === 'Escape') visit.exit('back');
      };
      const keys = Platform.OS === 'web' && typeof target.addEventListener === 'function';
      if (keys) target.addEventListener!('keydown', onKey);
      return () => {
        sub.remove();
        if (keys) target.removeEventListener?.('keydown', onKey);
      };
    }, [visit]),
  );

  const onTap = useCallback(
    (index: number) => {
      const building = BUILDINGS[index];
      if (!building) {
        visit.deselect();
        return;
      }
      haptic('buttonPress');
      visit.select(building.id);
      setTapCount((n) => n + 1);
    },
    [visit],
  );

  const onGesture = useCallback(
    (kind: 'pan' | 'pinch', active: boolean) =>
      active ? visit.gestureStart(kind) : visit.gestureEnd(kind),
    [visit],
  );

  const onHome = useCallback(() => visit.exit('home'), [visit]);
  const onPopupHome = useCallback(() => visit.exit('popup'), [visit]);
  const onCompass = useCallback(() => map.current?.recentre(), []);
  const onCloseCard = useCallback(() => visit.deselect(), [visit]);
  const onMapShown = useCallback(() => setMapShown(true), []);

  const selected = snap.selectedId ? BUILDING_BY_ID[snap.selectedId as BuildingId] : null;
  const selectedIndex = selected ? BUILDINGS.indexOf(selected) : -1;
  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.value }));

  return (
    <View
      style={styles.root}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0 && (width !== view.w || height !== view.h)) {
          setView({ w: width, h: height });
        }
      }}
    >
      <View
        style={StyleSheet.absoluteFill}
        importantForAccessibility={popupUp ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={popupUp}
      >
        <CityMap
          ref={map}
          width={view.w}
          height={view.h}
          interactive={snap.phase === 'exploring'}
          selectedIndex={selectedIndex}
          tapCount={tapCount}
          reduceMotion={reduceMotion}
          onTap={onTap}
          onGesture={onGesture}
          onMapShown={onMapShown}
        />
        <Scale transparent>
          <CityHud
            coins={coins}
            gems={profile.gems}
            selected={selected}
            enter={hudIn}
            reduceMotion={reduceMotion}
            onHome={onHome}
            onCompass={onCompass}
            onCloseCard={onCloseCard}
          />
        </Scale>
      </View>

      {popupUp ? (
        <ComingSoonPopup
          stage={snap.popup}
          countdown={snap.countdown}
          enterMs={motion.popupIn}
          reduceMotion={reduceMotion}
          onReturnHome={onPopupHome}
        />
      ) : null}

      {/* Paper over everything while the art resolves and on the way out. */}
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.veil, veilStyle]}
        pointerEvents={snap.phase === 'exiting' ? 'auto' : 'none'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.paper, overflow: 'hidden' },
  veil: { backgroundColor: color.paper },
});
