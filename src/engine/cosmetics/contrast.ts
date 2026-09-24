/**
 * Legibility — part-03 §3, tested by §6.3. **This file closes DECISIONS D11.**
 *
 * §3: "**Legibility is a rule, not a preference.** A test computes the
 * contrast ratio of every ink x paper combination; anything under 3:1 is
 * remapped to that ink's light variant on dark papers (Blueprint) instead of
 * being sold as an unreadable combination."
 *
 * ─────────────────────────────────────────────────────────────────────────
 * D11, RESOLVED: the remap is now BIDIRECTIONAL.
 *
 * §3 as written is one-directional — it only handles dark papers. The survey
 * during Part 2 measured all 48 ink x paper pairs and found 13 failures: seven
 * are dark-ink-on-Blueprint, which the written rule covers, and six are
 * **Gold** on the five light papers (1.95-2.51), which it does not.
 *
 * Two ways out, and I have taken the first:
 *
 *   (a) give each ink an `onLight` variant as well as an `onDark` one, so the
 *       remap works in both directions;
 *   (b) do not sell Gold as a general-purpose ink.
 *
 * (a), because acceptance criterion §7.2 requires the board to stay legible
 * "in every combination we sell", and a 350-gem ink that is only legible on
 * one of six papers is a purchase the player cannot see going wrong. It also
 * extends a rule §3 already establishes rather than inventing a new one: the
 * remap exists, it simply pointed one way.
 *
 * The floor stays 3:1 and no combination ships below it. Nothing about
 * gameplay changes — this is a colour substitution at render time.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { cosmeticById, type CosmeticItem } from './catalogue';

/** §3's floor. WCAG's large-text minimum, which is what a ship sprite is. */
export const MIN_CONTRAST = 3;

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean.split('').map((c) => c + c).join('')
      : clean.padEnd(6, '0').slice(0, 6);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** WCAG 2.1 relative luminance. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio, 1:1 to 21:1. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** A paper is "dark" when white text would read better on it than black. */
export function isDarkPaper(paperHex: string): boolean {
  return luminance(paperHex) < 0.5;
}

/**
 * The colour an ink is ACTUALLY drawn in on a given paper.
 *
 * This is the whole remap, and it is the only function that decides an ink's
 * rendered colour. Order matters: try the base, then the direction-appropriate
 * variant, then the other one — so an ink with only one variant still gets the
 * best of what it has rather than falling back to something illegible.
 */
export function inkOn(inkId: string, paperId: string): string {
  const ink = cosmeticById(inkId);
  const paper = cosmeticById(paperId);
  const base = ink?.hex ?? '#3E2FB8';
  const sheet = paper?.hex ?? '#FBFCFE';

  if (contrastRatio(base, sheet) >= MIN_CONTRAST) return base;

  const preferred = isDarkPaper(sheet) ? ink?.onDark : ink?.onLight;
  if (preferred && contrastRatio(preferred, sheet) >= MIN_CONTRAST) return preferred;

  const other = isDarkPaper(sheet) ? ink?.onLight : ink?.onDark;
  if (other && contrastRatio(other, sheet) >= MIN_CONTRAST) return other;

  // Nothing in the item clears the floor. Rather than ship an unreadable
  // board, fall back to the default ink's appropriate form — which always
  // does, and a test proves it.
  return isDarkPaper(sheet) ? '#8E82F0' : '#3E2FB8';
}

/** Every ink x paper pair, as rendered. What §6.3's test walks. */
export function allPairs(
  inks: readonly CosmeticItem[],
  papers: readonly CosmeticItem[],
): { inkId: string; paperId: string; rendered: string; ratio: number }[] {
  const out: { inkId: string; paperId: string; rendered: string; ratio: number }[] = [];
  for (const ink of inks) {
    for (const paper of papers) {
      const rendered = inkOn(ink.id, paper.id);
      out.push({
        inkId: ink.id,
        paperId: paper.id,
        rendered,
        ratio: contrastRatio(rendered, paper.hex ?? '#FBFCFE'),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Marks (§3 — "Marks must stay distinguishable on every paper")
// ---------------------------------------------------------------------------

/**
 * The five marks, with the reference palette §3's test compares against.
 * These are NOT cosmetic — a player cannot recolour a hit marker, because
 * telling a hit from a miss is a rule, not a preference.
 */
export const MARK_COLOURS = {
  miss: '#6C5FD6',
  hit: '#C7261C',
  sunk: '#8A1810',
  revealed: '#B4ABEC',
  mine: '#3E9B4F',
} as const;

export type MarkKind = keyof typeof MARK_COLOURS;

/** On a dark paper, the marks need their light forms — same rule as ink. */
export const MARK_COLOURS_DARK = {
  miss: '#A79CF0',
  hit: '#FF7A6E',
  sunk: '#FFB3A8',
  revealed: '#D8D2F8',
  mine: '#7BD98C',
} as const;

/**
 * A third palette, for TINTED light papers.
 *
 * The first sweep only checked graph paper, which is near-white. Parchment
 * (#F2E6CC) and the old sea chart are warm and several shades down, and the
 * green mine (2.82:1) and the faint revealed mark both fall through the floor
 * on them — a real finding, caught because the test walks every paper rather
 * than the default one.
 *
 * So marks get the same treatment inks do: a deeper form, used when the base
 * does not clear the mark's own floor. Same rule, same shape, one more table.
 */
export const MARK_COLOURS_DEEP = {
  miss: '#4A3FA8',
  hit: '#9E1E16',
  sunk: '#6B120C',
  revealed: '#8C82C4',
  mine: '#2A6B36',
} as const;

/**
 * The colour a mark is ACTUALLY drawn in on a given paper.
 *
 * Dark paper gets the light palette; a light paper gets the base, or the deep
 * one when the base does not clear that mark's floor.
 */
export function markOn(mark: MarkKind, paperId: string): string {
  const paper = cosmeticById(paperId);
  const sheet = paper?.hex ?? '#FBFCFE';
  if (isDarkPaper(sheet)) return MARK_COLOURS_DARK[mark];

  const base = MARK_COLOURS[mark];
  if (contrastRatio(base, sheet) >= MARK_FLOORS[mark]) return base;
  return MARK_COLOURS_DEEP[mark];
}

/**
 * THE FLOOR A MARK MUST CLEAR AGAINST ITS PAPER.
 *
 * Four of the five marks are load-bearing — you act on them — and hold the
 * same 3:1 as everything else. `revealed` is different BY DESIGN: it is the
 * faint hatch the engine draws on a cell the rules have made known-empty, a
 * hint rather than a statement, and it is `inkFaint` in the base game
 * (2.05:1 on graph paper).
 *
 * I have NOT darkened it. Doing so would change how the base game looks, which
 * is outside a cosmetics part's business, and the mark is deliberately
 * subordinate — a revealed cell that shouted would compete with the hits.
 * Instead the rule is stated honestly: a lower floor, written down, tested.
 */
export const MARK_FLOORS: Readonly<Record<MarkKind, number>> = {
  miss: MIN_CONTRAST,
  hit: MIN_CONTRAST,
  sunk: MIN_CONTRAST,
  mine: MIN_CONTRAST,
  /** Subordinate by design. See above. */
  revealed: 2,
};

export function markLegible(mark: MarkKind, paperId: string): boolean {
  const paper = cosmeticById(paperId);
  const sheet = paper?.hex ?? '#FBFCFE';
  return contrastRatio(markOn(mark, paperId), sheet) >= MARK_FLOORS[mark];
}

/**
 * How far apart two colours are, perceptually. "Redmean" — cheap, no colour
 * space conversion, and good enough to tell violet from red.
 *
 * WHY NOT CONTRAST RATIO. Contrast ratio is a LUMINANCE measure: it answers
 * "can I read this against that background". Two marks can have almost
 * identical luminance and still be obviously different — the game's miss
 * (violet) and hit (red) score 1.14:1 against each other, which reads as
 * "indistinguishable" and is plainly wrong. Distance is the right question
 * for foreground-vs-foreground, and it puts the closest pair at 105.
 */
export function colourDistance(a: string, b: string): number {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const meanRed = (x.r + y.r) / 2;
  const dr = x.r - y.r;
  const dg = x.g - y.g;
  const db = x.b - y.b;
  return Math.sqrt(
    (2 + meanRed / 256) * dr * dr + 4 * dg * dg + (2 + (255 - meanRed) / 256) * db * db,
  );
}

/** Comfortably below the measured minimum (105 light, 136 dark). */
export const MARK_SEPARATION = 60;

/**
 * §3 — "Marks must stay distinguishable on every paper."
 *
 * Colour is the SECOND line here, not the first: each mark has its own glyph
 * (a dot, an X, a filled cell, a hatch, a ring), which is what keeps the board
 * readable for a colour-blind player. This checks the colour layer on top.
 */
export function marksDistinguishable(paperId: string): boolean {
  const kinds = Object.keys(MARK_COLOURS) as MarkKind[];
  for (let i = 0; i < kinds.length; i++) {
    for (let j = i + 1; j < kinds.length; j++) {
      const a = markOn(kinds[i]!, paperId);
      const b = markOn(kinds[j]!, paperId);
      if (colourDistance(a, b) < MARK_SEPARATION) return false;
    }
  }
  return true;
}

/**
 * The glyph each mark is drawn as. The REAL distinguishability guarantee: a
 * player who cannot tell violet from red still tells a dot from an X.
 */
export const MARK_GLYPHS: Readonly<Record<MarkKind, string>> = {
  miss: 'dot',
  hit: 'cross',
  sunk: 'filled',
  revealed: 'hatch',
  mine: 'ring',
};
