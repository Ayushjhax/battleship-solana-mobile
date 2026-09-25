/**
 * Enter your name — drawn to its mockup on BACKGROUNDS.nameEntry: the taped
 * paper note (label, field, Save, close) up top, the commissioned keyboard
 * across the bottom, the logo and the notes around them. The field is a
 * rendered string, never a TextInput, so the OS keyboard never appears.
 *
 * Validation: 1-14 characters, trimmed. Save writes the profile store and the
 * Supabase row. First run continues to the avatar screen; from settings
 * (`?next=back`) it returns.
 */
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type ImageStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { haptic } from '@/audio/haptics';
import { pushProfile } from '@/net/profileSync';
import { useProfile } from '@/state/profile';
import { ArtKeyboard, ART_KEYBOARD_W } from '@/ui/ArtKeyboard';
import { BACKGROUNDS, NAME_ART, PAPER_PANEL, type Asset } from '@/ui/assets';
import { Scale } from '@/ui/Scale';
import { SlicedImage } from '@/ui/SlicedImage';
import { artColor, menuFont } from '@/ui/tokens';

const MAX_LEN = 14;
/** The note's paper, stretched to the mockup's taller card; its torn edge takes it. */
const NOTE = { x: 235, y: 24, w: 334, h: 145 } as const;
const FIELD = { x: 276, y: 75, w: 256, h: 36 } as const;
const SAVE = { x: 346, y: 111, w: 112, h: 46 } as const;
const KEYBOARD = { x: 110, y: 172 } as const;

function Caret() {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(withTiming(0, { duration: 420 }), withTiming(1, { duration: 420 })),
      -1,
      true,
    );
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[styles.caret, style]}>
      <Image source={NAME_ART.cursor} style={StyleSheet.absoluteFill} contentFit="contain" />
    </Animated.View>
  );
}

/** A piece of art at a fixed place on the canvas, never in the way of a touch. */
function Art({ source, style }: { source: Asset; style: ImageStyle }) {
  return (
    <Image
      source={source}
      style={[{ position: 'absolute' }, style]}
      contentFit="contain"
      cachePolicy="memory-disk"
      pointerEvents="none"
    />
  );
}

/** A button that is one piece of art: haptic and a 1-unit drop on press. */
function ArtPress({
  source,
  style,
  label,
  disabled = false,
  onPress,
}: {
  source: Asset;
  style: ImageStyle;
  label: string;
  disabled?: boolean;
  onPress: () => void;
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
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[{ position: 'absolute' }, style]}
    >
      <Image
        source={source}
        style={[
          StyleSheet.absoluteFill,
          { opacity: disabled ? 0.55 : 1, transform: [{ translateY: pressed ? 1 : 0 }] },
        ]}
        contentFit="fill"
      />
    </Pressable>
  );
}

export default function NameScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string | string[] }>();
  const next = Array.isArray(params.next) ? params.next[0] : params.next;
  const storedName = useProfile((s) => s.name);
  const [value, setValue] = useState(storedName);

  const trimmed = value.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= MAX_LEN;

  const leave = useCallback(() => {
    if (next === 'back' && router.canGoBack()) router.back();
    else if (next === 'back') router.replace('/menu');
    else router.replace('/avatar');
  }, [next, router]);

  const save = useCallback(() => {
    if (!valid) return;
    const profile = useProfile.getState();
    profile.setIdentity({ name: trimmed });
    if (profile.userId) void pushProfile(profile.userId, { name: trimmed });
    leave();
  }, [valid, trimmed, leave]);

  const close = useCallback(() => {
    // A first-run player who closes without a name still needs one.
    if (!useProfile.getState().name.trim()) useProfile.getState().setIdentity({ name: 'Player' });
    leave();
  }, [leave]);

  return (
    <Scale backgroundImage={BACKGROUNDS.nameEntry}>
      <Art source={NAME_ART.logo} style={styles.logo} />
      <Art source={NAME_ART.greatCaptainQuote} style={styles.quoteLeft} />
      <Art source={NAME_ART.differentCaptainsQuote} style={styles.quoteRight} />
      <Art source={NAME_ART.strategyNote} style={styles.strategyNote} />

      <Image
        source={PAPER_PANEL}
        style={[styles.abs, { left: NOTE.x, top: NOTE.y, width: NOTE.w, height: NOTE.h }]}
        contentFit="fill"
        pointerEvents="none"
      />
      <Art source={NAME_ART.tape} style={styles.tape} />
      <Art source={NAME_ART.label} style={styles.label} />
      <Art source={NAME_ART.emphasis} style={styles.emphasis} />

      <View
        style={[styles.abs, { left: FIELD.x, top: FIELD.y, width: FIELD.w, height: FIELD.h }]}
        accessibilityLabel={value ? `Name, ${value}` : 'Name, empty'}
      >
        <SlicedImage slices={NAME_ART.input} w={FIELD.w} h={FIELD.h} style={StyleSheet.absoluteFill} />
        <View style={styles.fieldRow}>
          <Text numberOfLines={1} style={styles.value}>
            {value}
          </Text>
          <Caret />
          {value ? null : (
            <Image source={NAME_ART.placeholder} style={styles.placeholder} contentFit="contain" />
          )}
        </View>
      </View>

      <ArtPress
        source={NAME_ART.save}
        style={{ left: SAVE.x, top: SAVE.y, width: SAVE.w, height: SAVE.h }}
        label="Save"
        disabled={!valid}
        onPress={save}
      />
      <ArtPress source={NAME_ART.close} style={styles.close} label="Close" onPress={close} />

      <View style={[styles.abs, { left: KEYBOARD.x, top: KEYBOARD.y, width: ART_KEYBOARD_W }]}>
        <ArtKeyboard value={value} onChange={setValue} onSubmit={save} maxLength={MAX_LEN} />
      </View>
    </Scale>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  logo: { left: 16, top: 36, width: 200, height: 80 },
  quoteLeft: { left: 74, top: 110, width: 104, height: 51 },
  quoteRight: { left: 580, top: 92, width: 94, height: 63 },
  strategyNote: { left: 700, top: 205, width: 85, height: 76 },
  tape: { left: 371, top: 10, width: 62, height: 34 },
  label: { left: 317, top: 36, width: 170, height: 43 },
  emphasis: { left: 256, top: 56, width: 22, height: 24 },
  close: { left: 527, top: 29, width: 34, height: 32 },
  fieldRow: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 10,
    paddingBottom: 2,
  },
  value: {
    color: artColor.ink,
    fontFamily: menuFont.caps,
    fontSize: 20,
    maxWidth: FIELD.w - 40,
  },
  caret: { width: 7, height: 22, marginLeft: 1 },
  placeholder: { width: 82, height: 34, marginLeft: 2 },
});
