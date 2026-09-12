/**
 * Enter your name — IMG_9755. An InkPanel modal in the upper half with the
 * value rendered as a string (never a TextInput, so the OS keyboard never
 * appears) and the hand-drawn InkKeyboard filling the bottom of the canvas.
 *
 * Validation: 1-14 characters, trimmed. Save writes the profile store and the
 * Supabase row. First run continues to the avatar screen; from settings
 * (`?next=back`) it returns.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { pushProfile } from '@/net/profileSync';
import { useProfile } from '@/state/profile';
import { InkButton } from '@/ui/InkButton';
import { InkIconButton } from '@/ui/InkIconButton';
import { InkKeyboard } from '@/ui/InkKeyboard';
import { InkPanel } from '@/ui/InkPanel';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';
import { RoughShape, hashString, useRough } from '@/ui/useRough';

const MAX_LEN = 14;
const KEYBOARD_H = Math.round(CANVAS_H * 0.55);
const PANEL = { w: 300, h: 148 } as const;
const FIELD = { w: 236, h: 44 } as const;

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
  return <Animated.View style={[styles.caret, style]} />;
}

export default function NameScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string | string[] }>();
  const next = Array.isArray(params.next) ? params.next[0] : params.next;
  const storedName = useProfile((s) => s.name);
  const [value, setValue] = useState(storedName);
  const { roughRect } = useRough();

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

  const field = roughRect(2, 2, FIELD.w - 4, FIELD.h - 4, {
    seed: hashString('name-field'),
    strokeWidth: 2.2,
    roughness: 2.2,
    bowing: 0.6,
    fill: color.paper,
    fillStyle: 'solid',
  });

  return (
    <Scale>
      <Paper variant="full" />
      {/* the sheet above the keyboard is dimmed, like the reference */}
      <View pointerEvents="none" style={[styles.dim, { height: CANVAS_H - KEYBOARD_H }]} />

      <View style={styles.modal}>
        <InkPanel w={PANEL.w} h={PANEL.h} seedKey="name-modal" padding={space.sm}>
          <View style={styles.centre}>
            <Text style={styles.title}>Enter your name:</Text>
            <View style={{ width: FIELD.w, height: FIELD.h, marginTop: 6 }}>
              <Svg
                width={FIELD.w}
                height={FIELD.h}
                viewBox={`0 0 ${FIELD.w} ${FIELD.h}`}
                style={StyleSheet.absoluteFill}
              >
                <RoughShape paths={field} />
              </Svg>
              <View style={[StyleSheet.absoluteFill, styles.fieldRow]}>
                <Text numberOfLines={1} style={styles.value}>
                  {value}
                </Text>
                <Caret />
              </View>
            </View>
            <View style={{ marginTop: 8 }}>
              <InkButton
                label="Save"
                w={120}
                h={36}
                size="md"
                seedKey="name-save"
                disabled={!valid}
                onPress={save}
              />
            </View>
          </View>
        </InkPanel>
        <View style={styles.close}>
          <InkIconButton icon="close" size={30} accessibilityLabel="Close" onPress={close} />
        </View>
      </View>

      <View style={{ position: 'absolute', left: 0, top: CANVAS_H - KEYBOARD_H }}>
        <InkKeyboard
          value={value}
          onChange={setValue}
          onSubmit={save}
          maxLength={MAX_LEN}
          w={CANVAS_W}
          h={KEYBOARD_H}
        />
      </View>
    </Scale>
  );
}

const styles = StyleSheet.create({
  dim: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: CANVAS_W,
    backgroundColor: color.deskDark,
    opacity: 0.35,
  },
  modal: {
    position: 'absolute',
    left: (CANVAS_W - PANEL.w) / 2,
    top: 8,
    width: PANEL.w,
    height: PANEL.h,
  },
  close: { position: 'absolute', right: -6, top: -6 },
  centre: { alignItems: 'center' },
  title: { color: color.ink, fontFamily: font.display, fontSize: typeScale.md },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  value: {
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.lg,
    maxWidth: FIELD.w - 36,
  },
  caret: { width: 2, height: 24, backgroundColor: color.ink, marginLeft: 2 },
});
