/**
 * The brand mark. assets/ink/brand/logo.png (black line art tinted to ink)
 * with an optional Bitter subtitle under it, the two centred as one block;
 * until the art lands, a typographic wordmark with a rough underline. Either
 * way it is drawn twice — the lower copy offset one unit at 0.25 opacity — so
 * it bleeds into the paper like wet ink.
 */
import { Image } from 'expo-image';
import { Image as RNImage, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg from 'react-native-svg';

import { BRAND } from './assets';
import { color, font, type as typeScale } from './tokens';
import { RoughShape, hashString, useRough } from './useRough';

export interface LogoMarkProps {
  w?: number;
  h?: number;
  /** The wet-ink double print. On by default. */
  bleed?: boolean;
  /** A small line under the mark, e.g. "Ocean Warfare". */
  subtitle?: string;
  style?: ViewStyle;
}

const SUBTITLE_H = 14;

const LOGO_ASPECT = (() => {
  const source = typeof BRAND.logo === 'number' ? RNImage.resolveAssetSource(BRAND.logo) : null;
  return source && source.width && source.height ? source.width / source.height : 8 / 3;
})();

function Wordmark({ w, h, tint }: { w: number; h: number; tint: string }) {
  const { roughLine } = useRough();
  const big = Math.min(typeScale.xl, Math.round(h * 0.42));
  const small = Math.min(typeScale.md, Math.round(h * 0.26));
  const underline = roughLine(w * 0.2, h * 0.58, w * 0.8, h * 0.58, {
    seed: hashString('logo-underline'),
    stroke: tint,
    strokeWidth: 1.6,
    roughness: 1.1,
  });
  return (
    <View style={[StyleSheet.absoluteFill, styles.centre]}>
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={StyleSheet.absoluteFill}>
        <RoughShape paths={underline} />
      </Svg>
      <Text
        style={{ color: tint, fontFamily: font.display, fontSize: big, lineHeight: big * 1.15 }}
      >
        Empire of Bits
      </Text>
      <Text
        style={{
          color: tint,
          fontFamily: font.label,
          fontSize: small,
          lineHeight: small * 1.4,
          marginTop: h * 0.1,
        }}
      >
        Ocean Warfare
      </Text>
    </View>
  );
}

function Layer({ w, h, tint, subtitle }: { w: number; h: number; tint: string; subtitle?: string }) {
  if (!BRAND.logo) return <Wordmark w={w} h={h} tint={tint} />;

  const subtitleH = subtitle ? SUBTITLE_H : 0;
  const imageH = Math.min(h - subtitleH, w / LOGO_ASPECT);
  const imageW = Math.min(w, imageH * LOGO_ASPECT);
  const top = (h - imageH - subtitleH) / 2;
  return (
    <View style={StyleSheet.absoluteFill}>
      <Image
        source={BRAND.logo}
        style={{ position: 'absolute', left: (w - imageW) / 2, top, width: imageW, height: imageH }}
        contentFit="contain"
        tintColor={tint}
        cachePolicy="memory-disk"
      />
      {subtitle ? (
        <Text
          style={{
            position: 'absolute',
            left: 0,
            top: top + imageH,
            width: w,
            textAlign: 'center',
            color: tint,
            fontFamily: font.label,
            fontSize: typeScale.xxs,
            lineHeight: SUBTITLE_H,
          }}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function LogoMark({ w = 320, h = 120, bleed = true, subtitle, style }: LogoMarkProps) {
  return (
    <View style={[{ width: w, height: h }, style]}>
      {bleed ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { opacity: 0.25, transform: [{ translateY: 1 }] }]}
        >
          <Layer w={w} h={h} tint={color.ink} subtitle={subtitle} />
        </View>
      ) : null}
      <Layer w={w} h={h} tint={color.ink} subtitle={subtitle} />
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
});
