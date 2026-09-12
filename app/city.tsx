/**
 * The port city (P14). ONE static screen for this build: city-port.png
 * covering the canvas, pinch-to-zoom and pan (a plain Reanimated pinch +
 * pan, no map library), the player card top-left, currency chips top-right,
 * three building slots outlined in ink with a "Coming soon" ribbon, and the
 * Captain saying hello on the first visit only. There is no building system
 * — this screen exists to show where the metagame goes.
 *
 * Zoom is about the canvas centre, 1x..3x, and the pan is clamped so the
 * image edge never comes inside the canvas: at 1x the 2:1 image covers the
 * 800x360 sheet as 800x400, so only 20 dp of vertical play exists until you
 * zoom. Both gestures write shared values; the clamp runs on the UI thread.
 */
import { rankProgress } from '@engine/ranks';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { useProfile } from '@/state/profile';
import { AssetSlot } from '@/ui/AssetSlot';
import { AVATARS, UI_ART } from '@/ui/assets';
import { CurrencyChip } from '@/ui/CurrencyChip';
import { InkButton } from '@/ui/InkButton';
import { RankBadge } from '@/ui/RankBadge';
import { Scale } from '@/ui/Scale';
import { SpeechBubble } from '@/ui/SpeechBubble';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';
import { RoughShape, hashString, useRough } from '@/ui/useRough';

// The map covers the sheet: 2048x1024 scaled to the canvas width.
const MAP_W = CANVAS_W;
const MAP_H = CANVAS_W / 2;
const MIN_SCALE = 1;
const MAX_SCALE = 3;
const CAPTAIN = { w: 150, h: 200 } as const;

/** Where the future buildings go, in map units (at 1x). */
const SLOTS: readonly { key: string; x: number; y: number; w: number; h: number; label: string }[] =
  [
    { key: 'docks', x: 96, y: 232, w: 132, h: 76, label: 'Shipyard' },
    { key: 'hall', x: 350, y: 118, w: 120, h: 80, label: 'Admiralty' },
    { key: 'tower', x: 612, y: 196, w: 104, h: 84, label: 'Lighthouse' },
  ];

function clamp(v: number, lo: number, hi: number): number {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
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
      <View style={{ position: 'absolute', left: (slot.w - 112) / 2, bottom: -14 }}>
        <TitleRibbon title="Coming soon" w={112} h={26} size="md" seedKey={`soon-${slot.key}`} />
      </View>
    </View>
  );
}

export default function CityScreen() {
  const router = useRouter();
  const profile = useProfile();
  const progress = rankProgress(profile.rankPoints);
  const [welcome, setWelcome] = useState(() => !useProfile.getState().hasVisitedCity);

  useEffect(() => {
    if (!welcome) return;
    useProfile.getState().markCityVisited();
    const id = setTimeout(() => setWelcome(false), 4200);
    return () => clearTimeout(id);
  }, [welcome]);

  // ---- pinch + pan, clamped at the image edges ----
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = clamp(savedScale.value * e.scale, MIN_SCALE, MAX_SCALE);
      const maxX = (MAP_W * scale.value - CANVAS_W) / 2;
      const maxY = (MAP_H * scale.value - CANVAS_H) / 2;
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
      const maxX = (MAP_W * scale.value - CANVAS_W) / 2;
      const maxY = (MAP_H * scale.value - CANVAS_H) / 2;
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
      const next = scale.value > 1.05 ? 1 : 2;
      scale.value = withTiming(next, { duration: 260, easing: Easing.out(Easing.cubic) });
      savedScale.value = next;
      const maxX = (MAP_W * next - CANVAS_W) / 2;
      const maxY = (MAP_H * next - CANVAS_H) / 2;
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
    <Scale>
      <View style={styles.root}>
        <GestureDetector gesture={gesture}>
          <Animated.View style={[styles.map, mapStyle]}>
            <AssetSlot
              source={UI_ART.cityPort}
              w={MAP_W}
              h={MAP_H}
              label="city-port 2048x1024"
              tintColor={color.ink}
            />
            {SLOTS.map((slot) => (
              <Slot key={slot.key} slot={slot} />
            ))}
          </Animated.View>
        </GestureDetector>

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
          <CurrencyChip kind="coins" value={profile.coins} />
          <CurrencyChip kind="gems" value={profile.gems} />
        </View>
        <View style={styles.back}>
          <InkButton
            label="↩"
            size="lg"
            w={54}
            h={44}
            seedKey="city-back"
            onPress={() => router.back()}
          />
        </View>

        {welcome ? (
          <>
            <View pointerEvents="none" style={styles.captain}>
              <AssetSlot source={AVATARS.captain} w={CAPTAIN.w} h={CAPTAIN.h} label="captain" />
            </View>
            <View pointerEvents="none" style={styles.bubble}>
              <SpeechBubble
                text="Welcome to your port city!"
                tail="left"
                tailAt={0.3}
                w={230}
                seedKey="city-welcome"
              />
            </View>
          </>
        ) : null}
      </View>
    </Scale>
  );
}

const styles = StyleSheet.create({
  root: { width: CANVAS_W, height: CANVAS_H, overflow: 'hidden', backgroundColor: color.paper },
  map: { position: 'absolute', left: 0, top: (CANVAS_H - MAP_H) / 2, width: MAP_W, height: MAP_H },
  topLeft: { position: 'absolute', left: space.md, top: space.sm },
  topRight: {
    position: 'absolute',
    right: space.md,
    top: space.sm,
    flexDirection: 'row',
    gap: space.xs,
  },
  back: { position: 'absolute', left: space.md, bottom: space.sm },
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
