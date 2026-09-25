/**
 * The illustrated "How to play" walkthrough (assets/how-to-play-assets): five
 * swipeable pages — welcome, fire, a miss, picking a target, placing your
 * fleet — each narrated by the same captain in the corner. It is a quick,
 * read-only primer, distinct from the interactive lesson at `/tutorial`
 * (src/tutorial): nothing here is live gameplay, so it can show the whole
 * board at a glance rather than teaching one tap at a time.
 *
 * Navigation: swipe, or tap the left/right edge; Skip and the Android back
 * button both leave for the menu (back steps back first). The last page's
 * "Let's play!" goes straight into an AI match.
 */
import { rankFor } from '@engine/ranks';
import { specFor } from '@engine/arsenal';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { haptic } from '@/audio/haptics';
import { useFrameClock, SpriteStrip } from '@/fx/Sprite';
import { useProfile } from '@/state/profile';
import { ArtPlate } from '@/ui/ArtPlate';
import { BACKGROUNDS, FX_ART, HOW_TO_PLAY_ART, type Asset } from '@/ui/assets';
import { portraitFor } from '@/ui/portraits';
import { Scale, useScale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, artColor, font } from '@/ui/tokens';

const STEP_COUNT = 5;
const HTP = HOW_TO_PLAY_ART;
/** board-frame.png's own aspect (w / h) — every mini board is drawn at this. */
const BOARD_ASPECT = 587 / 598;
/** Native w x h of ships/ship-01..08.png, largest first (FLEET_SPEC's order). */
const SHIP_DIMS: readonly (readonly [number, number])[] = [
  [126, 45],
  [97, 38],
  [110, 38],
  [77, 28],
  [71, 32],
  [70, 27],
  [47, 21],
  [42, 18],
];

// ---------------------------------------------------------------------------
// Shared pieces every page draws with
// ---------------------------------------------------------------------------

function MiniBoard({ x, y, h }: { x: number; y: number; h: number }) {
  const w = h * BOARD_ASPECT;
  return (
    <Image
      source={HTP.placeFleet.boardFrame}
      style={{ position: 'absolute', left: x, top: y, width: w, height: h }}
      contentFit="fill"
    />
  );
}

function StepShip({
  index,
  x,
  y,
  w,
  rotate = 0,
}: {
  /** Which of the 8 fleet ships — 0 is the battleship, 7 the smaller boat. */
  index: number;
  x: number;
  y: number;
  w: number;
  rotate?: number;
}) {
  const [iw, ih] = SHIP_DIMS[index] ?? [100, 40];
  const h = (w * ih) / iw;
  return (
    <Image
      source={HTP.ships[index]}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        transform: [{ rotate: `${rotate}deg` }],
      }}
      contentFit="fill"
    />
  );
}

/** The captain in the corner, with this page's line in its own speech bubble. */
function Narrator({ speech, aspect }: { speech: Asset; aspect: number }) {
  const capH = 150;
  const capW = (capH * 313) / 406;
  const cx = CANVAS_W - 8 - capW;
  const cy = CANVAS_H - capH - 4;
  const sw = 214;
  const sh = sw / aspect;
  return (
    <>
      <Image
        source={speech}
        style={{ position: 'absolute', left: cx - sw + 34, top: cy - sh * 0.35, width: sw, height: sh }}
        contentFit="contain"
      />
      <Image
        source={HTP.shared.captainIllustration}
        style={{ position: 'absolute', left: cx, top: cy, width: capW, height: capH }}
        contentFit="contain"
      />
    </>
  );
}

const CHIP = { w: 40 } as const;
const CHIP_X = 10;
const CHIP_Y = 6;

/** The player's own chip (real portrait, name and rank) and a fixed "guide" opposite them. */
function HudChips() {
  const profile = useProfile();
  const fw = CHIP.w;
  const fh = (fw * 335) / 321;
  const hole = { x: CHIP_X + (16 * fw) / 321, y: CHIP_Y + (17 * fh) / 335, w: (fw * 285) / 321, h: (fh * 294) / 335 };
  const pic = Math.max(hole.w, hole.h) / 0.78;
  return (
    <>
      <View pointerEvents="none" style={[styles.hole, { left: hole.x, top: hole.y, width: hole.w, height: hole.h }]}>
        <Image
          source={portraitFor(profile.avatarId, profile.avatarColor)}
          style={{ position: 'absolute', left: (hole.w - pic) / 2, top: (hole.h - pic) / 2, width: pic, height: pic }}
          contentFit="cover"
        />
      </View>
      <Image
        source={HTP.shared.captainCardFrame}
        style={{ position: 'absolute', left: CHIP_X, top: CHIP_Y, width: fw, height: fh }}
        contentFit="fill"
      />
      <Text numberOfLines={1} style={[styles.hudName, { left: CHIP_X + fw + 7, top: CHIP_Y + 2 }]}>
        {profile.name || 'Sailor'}
      </Text>
      <Text numberOfLines={1} style={[styles.hudRank, { left: CHIP_X + fw + 7, top: CHIP_Y + 19 }]}>
        {rankFor(profile.rankPoints).name}
      </Text>
      <Text numberOfLines={1} style={[styles.hudPoints, { left: CHIP_X + fw + 7, top: CHIP_Y + 32 }]}>
        {`Points: ${profile.rankPoints}`}
      </Text>
      <Image
        source={HTP.shared.arsenalButton}
        style={{ position: 'absolute', left: CHIP_X, top: CHIP_Y + fh + 4, width: 62, height: (62 * 86) / 215 }}
        contentFit="contain"
      />

      {(() => {
        const ofw = CHIP.w;
        const ofh = (ofw * 146) / 135;
        const ofx = CANVAS_W - 10 - ofw;
        return (
          <>
            <Image
              source={HTP.shared.opponentAvatar}
              style={{ position: 'absolute', left: ofx, top: CHIP_Y, width: ofw, height: ofh }}
              contentFit="contain"
            />
            <Text numberOfLines={1} style={[styles.hudName, styles.hudRight, { right: CANVAS_W - ofx + 4, top: CHIP_Y + 2 }]}>
              The Captain
            </Text>
            <Text numberOfLines={1} style={[styles.hudRank, styles.hudRight, { right: CANVAS_W - ofx + 4, top: CHIP_Y + 19 }]}>
              Vice-admiral
            </Text>
          </>
        );
      })()}

      <Image source={HTP.shared.strategyQuote} style={styles.quoteLeft} contentFit="contain" />
      <Image source={HTP.shared.seagullSmall} style={styles.gullLeft} contentFit="contain" />
      <Image source={HTP.shared.smallerBattlesQuote} style={styles.quoteRight} contentFit="contain" />
      <Image source={HTP.shared.seagullWide} style={styles.gullRight} contentFit="contain" />
    </>
  );
}

const OWN_X = 66;
const BOARD_Y = 96;
const BOARD_H = 172;
const ENEMY_X = OWN_X + BOARD_H * BOARD_ASPECT + 44;

/** The own board's usual eight ships, drawn the same across steps 1-3. */
function OwnFleet() {
  return (
    <>
      <StepShip index={0} x={OWN_X + 26} y={BOARD_Y + 18} w={74} />
      <StepShip index={2} x={OWN_X + 40} y={BOARD_Y + 70} w={62} rotate={8} />
      <StepShip index={3} x={OWN_X + 18} y={BOARD_Y + 110} w={42} rotate={-6} />
      <StepShip index={5} x={OWN_X + 90} y={BOARD_Y + 52} w={40} rotate={90} />
      <StepShip index={6} x={OWN_X + 100} y={BOARD_Y + 130} w={26} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Page 1 — welcome
// ---------------------------------------------------------------------------

function WelcomeStep() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <HudChips />
      <MiniBoard x={OWN_X} y={BOARD_Y} h={BOARD_H} />
      <MiniBoard x={ENEMY_X} y={BOARD_Y} h={BOARD_H} />
      <Image
        source={HTP.shared.crossedSwords}
        style={{ position: 'absolute', left: (OWN_X + BOARD_H * BOARD_ASPECT + ENEMY_X) / 2 - 11, top: 170, width: 22, height: (22 * 80) / 74 }}
        contentFit="contain"
      />
      <OwnFleet />
      <Narrator speech={HTP.welcome.speech} aspect={493 / 146} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Page 2 — fire
// ---------------------------------------------------------------------------

function TapPulse({ x, y, w, source, aspect }: { x: number; y: number; w: number; source: Asset; aspect: number }) {
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    t.value = withSequence(
      withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }),
      withDelay(320, withTiming(0, { duration: 0 })),
    );
    const id = setInterval(() => {
      t.value = withSequence(withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }), withDelay(320, withTiming(0, { duration: 0 })));
    }, 1400);
    return () => clearInterval(id);
  }, [reduceMotion, t]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.08 * t.value }] }));
  const gh = w / aspect;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x, top: y, width: w, height: gh }, style]}>
      <Image source={source} style={StyleSheet.absoluteFill} contentFit="contain" />
    </Animated.View>
  );
}

function FireStep() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <HudChips />
      <MiniBoard x={OWN_X} y={BOARD_Y} h={BOARD_H} />
      <MiniBoard x={ENEMY_X} y={BOARD_Y} h={BOARD_H} />
      <OwnFleet />
      <TapPulse x={ENEMY_X + BOARD_H * BOARD_ASPECT * 0.42} y={BOARD_Y + BOARD_H * 0.35} w={42} aspect={125 / 128} source={HTP.fire.tapGesture} />
      <Narrator speech={HTP.fire.speech} aspect={471 / 130} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Page 3 — a miss ends your turn
// ---------------------------------------------------------------------------

function LoopingSplash({ x, y, w }: { x: number; y: number; w: number }) {
  const strip = FX_ART.splash;
  const frame = useFrameClock({ frames: strip.frames, durationMs: 1400, loop: true });
  const h = w / strip.aspect;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x - w / 2, top: y - h * 0.62 }}>
      <SpriteStrip strip={strip} width={w} frame={frame} />
    </View>
  );
}

function MissStep() {
  const tx = ENEMY_X + BOARD_H * BOARD_ASPECT * 0.5;
  const ty = BOARD_Y + BOARD_H * 0.45;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <HudChips />
      <MiniBoard x={OWN_X} y={BOARD_Y} h={BOARD_H} />
      <MiniBoard x={ENEMY_X} y={BOARD_Y} h={BOARD_H} />
      <StepShip index={0} x={OWN_X + 26} y={BOARD_Y + 18} w={74} />
      <StepShip index={2} x={OWN_X + 40} y={BOARD_Y + 70} w={62} rotate={8} />
      <StepShip index={6} x={OWN_X + 100} y={BOARD_Y + 130} w={26} />
      <Image
        source={HTP.miss.hitCross}
        style={{ position: 'absolute', left: OWN_X + BOARD_H * BOARD_ASPECT * 0.55, top: BOARD_Y + 18, width: 16, height: 16 }}
        contentFit="contain"
      />
      <Image
        source={HTP.miss.secondHitCross}
        style={{ position: 'absolute', left: OWN_X + BOARD_H * BOARD_ASPECT * 0.3, top: BOARD_Y + 95, width: 16, height: 16 }}
        contentFit="contain"
      />
      <LoopingSplash x={tx} y={ty} w={34} />
      <Image
        source={HTP.miss.tapGesture}
        style={{ position: 'absolute', left: tx, top: ty, width: 38, height: (38 * 139) / 113 }}
        contentFit="contain"
      />
      <Narrator speech={HTP.miss.speech} aspect={486 / 132} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Page 4 — pick your target (the bomber, then the atomic bomb, on a loop)
// ---------------------------------------------------------------------------

type Demo = 'bomber' | 'atomic';
const DEMO_MS = 3400;
const FLIGHT_MS = 1500;
const IMPACT_DELAY_MS = 1150;

function FlightDemo({ kind, hcx, hcy, hs }: { kind: Demo; hcx: number; hcy: number; hs: number }) {
  const reduceMotion = useReducedMotion();
  const bomber = kind === 'bomber';
  const strip = FX_ART.aircraft[bomber ? 'bomber' : 'atomicBomber'];
  const shadow = FX_ART.shadows[bomber ? 'twin' : 'quad'];
  const width = bomber ? 44 : 54;
  const shadowW = width * (bomber ? 0.9 : 0.85);
  const startX = hcx - 140;
  const flightFrame = useFrameClock({ frames: strip.frames, durationMs: 480, loop: true });
  const progress = useSharedValue(0);
  const opacity = useSharedValue(1);
  useEffect(() => {
    progress.value = withTiming(1, { duration: reduceMotion ? 0 : FLIGHT_MS, easing: Easing.linear });
    opacity.value = withDelay(reduceMotion ? 0 : FLIGHT_MS - 120, withTiming(0, { duration: reduceMotion ? 0 : 220 }));
  }, [opacity, progress, reduceMotion]);
  const planeStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: startX + (hcx + 30 - startX) * progress.value }, { translateY: hcy - 20 }],
  }));
  const shadowStyle = useAnimatedStyle(() => ({
    opacity: 0.3 * opacity.value,
    transform: [{ translateX: startX + 8 + (hcx + 38 - startX) * progress.value }, { translateY: hcy - 6 }],
  }));

  const bombFrame = useFrameClock({ frames: FX_ART.bomb.frames, durationMs: 320, delayMs: IMPACT_DELAY_MS - 260, reverse: true });
  const impactFrame = useFrameClock({
    frames: bomber ? FX_ART.explosionFire.frames : FX_ART.explosionAtomic.frames,
    durationMs: bomber ? 520 : 700,
    delayMs: IMPACT_DELAY_MS,
  });
  const smokeFrame = useFrameClock({
    frames: FX_ART.smoke.frames,
    durationMs: 1200,
    delayMs: IMPACT_DELAY_MS + 260,
    loop: !bomber,
  });

  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.abs, { width: shadowW, height: shadowW / shadow.aspect }, shadowStyle]}>
        <Image source={shadow.source} style={StyleSheet.absoluteFill} contentFit="fill" />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.abs, { width, height: width / strip.aspect, marginLeft: -width / 2 }, planeStyle]}>
        <SpriteStrip strip={strip} width={width} frame={flightFrame} />
      </Animated.View>
      {bomber ? (
        <View pointerEvents="none" style={[styles.abs, { left: hcx + hs / 2 - 6, top: hcy - 26 }]}>
          <SpriteStrip strip={FX_ART.bomb} width={12} frame={bombFrame} />
        </View>
      ) : null}
      <View pointerEvents="none" style={[styles.abs, { left: hcx + hs / 2 - (bomber ? 27 : 38), top: hcy + hs / 2 - (bomber ? 27 : 38) }]}>
        <SpriteStrip strip={bomber ? FX_ART.explosionFire : FX_ART.explosionAtomic} width={bomber ? 54 : 76} frame={impactFrame} />
      </View>
      <View pointerEvents="none" style={[styles.abs, { left: hcx + hs / 2 - (bomber ? 19 : 26), top: hcy + hs / 2 - (bomber ? 30 : 40) }]}>
        <SpriteStrip strip={FX_ART.smoke} width={bomber ? 38 : 50} frame={smokeFrame} />
      </View>
    </>
  );
}

function TargetStep() {
  const [demo, setDemo] = useState<Demo>('bomber');
  useEffect(() => {
    const id = setInterval(() => setDemo((d) => (d === 'bomber' ? 'atomic' : 'bomber')), DEMO_MS);
    return () => clearInterval(id);
  }, []);
  const hcx = ENEMY_X + BOARD_H * BOARD_ASPECT * 0.45;
  const hcy = BOARD_Y + BOARD_H * 0.4;
  const hs = 26;
  const enemyW = BOARD_H * BOARD_ASPECT;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <HudChips />
      <MiniBoard x={OWN_X} y={BOARD_Y} h={BOARD_H} />
      <MiniBoard x={ENEMY_X} y={BOARD_Y} h={BOARD_H} />
      <OwnFleet />
      {demo === 'bomber' ? (
        <Image
          source={HTP.target.actionLabel}
          style={{ position: 'absolute', left: ENEMY_X + (enemyW - 170) / 2, top: BOARD_Y - 32, width: 170, height: (170 * 58) / 386 }}
          contentFit="contain"
        />
      ) : null}
      {demo === 'bomber' ? (
        <>
          <Image source={HTP.target.highlightCell} style={{ position: 'absolute', left: hcx, top: hcy, width: hs, height: hs }} contentFit="fill" />
          <Image source={HTP.target.highlightCell} style={{ position: 'absolute', left: hcx + hs, top: hcy, width: hs, height: hs }} contentFit="fill" />
          <Image source={HTP.target.highlightCell} style={{ position: 'absolute', left: hcx, top: hcy + hs, width: hs, height: hs }} contentFit="fill" />
        </>
      ) : (
        <Image source={HTP.target.highlightCell} style={{ position: 'absolute', left: hcx, top: hcy, width: hs, height: hs }} contentFit="fill" />
      )}
      <Image
        source={HTP.target.crosshair}
        style={{ position: 'absolute', left: hcx + hs / 2 - 8, top: hcy + hs / 2 - 8, width: 16, height: 16 }}
        contentFit="contain"
      />
      <Image
        source={HTP.target.hand}
        style={{ position: 'absolute', left: hcx + hs * 1.4, top: hcy + hs * 1.3, width: 28, height: (28 * 70) / 56 }}
        contentFit="contain"
      />
      <FlightDemo key={demo} kind={demo} hcx={hcx} hcy={hcy} hs={hs} />
      <Narrator speech={HTP.target.speech} aspect={322 / 161} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Page 5 — place your fleet
// ---------------------------------------------------------------------------

const ARSENAL_CARDS: readonly { key: keyof typeof HTP.placeFleet; icon: Asset; label: string; kind: Parameters<typeof specFor>[0] }[] = [
  { key: 'torpedoIcon', icon: HTP.placeFleet.torpedoIcon, label: 'Torpedo', kind: 'torpedoBomber' },
  { key: 'doubleTapIcon', icon: HTP.placeFleet.doubleTapIcon, label: 'Double Tap', kind: 'doubleTorpedoBomber' },
  { key: 'bomberIcon', icon: HTP.placeFleet.bomberIcon, label: 'Bomber', kind: 'bomber' },
  { key: 'mineIcon', icon: HTP.placeFleet.mineIcon, label: 'Mine', kind: 'mine' },
  { key: 'submarineIcon', icon: HTP.placeFleet.submarineIcon, label: 'Submarine', kind: 'submarine' },
];

function PlaceFleetStep() {
  const dx = 8;
  const dy = 46;
  const dw = 44;
  const dh = (dw * 581) / 153;
  const bx = dx + dw + 16;
  const by = 44;
  const bh = 214;
  const bw = bh * BOARD_ASPECT;
  const ax = bx + bw + 14;
  const aw = 196;
  const gap = 6;
  const cw = (aw - gap) / 2;
  const ch = 34;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image source={HTP.placeFleet.backButton} style={{ position: 'absolute', left: 10, top: 8, width: 40, height: (40 * 83) / 118 }} contentFit="contain" />
      <Text style={styles.aiLabel}>AI:</Text>
      <Image source={HTP.placeFleet.easyButton} style={{ position: 'absolute', left: 84, top: 6, width: 54, height: (54 * 78) / 156 }} contentFit="contain" />
      <Image source={HTP.placeFleet.normalButton} style={{ position: 'absolute', left: 142, top: 6, width: 54, height: (54 * 79) / 141 }} contentFit="contain" />
      <Image source={HTP.placeFleet.hardButton} style={{ position: 'absolute', left: 200, top: 6, width: 54, height: (54 * 80) / 138 }} contentFit="contain" />
      <Image source={HTP.placeFleet.wagerOffButton} style={{ position: 'absolute', left: 262, top: 8, width: 62, height: (62 * 85) / 236 }} contentFit="contain" />

      <Image source={HTP.placeFleet.fuelMeter} style={{ position: 'absolute', left: CANVAS_W - 14 - 90, top: 10, width: 90, height: (90 * 32) / 115 }} contentFit="contain" />
      <Image source={HTP.placeFleet.fuelFlame} style={{ position: 'absolute', left: CANVAS_W - 14 - 90 - 18, top: 8, width: 14, height: (14 * 50) / 35 }} contentFit="contain" />
      <Text style={styles.fuelLabel}>Fuel</Text>

      <Image source={HTP.placeFleet.dockFrame} style={{ position: 'absolute', left: dx, top: dy, width: dw, height: dh }} contentFit="fill" />
      <Text style={styles.dockTitle}>Dock</Text>
      <StepShip index={0} x={dx + 4} y={dy + 26} w={34} rotate={90} />
      <StepShip index={2} x={dx + 4} y={dy + 70} w={30} rotate={90} />
      <StepShip index={4} x={dx + 7} y={dy + 108} w={24} rotate={90} />
      <Text style={styles.dockCount}>8 to place</Text>

      <MiniBoard x={bx} y={by} h={bh} />
      <Image
        source={HTP.placeFleet.tapGesture}
        style={{ position: 'absolute', left: bx + bw * 0.4, top: by + bh * 0.42, width: 26, height: (26 * 142) / 118 }}
        contentFit="contain"
      />
      <Image source={HTP.placeFleet.rotateButton} style={{ position: 'absolute', left: bx, top: by + bh + 8, width: 34, height: (34 * 88) / 95 }} contentFit="contain" />
      <Image source={HTP.placeFleet.shuffleButton} style={{ position: 'absolute', left: bx + 42, top: by + bh + 10, width: 64, height: (64 * 79) / 212 }} contentFit="contain" />

      <Text style={[styles.arsenalTitle, { left: ax, width: aw }]}>Arsenal</Text>
      {ARSENAL_CARDS.map((card, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const cx = ax + col * (cw + gap);
        const cy = 80 + row * (ch + gap);
        return (
          <View key={card.kind} style={{ position: 'absolute', left: cx, top: cy, width: cw, height: ch }}>
            <Image source={HTP.placeFleet.arsenalCardFrame} style={StyleSheet.absoluteFill} contentFit="fill" />
            <Image source={card.icon} style={{ position: 'absolute', left: 5, top: (ch - 22) / 2, width: 22, height: 22 }} contentFit="contain" />
            <Text style={styles.cardCount}>{`0/${specFor(card.kind).max}`}</Text>
            <Text numberOfLines={1} style={styles.cardLabel}>
              {card.label}
            </Text>
          </View>
        );
      })}

      <Narrator speech={HTP.placeFleet.speech} aspect={508 / 175} />
    </View>
  );
}

const PAGES = [WelcomeStep, FireStep, MissStep, TargetStep, PlaceFleetStep] as const;

// ---------------------------------------------------------------------------
// Chrome: logo, Skip, dots — fixed on top of the sliding pages
// ---------------------------------------------------------------------------

function Dots({ step }: { step: number }) {
  return (
    <View pointerEvents="none" style={styles.dots}>
      {PAGES.map((_, i) => (
        <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The carousel
// ---------------------------------------------------------------------------

export function HowToPlayScreen() {
  const router = useRouter();
  const { scale } = useScale();
  const [step, setStep] = useState(0);
  const stepRef = useRef(0);
  const reduceMotion = useReducedMotion();
  const tx = useSharedValue(0);
  const dragStart = useSharedValue(0);

  const leave = () => router.replace('/menu' as Href);
  const play = () => router.replace('/placement?mode=ai' as Href);

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(STEP_COUNT - 1, next));
    stepRef.current = clamped;
    setStep(clamped);
    tx.value = withTiming(-clamped * CANVAS_W, { duration: reduceMotion ? 0 : 320, easing: Easing.out(Easing.cubic) });
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stepRef.current > 0) goTo(stepRef.current - 1);
      else leave();
      return true;
    });
    return () => sub.remove();
    // goTo/leave close over refs and router only; stable enough for the life of this screen.
  }, []);

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-16, 16])
    .onStart(() => {
      dragStart.value = tx.value;
    })
    .onUpdate((e) => {
      const raw = dragStart.value + e.translationX / scale;
      const min = -(STEP_COUNT - 1) * CANVAS_W;
      // A little give past either end, so the drag never feels like a wall.
      tx.value = raw > 0 ? raw * 0.35 : raw < min ? min + (raw - min) * 0.35 : raw;
    })
    .onEnd((e) => {
      const dragged = (tx.value - dragStart.value) / CANVAS_W;
      const flick = e.velocityX / scale > 500 ? -1 : e.velocityX / scale < -500 ? 1 : 0;
      const delta = flick !== 0 ? flick : dragged < -0.28 ? 1 : dragged > 0.28 ? -1 : 0;
      runOnJS(goTo)(stepRef.current + delta);
    });

  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  return (
    <Scale backgroundImage={BACKGROUNDS.settings}>
      <GestureDetector gesture={pan}>
        <View style={styles.viewport}>
          <Animated.View style={[styles.strip, stripStyle]}>
            {PAGES.map((Page, i) => (
              <View key={i} style={styles.page}>
                <Page />
              </View>
            ))}
          </Animated.View>
        </View>
      </GestureDetector>

      {/* edge taps: a light nudge back/forward, on top of the swipe */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous"
        onPress={() => {
          if (step > 0) {
            haptic('buttonPress');
            goTo(step - 1);
          }
        }}
        style={styles.edgeLeft}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next"
        onPress={() => {
          if (step < STEP_COUNT - 1) {
            haptic('buttonPress');
            goTo(step + 1);
          }
        }}
        style={styles.edgeRight}
      />

      <Image source={HTP.shared.logo} style={styles.logo} contentFit="contain" pointerEvents="none" />
      <ArtPlate
        family="sketch"
        tone="cream"
        w={78}
        h={30}
        fontSize={14}
        label="Skip »"
        accessibilityLabel="Skip the walkthrough"
        onPress={() => {
          haptic('buttonPress');
          leave();
        }}
        style={styles.skip}
      />
      <Dots step={step} />
      {step === STEP_COUNT - 1 ? (
        <ArtPlate
          family="sketch"
          tone="green"
          w={140}
          h={34}
          fontSize={16}
          label="Let's play!"
          accessibilityLabel="Start a match"
          onPress={() => {
            haptic('buttonPress');
            play();
          }}
          style={styles.playCta}
        />
      ) : null}
    </Scale>
  );
}

const styles = StyleSheet.create({
  viewport: { position: 'absolute', left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, overflow: 'hidden' },
  strip: { flexDirection: 'row', width: CANVAS_W * STEP_COUNT, height: CANVAS_H },
  page: { width: CANVAS_W, height: CANVAS_H },
  abs: { position: 'absolute', left: 0, top: 0 },
  edgeLeft: { position: 'absolute', left: 0, top: 100, width: 40, height: 180 },
  edgeRight: { position: 'absolute', right: 0, top: 100, width: 40, height: 180 },
  logo: { position: 'absolute', left: (CANVAS_W - 158) / 2, top: 6, width: 158, height: (158 * 146) / 463 },
  skip: { position: 'absolute', right: 10, top: 60 },
  playCta: { position: 'absolute', left: (CANVAS_W - 140) / 2, bottom: 14 },
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 8,
    height: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#C7CCE0' },
  dotActive: { width: 8, height: 8, borderRadius: 4, backgroundColor: artColor.navy },
  hole: { position: 'absolute', overflow: 'hidden' },
  hudName: { position: 'absolute', width: 120, color: artColor.navy, fontFamily: font.display, fontSize: 15, lineHeight: 18 },
  hudRank: { position: 'absolute', width: 140, color: artColor.soft, fontFamily: font.label, fontSize: 10, lineHeight: 12 },
  hudPoints: { position: 'absolute', width: 140, color: artColor.red, fontFamily: font.label, fontSize: 10, lineHeight: 12 },
  hudRight: { textAlign: 'right' },
  quoteLeft: { position: 'absolute', left: 10, top: 190, width: 40, height: (40 * 135) / 117 },
  gullLeft: { position: 'absolute', left: 8, top: 176, width: 26, height: (26 * 26) / 57 },
  quoteRight: { position: 'absolute', right: 20, top: 118, width: 34, height: (34 * 152) / 99 },
  gullRight: { position: 'absolute', right: 58, top: 104, width: 28, height: (28 * 29) / 59 },
  aiLabel: { position: 'absolute', left: 60, top: 12, color: artColor.navy, fontFamily: font.display, fontSize: 14 },
  fuelLabel: { position: 'absolute', right: 148, top: 12, color: artColor.navy, fontFamily: font.display, fontSize: 13 },
  dockTitle: { position: 'absolute', left: 8, top: 50, width: 44, textAlign: 'center', color: artColor.navy, fontFamily: font.display, fontSize: 12 },
  dockCount: { position: 'absolute', left: 4, bottom: 34, width: 52, textAlign: 'center', color: artColor.red, fontFamily: font.label, fontSize: 10 },
  arsenalTitle: { position: 'absolute', top: 56, color: artColor.red, fontFamily: font.display, fontSize: 16 },
  cardCount: { position: 'absolute', left: 30, top: 2, width: 26, color: artColor.navy, fontFamily: font.label, fontSize: 10 },
  cardLabel: { position: 'absolute', left: 29, right: 5, bottom: 3, color: artColor.navy, fontFamily: font.display, fontSize: 9.5 },
});
