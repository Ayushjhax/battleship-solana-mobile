import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame} from 'remotion';
import {Footage, Freeze} from '../components/Footage';
import {Framed, SOURCE} from '../components/Framed';
import {COPY} from '../config/copy';
import {BENTO as B, f, STILLS} from '../config/timeline';
import {cam, enter, mix} from '../lib/anim';
import {C, FONT, INNER_HIGHLIGHT, RADIUS, SAFE, SHADOW} from '../theme';

// 5 × 3 grid inside the title-safe area
const COLS = 5;
const ROWS = 3;
const GAP = 36;
const GW = 3840 - SAFE.x * 2;
const GH = 2160 - SAFE.y * 2;
const CW = (GW - GAP * (COLS - 1)) / COLS;
const CH = (GH - GAP * (ROWS - 1)) / ROWS;

type Tile = {key: keyof typeof COPY.bento.tiles; c: number; r: number; w: number; h: number; body: React.ReactNode};

const art = (src: string, scale = 0.62, bg = 'linear-gradient(160deg, #17171d 0%, #0b0b0f 100%)') => (
  <AbsoluteFill style={{background: bg, justifyContent: 'center', alignItems: 'center'}}>
    <Img src={staticFile(src)} style={{maxWidth: `${scale * 100}%`, maxHeight: `${scale * 100}%`, objectFit: 'contain'}} />
  </AbsoluteFill>
);

const phone = (clip: 'match' | 'wallet' | 'buy' | 'store', at: number) => <Freeze clip={clip} at={at} fit="cover" />;

const TILES: Tile[] = [
  {
    key: 'battle',
    c: 0,
    r: 0,
    w: 2,
    h: 2,
    body: (
      <Framed source={SOURCE.battle} u={0.72} v={0.5} zoom={3.4} frameW={CW * 2 + GAP} frameH={CH * 2 + GAP}>
        <Footage shot={{clip: 'arsenal', at: 0, beats: 12, from: 0.95}} fit="fill" />
      </Framed>
    ),
  },
  {key: 'fleet', c: 2, r: 0, w: 2, h: 1, body: art('art/fleet/battleship.png', 0.8)},
  {key: 'store', c: 4, r: 0, w: 1, h: 1, body: phone('store', 2.6)},
  {key: 'arsenal', c: 2, r: 1, w: 1, h: 1, body: art('art/weapons/atomic-bomber.png')},
  {key: 'defence', c: 3, r: 1, w: 1, h: 1, body: art('art/weapons/aa-gun.png')},
  {key: 'match', c: 4, r: 1, w: 1, h: 1, body: phone('match', 3.7)},
  {key: 'wallet', c: 0, r: 2, w: 1, h: 1, body: phone('wallet', 2.6)},
  {key: 'points', c: 1, r: 2, w: 1, h: 1, body: phone('buy', 4.6)},
  {
    key: 'leaderboard',
    c: 2,
    r: 2,
    w: 1,
    h: 1,
    body: <Img src={staticFile(STILLS.leaderboard)} style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 40%'}} />,
  },
  {
    key: 'port',
    c: 3,
    r: 2,
    w: 2,
    h: 1,
    body: <Img src={staticFile('art/ui/port-city-map.png')} style={{width: '100%', height: '100%', objectFit: 'cover'}} />,
  },
];

const rect = (t: Tile) => ({
  x: SAFE.x + t.c * (CW + GAP),
  y: SAFE.y + t.r * (CH + GAP),
  w: t.w * CW + (t.w - 1) * GAP,
  h: t.h * CH + (t.h - 1) * GAP,
});

/**
 * The recap: an Apple bento grid, tiles in on the half-beats, labels only. Then the camera
 * flies into the battle tile and through it into the supercut.
 */
export const Bento: React.FC = () => {
  const frame = useCurrentFrame();
  const fly = cam(frame, f(B.flyIn), f(12) + 4);
  const hero = rect(TILES[0]);
  // scale that makes the battle tile fill the frame, and the translation to centre it
  const S = Math.max(3840 / hero.w, 2160 / hero.h) * 1.02;
  const s = mix(1, S, fly ** 1.3);
  const tx = mix(0, 1920 - (hero.x + hero.w / 2), fly);
  const ty = mix(0, 1080 - (hero.y + hero.h / 2), fly);
  const drift = cam(frame, 0, f(B.flyIn));
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <AbsoluteFill style={{scale: s * mix(1, 1.025, drift), translate: `${tx * s}px ${ty * s}px`, transformOrigin: '50% 50%'}}>
        {TILES.map((t, i) => {
          const r = rect(t);
          const p = enter(frame, f(B.tiles[i]), 20);
          const others = i === 0 ? 1 : 1 - fly;
          return (
            <div
              key={t.key}
              style={{
                position: 'absolute',
                left: r.x,
                top: r.y,
                width: r.w,
                height: r.h,
                borderRadius: RADIUS.tile * (i === 0 ? 1 - fly : 1),
                overflow: 'hidden',
                boxShadow: `${SHADOW}, ${INNER_HIGHLIGHT}`,
                background: '#0b0b0f',
                opacity: p * others,
                scale: mix(0.9, 1, p),
                filter: p < 1 ? `blur(${(1 - p) * 14}px)` : undefined,
              }}
            >
              {t.body}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: '38%',
                  background: 'linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0))',
                  opacity: 1 - fly,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: 44,
                  bottom: 36,
                  fontFamily: FONT.label,
                  fontWeight: 600,
                  fontSize: 50,
                  letterSpacing: '-0.01em',
                  color: C.white,
                  opacity: 1 - fly,
                }}
              >
                {COPY.bento.tiles[t.key]}
              </div>
              <div style={{position: 'absolute', inset: 0, borderRadius: 'inherit', boxShadow: INNER_HIGHLIGHT}} />
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
