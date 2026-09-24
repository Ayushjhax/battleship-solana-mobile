/**
 * The HUD strip above the boards — IMG_9770, left to right:
 *   your avatar card · the "Arsenal" tab hanging from the top edge · your
 *   rank, name and points · the opponent's points, rank, name, shield and
 *   flag · their avatar card.
 * Plus the pieces that float over it: the emote sticker and picker, and the
 * hotseat fleet cover.
 */
import { CAPTAINS } from '@engine/captains';
import { rankFor } from '@engine/ranks';
import type { CaptainId } from '@engine/types';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { BOARD_SIZE } from '@/board/layout';
import { useTutorialTarget } from '@/tutorial/useTutorialTarget';
import { AssetSlot } from '@/ui/AssetSlot';
import { AVATARS, EMOTES, type Asset } from '@/ui/assets';
import { chevronPoints, shieldPoints, tabOutline } from '@/ui/geometry';
import { InkPanel } from '@/ui/InkPanel';
import { color, font, space, type as typeScale } from '@/ui/tokens';
import { RoughShape, hashString, roughCircle, roughPolygon, roughRect } from '@/ui/useRough';

// ---------------------------------------------------------------------------
// Avatar card — framed portrait
// ---------------------------------------------------------------------------

export const AVATAR_CARD = { w: 54, h: 62 } as const;

export function AvatarCard({
  avatarId,
  tint,
  seedKey,
}: {
  avatarId: number;
  tint: string;
  seedKey: string;
}) {
  const { w, h } = AVATAR_CARD;
  const seed = hashString(`avatar-card-${seedKey}`);
  const outer = roughRect(1.5, 1.5, w - 3, h - 3, {
    seed,
    strokeWidth: 1.8,
    fill: color.paper,
    fillStyle: 'solid',
  });
  const inner = roughRect(5, 5, w - 10, h - 10, { seed: seed + 1, strokeWidth: 1, roughness: 1 });
  const source: Asset = (AVATARS as Record<number, Asset>)[avatarId] ?? null;
  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={StyleSheet.absoluteFill}>
        <RoughShape paths={outer} />
        <RoughShape paths={inner} />
      </Svg>
      <View style={{ position: 'absolute', left: 7, top: 7 }}>
        <AssetSlot source={source} w={w - 14} h={h - 14} label="avatar" tintColor={tint} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Arsenal tab — scalloped, hanging from the top edge, with a count badge
// ---------------------------------------------------------------------------

export const ARSENAL_TAB = { w: 66, h: 30 } as const;

export function ArsenalTab({ count, onPress }: { count: number; onPress?: () => void }) {
  const { w, h } = ARSENAL_TAB;
  const target = useTutorialTarget('arsenal-tab');
  const seed = hashString('arsenal-tab');
  const tab = roughPolygon(
    tabOutline(w - 4, h - 6).map(([x, y]) => [x + 2, y] as [number, number]),
    {
      seed,
      strokeWidth: 1.6,
      fill: color.paper,
      fillStyle: 'solid',
      roughness: 0.8,
      disableMultiStroke: true,
    },
  );
  const badge = roughCircle(w - 6, 8, 14, {
    seed: seed + 1,
    stroke: color.inkRed,
    strokeWidth: 1.2,
    fill: color.paper,
    fillStyle: 'solid',
  });
  return (
    <Pressable
      {...target}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel="Arsenal"
      style={{ width: w + 8, height: h + 8 }}
    >
      <Svg
        width={w + 8}
        height={h + 8}
        viewBox={`0 0 ${w + 8} ${h + 8}`}
        style={StyleSheet.absoluteFill}
      >
        <RoughShape paths={tab} />
        {count > 0 ? <RoughShape paths={badge} /> : null}
      </Svg>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          top: 2,
          width: w,
          height: h - 8,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: color.inkRed, fontFamily: font.display, fontSize: typeScale.sm }}>
          Arsenal
        </Text>
      </View>
      {count > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: w - 13,
            top: 1,
            width: 14,
            height: 14,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: color.inkRed, fontFamily: font.display, fontSize: typeScale.xxs }}>
            {count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Player block — rank (600/13), name (700/20), "Points: N" in inkRed
// ---------------------------------------------------------------------------

export function PlayerBlock({
  name,
  points,
  align,
  maxWidth,
  captain,
}: {
  name: string;
  points: number;
  align: 'left' | 'right';
  /** Names are up to 14 characters; long ones step down a size before they ellipsise. */
  maxWidth?: number;
  /** Part 10A — the captain this side brought, shown to both players. */
  captain?: CaptainId | null;
}) {
  const textAlign = align;
  const nameSize = name.length <= 8 ? typeScale.md : name.length <= 11 ? typeScale.sm : typeScale.xs;
  const captainName = captain
    ? (CAPTAINS.find((entry) => entry.id === captain)?.name.split(',')[0] ?? captain)
    : null;
  return (
    <View style={{ alignItems: align === 'left' ? 'flex-start' : 'flex-end', maxWidth }}>
      <Text
        numberOfLines={1}
        style={{ color: color.deskDark, fontFamily: font.label, fontSize: typeScale.xs, textAlign }}
      >
        {rankFor(points).name}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          color: color.ink,
          fontFamily: font.display,
          fontSize: nameSize,
          lineHeight: 22,
          textAlign,
        }}
      >
        {name}
      </Text>
      {captainName ? (
        <Text
          numberOfLines={1}
          style={{ color: color.inkSoft, fontFamily: font.label, fontSize: typeScale.xxs, textAlign }}
        >
          ⚓ {captainName}
        </Text>
      ) : null}
    </View>
  );
}

export function PointsBlock({ points, align }: { points: number; align: 'left' | 'right' }) {
  return (
    <View style={{ alignItems: align === 'left' ? 'flex-start' : 'flex-end' }}>
      <Text style={{ color: color.deskDark, fontFamily: font.label, fontSize: typeScale.xs }}>
        Points:
      </Text>
      <Text
        style={{
          color: color.inkRed,
          fontFamily: font.display,
          fontSize: typeScale.md,
          lineHeight: 22,
        }}
      >
        {points}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Chips — rank shield and flag
// ---------------------------------------------------------------------------

export function ShieldChip({ seedKey }: { seedKey: string }) {
  const w = 22;
  const h = 26;
  const seed = hashString(`shield-chip-${seedKey}`);
  const shield = roughPolygon(shieldPoints(w, h, 1.5), {
    seed,
    strokeWidth: 1.3,
    fill: color.inkSoft,
    fillStyle: 'hachure',
    hachureGap: 2.6,
    fillWeight: 1,
  });
  const chevron = roughPolygon(
    chevronPoints(w).map(([x, y]) => [x, y * 0.72] as [number, number]),
    { seed: seed + 1, strokeWidth: 1, fill: color.ink, fillStyle: 'solid' },
  );
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <RoughShape paths={shield} />
      <RoughShape paths={chevron} />
    </Svg>
  );
}

/** The square emblem left of your shield in IMG_9770: a four-blade pinwheel in a rough frame. */
export function EmblemChip({ seedKey }: { seedKey: string }) {
  const w = 26;
  const h = 22;
  const seed = hashString(`emblem-${seedKey}`);
  const frame = roughRect(1, 1, w - 2, h - 2, {
    seed,
    strokeWidth: 1.2,
    fill: color.paper,
    fillStyle: 'solid',
  });
  const cx = w / 2;
  const cy = h / 2;
  const r = 7;
  const blades = [0, 1, 2, 3].map((i) => {
    const a = (i * Math.PI) / 2;
    const b = a + Math.PI / 2;
    const pts: [number, number][] = [
      [cx, cy],
      [cx + r * Math.cos(a), cy + r * Math.sin(a)],
      [cx + r * 0.8 * Math.cos(a + Math.PI / 4), cy + r * 0.8 * Math.sin(a + Math.PI / 4)],
      [cx + r * 0.35 * Math.cos(b), cy + r * 0.35 * Math.sin(b)],
    ];
    return roughPolygon(pts, {
      seed: seed + 1 + i,
      stroke: color.ink,
      strokeWidth: 0.9,
      fill: color.ink,
      fillStyle: 'solid',
      roughness: 0.7,
    });
  });
  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={StyleSheet.absoluteFill}>
        <RoughShape paths={frame} />
        {blades.map((p, i) => (
          <RoughShape key={i} paths={p} />
        ))}
      </Svg>
    </View>
  );
}

export function FlagChip({ code, seedKey }: { code: string; seedKey: string }) {
  const w = 30;
  const h = 20;
  const frame = roughRect(1, 1, w - 2, h - 2, {
    seed: hashString(`flag-${seedKey}`),
    strokeWidth: 1.2,
    fill: color.paper,
    fillStyle: 'solid',
  });
  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={StyleSheet.absoluteFill}>
        <RoughShape paths={frame} />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.centre]}>
        <Text style={{ color: color.inkRed, fontFamily: font.label, fontSize: typeScale.xxs }}>
          {code}
        </Text>
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
  useEffect(() => {
    y.value = 0;
    opacity.value = 0;
    y.value = withTiming(-36, { duration: 1600, easing: Easing.out(Easing.quad) });
    opacity.value = withSequence(
      withTiming(1, { duration: 150 }),
      withTiming(1, { duration: 1050 }),
      withTiming(0, { duration: 400 }),
    );
  }, [nonce, y, opacity]);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: y.value }],
  }));
  const emote = EMOTES.find((e) => e.id === id) ?? EMOTES[0];
  return (
    <Animated.View pointerEvents="none" style={[styles.float, style]}>
      <AssetSlot source={emote?.source ?? null} w={36} h={36} label={emote?.label ?? 'emote'} />
    </Animated.View>
  );
}

export function EmotePanel({
  onPick,
  onClose,
}: {
  onPick: (id: number) => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.panelWrap} pointerEvents="box-none">
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel="Close emotes"
      />
      <InkPanel w={216} h={132} seedKey="emotes" padding={space.xs}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
          {EMOTES.map((emote) => (
            <Pressable
              key={emote.id}
              onPress={() => onPick(emote.id)}
              accessibilityLabel={emote.label}
            >
              <AssetSlot source={emote.source} w={42} h={42} label={emote.label} />
            </Pressable>
          ))}
        </View>
      </InkPanel>
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
  centre: { alignItems: 'center', justifyContent: 'center' },
  float: { position: 'absolute', width: 36, height: 36 },
  panelWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
