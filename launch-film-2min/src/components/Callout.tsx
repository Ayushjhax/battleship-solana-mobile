import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {CLAMP, enter, exit} from '../lib/anim';
import {C, EASE, FONT, TYPE} from '../theme';

/**
 * Apple-style callout: a dot on a real UI element, a thin line, a small label.
 * (x, y) = the dot; the line runs to (x + dx, y + dy); the label sits past the line's end.
 */
export const Callout: React.FC<{
  x: number;
  y: number;
  dx: number;
  dy: number;
  label: string;
  at: number;
  out?: number;
  fontSize?: number;
}> = ({x, y, dx, dy, label, at, out, fontSize = TYPE.label}) => {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  const dot = enter(frame, at, 12);
  const line = interpolate(frame, [at + 4, at + 18], [0, 1], {...CLAMP, easing: EASE.enter});
  const lab = enter(frame, at + 12, 18);
  const o = out === undefined ? 0 : exit(frame, out, 12);
  if (o >= 1) return null;
  const ex = x + dx * line;
  const ey = y + dy * line;
  const right = dx >= 0;
  const len = Math.hypot(dx, dy);
  return (
    <div style={{position: 'absolute', inset: 0, opacity: 1 - o, pointerEvents: 'none'}}>
      <svg style={{position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible'}}>
        <line x1={x} y1={y} x2={ex} y2={ey} stroke={C.white} strokeOpacity={0.85} strokeWidth={4} strokeLinecap="round" />
        <circle cx={x} cy={y} r={22 * dot} fill={C.accent} opacity={0.35 * dot} />
        <circle cx={x} cy={y} r={11 * dot} fill={C.white} />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: right ? x + dx + 28 : undefined,
          right: right ? undefined : 3840 - (x + dx) + 28,
          top: y + dy - fontSize * 0.62,
          fontFamily: FONT.label,
          fontWeight: 560,
          fontSize,
          letterSpacing: '-0.005em',
          color: C.white,
          whiteSpace: 'nowrap',
          opacity: lab,
          translate: `${(right ? -1 : 1) * (1 - lab) * 24}px 0`,
          textShadow: '0 2px 18px rgba(0,0,0,0.85), 0 0 4px rgba(0,0,0,0.6)',
        }}
      >
        {len > 0 ? label : label}
      </div>
    </div>
  );
};
