/**
 * The main menu's pieces, drawn to its mockup: pastel cards with a navy pen
 * outline sitting on a faint offset base (Rough polygons — never borderRadius
 * or shadow props), colour glyphs from MENU_ART, Fredoka caps and Patrick Hand
 * handwriting. Press feel matches InkButton: light haptic, a 1-unit drop.
 */
import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { haptic } from '@/audio/haptics';
import { FlagBadge } from '@/features/flags/FlagBadge';
import { MENU_ART, type Asset } from '@/ui/assets';
import { roundedRectPoints } from '@/ui/geometry';
import { color, menuColor, menuFont, space, type as typeScale } from '@/ui/tokens';
import { RoughShape, hashString, useRough } from '@/ui/useRough';

/** How far the base shows under a card's bottom edge. */
const BASE_DROP = 3;

interface CardProps {
  w: number;
  h: number;
  fill: string;
  seedKey: string;
  r?: number;
  /** Drawn over the fill but under the outline — the play cards' painting. */
  under?: ReactNode;
  children?: ReactNode;
}

/** A w x h card; the body is h - BASE_DROP tall, the base peeks out below it. */
export function MenuCard({ w, h, fill, seedKey, r = 12, under, children }: CardProps) {
  const { roughPolygon } = useRough();
  const seed = hashString(`menu-card-${seedKey}`);
  const bodyH = h - BASE_DROP - 3;
  const shape = roundedRectPoints(1.5, 1.5, w - 3, bodyH, r);
  const base = roughPolygon(roundedRectPoints(1.5, 1.5 + BASE_DROP, w - 3, bodyH, r), {
    seed: seed + 2,
    stroke: 'none',
    fill: menuColor.navy,
    fillStyle: 'solid',
    roughness: 0.4,
  });
  const body = roughPolygon(shape, {
    seed,
    stroke: 'none',
    fill,
    fillStyle: 'solid',
    roughness: 0.4,
  });
  const outline = roughPolygon(shape, {
    seed: seed + 1,
    stroke: menuColor.navy,
    strokeWidth: 1.6,
    roughness: 0.7,
    bowing: 0.6,
  });
  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={StyleSheet.absoluteFill}>
        <RoughShape paths={base} opacity={0.16} />
        <RoughShape paths={body} />
      </Svg>
      {under}
      <Svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      >
        <RoughShape paths={outline} />
      </Svg>
      {children}
    </View>
  );
}

/** Pressable with the house press feel: haptic on press-in, a 1-unit drop. */
export function PressableInk({
  onPress,
  accessibilityLabel,
  hitSlop,
  children,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  hitSlop?: number;
  children: ReactNode;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        setPressed(true);
        haptic('buttonPress');
      }}
      onPressOut={() => setPressed(false)}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={{ transform: [{ translateY: pressed ? 1 : 0 }] }}>{children}</View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Play online / offline
// ---------------------------------------------------------------------------

/** assets/menu/play-*.jpg are 1100 x 619; the painting is shown whole, never cropped. */
const ART_ASPECT = 1100 / 619;
const ART_INSET = 3;
const CARD_R = 16;
const BUTTON = { w: 196, h: 34, top: 128 } as const;

/**
 * The whole painting across the top of the card, faded into it on every edge
 * so it reads as inked onto the card rather than a photo pasted on it. The top
 * fade is also the wash the title sits on. The rounded clip only keeps the
 * painting inside the pen outline, which is drawn over it.
 */
function Painting({ art, w, fill, id }: { art: Asset; w: number; fill: string; id: string }) {
  const iw = w - ART_INSET * 2;
  const ih = iw / ART_ASPECT;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: ART_INSET,
        top: ART_INSET,
        width: iw,
        height: ih,
        overflow: 'hidden',
        borderRadius: CARD_R - ART_INSET,
      }}
    >
      <Image source={art} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
      <Svg width={iw} height={ih} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`${id}-v`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={fill} stopOpacity={0.85} />
            <Stop offset="0.36" stopColor={fill} stopOpacity={0} />
            <Stop offset="0.8" stopColor={fill} stopOpacity={0} />
            <Stop offset="1" stopColor={fill} stopOpacity={1} />
          </LinearGradient>
          <LinearGradient id={`${id}-h`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={fill} stopOpacity={0.9} />
            <Stop offset="0.05" stopColor={fill} stopOpacity={0} />
            <Stop offset="0.95" stopColor={fill} stopOpacity={0} />
            <Stop offset="1" stopColor={fill} stopOpacity={0.9} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={iw} height={ih} fill={`url(#${id}-v)`} />
        <Rect x={0} y={0} width={iw} height={ih} fill={`url(#${id}-h)`} />
      </Svg>
    </View>
  );
}

export interface PlayCardProps {
  w: number;
  h: number;
  title: string;
  subtitle: string;
  art: Asset;
  fill: string;
  buttonFill: string;
  buttonLabel: string;
  /** A small line under the button, e.g. the online count. */
  footer?: string;
  seedKey: string;
  onPress: () => void;
}

export function PlayCard({
  w,
  h,
  title,
  subtitle,
  art,
  fill,
  buttonFill,
  buttonLabel,
  footer,
  seedKey,
  onPress,
}: PlayCardProps) {
  return (
    <PressableInk onPress={onPress} accessibilityLabel={title}>
      <MenuCard
        w={w}
        h={h}
        fill={fill}
        seedKey={seedKey}
        r={CARD_R}
        under={<Painting art={art} w={w} fill={fill} id={`paint-${seedKey}`} />}
      >
        <Text style={styles.playTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.playSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
        <View style={[styles.playButton, { left: (w - BUTTON.w) / 2 }]}>
          <MenuCard w={BUTTON.w} h={BUTTON.h} fill={buttonFill} seedKey={`${seedKey}-btn`} r={BUTTON.h}>
            <View style={styles.playButtonRow}>
              <Text style={styles.playButtonLabel}>{buttonLabel}</Text>
              <Image source={MENU_ART.play} style={styles.playGlyph} contentFit="contain" />
            </View>
          </MenuCard>
        </View>
        {footer ? (
          <Text style={[styles.playFooter, { top: BUTTON.top + BUTTON.h + 1 }]} numberOfLines={1}>
            {footer}
          </Text>
        ) : null}
      </MenuCard>
    </PressableInk>
  );
}

// ---------------------------------------------------------------------------
// The bottom row
// ---------------------------------------------------------------------------

export function MenuTile({
  w,
  h,
  label,
  icon,
  fill,
  seedKey,
  onPress,
}: {
  w: number;
  h: number;
  label: string;
  icon: Asset;
  fill: string;
  seedKey: string;
  onPress: () => void;
}) {
  return (
    <PressableInk onPress={onPress} accessibilityLabel={label}>
      <MenuCard w={w} h={h} fill={fill} seedKey={seedKey} r={10}>
        <View style={styles.tileInner}>
          <Image source={icon} style={styles.tileIcon} contentFit="contain" />
          <Text style={styles.tileLabel} numberOfLines={2}>
            {label}
          </Text>
        </View>
      </MenuCard>
    </PressableInk>
  );
}

// ---------------------------------------------------------------------------
// The top bar
// ---------------------------------------------------------------------------

export function CurrencyPill({
  icon,
  value,
  w,
  seedKey,
}: {
  icon: Asset;
  value: number;
  w: number;
  seedKey: string;
}) {
  return (
    <MenuCard w={w} h={32} fill={menuColor.card} seedKey={seedKey} r={9}>
      <View style={styles.pillRow}>
        <Image source={icon} style={styles.pillIcon} contentFit="contain" />
        <Text style={styles.pillValue} numberOfLines={1} adjustsFontSizeToFit>
          {value.toLocaleString()}
        </Text>
      </View>
    </MenuCard>
  );
}

export function ProfileCard({
  w,
  h,
  name,
  portrait,
  countryCode,
  rank,
  current,
  total,
  onPress,
}: {
  w: number;
  h: number;
  name: string;
  /** The captain the player chose, in their colour (portraitFor). */
  portrait: Asset;
  /** Pinned to the portrait's lower corner. */
  countryCode?: string;
  rank: string;
  current: number;
  total: number;
  onPress: () => void;
}) {
  const { roughPolygon } = useRough();
  const barW = w - 150;
  const barH = 9;
  const ratio = total > 0 ? Math.min(1, current / total) : 1;
  const seed = hashString('menu-rank-bar');
  const track = roughPolygon(roundedRectPoints(1, 1, barW - 2, barH - 2, barH), {
    seed,
    stroke: menuColor.navy,
    strokeWidth: 1.1,
    fill: menuColor.rankTrack,
    fillStyle: 'solid',
    roughness: 0.5,
  });
  const fillW = Math.max(barH, (barW - 4) * ratio);
  const fill =
    ratio > 0
      ? roughPolygon(roundedRectPoints(2, 2, fillW, barH - 4, barH), {
          seed: seed + 1,
          stroke: 'none',
          fill: menuColor.rankBar,
          fillStyle: 'solid',
          roughness: 0.3,
        })
      : null;
  return (
    <PressableInk onPress={onPress} accessibilityLabel={`Profile, ${name}`}>
      <MenuCard w={w} h={h} fill={menuColor.card} seedKey="menu-profile" r={12}>
        <Image
          source={portrait ?? MENU_ART.captain}
          style={styles.profileAvatar}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={120}
        />
        {countryCode !== undefined ? (
          <FlagBadge code={countryCode} w={24} style={styles.profileFlag} />
        ) : null}
        <View style={styles.profileText}>
          <Text style={styles.profileName} numberOfLines={1}>
            {name}
          </Text>
          <View style={styles.profileRankRow}>
            <Image source={MENU_ART.rank} style={styles.profileRankIcon} contentFit="contain" />
            <Text style={styles.profileRank} numberOfLines={1}>
              {rank}
            </Text>
          </View>
          <View style={styles.profileBarRow}>
            <Svg width={barW} height={barH} viewBox={`0 0 ${barW} ${barH}`}>
              <RoughShape paths={track} />
              {fill ? <RoughShape paths={fill} /> : null}
            </Svg>
            <Text style={styles.profileReadout}>
              {current}/{total}
            </Text>
          </View>
        </View>
      </MenuCard>
    </PressableInk>
  );
}

/**
 * A bare glyph on a small white tile, sized to sit beside the settings tile.
 * `crossed` dims it under a red pen slash — the speaker when muted.
 */
export function GlyphTileButton({
  source,
  size,
  seedKey,
  accessibilityLabel,
  onPress,
  crossed = false,
}: {
  source: Asset;
  size: number;
  seedKey: string;
  accessibilityLabel: string;
  onPress: () => void;
  crossed?: boolean;
}) {
  const { roughLine } = useRough();
  const h = size + BASE_DROP;
  const slash = crossed
    ? roughLine(size * 0.22, size * 0.2, size * 0.78, size * 0.76, {
        seed: hashString(`${seedKey}-slash`),
        stroke: color.inkRed,
        strokeWidth: 2.4,
        roughness: 0.8,
      })
    : null;
  return (
    <PressableInk onPress={onPress} accessibilityLabel={accessibilityLabel} hitSlop={space.xxs}>
      <MenuCard w={size} h={h} fill={menuColor.card} seedKey={seedKey} r={9}>
        <View style={styles.glyphTileInner}>
          <Image
            source={source}
            style={{ width: size * 0.64, height: size * 0.64, opacity: crossed ? 0.45 : 1 }}
            contentFit="contain"
          />
        </View>
        {slash ? (
          <Svg
            width={size}
            height={h}
            viewBox={`0 0 ${size} ${h}`}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          >
            <RoughShape paths={slash} />
          </Svg>
        ) : null}
      </MenuCard>
    </PressableInk>
  );
}

/** A full-colour icon that keeps its own tile, e.g. the settings gear. */
export function IconTileButton({
  source,
  size,
  accessibilityLabel,
  onPress,
}: {
  source: Asset;
  size: number;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <PressableInk onPress={onPress} accessibilityLabel={accessibilityLabel} hitSlop={space.xs}>
      <Image source={source} style={{ width: size, height: size }} contentFit="contain" />
    </PressableInk>
  );
}

const styles = StyleSheet.create({
  playTitle: {
    position: 'absolute',
    left: space.sm,
    right: space.sm,
    top: 8,
    color: menuColor.navy,
    fontFamily: menuFont.capsBold,
    fontSize: typeScale.lg,
    lineHeight: 30,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  playSubtitle: {
    position: 'absolute',
    left: space.sm,
    right: space.sm,
    top: 36,
    color: menuColor.navy,
    fontFamily: menuFont.hand,
    fontSize: typeScale.sm,
    lineHeight: 18,
    textAlign: 'center',
  },
  playButton: { position: 'absolute', top: BUTTON.top },
  playButtonRow: {
    flex: 1,
    paddingBottom: BASE_DROP,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  playButtonLabel: {
    color: menuColor.navy,
    fontFamily: menuFont.capsBold,
    fontSize: typeScale.sm,
    letterSpacing: 0.5,
  },
  playGlyph: { width: 20, height: 14 },
  playFooter: {
    position: 'absolute',
    left: space.sm,
    right: space.sm,
    color: menuColor.navy,
    fontFamily: menuFont.hand,
    fontSize: typeScale.xs,
    lineHeight: 14,
    textAlign: 'center',
  },
  tileInner: {
    flex: 1,
    paddingTop: 5,
    paddingBottom: BASE_DROP + 3,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tileIcon: { width: 34, height: 30 },
  tileLabel: {
    color: menuColor.navy,
    fontFamily: menuFont.caps,
    fontSize: typeScale.xxs,
    lineHeight: 12,
    textAlign: 'center',
  },
  pillRow: {
    flex: 1,
    paddingBottom: BASE_DROP,
    paddingHorizontal: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pillIcon: { width: 20, height: 20 },
  pillValue: {
    flex: 1,
    color: menuColor.navy,
    fontFamily: menuFont.caps,
    fontSize: typeScale.sm,
    textAlign: 'center',
  },
  glyphTileInner: {
    flex: 1,
    paddingBottom: BASE_DROP + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatar: { position: 'absolute', left: 6, top: 5, width: 50, height: 50 },
  profileFlag: { position: 'absolute', left: 38, top: 39, transform: [{ rotate: '-7deg' }] },
  profileText: { position: 'absolute', left: 62, right: 8, top: 4 },
  profileName: {
    color: menuColor.navy,
    fontFamily: menuFont.hand,
    fontSize: typeScale.md,
    lineHeight: 21,
  },
  profileRankRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  profileRankIcon: { width: 15, height: 15 },
  profileRank: {
    flex: 1,
    color: menuColor.navy,
    fontFamily: menuFont.hand,
    fontSize: typeScale.xs,
    lineHeight: 15,
  },
  profileBarRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  profileReadout: {
    color: menuColor.navy,
    fontFamily: menuFont.hand,
    fontSize: typeScale.xs,
    lineHeight: 14,
  },
});
