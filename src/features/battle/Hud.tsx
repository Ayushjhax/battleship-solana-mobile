/**
 * The battle's HUD, drawn to its mockup in the fleet art — left to right:
 *   your captain in the portrait frame · the Arsenal button (the chest, with
 *   a red count of what is left) over your plate — star, rank shield, rank,
 *   name, points · the Empire of Bits banner · the opponent's plate — points,
 *   rank, name, shield, port — · their captain.
 * Plus the pieces that float over it: the emote sticker and picker, and the
 * hotseat fleet cover.
 */
import { rankFor } from '@engine/ranks';
import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { haptic } from '@/audio/haptics';
import { BOARD_SIZE } from '@/board/layout';
import { useTutorialTarget } from '@/tutorial/useTutorialTarget';
import { BATTLE_ART, EMOTES } from '@/ui/assets';
import { InkPanel } from '@/ui/InkPanel';
import { portraitFor } from '@/ui/portraits';
import { artColor, color, font, space, type as typeScale } from '@/ui/tokens';

// ---------------------------------------------------------------------------
// Portrait — the player's own captain in the frame
// ---------------------------------------------------------------------------

export const PORTRAIT = { w: 52, h: 52 * (183 / 168) } as const;

/**
 * The frame's hole (18..149 x 17..163 of 168 x 183) holds the captain's
 * portrait art, cropped to it: that art carries a mat of its own and its
 * picture fills ~78 % of the square, so it is scaled up to meet the hole.
 */
export function PortraitCard({ avatarId, tint }: { avatarId: number; tint: string }) {
  const k = PORTRAIT.w / 168;
  const hole = { x: 18 * k, y: 17 * k, w: 131 * k, h: 146 * k };
  const pic = Math.max(hole.w, hole.h) / 0.78;
  return (
    <View style={{ width: PORTRAIT.w, height: PORTRAIT.h }}>
      <View style={[styles.hole, { left: hole.x, top: hole.y, width: hole.w, height: hole.h }]}>
        <Image
          source={portraitFor(avatarId, tint)}
          style={{ position: 'absolute', left: (hole.w - pic) / 2, top: (hole.h - pic) / 2, width: pic, height: pic }}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      </View>
      <Image source={BATTLE_ART.portraitFrame} style={StyleSheet.absoluteFill} contentFit="fill" />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Arsenal button — the chest, with a red count of what is left
// ---------------------------------------------------------------------------

export const ARSENAL_BUTTON = { w: 96, h: 96 * (60 / 195) } as const;
const BADGE = 17;

export function ArsenalButton({ count, onPress }: { count: number; onPress?: () => void }) {
  const target = useTutorialTarget('arsenal-tab');
  const reduceMotion = useReducedMotion();
  const press = useSharedValue(1);
  const bump = useSharedValue(1);
  const first = useRef(true);
  // The count pops each time a weapon is spent, so a used one is noticed.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduceMotion) return;
    bump.value = withSequence(withTiming(1.35, { duration: 110 }), withSpring(1, { damping: 9, stiffness: 260 }));
  }, [bump, count, reduceMotion]);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: bump.value }] }));
  return (
    <Pressable
      {...target}
      onPress={onPress}
      onPressIn={() => {
        press.value = withTiming(0.94, { duration: 70 });
        haptic('buttonPress');
      }}
      onPressOut={() => {
        press.value = withSpring(1, { damping: 11, stiffness: 360 });
      }}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`Arsenal, ${count} left`}
      style={{ width: ARSENAL_BUTTON.w + BADGE / 2, height: ARSENAL_BUTTON.h + 4 }}
    >
      <Animated.View style={[{ width: ARSENAL_BUTTON.w, height: ARSENAL_BUTTON.h, marginTop: 4 }, pressStyle]}>
        <Image source={BATTLE_ART.arsenalButton} style={StyleSheet.absoluteFill} contentFit="fill" />
      </Animated.View>
      {count > 0 ? (
        <Animated.View pointerEvents="none" style={[styles.badge, badgeStyle]}>
          <Svg width={BADGE} height={BADGE} viewBox={`0 0 ${BADGE} ${BADGE}`} style={StyleSheet.absoluteFill}>
            <Circle cx={BADGE / 2} cy={BADGE / 2} r={BADGE / 2 - 1} fill={artColor.red} stroke="#FFF7EE" strokeWidth={1.2} />
          </Svg>
          <Text style={styles.badgeText}>{count}</Text>
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Player plate — rank, name and points in the info frame
// ---------------------------------------------------------------------------

export const PLATE = { w: 256, h: 40 } as const;

/**
 * Yours reads star · shield · rank over name · points; the opponent's is its
 * mirror — points · rank over name · shield · port — as in the mockup.
 */
export function PlayerPlate({
  side,
  name,
  points,
  countryCode,
}: {
  side: 'left' | 'right';
  name: string;
  points: number;
  countryCode?: string;
}) {
  const rank = rankFor(points).name;
  const nameSize = name.length <= 9 ? 18 : name.length <= 12 ? 16 : 14;
  const left = side === 'left';
  const who = (
    <View style={[styles.who, { alignItems: left ? 'flex-start' : 'flex-end' }]}>
      <Text numberOfLines={1} style={styles.rank}>
        {rank}
      </Text>
      <Text numberOfLines={1} style={[styles.name, { fontSize: nameSize, textAlign: left ? 'left' : 'right' }]}>
        {name}
      </Text>
    </View>
  );
  const score = (
    <View style={[styles.score, { alignItems: left ? 'flex-end' : 'flex-start' }]}>
      <Text style={styles.pointsLabel}>Points:</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.points}>
        {points}
      </Text>
    </View>
  );
  return (
    <View style={{ width: PLATE.w, height: PLATE.h }} accessibilityLabel={`${rank} ${name}, ${points} points`}>
      <Image source={BATTLE_ART.infoFrame} style={StyleSheet.absoluteFill} contentFit="fill" />
      <View style={[styles.plateRow, { flexDirection: left ? 'row' : 'row-reverse' }]}>
        {left ? (
          <Image source={BATTLE_ART.starBadge} style={styles.star} contentFit="contain" />
        ) : (
          <View style={styles.port}>
            <Text style={styles.portText}>{(countryCode || '··').slice(0, 2).toUpperCase()}</Text>
          </View>
        )}
        <Image
          source={left ? BATTLE_ART.rankBadge : BATTLE_ART.rankBadgeAdmiral}
          style={styles.shield}
          contentFit="contain"
        />
        {who}
        {score}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Emotes — the floating sticker and the picker
// ---------------------------------------------------------------------------

export function EmoteFloat({ id, nonce }: { id: number; nonce: number }) {
  const y = useSharedValue(0);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.4);
  useEffect(() => {
    y.value = 0;
    opacity.value = 0;
    scale.value = 0.4;
    scale.value = withSpring(1, { damping: 8, stiffness: 220 });
    y.value = withTiming(-34, { duration: 1700, easing: Easing.out(Easing.quad) });
    opacity.value = withSequence(
      withTiming(1, { duration: 140 }),
      withTiming(1, { duration: 1100 }),
      withTiming(0, { duration: 420 }),
    );
  }, [nonce, y, opacity, scale]);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: y.value }, { scale: scale.value }],
  }));
  const emote = EMOTES.find((e) => e.id === id) ?? EMOTES[0];
  return (
    <Animated.View pointerEvents="none" style={[styles.float, style]}>
      {emote?.source ? <Image source={emote.source} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
    </Animated.View>
  );
}

const MENU_W = 250;
const MENU_H = MENU_W * (275 / 446);
const TILE_W = 48;
const TILE_H = TILE_W * (109 / 89);

function EmoteTile({ id, label, source, onPick }: { id: number; label: string; source: (typeof EMOTES)[number]['source']; onPick: (id: number) => void }) {
  const press = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  return (
    <Pressable
      onPress={() => onPick(id)}
      onPressIn={() => {
        press.value = withTiming(0.9, { duration: 70 });
        haptic('buttonPress');
      }}
      onPressOut={() => {
        press.value = withSpring(1, { damping: 10, stiffness: 360 });
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Animated.View style={[{ width: TILE_W, height: TILE_H }, style]}>
        <Image source={BATTLE_ART.emoteTile} style={StyleSheet.absoluteFill} contentFit="fill" />
        {source ? <Image source={source} style={styles.tileArt} contentFit="contain" /> : null}
      </Animated.View>
    </Pressable>
  );
}

/** The picker: eight stickers in the menu frame, over the middle of the boards. */
export function EmotePanel({ onPick, onClose }: { onPick: (id: number) => void; onClose: () => void }) {
  const reduceMotion = useReducedMotion();
  const enter = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    enter.value = withTiming(1, { duration: reduceMotion ? 0 : 190, easing: Easing.out(Easing.back(1.5)) });
  }, [enter, reduceMotion]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -12 * (1 - enter.value) }, { scale: 0.9 + 0.1 * enter.value }],
  }));
  return (
    <View style={styles.panelWrap} pointerEvents="box-none">
      <Pressable style={styles.panelDismiss} onPress={onClose} accessibilityLabel="Close emotes" />
      <Animated.View style={[styles.menu, style]}>
        <Image source={BATTLE_ART.emoteMenu} style={StyleSheet.absoluteFill} contentFit="fill" />
        <Image source={BATTLE_ART.emoteTab} style={styles.menuTab} contentFit="contain" />
        <View style={styles.tiles}>
          {EMOTES.map((emote) => (
            <EmoteTile key={emote.id} id={emote.id} label={emote.label} source={emote.source} onPick={onPick} />
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Fleet cover — the hotseat handover
// ---------------------------------------------------------------------------

/**
 * The sheet overhangs the 280 board by this much on every side — enough that
 * the paper beneath the strokes runs past the last column, and no more, so
 * it stops short of the turn triangle in the gutter.
 */
const COVER_BLEED = 4;
export const COVER_SIZE = BOARD_SIZE + COVER_BLEED * 2;

/**
 * Hotseat: the incoming player's own board under a sheet of paper with their
 * name on it, laid over the board at `origin` in the same commit as the view
 * swap. It is not a dialog. The enemy board beside it stays in view, there
 * is nothing to read, and one tap anywhere on it lifts it — `onLift` is the
 * store's `uncoverFleet`. It replaced a full-screen modal that repeated the
 * same three lines and a Ready button after every miss.
 *
 * Opaque by construction, never by style: a plain paper View sits under the
 * rough strokes, so no frame of the fleet shows through a wobble in the ink.
 */
export function FleetCover({
  name,
  origin,
  onLift,
}: {
  name: string;
  origin: { x: number; y: number };
  onLift: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const lift = useSharedValue(0);
  const lifting = useRef(false);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - lift.value,
    transform: [{ translateY: -14 * lift.value }],
  }));

  const press = () => {
    if (lifting.current) return;
    lifting.current = true;
    if (reduceMotion) {
      onLift();
      return;
    }
    lift.value = withTiming(1, { duration: 160, easing: Easing.in(Easing.quad) }, (done) => {
      if (done) runOnJS(onLift)();
    });
  };

  return (
    <Animated.View
      style={[styles.cover, { left: origin.x - COVER_BLEED, top: origin.y - COVER_BLEED }, style]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}'s fleet is covered. Tap to lift the sheet.`}
        onPress={press}
        style={StyleSheet.absoluteFill}
      >
        <View style={styles.coverPaper} />
        <InkPanel
          w={COVER_SIZE}
          h={COVER_SIZE}
          seedKey="fleet-cover"
          padding={space.md}
          fill="none"
        >
          <View style={styles.coverCopy}>
            <Text style={styles.coverEyebrow}>Fleet of</Text>
            <Text
              style={styles.coverName}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {name}
            </Text>
            <Text style={styles.coverHint}>Tap to lift</Text>
          </View>
        </InkPanel>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hole: { position: 'absolute', overflow: 'hidden' },
  badge: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: BADGE,
    height: BADGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFF7EE', fontFamily: font.display, fontSize: 11, lineHeight: 13 },
  plateRow: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    paddingHorizontal: 9,
    gap: 5,
  },
  star: { width: 20, height: 20 },
  shield: { width: 16, height: 21 },
  port: {
    width: 24,
    height: 17,
    borderWidth: 1.4,
    borderColor: artColor.red,
    backgroundColor: '#FFFDF7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  portText: { color: artColor.red, fontFamily: font.display, fontSize: 10, lineHeight: 12 },
  who: { flex: 1, minWidth: 0 },
  rank: { color: artColor.soft, fontFamily: font.label, fontSize: 10, lineHeight: 12, maxWidth: '100%' },
  name: { color: artColor.navy, fontFamily: font.display, lineHeight: 20, maxWidth: '100%' },
  score: { width: 64 },
  pointsLabel: { color: artColor.soft, fontFamily: font.label, fontSize: 10, lineHeight: 12 },
  points: { color: artColor.red, fontFamily: font.display, fontSize: 18, lineHeight: 20, fontVariant: ['tabular-nums'] },
  float: { position: 'absolute', width: 38, height: 38 },
  panelWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 70,
  },
  panelDismiss: { position: 'absolute', left: -200, top: -200, right: -200, bottom: -200 },
  menu: { width: MENU_W, height: MENU_H, marginTop: 24 },
  menuTab: { position: 'absolute', left: (MENU_W - 30) / 2, top: -14, width: 30, height: 22 },
  tiles: {
    position: 'absolute',
    left: 14,
    right: 14,
    top: 14,
    bottom: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignContent: 'space-between',
  },
  tileArt: { position: 'absolute', left: 7, top: 10, right: 7, bottom: 10 },
  cover: { position: 'absolute', width: COVER_SIZE, height: COVER_SIZE, zIndex: 20 },
  // Under the panel's strokes and a unit past the board on every side.
  coverPaper: {
    position: 'absolute',
    left: 1,
    top: 1,
    right: 3,
    bottom: 3,
    backgroundColor: color.paper,
  },
  coverCopy: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  coverEyebrow: { color: color.inkSoft, fontFamily: font.label, fontSize: typeScale.sm },
  coverName: {
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.xl,
    textAlign: 'center',
    maxWidth: COVER_SIZE - space.md * 2 - 12,
  },
  coverHint: {
    marginTop: space.sm,
    color: color.inkGreen,
    fontFamily: font.label,
    fontSize: typeScale.xs,
  },
});
