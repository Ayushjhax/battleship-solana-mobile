import React from 'react';
import {useCurrentFrame} from 'remotion';
import {enter, exit} from '../lib/anim';
import {C, DUR, FONT, TRACK, TYPE} from '../theme';

type Size = keyof typeof TYPE;

export type KineticTextProps = {
  text: string;
  /** frame (in the parent Sequence) where the first word starts */
  at: number;
  /** frame where the line exits; omit to hold */
  out?: number;
  size?: Size;
  fontSize?: number;
  weight?: number;
  color?: string;
  family?: string;
  tracking?: string;
  /** frames between words (2–4) */
  stagger?: number;
  align?: 'left' | 'center' | 'right';
  /** extra element appended after the last word (e.g. the bit as a period) */
  tail?: React.ReactNode;
  style?: React.CSSProperties;
};

/**
 * Apple-style kinetic type: each word rises out of a mask with blur 16px → 0 and a fade,
 * staggered. The exit is one quicker move for the whole line (blur up, fade).
 */
export const KineticText: React.FC<KineticTextProps> = ({
  text,
  at,
  out,
  size = 'headline',
  fontSize,
  weight = 650,
  color = C.white,
  family = FONT.head,
  tracking,
  stagger = DUR.word,
  align = 'center',
  tail,
  style,
}) => {
  const frame = useCurrentFrame();
  const lines = text.split('\n');
  const fs = fontSize ?? TYPE[size];
  const o = out === undefined ? 0 : exit(frame, out);
  if (frame < at - 1 || o >= 1) return null;
  return (
    <div
      style={{
        fontFamily: family,
        fontSize: fs,
        fontWeight: weight,
        letterSpacing: tracking ?? TRACK[size],
        lineHeight: 1.0,
        color,
        textAlign: align,
        whiteSpace: 'nowrap',
        opacity: 1 - o,
        filter: o > 0 ? `blur(${o * 12}px)` : undefined,
        translate: `0 ${-o * fs * 0.12}px`,
        ...style,
      }}
    >
      {lines.map((line, li) => {
        const offset = lines.slice(0, li).reduce((n, l) => n + l.split(' ').length, 0);
        const words = line.split(' ');
        return (
          <div key={li} style={{display: 'block', lineHeight: 1.04}}>
            {words.map((w, i) => {
              const p = enter(frame, at + (offset + i) * stagger, DUR.enter);
              return (
                <span key={i} style={{display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', padding: '0.08em 0 0.14em', margin: '-0.08em 0 -0.14em'}}>
                  <span
                    style={{
                      display: 'inline-block',
                      translate: `0 ${(1 - p) * 0.9}em`,
                      opacity: p,
                      filter: p < 1 ? `blur(${(1 - p) * 16}px)` : undefined,
                    }}
                  >
                    {w}
                    {i < words.length - 1 ? '\u00A0' : null}
                  </span>
                </span>
              );
            })}
            {li === lines.length - 1 ? tail : null}
          </div>
        );
      })}
    </div>
  );
};
