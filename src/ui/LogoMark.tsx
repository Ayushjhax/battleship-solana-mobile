/**
 * The brand mark. assets/images/brand/logo.png once it lands (1024 x 384,
 * black line art tinted to ink); until then a typographic wordmark in Bitter
 * with a rough underline. Either way it is drawn twice — the lower copy
 * offset one unit at 0.25 opacity — so it bleeds into the paper like wet ink.
 */
import { Image } from 'expo-image';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg from 'react-native-svg';

import { BRAND } from './assets';
import { color, font, type as typeScale } from './tokens';
import { RoughShape, hashString, useRough } from './useRough';

export interface LogoMarkProps {
  w?: number;
  h?: number;
  /** The wet-ink double print. On by default. */
  bleed?: boolean;
  style?: ViewStyle;
}

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
        Sea Battle
      </Text>
    </View>
  );
}

function Layer({ w, h, tint }: { w: number; h: number; tint: string }) {
  if (BRAND.logo) {
    return (
      <Image
        source={BRAND.logo}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        tintColor={tint}
        cachePolicy="memory-disk"
      />
    );
  }
  return <Wordmark w={w} h={h} tint={tint} />;
}

export function LogoMark({ w = 320, h = 120, bleed = true, style }: LogoMarkProps) {
  return (
    <View style={[{ width: w, height: h }, style]}>
      {bleed ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { opacity: 0.25, transform: [{ translateY: 1 }] }]}
        >
          <Layer w={w} h={h} tint={color.ink} />
        </View>
      ) : null}
      <Layer w={w} h={h} tint={color.ink} />
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
});
