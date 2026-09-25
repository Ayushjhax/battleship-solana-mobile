/**
 * A captain's country as a badge: the flag in a paper border and a navy rim
 * on a soft base (baked by scripts/store-assets.sh, so every size reads the
 * same). A code with no flag gets the blank badge with its letters on it.
 * Sized by width; the height follows the badge art.
 */
import { Image } from 'expo-image';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { FLAG_ART, FLAG_BADGE, FLAG_BLANK } from '@/ui/assets';
import { menuFont } from '@/ui/tokens';

import { countryName } from './countries';

export const flagBadgeHeight = (w: number) => (w * FLAG_BADGE.h) / FLAG_BADGE.w;

export function FlagBadge({
  code,
  w,
  style,
}: {
  code: string | null | undefined;
  w: number;
  style?: StyleProp<ViewStyle>;
}) {
  const upper = (code ?? '').toUpperCase();
  const art = FLAG_ART[upper];
  const h = flagBadgeHeight(w);
  const k = w / FLAG_BADGE.w;
  return (
    <View
      style={[{ width: w, height: h }, style]}
      pointerEvents="none"
      accessible
      accessibilityLabel={countryName(upper)}
    >
      <Image
        source={art ?? FLAG_BLANK}
        style={StyleSheet.absoluteFill}
        contentFit="fill"
        cachePolicy="memory-disk"
      />
      {art ? null : (
        <View
          style={{
            position: 'absolute',
            left: FLAG_BADGE.inset * k,
            top: FLAG_BADGE.inset * k,
            width: FLAG_BADGE.flagW * k,
            height: FLAG_BADGE.flagH * k,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={[styles.code, { fontSize: FLAG_BADGE.flagH * k * 0.56 }]}
            numberOfLines={1}
            allowFontScaling={false}
          >
            {upper.slice(0, 2) || '··'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  code: { color: '#FFFDF6', fontFamily: menuFont.capsBold, includeFontPadding: false },
});
