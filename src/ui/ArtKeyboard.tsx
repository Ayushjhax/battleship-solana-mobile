/**
 * The name screen's keyboard, built from its commissioned key art
 * (KEYBOARD_ART) to the mockup's layout:
 *
 *   row 1   q w e r t y u i o p -
 *   row 2    a s d f g h j k l _ +
 *   row 3   shift z x c v b n m ' @ backspace
 *   row 4   123 globe [ space ] . , enter
 *
 * Glyph keys are the art with its glyph erased and the glyph drawn live, so
 * shift can show capitals and the 123 layer digits on the same keys. Icon keys
 * are drawn as-is. What a press types is keyboardInput.ts.
 */
import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { KEYBOARD_ART, type Asset, type KeyFace } from './assets';
import { K, S, useKeyboardInput, type KeyDef } from './keyboardInput';
import { artColor, font, type as typeScale } from './tokens';

type IconFace = 'shift' | 'backspace' | 'enter' | 'language' | 'space';

interface Slot {
  face: KeyFace | IconFace;
  w: number;
  abc: KeyDef;
  num: KeyDef;
}

/** Every row spans this width; row 2 starts indented, like the mockup's. */
export const ART_KEYBOARD_W = 578;
const KEY_W = 48;
const KEY_H = 37;
const ROW_PITCH = 40;
export const ART_KEYBOARD_H = ROW_PITCH * 3 + KEY_H;

const same = (face: Slot['face'], def: KeyDef, w = KEY_W): Slot => ({ face, w, abc: def, num: def });
const glyphs = (faces: KeyFace[], abc: string[], num: string[]): Slot[] =>
  faces.map((face, i) => ({ face, w: KEY_W, abc: K(abc[i]!), num: K(num[i]!) }));

interface Row {
  x: number;
  gap: number;
  slots: Slot[];
}

const ROWS: readonly Row[] = [
  {
    x: 0,
    gap: 5,
    slots: glyphs(
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', 'hyphen'],
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '-'],
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'],
    ),
  },
  {
    x: 14,
    gap: 3.5,
    slots: glyphs(
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'underscore', 'plus'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', '_', '+'],
      ['/', ':', ';', '(', ')', '$', '&', '#', '%', '=', '+'],
    ),
  },
  {
    x: 5,
    gap: 3.5,
    slots: [
      same('shift', S('shift', '⇧'), 55),
      ...glyphs(
        ['z', 'x', 'c', 'v', 'b', 'n', 'm', 'apostrophe', 'at'],
        ['z', 'x', 'c', 'v', 'b', 'n', 'm', "'", '@'],
        ['?', '!', '"', '*', '~', '^', '[', ']', '@'],
      ),
      same('backspace', S('backspace', '⌫'), 51),
    ],
  },
  {
    x: 5,
    gap: 7,
    slots: [
      { face: 'numbers', w: 55, abc: S('layer', '123'), num: S('layer', 'abc') },
      same('language', S('globe', '◎'), 49),
      same('space', S('space', ' ', 5), 289),
      same('period', K('.'), 45),
      same('comma', K(','), 45),
      same('enter', S('enter', '⏎'), 55),
    ],
  },
];

function faceSource(face: Slot['face']): Asset {
  return face in KEYBOARD_ART.blank
    ? KEYBOARD_ART.blank[face as KeyFace]
    : KEYBOARD_ART[face as IconFace];
}

interface KeyProps {
  slot: Slot;
  def: KeyDef;
  x: number;
  y: number;
  shift: boolean;
  onPress: (def: KeyDef) => void;
}

const ArtKey = memo(function ArtKey({ slot, def, x, y, shift, onPress }: KeyProps) {
  const [pressed, setPressed] = useState(false);
  const source = faceSource(slot.face);
  const drawn = slot.face in KEYBOARD_ART.blank;
  const label = def.special === 'layer' ? def.glyph : shift ? def.glyph.toUpperCase() : def.glyph;
  // Shift stays pushed in while it is armed, so the capitals have a cause.
  const down = pressed || (def.special === 'shift' && shift);
  return (
    <Pressable
      onPress={() => onPress(def)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="keyboardkey"
      accessibilityLabel={def.special ?? def.glyph}
      style={{ position: 'absolute', left: x, top: y, width: slot.w, height: KEY_H }}
    >
      <View style={[StyleSheet.absoluteFill, { transform: [{ translateY: down ? 1 : 0 }] }]}>
        <Image source={source} style={StyleSheet.absoluteFill} contentFit="fill" cachePolicy="memory-disk" />
        {down ? (
          <Image
            source={source}
            style={[StyleSheet.absoluteFill, styles.pressShade]}
            contentFit="fill"
            tintColor={artColor.keyInk}
          />
        ) : null}
        {drawn ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.centre]}>
            <Text style={[styles.glyph, def.special === 'layer' ? styles.layerGlyph : null]}>
              {label}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

export interface ArtKeyboardProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  maxLength?: number;
}

export function ArtKeyboard({ value, onChange, onSubmit, maxLength = 14 }: ArtKeyboardProps) {
  const { layer, shift, press } = useKeyboardInput({ value, onChange, onSubmit, maxLength });
  return (
    <View style={{ width: ART_KEYBOARD_W, height: ART_KEYBOARD_H }}>
      {ROWS.map((row, r) => {
        let x = row.x;
        return row.slots.map((slot) => {
          const def = layer === 'abc' ? slot.abc : slot.num;
          const key = (
            <ArtKey
              key={`${r}-${slot.face}`}
              slot={slot}
              def={def}
              x={x}
              y={r * ROW_PITCH}
              shift={shift && layer === 'abc'}
              onPress={press}
            />
          );
          x += slot.w + row.gap;
          return key;
        });
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center', paddingBottom: 2 },
  glyph: { color: artColor.keyInk, fontFamily: font.display, fontSize: 18 },
  layerGlyph: { fontSize: typeScale.xs },
  pressShade: { opacity: 0.12 },
});
