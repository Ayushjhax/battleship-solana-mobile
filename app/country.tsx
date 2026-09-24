/**
 * The country picker — part-08 §5, and Appendix C's missing screen.
 *
 * "an ink list, alphabetical, with a letter index down the side and no OS
 *  keyboard."
 *
 * THE LETTER INDEX IS THE WHOLE DESIGN. 199 rows is far too many to scroll
 * and this game has no OS keyboard by design — `InkKeyboard` exists because
 * `TextInput` is banned, and it is built for 14-character names, not for
 * filtering a list. So the index is the navigation: 26 ink glyphs down the
 * right, dimmed for letters no country starts with, each jumping the list.
 *
 * Everything the screen decides comes from `src/data/countries.ts`, including
 * which letters are live — a tappable letter that jumps nowhere is worse than
 * one that is visibly off.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ALPHABET,
  COUNTRIES,
  activeLetters,
  indexOfLetter,
  sortKey,
  type Country,
} from '@/data/countries';
import { haptic } from '@/audio/haptics';
import { useProfile } from '@/state/profile';
import { InkButton } from '@/ui/InkButton';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

const ROW_H = 34;
const LIST_X = 120;
const LIST_W = 520;
const LIST_Y = 52;
const INDEX_X = LIST_X + LIST_W + 18;

function Row({
  country,
  selected,
  onPress,
}: {
  country: Country;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={country.name}
      onPress={onPress}
      style={[styles.row, selected && styles.rowSelected]}
    >
      <Text style={styles.code}>{country.code}</Text>
      <Text style={[styles.name, selected && styles.nameSelected]} numberOfLines={1}>
        {country.name}
      </Text>
      {selected ? <Text style={styles.tick}>✓</Text> : null}
    </Pressable>
  );
}

export default function CountryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string | string[] }>();
  const next = Array.isArray(params.next) ? params.next[0] : params.next;

  const current = useProfile((state) => state.countryCode);
  const [picked, setPicked] = useState(current);
  const listRef = useRef<ScrollView>(null);

  const live = useMemo(() => activeLetters(), []);

  const jump = useCallback((letter: string) => {
    const index = indexOfLetter(letter);
    if (index === null) return; // a dead letter does nothing, visibly
    haptic('buttonPress');
    listRef.current?.scrollTo({ y: index * ROW_H, animated: true });
  }, []);

  const choose = useCallback(
    (code: string) => {
      haptic('buttonPress');
      setPicked(code);
      // The profile is the only writer; the server picks it up through the
      // existing profileSync, exactly as name and avatar do.
      useProfile.getState().setIdentity({ countryCode: code });
    },
    [],
  );

  const done = useCallback(() => {
    if (next) router.replace(next as never);
    else router.back();
  }, [next, router]);

  return (
    <Scale>
      <Paper variant="full" />

      <View style={styles.back}>
        <InkButton label="↩" size="lg" w={54} h={48} seedKey="country-back" onPress={done} />
      </View>
      <View style={styles.ribbon}>
        <TitleRibbon title="Your port" w={260} h={40} size="sm" seedKey="country-title" />
      </View>

      <ScrollView
        ref={listRef}
        style={styles.list}
        contentContainerStyle={{ paddingBottom: space.lg }}
        showsVerticalScrollIndicator={false}
      >
        {COUNTRIES.map((country) => (
          <Row
            key={country.code}
            country={country}
            selected={picked === country.code}
            onPress={() => choose(country.code)}
          />
        ))}
      </ScrollView>

      {/* The letter index. No keyboard, ever. */}
      <View style={styles.index}>
        {ALPHABET.map((letter) => {
          const enabled = live.has(letter);
          return (
            <Pressable
              key={letter}
              disabled={!enabled}
              accessibilityRole="button"
              accessibilityLabel={enabled ? `Jump to ${letter}` : `${letter}, no countries`}
              onPress={() => jump(letter)}
              style={styles.letterHit}
            >
              <Text style={[styles.letter, !enabled && styles.letterDead]}>{letter}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {picked ? `Sailing under ${nameOf(picked)}` : 'Choose a port'}
        </Text>
      </View>
      <View style={styles.done}>
        <InkButton
          label="Done"
          tone="confirm"
          size="md"
          w={150}
          h={50}
          seedKey="country-done"
          onPress={done}
        />
      </View>
    </Scale>
  );
}

function nameOf(code: string): string {
  return COUNTRIES.find((c) => c.code === code)?.name ?? code;
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: space.sm, top: space.sm },
  ribbon: { position: 'absolute', left: CANVAS_W / 2 - 130, top: 2 },
  list: {
    position: 'absolute',
    left: LIST_X,
    top: LIST_Y,
    width: LIST_W,
    height: CANVAS_H - LIST_Y - 48,
  },
  row: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.gridMinor,
    paddingHorizontal: space.sm,
  },
  rowSelected: { borderBottomColor: color.ink },
  code: {
    width: 34,
    color: color.inkFaint,
    fontFamily: font.label,
    fontSize: typeScale.xs,
  },
  name: { flex: 1, color: color.ink, fontFamily: font.body, fontSize: typeScale.sm },
  nameSelected: { fontFamily: font.display },
  tick: { color: color.inkGreen, fontFamily: font.display, fontSize: typeScale.md },

  index: {
    position: 'absolute',
    left: INDEX_X,
    top: LIST_Y,
    width: 26,
    height: CANVAS_H - LIST_Y - 48,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // A 26-row column on a 360dp canvas gives ~10dp a letter, which is under
  // the touch floor — so the hit area is padded wider than the glyph.
  letterHit: { width: 26, alignItems: 'center', justifyContent: 'center', flex: 1 },
  letter: { color: color.ink, fontFamily: font.label, fontSize: typeScale.xxs },
  letterDead: { color: color.inkFaint, opacity: 0.4 },

  footer: { position: 'absolute', left: LIST_X, bottom: 14 },
  footerText: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xs },
  done: { position: 'absolute', right: space.md, bottom: space.sm },
});
