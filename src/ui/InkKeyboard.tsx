/**
 * The hand-drawn keyboard from IMG_9755 — every key a roughRect with a Bitter
 * 600 glyph, filling the bottom of the canvas. No native keyboard is ever
 * involved: the field it feeds is a rendered string, not a TextInput.
 *
 *   row 1   q w e r t y u i o p -
 *   row 2   a s d f g h j k l _ +
 *   row 3   shift z x c v b n m ' @ backspace (inkRed border)
 *   row 4   123 ! globe [ space ] . , enter
 *
 * Keys press with a one-unit downward offset and a Light haptic. The current
 * value is kept in a ref that every press updates synchronously, so two taps
 * inside one frame never lose a character.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg from 'react-native-svg';

import { haptic } from '@/audio/haptics';
import { Paper } from './Paper';
import { color, font, type as typeScale } from './tokens';
import {
  RoughShape,
  hashString,
  roughCircle,
  roughLine,
  roughPolygon,
  roughRect,
  type PathInfo,
  type Point,
} from './useRough';

export interface InkKeyboardProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  maxLength?: number;
  w?: number;
  h?: number;
}

type Special = 'shift' | 'backspace' | 'enter' | 'layer' | 'globe' | 'space';

interface KeyDef {
  /** The character typed, or a special action. */
  glyph: string;
  special?: Special;
  /** Width in key units (1 = one letter key). */
  units?: number;
}

const K = (glyph: string): KeyDef => ({ glyph });
const S = (special: Special, glyph: string, units = 1): KeyDef => ({ glyph, special, units });

const LETTERS: KeyDef[][] = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '-'].map(K),
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', '_', '+'].map(K),
  [S('shift', '⇧'), ...['z', 'x', 'c', 'v', 'b', 'n', 'm', "'", '@'].map(K), S('backspace', '⌫')],
  [S('layer', '123'), K('!'), S('globe', '◎'), S('space', ' ', 5), K('.'), K(','), S('enter', '⏎')],
];

const NUMBERS: KeyDef[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'].map(K),
  ['/', ':', ';', '(', ')', '$', '&', '#', '%', '=', '+'].map(K),
  [S('shift', '⇧'), ...['?', '!', '"', '*', '~', '^', '[', ']', '@'].map(K), S('backspace', '⌫')],
  [S('layer', 'abc'), K('!'), S('globe', '◎'), S('space', ' ', 5), K('.'), K(','), S('enter', '⏎')],
];

const COLS = 11;
const GAP = 6;
const ROW_H = 40;
const PAD_TOP = 8;

// ---------------------------------------------------------------------------
// Drawn glyphs for the special keys
// ---------------------------------------------------------------------------

function specialPaths(
  special: Special,
  w: number,
  h: number,
  seed: number,
): (readonly PathInfo[])[] {
  const c = { x: w / 2, y: h / 2 };
  const ink = { stroke: color.ink, strokeWidth: 1.4 } as const;
  switch (special) {
    case 'shift':
      return [
        roughPolygon(
          [
            [c.x, c.y - 11],
            [c.x + 9, c.y - 1],
            [c.x + 4, c.y - 1],
            [c.x + 4, c.y + 9],
            [c.x - 4, c.y + 9],
            [c.x - 4, c.y - 1],
            [c.x - 9, c.y - 1],
          ],
          { seed, ...ink, fill: color.ink, fillStyle: 'hachure', hachureGap: 2.6, fillWeight: 0.9 },
        ),
      ];
    case 'backspace': {
      const red = { stroke: color.inkRed, strokeWidth: 1.4 } as const;
      return [
        roughPolygon(
          [
            [c.x - 12, c.y],
            [c.x - 4, c.y - 8],
            [c.x + 12, c.y - 8],
            [c.x + 12, c.y + 8],
            [c.x - 4, c.y + 8],
          ],
          {
            seed,
            ...red,
            fill: color.inkRed,
            fillStyle: 'hachure',
            hachureGap: 3,
            fillWeight: 0.8,
          },
        ),
        roughLine(c.x, c.y - 4, c.x + 8, c.y + 4, {
          seed: seed + 1,
          stroke: color.paper,
          strokeWidth: 1.8,
        }),
        roughLine(c.x + 8, c.y - 4, c.x, c.y + 4, {
          seed: seed + 2,
          stroke: color.paper,
          strokeWidth: 1.8,
        }),
      ];
    }
    case 'enter':
      return [
        roughPolygon(
          [
            [c.x - 11, c.y + 2],
            [c.x - 3, c.y - 7],
            [c.x - 3, c.y - 2],
            [c.x + 10, c.y - 2],
            [c.x + 10, c.y - 10],
            [c.x + 13, c.y - 10],
            [c.x + 13, c.y + 2],
            [c.x - 3, c.y + 2],
            [c.x - 3, c.y + 8],
          ],
          { seed, ...ink, fill: color.ink, fillStyle: 'hachure', hachureGap: 2.6, fillWeight: 0.9 },
        ),
      ];
    case 'globe': {
      const meridian: Point[] = [];
      for (let k = 0; k <= 8; k++) {
        const t = -Math.PI / 2 + (Math.PI * k) / 8;
        meridian.push([c.x + Math.cos(t) * 4, c.y + Math.sin(t) * 10]);
      }
      return [
        roughCircle(c.x, c.y, 20, { seed, ...ink }),
        roughLine(c.x - 10, c.y, c.x + 10, c.y, { seed: seed + 1, ...ink, strokeWidth: 1 }),
        roughPolygon(meridian, { seed: seed + 2, ...ink, strokeWidth: 1 }),
      ];
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// One key
// ---------------------------------------------------------------------------

interface KeyProps {
  def: KeyDef;
  x: number;
  y: number;
  w: number;
  h: number;
  shift: boolean;
  onPress: (def: KeyDef) => void;
}

const Key = memo(function Key({ def, x, y, w, h, shift, onPress }: KeyProps) {
  const [pressed, setPressed] = useState(false);
  const seed = hashString(`key-${def.special ?? def.glyph}-${w}`) + (pressed ? 1 : 0);
  const stroke = def.special === 'backspace' ? color.inkRed : color.ink;
  const border = roughRect(2, 2, w - 4, h - 4, {
    seed,
    stroke,
    strokeWidth: def.special === 'backspace' ? 1.8 : 1.4,
    fill: color.paper,
    fillStyle: 'solid',
    roughness: 1,
  });
  const special =
    def.special && def.special !== 'space' && def.special !== 'layer'
      ? specialPaths(def.special, w, h, seed + 3)
      : null;
  const label = def.special === 'layer' ? def.glyph : shift ? def.glyph.toUpperCase() : def.glyph;

  return (
    <Pressable
      onPress={() => onPress(def)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="keyboardkey"
      accessibilityLabel={def.special ?? def.glyph}
      style={{ position: 'absolute', left: x, top: y + (pressed ? 1 : 0), width: w, height: h }}
    >
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={StyleSheet.absoluteFill}>
        <RoughShape paths={border} />
        {special?.map((paths, i) => (
          <RoughShape key={i} paths={paths} />
        ))}
      </Svg>
      {!special && def.special !== 'space' ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.centre]}>
          <Text
            style={{
              color: stroke,
              fontFamily: font.label,
              fontSize: def.special === 'layer' ? typeScale.sm : typeScale.md,
            }}
          >
            {label}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
});

// ---------------------------------------------------------------------------
// The keyboard
// ---------------------------------------------------------------------------

export function InkKeyboard({
  value,
  onChange,
  onSubmit,
  maxLength = 14,
  w = 800,
  h = 198,
}: InkKeyboardProps) {
  const [layer, setLayer] = useState<'abc' | '123'>('abc');
  const [shift, setShift] = useState(false);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const unit = (w - GAP * (COLS - 1) - 2 * 29) / COLS;
  const left = (w - (unit * COLS + GAP * (COLS - 1))) / 2;

  const press = useCallback(
    (def: KeyDef) => {
      haptic('buttonPress');
      const current = valueRef.current;
      switch (def.special) {
        case 'shift':
          setShift((s) => !s);
          return;
        case 'layer':
          setLayer((l) => (l === 'abc' ? '123' : 'abc'));
          return;
        case 'globe':
          return;
        case 'backspace': {
          const next = current.slice(0, -1);
          valueRef.current = next;
          onChange(next);
          return;
        }
        case 'enter':
          onSubmit?.();
          return;
        case 'space':
        default: {
          if (current.length >= maxLength) return;
          const glyph = def.special === 'space' ? ' ' : shift ? def.glyph.toUpperCase() : def.glyph;
          const next = current + glyph;
          valueRef.current = next;
          onChange(next);
          if (shift) setShift(false);
        }
      }
    },
    [maxLength, onChange, onSubmit, shift],
  );

  const rows = layer === 'abc' ? LETTERS : NUMBERS;

  return (
    <View style={{ width: w, height: h }}>
      <Paper variant="panel" w={w} h={h} seedKey="keyboard" />
      {rows.map((row, r) => {
        let x = left;
        return row.map((def) => {
          const kw = unit * (def.units ?? 1) + GAP * ((def.units ?? 1) - 1);
          const key = (
            <Key
              key={`${r}-${def.special ?? def.glyph}`}
              def={def}
              x={x}
              y={PAD_TOP + r * (ROW_H + GAP)}
              w={kw}
              h={ROW_H}
              shift={shift}
              onPress={press}
            />
          );
          x += kw + GAP;
          return key;
        });
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
});
