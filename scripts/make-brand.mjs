/**
 * Builds the colour brand art from assets/gamestartlogo.jpeg:
 *
 *   splash-hero.png        the launch screen — a porthole on the game's paper
 *   icon-hero.png          full bleed, for iOS and the legacy Android icon
 *   adaptive-icon-hero.png the Android adaptive foreground
 *
 * Why this is not in scripts/ink-assets.sh: that script needs ImageMagick and
 * turns line art into ink masks, which is the wrong treatment for a full
 * colour illustration. This one uses jimp (already in the Expo toolchain) so
 * it runs anywhere, and everything it writes is `-hero` suffixed so
 * `npm run assets` cannot clobber it.
 *
 *   npm run brand
 *
 * The output is committed — EAS builds never run this.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Jimp = require('jimp-compact');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = path.join(ROOT, 'assets', 'gamestartlogo.jpeg');
const BRAND = path.join(ROOT, 'assets', 'ink', 'brand');
const SPLASH_OUT = path.join(BRAND, 'splash-hero.png');
const ICON_OUT = path.join(BRAND, 'icon-hero.png');
const ADAPTIVE_OUT = path.join(BRAND, 'adaptive-icon-hero.png');

// src/ui/tokens.ts — the same paper the menu draws.
const PAPER = [0xfb, 0xfc, 0xfe];
const GRID_MINOR = [0xcf, 0xe9, 0xf6];
const GRID_MAJOR = [0xa6, 0xd8, 0xee];
const RULE_RED = [0xe2, 0x45, 0x3a];
const INK = [0x3e, 0x2f, 0xb8];
const INK_FAINT = [0xb4, 0xab, 0xec];

const SIZE = 1024;
/** One graph cell. 16 cells across, a major rule every 5th, as on the sheet. */
const CELL = 64;
const MAJOR_EVERY = 5;
/** The red margin rule sits at the same 9.4% of the sheet as PAPER_GRID.ruleY. */
const RULE_Y = Math.round(SIZE * 0.094);

/**
 * Android 12+ masks the splash icon to the launcher's shape — a circle on
 * stock, a squircle on some OEMs — and keeps only the middle ~66%. Everything
 * that must survive lives inside SAFE_R of the centre; the graph paper fills
 * the whole square so it reaches the mask edge whatever shape that is.
 *
 * The portrait is cut to a circle of its own: a porthole on the sheet, which
 * also means the mask can never slice a corner off the captain.
 */
const CENTRE = SIZE / 2;
const SAFE_R = Math.round((SIZE * 0.66) / 2);
const PORTHOLE_R = 280;
const RING = 9;
/** No shadow props anywhere in this game — an offset stroke stands in for one. */
const SHADOW_OFFSET = 8;

function fillRect(image, x, y, w, h, [r, g, b]) {
  const { data, width, height } = image.bitmap;
  for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(width, x + w); xx++) {
      const i = (yy * width + xx) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
}

function fillCircle(image, cx, cy, r, [red, green, blue]) {
  const { data, width, height } = image.bitmap;
  const rr = r * r;
  for (let y = Math.max(0, cy - r); y <= Math.min(height - 1, cy + r); y++) {
    const dy = y - cy;
    for (let x = Math.max(0, cx - r); x <= Math.min(width - 1, cx + r); x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy > rr) continue;
      const i = (y * width + x) * 4;
      data[i] = red;
      data[i + 1] = green;
      data[i + 2] = blue;
      data[i + 3] = 255;
    }
  }
}

/** Cuts the portrait to a disc, with a soft edge so the rim is not stair-stepped. */
function maskToCircle(image) {
  const { data, width, height } = image.bitmap;
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const r = Math.min(cx, cy);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.hypot(x - cx, y - cy);
      const i = (y * width + x) * 4;
      if (distance <= r - 1) continue;
      data[i + 3] = distance >= r ? 0 : Math.round((r - distance) * 255);
    }
  }
}

function drawGraphRules(sheet) {
  for (let n = 0, at = 0; at <= SIZE; n++, at = n * CELL) {
    const major = n % MAJOR_EVERY === 0;
    const colour = major ? GRID_MAJOR : GRID_MINOR;
    const weight = major ? 3 : 2;
    fillRect(sheet, at, 0, weight, SIZE, colour);
    fillRect(sheet, 0, at, SIZE, weight, colour);
  }
}

function write(image, file) {
  return new Promise((resolve, reject) => {
    image.write(file, (error) => (error ? reject(error) : resolve()));
  });
}

/**
 * The launcher icons.
 *
 * Android's adaptive icon is 108dp, but only the inner 72dp — 66.7% — is ever
 * on screen; the outer ring exists for parallax. So the whole illustration is
 * scaled to exactly that inner square and centred: the launcher's mask then
 * crops the corners of the art rather than the art being an island in the
 * middle of a background, which is what made the old icon look half empty.
 *
 * iOS applies its own rounded-rectangle mask and reserves no outer ring, so
 * the plain icon is the illustration full bleed.
 */
async function buildIcons(source) {
  const icon = source.clone().resize(SIZE, SIZE);
  await write(icon, ICON_OUT);

  const viewport = Math.round((SIZE * 72) / 108);
  const inset = Math.round((SIZE - viewport) / 2);
  // Transparent outside the viewport: adaptiveIcon.backgroundColor shows there,
  // and it is only ever seen while the launcher animates the icon.
  const adaptive = new Jimp(SIZE, SIZE, 0x00000000);
  adaptive.composite(source.clone().resize(viewport, viewport), inset, inset);
  await write(adaptive, ADAPTIVE_OUT);

  console.log(`icon   → ${path.relative(ROOT, ICON_OUT)} (${SIZE}x${SIZE}, full bleed)`);
  console.log(
    `icon   → ${path.relative(ROOT, ADAPTIVE_OUT)} (${SIZE}x${SIZE}, art ${viewport}px in the 72dp viewport)`,
  );
}

async function main() {
  const sheet = new Jimp(SIZE, SIZE, 0xfbfcfeff);
  fillRect(sheet, 0, 0, SIZE, SIZE, PAPER);
  drawGraphRules(sheet);
  // The red margin rule, stopping short of the edge like a torn sheet's does.
  fillRect(sheet, 18, RULE_Y, SIZE - 36, 5, RULE_RED);

  if (PORTHOLE_R + RING + SHADOW_OFFSET > SAFE_R) {
    throw new Error('the porthole would fall outside the splash mask safe zone');
  }

  const source = await Jimp.read(SOURCE);
  await buildIcons(source);

  const art = source.clone().resize(PORTHOLE_R * 2, PORTHOLE_R * 2);
  maskToCircle(art);

  // Offset stroke first (it reads as the shadow), then the ink rim, then the
  // portrait — so the rim is exactly RING px all the way round.
  fillCircle(sheet, CENTRE + SHADOW_OFFSET, CENTRE + SHADOW_OFFSET, PORTHOLE_R + RING, INK_FAINT);
  fillCircle(sheet, CENTRE, CENTRE, PORTHOLE_R + RING, INK);
  sheet.composite(art, CENTRE - PORTHOLE_R, CENTRE - PORTHOLE_R);

  await write(sheet, SPLASH_OUT);
  console.log(`splash → ${path.relative(ROOT, SPLASH_OUT)} (${SIZE}x${SIZE})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
