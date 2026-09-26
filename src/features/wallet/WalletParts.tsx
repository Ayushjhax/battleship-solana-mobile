/**
 * The Captain's wallet pieces, drawn to its mockup in WALLET_ART: plates with
 * live labels (the tabs, Review & send), the two tab glyphs the art set has
 * no icon for (drawn in the same navy pen), the balance sparkles, the network
 * footer and an activity row. Press feel is ArtImageButton's: a light haptic
 * and a quick spring down to 95 % — transform only, so nothing pressable ever
 * animates opacity.
 */
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import { haptic } from '@/audio/haptics';
import { WALLET_ART, type Asset } from '@/ui/assets';
import { InkSpinner } from '@/ui/InkSpinner';
import { artColor, color, font } from '@/ui/tokens';

export const WALLET_INK = artColor.navy;
export const WALLET_GREEN = '#1C8A45';
export const WALLET_BLUE = '#2A3FB8';

/** A pressable that springs down on press; `dim` is a static disabled look. */
export function PressPlate({
  w,
  h,
  label,
  disabled = false,
  hitSlop = 4,
  onPress,
  style,
  children,
}: {
  w: number;
  h: number;
  label: string;
  disabled?: boolean;
  hitSlop?: number;
  onPress: () => void;
  style?: ViewStyle;
  children: ReactNode;
}) {
  const press = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        press.value = withTiming(0.95, { duration: 70 });
        haptic('buttonPress');
      }}
      onPressOut={() => {
        press.value = withSpring(1, { damping: 11, stiffness: 360 });
      }}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[{ width: w, height: h }, style]}
    >
      <Animated.View style={[{ width: w, height: h, opacity: disabled ? 0.5 : 1 }, pressStyle]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

/** A button whose label is part of its art (Copy, Explorer, …); `busy` adds a spinner. */
export function LabelledArtButton({
  source,
  w,
  h,
  label,
  busy = false,
  disabled = false,
  onPress,
}: {
  source: Asset;
  w: number;
  h: number;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <PressPlate
      w={w}
      h={h}
      label={busy ? `${label}, working` : label}
      disabled={disabled || busy}
      onPress={onPress}
    >
      <Image
        source={source}
        style={StyleSheet.absoluteFill}
        contentFit="fill"
        cachePolicy="memory-disk"
      />
      {busy ? (
        <View style={[styles.busy, { top: (h - 18) / 2 - 1 }]} pointerEvents="none">
          <InkSpinner size={18} seedKey={`wallet-${label}`} stroke={WALLET_INK} />
        </View>
      ) : null}
    </PressPlate>
  );
}

/** A blank plate with a live icon + label — the tabs and Review & send. */
export function PlateButton({
  plate,
  w,
  h,
  label,
  icon,
  busy = false,
  disabled = false,
  selected,
  fontSize = 15,
  onPress,
}: {
  plate: Asset;
  w: number;
  h: number;
  label: string;
  icon?: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  /** Set on tabs: the accessibility state, not the look (the plate carries that). */
  selected?: boolean;
  fontSize?: number;
  onPress: () => void;
}) {
  return (
    <PressPlate w={w} h={h} label={label} disabled={disabled || busy} onPress={onPress}>
      <Image
        source={plate}
        style={StyleSheet.absoluteFill}
        contentFit="fill"
        cachePolicy="memory-disk"
      />
      <View
        style={styles.plateRow}
        accessibilityState={selected === undefined ? undefined : { selected }}
      >
        {busy ? <InkSpinner size={17} seedKey={`plate-${label}`} stroke={WALLET_INK} /> : icon}
        <Text style={[styles.plateLabel, { fontSize }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </PressPlate>
  );
}

// ---------------------------------------------------------------------------
// Glyphs the art set has no icon for, in its navy pen
// ---------------------------------------------------------------------------

export function ReceiveGlyph({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3.5 V15" stroke={WALLET_INK} strokeWidth={2.4} strokeLinecap="round" />
      <Path
        d="M7 10.5 L12 15.5 L17 10.5"
        stroke={WALLET_INK}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4 15.5 V19.5 H20 V15.5"
        stroke={WALLET_INK}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ActivityGlyph({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {[6, 12, 18].map((y) => (
        <Rect key={`d${y}`} x={3} y={y - 1.4} width={2.8} height={2.8} rx={1.4} fill={WALLET_INK} />
      ))}
      {[6, 12, 18].map((y) => (
        <Line
          key={`l${y}`}
          x1={9}
          y1={y}
          x2={21}
          y2={y}
          stroke={WALLET_INK}
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      ))}
    </Svg>
  );
}

export function FailedGlyph({ size = 16 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2.8 a9.2 9.2 0 1 0 0.01 0" stroke={color.inkRed} strokeWidth={2.2} />
      <Path
        d="M8.5 8.5 L15.5 15.5 M15.5 8.5 L8.5 15.5"
        stroke={color.inkRed}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** The short pen strokes either side of the balance in the mockup. */
export function Sparkles({ w, h }: { w: number; h: number }) {
  const cy = h / 2;
  const side = (x0: number, dir: 1 | -1) =>
    [
      `M${x0} ${cy - 13} L${x0 + dir * 9} ${cy - 7}`,
      `M${x0 - dir * 2} ${cy} L${x0 + dir * 11} ${cy}`,
      `M${x0} ${cy + 13} L${x0 + dir * 9} ${cy + 7}`,
    ].join(' ');
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path d={side(4, 1)} stroke="#57C28A" strokeWidth={2} strokeLinecap="round" />
      <Path d={side(w - 4, -1)} stroke="#57C28A" strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** The little blue pen marks at the QR code's corners in the mockup; drawn round a `size` box. */
export function QrSparkles({ size, pad = 12 }: { size: number; pad?: number }) {
  const o = pad;
  const e = size + pad;
  const d = [
    `M${o - 2} ${o - 9} L${o + 3} ${o - 3}`,
    `M${o - 9} ${o - 1} L${o - 3} ${o + 3}`,
    `M${e + 2} ${o - 9} L${e - 3} ${o - 3}`,
    `M${e + 9} ${o - 1} L${e + 3} ${o + 3}`,
    `M${o - 2} ${e + 9} L${o + 3} ${e + 3}`,
    `M${o - 9} ${e + 1} L${o - 3} ${e - 3}`,
    `M${e + 2} ${e + 9} L${e - 3} ${e + 3}`,
    `M${e + 9} ${e + 1} L${e + 3} ${e - 3}`,
  ].join(' ');
  return (
    <Svg width={size + pad * 2} height={size + pad * 2} pointerEvents="none">
      <Path d={d} stroke={WALLET_BLUE} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Footer and activity row
// ---------------------------------------------------------------------------

/** "Network: …" between the two pen squiggles; an error or a notice takes the line. */
export function NetworkFooter({
  text,
  tone,
}: {
  text: string;
  tone: 'plain' | 'error' | 'notice';
}) {
  return (
    <View style={styles.footer} accessibilityLiveRegion="polite">
      <Image source={WALLET_ART.footerLeft} style={styles.squiggle} contentFit="contain" />
      <Text
        style={[
          styles.footerText,
          tone === 'error' ? styles.footerError : tone === 'notice' ? styles.footerNotice : null,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {text}
      </Text>
      <Image source={WALLET_ART.footerRight} style={styles.squiggle} contentFit="contain" />
    </View>
  );
}

export function ActivityRow({
  w,
  h,
  failed,
  signature,
  onPress,
}: {
  w: number;
  h: number;
  failed: boolean;
  signature: string;
  onPress: () => void;
}) {
  return (
    <PressPlate
      w={w}
      h={h}
      label={`${failed ? 'Failed' : 'Confirmed'} transaction ${signature}. Open in explorer`}
      hitSlop={1}
      onPress={onPress}
    >
      <Image
        source={WALLET_ART.row}
        style={StyleSheet.absoluteFill}
        contentFit="fill"
        cachePolicy="memory-disk"
      />
      <View style={styles.row}>
        {failed ? (
          <FailedGlyph size={17} />
        ) : (
          <Image source={WALLET_ART.iconConfirmed} style={styles.rowIcon} contentFit="contain" />
        )}
        <Text style={[styles.rowStatus, failed ? styles.rowFailed : null]}>
          {failed ? 'Failed' : 'Confirmed'}
        </Text>
        <Text style={styles.rowSig} numberOfLines={1}>
          {signature}
        </Text>
        <Image source={WALLET_ART.iconChevron} style={styles.rowChevron} contentFit="contain" />
      </View>
    </PressPlate>
  );
}

const styles = StyleSheet.create({
  busy: { position: 'absolute', right: 10 },
  plateRow: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingBottom: 1,
  },
  plateLabel: { color: WALLET_INK, fontFamily: font.display },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  squiggle: { width: 64, height: 6 },
  footerText: { maxWidth: 230, color: WALLET_INK, fontFamily: font.body, fontSize: 11 },
  footerError: { color: color.inkRed },
  footerNotice: { color: WALLET_GREEN },
  row: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 12,
    gap: 9,
  },
  rowIcon: { width: 19, height: 15 },
  rowStatus: { width: 70, color: WALLET_GREEN, fontFamily: font.label, fontSize: 13 },
  rowFailed: { color: color.inkRed },
  rowSig: { flex: 1, color: WALLET_INK, fontFamily: font.body, fontSize: 13 },
  rowChevron: { width: 8, height: 13 },
});
