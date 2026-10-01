/**
 * Beats 45–55: ★6 VICTORY. as a window, then out of its O into the economy bento.
 *
 *   45   hard cut on the downbeat: VICTORY. slams in, ~85 % of the width; the victory screen's art drifts inside
 *        the letters (the recording's frames all carry text, so this is the same screen without its text layer:
 *        its backdrop, assets/backgrounds/decision.jpg); a light sweep crosses on 45.5
 *   48   the camera flies through the O (a true hole) as the letterbox pulls back
 *   49   the bento: five glass tiles snap in on the 8ths, each playing its screen, labelled
 *   53   the camera flies into the leaderboard; 54 punches into the #1 row (names and points blurred at prep)
 *   54.5 the #1 row lights up — and on 55 it collapses into the bit (the mosaic scene)
 */
import { CameraMotionBlur } from '@remotion/motion-blur';
import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Glass } from '../../trailer45/components/Frames';
import { slam } from '../../trailer45/components/Slam';
import { C, EASE_IN, EASE_MOVE, FONT, clamp } from '../../trailer45/theme';
import { UiClip } from '../components/Footage';
import { TypeWindow, counterOf } from '../components/TypeWindow';
import { BENTO } from '../copy';
import { SECTIONS, TILE_BEATS, UI_CLIPS, f } from '../timeline';

const A = SECTIONS.victory[0];
const L = (b: number) => f(b) - f(A);
const WORD = { width: 1632, cx: 960, cy: 540 };
const O = counterOf('victory', 'O', WORD.width, WORD.cx, WORD.cy);
const Z_THROUGH = 70;

// ---------------------------------------------------------------- the bento

type Box = { x: number; y: number; w: number; h: number };
export const TILES: { label: string; box: Box; at: number }[] = [
  { label: BENTO[0], box: { x: 96, y: 150, w: 1040, h: 520 }, at: TILE_BEATS[0] }, // LEADERBOARD (hero)
  { label: BENTO[1], box: { x: 96, y: 694, w: 508, h: 226 }, at: TILE_BEATS[1] }, //  BUY POINTS
  { label: BENTO[2], box: { x: 628, y: 694, w: 508, h: 226 }, at: TILE_BEATS[2] }, // SELL POINTS
  { label: BENTO[3], box: { x: 1160, y: 150, w: 664, h: 360 }, at: TILE_BEATS[3] }, // STORE
  { label: BENTO[4], box: { x: 1160, y: 534, w: 664, h: 386 }, at: TILE_BEATS[4] }, // WALLET
];
/** the leaderboard still (2670 x 1200) inside the hero tile: cover + objectPosition 55 % */
const LB = { w: 2670, h: 1200, posX: 0.55, row: { x0: 280, x1: 2010, y0: 432, y1: 502 } };
const lbScale = Math.max(TILES[0].box.w / LB.w, TILES[0].box.h / LB.h);
const lbOffX = (TILES[0].box.w - LB.w * lbScale) * LB.posX;
const lbOffY = (TILES[0].box.h - LB.h * lbScale) * 0.5;
/** the #1 row on screen (before any camera move) */
export const ROW1 = {
  x: TILES[0].box.x + lbOffX + ((LB.row.x0 + LB.row.x1) / 2) * lbScale,
  y: TILES[0].box.y + lbOffY + ((LB.row.y0 + LB.row.y1) / 2) * lbScale,
  w: (LB.row.x1 - LB.row.x0) * lbScale,
  h: (LB.row.y1 - LB.row.y0) * lbScale,
};
/** zoom that makes the #1 row ~1700 px wide, centred on screen */
export const ROW_ZOOM = 1700 / ROW1.w;

const Backdrop: React.FC = () => (
  <AbsoluteFill style={{ background: C.night }}>
    <AbsoluteFill style={{ background: 'radial-gradient(ellipse 1100px 700px at 960px 540px, rgba(124,108,255,0.2), rgba(62,47,184,0.06) 55%, rgba(0,0,0,0) 80%)' }} />
  </AbsoluteFill>
);

const Label: React.FC<{ text: string; t: number }> = ({ text, t }) => {
  const s = slam(t);
  return (
    <div
      style={{
        position: 'absolute',
        left: 26,
        bottom: 20,
        fontFamily: FONT.card,
        fontSize: 58,
        lineHeight: 1,
        letterSpacing: '0.02em',
        color: C.offWhite,
        textShadow: '0 2px 16px rgba(0,0,0,0.75)',
        scale: String(s.scale),
        transformOrigin: 'left bottom',
        filter: s.blur > 0.05 ? `blur(${s.blur}px)` : undefined,
        opacity: t < 0 ? 0 : s.opacity,
      }}
    >
      {text}
    </div>
  );
};

const TileContent: React.FC<{ i: number; dur: number }> = ({ i, dur }) => {
  switch (i) {
    case 0:
      return (
        <Img
          src={staticFile('deck30/media/leaderboard.png')}
          style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${LB.posX * 100}% 50%` }}
        />
      );
    case 1:
      return <UiClip clip={UI_CLIPS.buy} dur={dur} push={[1.0, 1.04]} position="30% 50%" />;
    case 2:
      return <UiClip clip={UI_CLIPS.sell} dur={dur} push={[1.0, 1.04]} position="30% 50%" />;
    case 3:
      return <UiClip clip={UI_CLIPS.store} dur={dur} push={[1.0, 1.04]} position="50% 45%" />;
    default:
      return <UiClip clip={UI_CLIPS.wallet} dur={dur} push={[1.0, 1.03]} position="22% 50%" freezeAfter={11} />;
  }
};

/** the bento on its own clock: local frame 0 = `zero` (beat), so the copy seen through the O and the one after it agree */
const Bento: React.FC<{ zero: number }> = ({ zero }) => {
  const frame = useCurrentFrame();
  const B = (b: number) => f(b) - f(zero);
  // fly into the leaderboard's #1 row: 53 → 54, then a punch on 54
  const e = interpolate(frame, [B(53), B(54)], [0, 1], { ...clamp, easing: EASE_MOVE });
  const Z = Math.exp(Math.log(ROW_ZOOM) * e) * (1 + 0.035 * interpolate(frame - B(54), [0, 5], [1, 0], { ...clamp, easing: EASE_IN }) * (frame >= B(54) ? 1 : 0));
  const cx = ROW1.x + (960 - ROW1.x) * e;
  const cy = ROW1.y + (540 - ROW1.y) * e;
  const drift = interpolate(frame, [0, B(53)], [1, 1.03], clamp);
  const zoom = e > 0 ? Z : drift;
  const tf = e > 0 ? `translate(${cx - ROW1.x * Z}px, ${cy - ROW1.y * Z}px) scale(${Z})` : `scale(${drift})`;
  const glow = interpolate(frame, [B(54.25), B(54.5)], [0, 1], { ...clamp, easing: EASE_IN });
  const others = interpolate(e, [0.2, 0.8], [1, 0], clamp);
  // 54.6 → 55: the lit #1 row (centred on screen by now) collapses into the bit; the table goes dark around it
  const col = interpolate(frame, [B(54.6), B(55)], [0, 1], { ...clamp, easing: EASE_MOVE });
  const rowW = ROW1.w * ROW_ZOOM;
  const rowH = ROW1.h * ROW_ZOOM;
  const bw = rowW + (30 - rowW) * col;
  const bh = rowH + (30 - rowH) * col;
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ transform: tf, transformOrigin: e > 0 ? '0 0' : '960px 540px', opacity: 1 - 0.72 * col }}>
        {TILES.map((tile, i) => {
          const t = frame - B(tile.at);
          if (t < -1) return null;
          const p = interpolate(t, [0, 7], [0, 1], { ...clamp, easing: EASE_IN });
          return (
            <Sequence key={tile.label} from={B(tile.at)} layout="none">
              <Glass
                box={tile.box}
                radius={22}
                style={{ opacity: p * (i === 0 ? 1 : others), scale: String(0.9 + 0.1 * p), translate: `0px ${(1 - p) * 26}px` }}
              >
                <TileContent i={i} dur={B(55) - B(tile.at)} />
                <AbsoluteFill style={{ background: 'linear-gradient(to top, rgba(5,4,11,0.72) 0%, rgba(5,4,11,0) 42%)', opacity: i === 0 ? 1 - e : 1 }} />
                {i === 0 && glow > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: lbOffX + LB.row.x0 * lbScale - 4,
                      top: lbOffY + LB.row.y0 * lbScale - 2,
                      width: (LB.row.x1 - LB.row.x0) * lbScale + 8,
                      height: (LB.row.y1 - LB.row.y0) * lbScale + 4,
                      border: `${2 / zoom}px solid ${C.accent}`,
                      background: `rgba(124,108,255,${0.22 * glow})`,
                      boxShadow: `0 0 ${18 / zoom}px ${C.accent}, inset 0 0 ${10 / zoom}px rgba(124,108,255,0.6)`,
                      opacity: glow,
                    }}
                  />
                )}
                <div style={{ opacity: i === 0 ? 1 - e : 1 }}>
                  <Label text={tile.label} t={t} />
                </div>
              </Glass>
            </Sequence>
          );
        })}
      </AbsoluteFill>
      {col > 0 && (
        <div
          style={{
            position: 'absolute',
            left: 960 - bw / 2,
            top: 540 - bh / 2,
            width: bw,
            height: bh,
            background: `rgba(${Math.round(124 + 108 * col)},${Math.round(108 + 120 * col)},255,${0.25 + 0.75 * col})`,
            border: `2px solid ${C.accent}`,
            boxShadow: `0 0 ${18 + 40 * col}px ${C.accent}`,
          }}
        />
      )}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- VICTORY.

const VictoryWindow: React.FC = () => {
  const frame = useCurrentFrame(); // local: 0 = beat 45
  const s = slam(frame);
  const push = interpolate(frame, [0, L(48)], [1, 1.05], clamp);
  const fly = interpolate(frame, [L(48), L(49)], [0, 1], { ...clamp, easing: EASE_MOVE });
  const zoom = s.scale * push * Math.exp(Math.log(Z_THROUGH) * fly);
  const sweep = interpolate(frame, [L(45.5), L(46.6)], [-0.15, 1.15], { ...clamp, easing: EASE_MOVE });
  // the victory screen's art drifting inside the letters: ship → islands → lighthouse
  const SCALE = 1.5;
  const imgX = 164 - interpolate(frame, [0, L(49)], [0, 300], clamp) * SCALE;
  const imgY = 320 - 40 * SCALE;
  const id = `vw${String(frame).replace('.', '_')}`;
  const behindScale = 0.72 + 0.28 * fly;
  return (
    <AbsoluteFill style={{ filter: s.blur > 0.05 ? `blur(${s.blur}px)` : undefined, opacity: s.opacity }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 1000px 520px at 960px 540px, rgba(124,108,255,${0.22 * (1 - fly)}), rgba(0,0,0,0) 72%)` }} />
      <TypeWindow
        word="victory"
        id={id}
        width={WORD.width}
        cx={WORD.cx}
        cy={WORD.cy}
        zoom={zoom}
        at={{ x: O.x, y: O.y }}
        hole={fly > 0}
        plate="rgba(0,0,0,1)"
        sweep={sweep}
        behind={
          <AbsoluteFill style={{ scale: String(behindScale) }}>
            <Sequence from={L(48)}>
              <Bento zero={48} />
            </Sequence>
          </AbsoluteFill>
        }
      >
        <Img
          src={staticFile('deck30/art/victory-backdrop.jpg')}
          style={{ position: 'absolute', left: imgX, top: imgY, width: 1672 * SCALE, height: 941 * SCALE, filter: 'contrast(1.06) saturate(1.15)' }}
        />
      </TypeWindow>
    </AbsoluteFill>
  );
};

export const Victory: React.FC = () => {
  const frame = useCurrentFrame();
  const flying = frame > L(48) + 2 && frame < L(49);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Sequence name="VICTORY." durationInFrames={L(49)}>
        {flying ? (
          <CameraMotionBlur shutterAngle={180} samples={5}>
            <VictoryWindow />
          </CameraMotionBlur>
        ) : (
          <VictoryWindow />
        )}
      </Sequence>
      <Sequence name="bento → the #1 row" from={L(49)}>
        <Bento zero={49} />
      </Sequence>
    </AbsoluteFill>
  );
};
