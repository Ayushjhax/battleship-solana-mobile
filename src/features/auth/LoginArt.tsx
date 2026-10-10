/**
 * The sign-in screen's controls, drawn on their own art (LOGIN_ART): a sliced
 * button with a live Bitter label, and a text field laid over a sliced input.
 * Labels are live rather than baked because they change — "Opening Google…",
 * "Checking…", "Resend in 24s". Press feel matches InkButton: light haptic,
 * a 1-unit drop.
 */
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { haptic } from '@/audio/haptics';
import { LOGIN_ART, type Slices } from '@/ui/assets';
import { InkSpinner } from '@/ui/InkSpinner';
import { SlicedImage, sliceCaps } from '@/ui/SlicedImage';
import { artColor, font } from '@/ui/tokens';

/** The art's base shadow sits under each control, so its face centres a touch high. */
const FACE_LIFT = 0.06;

export interface ArtButtonProps {
  slices: Slices;
  w: number;
  h: number;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Which caps carry an icon the label must clear: the Google G and chevron, the pencil, the clock. */
  clear?: 'none' | 'left' | 'both';
  fontSize?: number;
  /** Art that is already drawn in its disabled look (Resend) mutes its label instead of fading. */
  mutedWhenDisabled?: boolean;
}

export function ArtButton({
  slices,
  w,
  h,
  label,
  onPress,
  disabled = false,
  clear = 'none',
  fontSize = 15,
  mutedWhenDisabled = false,
}: ArtButtonProps) {
  const [pressed, setPressed] = useState(false);
  const caps = sliceCaps(slices, h);
  const padLeft = clear === 'none' ? 6 : caps.left - 4;
  const padRight = clear === 'both' ? caps.right : 6;
  const fade = disabled && !mutedWhenDisabled;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        setPressed(true);
        haptic('buttonPress');
      }}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <View
        style={{
          width: w,
          height: h,
          opacity: fade ? 0.55 : 1,
          transform: [{ translateY: pressed ? 1 : 0 }],
        }}
      >
        <SlicedImage slices={slices} w={w} h={h} style={StyleSheet.absoluteFill} />
        <View
          style={[
            styles.labelBox,
            { paddingLeft: padLeft, paddingRight: padRight, paddingBottom: h * FACE_LIFT * 2 },
          ]}
        >
          <Text
            style={[
              styles.label,
              { fontSize, color: disabled && mutedWhenDisabled ? artColor.muted : artColor.ink },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {label}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * "Connect Solana wallet": the navy plate with the Solana mark on the left cap,
 * the chevron on the right and a live ivory label. While the wallet app is
 * open it shows a spinner in place of the chevron and says so; disabled, it
 * fades and says why through `accessibilityHint`.
 */
export function WalletConnectButton({
  w,
  h,
  label,
  onPress,
  busy = false,
  disabled = false,
  accessibilityHint,
}: {
  w: number;
  h: number;
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}) {
  const [pressed, setPressed] = useState(false);
  const caps = sliceCaps(LOGIN_ART.wallet, h);
  const mark = h * 0.42;
  const arrow = h * 0.32;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        setPressed(true);
        haptic('buttonPress');
      }}
      onPressOut={() => setPressed(false)}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || busy, busy }}
    >
      <View
        style={{
          width: w,
          height: h,
          opacity: disabled ? 0.55 : 1,
          transform: [{ translateY: pressed ? 1 : 0 }],
        }}
      >
        <SlicedImage slices={LOGIN_ART.wallet} w={w} h={h} style={StyleSheet.absoluteFill} />
        <Image
          source={LOGIN_ART.walletMark}
          style={{ position: 'absolute', left: caps.left * 0.55, top: (h - mark) / 2, width: mark * (95 / 72), height: mark }}
          contentFit="contain"
          pointerEvents="none"
        />
        {busy ? (
          <InkSpinner
            size={arrow * 1.4}
            stroke={artColor.ivory}
            seedKey="wallet-connect"
            style={{ position: 'absolute', right: caps.right * 0.6, top: (h - arrow * 1.4) / 2 }}
          />
        ) : (
          <Image
            source={LOGIN_ART.walletArrow}
            style={{ position: 'absolute', right: caps.right * 0.75, top: (h - arrow) / 2, width: arrow * (29 / 48), height: arrow }}
            contentFit="contain"
            pointerEvents="none"
          />
        )}
        <View style={[styles.labelBox, { paddingLeft: caps.left + mark * 0.9, paddingRight: caps.right + 4 }]}>
          <Text style={[styles.label, { fontSize: 15, color: artColor.ivory }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {label}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export type ArtInputProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  slices: Slices;
  w: number;
  h: number;
};

export function ArtInput({ slices, w, h, ...props }: ArtInputProps) {
  const caps = sliceCaps(slices, h);
  return (
    <View style={{ width: w, height: h }}>
      <SlicedImage slices={slices} w={w} h={h} style={StyleSheet.absoluteFill} />
      <TextInput
        {...props}
        placeholderTextColor={artColor.muted}
        selectionColor={artColor.soft}
        style={[
          styles.input,
          { left: caps.left + 2, right: caps.right, bottom: h * FACE_LIFT * 2 },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  labelBox: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontFamily: font.display, textAlign: 'center' },
  input: {
    position: 'absolute',
    top: 0,
    color: artColor.ink,
    fontFamily: font.body,
    fontSize: 15,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
});
