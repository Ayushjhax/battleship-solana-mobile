/**
 * What a key press does on the on-screen keyboard (ArtKeyboard), kept apart
 * from the keys so the typing rules are one small, testable piece.
 *
 * The current value is kept in a ref that every press updates synchronously,
 * so two taps inside one frame never lose a character. Shift is one-shot: it
 * capitalises the next character, then drops.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { haptic } from '@/audio/haptics';

export type Special = 'shift' | 'backspace' | 'enter' | 'layer' | 'globe' | 'space';

export interface KeyDef {
  /** The character typed, or a special action. */
  glyph: string;
  special?: Special;
  /** Width in key units (1 = one letter key). */
  units?: number;
}

export const K = (glyph: string): KeyDef => ({ glyph });
export const S = (special: Special, glyph: string, units = 1): KeyDef => ({ glyph, special, units });

export interface KeyboardInput {
  layer: 'abc' | '123';
  shift: boolean;
  press: (def: KeyDef) => void;
}

export function useKeyboardInput({
  value,
  onChange,
  onSubmit,
  maxLength,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  maxLength: number;
}): KeyboardInput {
  const [layer, setLayer] = useState<'abc' | '123'>('abc');
  const [shift, setShift] = useState(false);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

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

  return { layer, shift, press };
}
