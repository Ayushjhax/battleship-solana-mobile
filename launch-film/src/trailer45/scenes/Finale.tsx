/**
 * Beats 83–105: the swarm, the landing, the dApp Store and "Your move."
 *
 * A wall of player tiles (photos first, the live GIF, then the game's own art)
 * sits right in front of the camera; the tiles fly back into the Empire of Bits
 * logo, bit by bit, turning brand-violet as they lock. The logo's top-right bit
 * stays empty and glowing: the viewer's spot. Everything random goes through
 * Remotion's random(seed), so every render is identical.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AbsoluteFill, Img, continueRender, delayRender, interpolate, random, staticFile, useCurrentFrame } from 'remotion';
import { END } from '../copy';
import { Bit, Ping } from '../components/Frames';
import { C, EASE_IN, EASE_MOVE, FONT, clamp } from '../theme';
import { f } from '../timeline';
import SW from '../swarm.data.json';

const A = 82; // starts on the breath beat: the wall is already there as the letterbox opens
const T = (b: number) => f(b) - f(A);

const L = SW.logo;
const BIT_C = { x: (L.bit[0] + L.bit[2]) / 2, y: (L.bit[1] + L.bit[3]) / 2, s: L.bit[2] - L.bit[0] };

/** Where the logo is (centre + width) at a local frame: big during the swarm, then eased up. */
const logoAt = (t: number) => {
  const p = interpolate(t, [T(91.5), T(93.5)], [0, 1], { ...clamp, easing: EASE_MOVE });
  return { cx: 960, cy: 540 + (305 - 540) * p, w: 1640 + (1180 - 1640) * p };
};
const toScreen = (lg: { cx: number; cy: number; w: number }, sx: number, sy: number) => {
  const k = lg.w / L.w;
  return { x: lg.cx + (sx - L.w / 2) * k, y: lg.cy + (sy - L.h / 2) * k, k };
};

// ---- the plan for every tile, computed once, deterministically ------------------------------
type Tile = { tx: number; ty: number; wx: number; wy: number; img: number; gif: boolean; phase: number; dep: number; rot: number; swirl: number };
const D = 1000; // perspective distance
const ZW = -900; // the wall, right in front of the camera (scale 10)
const DUR = 26; // flight frames

const plan: Tile[] = (() => {
  const n = SW.cells.length;
  const wallCols = 40;
  const wallRows = Math.ceil(n / wallCols);
  const cellW = L.cell * (1640 / L.w); // world size of one logo cell at the swarm's logo size
  const spacing = cellW * 1.06;
  const slots = Array.from({ length: n }, (_, i) => i).sort((p, q) => random(`slot${p}`) - random(`slot${q}`));
  const pick = (arr: number[], s: string) => arr[Math.floor(random(s) * arr.length)];
  let gifs = 0;
  return SW.cells.map(([c, r], i) => {
    const slot = slots[i];
    const col = slot % wallCols;
    const row = Math.floor(slot / wallCols);
    const dc = col - (wallCols - 1) / 2;
    const dr = row - (wallRows - 1) / 2;
    const central = Math.abs(dc) <= 6 && Math.abs(dr) <= 3.5;
    let gif = false;
    let img: number;
    if (central && gifs < 12 && random(`g${i}`) < 0.16) {
      gif = true;
      gifs++;
      img = SW.gif[0];
    } else if (central) {
      img = pick(SW.best, `b${i}`);
    } else {
      img = random(`k${i}`) < 0.55 ? pick(SW.photos, `p${i}`) : pick(SW.art, `a${i}`);
    }
    const dist = Math.hypot(dc / (wallCols / 2), dr / (wallRows / 2)); // 0 centre … ~1.4 corners
    const dep = T(83.5) + (dist / 1.45) * (T(88) - T(83.5)) * 0.85 + random(`d${i}`) * 9;
    const tl = { x: (c + 0.5) * L.cell - L.w / 2, y: (r + 0.5) * L.cell - L.h / 2 };
    const k = 1640 / L.w;
    return {
      tx: tl.x * k,
      ty: tl.y * k,
      wx: dc * spacing,
      wy: dr * spacing,
      img,
      gif,
      phase: Math.floor(random(`ph${i}`) * 9),
      dep: Math.min(dep, T(90) - DUR),
      rot: (random(`r${i}`) * 2 - 1) * 55,
      swirl: (random(`s${i}`) * 2 - 1) * 260,
    };
  });
})();
const CELL_PX = L.cell * (1640 / L.w) * 0.9;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });

const SwarmCanvas: React.FC<{ t: number; fade: number; lg: ReturnType<typeof logoAt> }> = ({ t, fade, lg }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [imgs, setImgs] = useState<[HTMLImageElement, HTMLImageElement] | null>(null);
  const [handle] = useState(() => delayRender('swarm atlases'));
  useEffect(() => {
    Promise.all([loadImage(staticFile('swarm/atlas_color.jpg')), loadImage(staticFile('swarm/atlas_duo.png'))])
      .then((pair) => {
        setImgs(pair);
        continueRender(handle);
      })
      .catch((e) => {
        console.error(e);
        continueRender(handle);
      });
  }, [handle]);
  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv || !imgs) return;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, 1920, 1080);
    if (fade <= 0) return;
    const [color, duo] = imgs;
    const AC = SW.atlas.cols;
    const k = lg.w / 1640; // logo scale relative to the swarm's logo
    // the wall: an orderly grid, turned in 3D, that eases square to the camera and back a little
    const wallPush = interpolate(t, [0, T(85)], [0, 70], { ...clamp, easing: EASE_MOVE });
    const turn = (interpolate(t, [0, T(86)], [24, 8], { ...clamp, easing: EASE_MOVE }) * Math.PI) / 180;
    const items = plan.map((p, i) => {
      const prog = interpolate(t, [p.dep, p.dep + DUR], [0, 1], clamp);
      const e = EASE_MOVE(prog);
      const wx = p.wx * Math.cos(turn);
      const wz = ZW + wallPush + p.wx * Math.sin(turn) * 0.9;
      const z = Math.max(wz, -D * 0.93) * (1 - e);
      const sw = Math.sin(Math.PI * e) * p.swirl;
      const x = wx + (p.tx - wx) * e + sw * 0.6;
      const y = p.wy + (p.ty - p.wy) * e - Math.abs(sw) * 0.25;
      return { p, i, z, x, y, e };
    });
    items.sort((q, r) => r.z - q.z);
    ctx.imageSmoothingQuality = 'high';
    for (const { p, i, z, x, y, e } of items) {
      const sc = D / (D + z);
      const size = CELL_PX * sc * k;
      const sx = lg.cx + x * sc * k;
      const sy = lg.cy + y * sc * k;
      if (sx < -size || sx > 1920 + size || sy < -size || sy > 1080 + size) continue;
      const img = p.gif ? SW.gif[(Math.floor(t / 2) + p.phase) % SW.gif.length] : p.img;
      const ax = img % AC;
      const ay = Math.floor(img / AC);
      const duoA = interpolate(e, [0.4, 0.9], [0, 1], clamp);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(((p.rot * Math.sin(Math.PI * e)) * Math.PI) / 180);
      ctx.globalAlpha = fade * (1 - duoA);
      if (ctx.globalAlpha > 0.01) ctx.drawImage(color, ax * SW.atlas.color, ay * SW.atlas.color, SW.atlas.color, SW.atlas.color, -size / 2, -size / 2, size, size);
      ctx.globalAlpha = fade * duoA;
      if (ctx.globalAlpha > 0.01) ctx.drawImage(duo, ax * SW.atlas.duo, ay * SW.atlas.duo, SW.atlas.duo, SW.atlas.duo, -size / 2, -size / 2, size, size);
      ctx.restore();
      void i;
    }
  }, [t, imgs, fade, lg.cx, lg.cy, lg.w]);
  return <canvas ref={ref} width={1920} height={1080} style={{ position: 'absolute', inset: 0 }} />;
};

/** The logo, tinted by CSS mask (no top-right square: the bit replaces it). */
const LogoMask: React.FC<{ lg: ReturnType<typeof logoAt>; color: string; opacity: number; background?: string }> = ({ lg, color, opacity, background }) => {
  const h = (lg.w * L.h) / L.w;
  const m = `url(${staticFile('brand/logo-mask-nobit@3x.png')})`;
  return (
    <div
      style={{
        position: 'absolute',
        left: lg.cx - lg.w / 2,
        top: lg.cy - h / 2,
        width: lg.w,
        height: h,
        background: background ?? color,
        opacity,
        WebkitMaskImage: m,
        maskImage: m,
        WebkitMaskSize: '100% 100%',
        maskSize: '100% 100%',
      }}
    />
  );
};

export const Finale: React.FC = () => {
  const t = useCurrentFrame();
  const lg = logoAt(t);
  const land = T(91);
  const crisp = interpolate(t, [land - 1, land + 3], [0, 1], { ...clamp, easing: EASE_IN });
  const mosaic = interpolate(t, [land + 2, land + 10], [1, 0], clamp);
  const flash = interpolate(t, [land, land + 10], [1, 0], clamp);
  // the light sweep crosses the locked logo during beat 90
  const sweep = interpolate(t, [T(90), T(91) + 2], [-0.3, 1.3], { ...clamp, easing: EASE_MOVE });
  const bit = toScreen(lg, BIT_C.x, BIT_C.y);
  const bitSize = BIT_C.s * bit.k;
  const bitOn = interpolate(t, [T(84.5), T(86)], [0, 1], clamp);
  const hollow = interpolate(t, [land, land + 6], [1, 0], clamp);
  const bitGlow = 0.8 + 0.5 * flash + 0.6 * interpolate(t - T(99), [0, 3, 24], [0, 1, 0], clamp);
  // end card
  const badge = interpolate(t, [T(92), T(94)], [0, 1], { ...clamp, easing: EASE_IN });
  const line = interpolate(t, [T(96), T(96) + 14], [0, 1], { ...clamp, easing: EASE_IN });
  const drift = interpolate(t, [T(93.5), T(105)], [1, 1.025], clamp);
  const h = (lg.w * L.h) / L.w;
  return (
    <AbsoluteFill style={{ background: C.night }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle 900px at 960px ${lg.cy}px, rgba(124,108,255,${0.1 + 0.18 * flash}), rgba(0,0,0,0) 70%)` }} />
      <AbsoluteFill style={{ scale: String(drift) }}>
        <SwarmCanvas t={t} fade={mosaic} lg={lg} />
        {/* light sweep, only on the logo */}
        {t >= T(90) && t <= land + 4 && (
          <LogoMask
            lg={lg}
            color="#fff"
            opacity={0.9}
            background={`linear-gradient(105deg, rgba(255,255,255,0) ${sweep * 100 - 14}%, rgba(255,255,255,0.95) ${sweep * 100}%, rgba(255,255,255,0) ${sweep * 100 + 14}%)`}
          />
        )}
        <LogoMask lg={lg} color={C.offWhite} opacity={crisp} />
        {flash > 0 && t >= land && <LogoMask lg={lg} color={C.accent} opacity={flash * 0.6} />}
        {bitOn > 0 && <Bit x={bit.x} y={bit.y} size={bitSize} intensity={bitOn * bitGlow} hollow={hollow} />}
        <Ping x={bit.x} y={bit.y} t={t - land} size={bitSize} dur={20} max={6} />
        <Ping x={bit.x} y={bit.y} t={t - T(97)} size={bitSize} dur={26} max={8} />
        {/* Your move. */}
        <div
          style={{
            position: 'absolute',
            top: lg.cy + h / 2 + 58,
            width: '100%',
            textAlign: 'center',
            fontFamily: FONT.apple,
            fontWeight: 500,
            fontSize: 92,
            letterSpacing: '-0.015em',
            color: C.offWhite,
            opacity: line,
            translate: `0px ${(1 - line) * 14}px`,
          }}
        >
          {END.line}
        </div>
        {/* Solana dApp Store */}
        <Img
          src={staticFile('brand/dapp-store.png')}
          style={{
            position: 'absolute',
            left: 960 - 270,
            top: 706 + (1 - badge) * 70,
            width: 540,
            height: (540 * 273) / 696,
            opacity: badge,
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
