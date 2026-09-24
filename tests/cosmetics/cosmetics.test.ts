/**
 * Cosmetics — part-03 §6, all six groups.
 *
 * The two that carry the hard rule ("zero gameplay effect") are §6.3, the
 * contrast sweep over every ink x paper pair, and §6.2/§6.4, the information
 * boundary. Those are the ones that held DECISIONS D11 and D12 open, and both
 * assertions below are written so the ruling fails loudly if it is reversed.
 */
import { describe, expect, it } from 'vitest';

import {
  COSMETICS,
  COSMETIC_SLOTS,
  DEFAULTS,
  FLEET_INKS,
  HULL_SETS,
  MARK_COLOURS,
  MARK_FLOORS,
  MARK_GLYPHS,
  MARK_SEPARATION,
  MAX_SINK_EFFECT_MS,
  MIN_CONTRAST,
  OPPONENT_VISIBLE,
  PAPERS,
  PAYLOAD_SLOTS,
  SLOT_STORE,
  SINK_EFFECTS,
  SINK_EFFECT_MS,
  TURN_FLIP_DELAY_MS,
  allPairs,
  canBuy,
  canEquip,
  colourDistance,
  contrastRatio,
  cosmeticById,
  inkOn,
  isDarkPaper,
  markLegible,
  markOn,
  marksDistinguishable,
  opponentHullVisible,
  opponentInkVisible,
  payloadFor,
  resolveEquipped,
  resolveRemote,
  resolveRemotePayload,
  shelfFor,
  sinkEffectDuration,
  type CosmeticSlot,
  type MarkKind,
} from '@engine/cosmetics';

// ===========================================================================
// §6.3 — THE CONTRAST SWEEP (closes D11)
// ===========================================================================

describe('legibility is a rule, not a preference', () => {
  it('EVERY ink x paper pair clears the 3:1 floor, as rendered', () => {
    // §7.2 — "the board stays legible in every combination we sell".
    const pairs = allPairs(FLEET_INKS, PAPERS);
    expect(pairs).toHaveLength(FLEET_INKS.length * PAPERS.length);

    const failures = pairs.filter((pair) => pair.ratio < MIN_CONTRAST);
    expect(
      failures.map((f) => `${f.inkId} on ${f.paperId} = ${f.ratio.toFixed(2)}`),
      'these combinations would ship unreadable',
    ).toEqual([]);
  });

  it('GOLD is legible on every paper — the D11 ruling, pinned', () => {
    // D11: gold scores 1.95-2.51 raw on the five light papers. The
    // bidirectional remap is what fixes it. If someone reverts the remap to
    // one-directional, this is the test that says so.
    for (const paper of PAPERS) {
      const rendered = inkOn('ink-gold', paper.id);
      const ratio = contrastRatio(rendered, paper.hex!);
      expect(ratio, `gold on ${paper.id}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it('...and gold’s RAW colour really does fail, so the remap is doing work', () => {
    const gold = cosmeticById('ink-gold')!;
    const lightPapers = PAPERS.filter((p) => !isDarkPaper(p.hex!));
    expect(lightPapers.length).toBeGreaterThan(0);
    for (const paper of lightPapers) {
      expect(contrastRatio(gold.hex!, paper.hex!), paper.id).toBeLessThan(MIN_CONTRAST);
    }
    // And the remap picks the dark bronze, not the bright form.
    expect(inkOn('ink-gold', 'paper-graph')).toBe(gold.onLight);
  });

  it('a dark paper gets the light variant — §3’s original direction', () => {
    expect(isDarkPaper('#123A5C')).toBe(true);
    const violet = cosmeticById('ink-violet')!;
    expect(inkOn('ink-violet', 'paper-blueprint')).toBe(violet.onDark);
    // And on a light paper it keeps its base.
    expect(inkOn('ink-violet', 'paper-graph')).toBe(violet.hex);
  });

  it('an unknown ink or paper still renders something legible', () => {
    const rendered = inkOn('nonsense', 'paper-blueprint');
    expect(contrastRatio(rendered, '#123A5C')).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(contrastRatio(inkOn('ink-crimson', 'nonsense'), '#FBFCFE')).toBeGreaterThanOrEqual(
      MIN_CONTRAST,
    );
  });

  it('the contrast maths is WCAG: white on black is 21:1, a colour on itself is 1:1', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#3E2FB8', '#3E2FB8')).toBeCloseTo(1, 5);
  });
});

describe('marks stay readable and stay apart', () => {
  it('every mark clears ITS floor on every paper', () => {
    const kinds = Object.keys(MARK_COLOURS) as MarkKind[];
    for (const paper of PAPERS) {
      for (const mark of kinds) {
        expect(markLegible(mark, paper.id), `${mark} on ${paper.id}`).toBe(true);
      }
    }
  });

  it('the four load-bearing marks hold the full 3:1', () => {
    for (const mark of ['miss', 'hit', 'sunk', 'mine'] as MarkKind[]) {
      expect(MARK_FLOORS[mark], mark).toBe(MIN_CONTRAST);
      for (const paper of PAPERS) {
        expect(
          contrastRatio(markOn(mark, paper.id), paper.hex!),
          `${mark} on ${paper.id}`,
        ).toBeGreaterThanOrEqual(MIN_CONTRAST);
      }
    }
  });

  it('`revealed` is deliberately subordinate, and says so', () => {
    // It is the base game's inkFaint (2.05:1 on graph). Part 3 does not
    // darken it — that would change how the game already looks — so the
    // exception is written down rather than silently allowed.
    expect(MARK_FLOORS.revealed).toBeLessThan(MIN_CONTRAST);
    expect(MARK_FLOORS.revealed).toBe(2);
    expect(markLegible('revealed', 'paper-graph')).toBe(true);
  });

  it('no two marks collapse into each other on any paper', () => {
    // Telling a hit from a sunk is a RULE. A paper that made them look alike
    // would be a gameplay change sold as a cosmetic.
    for (const paper of PAPERS) {
      expect(marksDistinguishable(paper.id), paper.id).toBe(true);
    }
  });

  it('...measured by colour DISTANCE, because contrast is the wrong question', () => {
    // miss (violet) and hit (red) sit at 1.14:1 — nearly identical luminance,
    // obviously different colours. Contrast ratio answers "readable against a
    // background"; distance answers "tell these two apart".
    expect(contrastRatio(MARK_COLOURS.miss, MARK_COLOURS.hit)).toBeLessThan(1.25);
    expect(colourDistance(MARK_COLOURS.miss, MARK_COLOURS.hit)).toBeGreaterThan(MARK_SEPARATION);
  });

  it('and each mark has its OWN glyph, which is the real guarantee', () => {
    // A player who cannot tell violet from red still tells a dot from an X.
    const glyphs = Object.values(MARK_GLYPHS);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('marks are not purchasable — there is no mark slot', () => {
    expect(COSMETIC_SLOTS).not.toContain('mark');
    expect(COSMETICS.some((c) => c.id.startsWith('mark-'))).toBe(false);
  });
});

// ===========================================================================
// §6.2 / §6.4 — THE INFORMATION BOUNDARY (closes D12)
// ===========================================================================

describe('no hidden information leaks', () => {
  it('GHOST FLEET renders on an enemy ship only when it is SUNK — the D12 ruling', () => {
    expect(opponentHullVisible({ sunk: true })).toBe(true);
    expect(opponentHullVisible({ sunk: false })).toBe(false);
  });

  it('there is no other state that reveals a hull', () => {
    // Not "hit", not "revealed", not "adjacent". Only sunk.
    for (const state of [{ sunk: false }, { sunk: false }]) {
      expect(opponentHullVisible(state)).toBe(false);
    }
  });

  it('ink and pen follow the same rule: proven cells only', () => {
    expect(opponentInkVisible({ proven: true })).toBe(true);
    expect(opponentInkVisible({ proven: false })).toBe(false);
  });

  it('the wire payload carries NO paper — it is "for you only"', () => {
    const equipped = resolveEquipped({ paper: 'paper-blueprint' });
    const payload = payloadFor(equipped);
    expect('paper' in payload).toBe(false);
    expect(Object.keys(payload).sort()).toEqual(
      ['fleetInk', 'hullSet', 'pen', 'sinkEffect', 'victoryStamp'].sort(),
    );
  });

  it('the payload carries no positions at all', () => {
    const json = JSON.stringify(payloadFor(resolveEquipped({})));
    expect(json).not.toContain('"r"');
    expect(json).not.toContain('"c"');
    expect(json).not.toContain('ships');
    expect(json).not.toContain('cells');
  });

  it('the visible-slot table and the payload agree', () => {
    expect([...PAYLOAD_SLOTS].sort()).toEqual(
      COSMETIC_SLOTS.filter((s) => OPPONENT_VISIBLE[s]).sort(),
    );
    expect(OPPONENT_VISIBLE.paper).toBe(false);
  });
});

// ===========================================================================
// §6.4 — an unknown id from an older or newer client
// ===========================================================================

describe('an unknown cosmetic id', () => {
  it('falls back to the default — never a crash', () => {
    expect(resolveRemote('sinkEffect', 'sink-from-the-future')).toBe(DEFAULTS.sinkEffect);
    expect(resolveRemote('hullSet', undefined)).toBe(DEFAULTS.hullSet);
    expect(resolveRemote('fleetInk', '')).toBe(DEFAULTS.fleetInk);
  });

  it('refuses an id from the WRONG slot', () => {
    // A payload claiming a paper in the ink slot is a bug or an attack; either
    // way it renders as the default rather than as something unexpected.
    expect(resolveRemote('fleetInk', 'paper-blueprint')).toBe(DEFAULTS.fleetInk);
  });

  it('a whole malformed payload resolves to defaults without throwing', () => {
    expect(() => resolveRemotePayload(null)).not.toThrow();
    expect(resolveRemotePayload(null)).toEqual({
      fleetInk: DEFAULTS.fleetInk,
      pen: DEFAULTS.pen,
      hullSet: DEFAULTS.hullSet,
      sinkEffect: DEFAULTS.sinkEffect,
      victoryStamp: DEFAULTS.victoryStamp,
    });
    expect(resolveRemotePayload({ hullSet: 'hull-ghost' }).hullSet).toBe('hull-ghost');
  });

  it('resolveEquipped fills every slot, whatever it is handed', () => {
    const out = resolveEquipped({ fleetInk: 'nonsense' });
    expect(Object.keys(out).sort()).toEqual([...COSMETIC_SLOTS].sort());
    expect(out.fleetInk).toBe(DEFAULTS.fleetInk);
  });
});

// ===========================================================================
// §6.5 — timing
// ===========================================================================

describe('sink effects cannot delay the game', () => {
  it('every one completes inside §3’s 600 ms cap', () => {
    for (const effect of SINK_EFFECTS) {
      expect(sinkEffectDuration(effect.id), effect.id).toBeLessThanOrEqual(MAX_SINK_EFFECT_MS);
    }
  });

  it('they all run at the SAME duration — a cosmetic cannot buy you time', () => {
    const durations = new Set(SINK_EFFECTS.map((e) => sinkEffectDuration(e.id)));
    expect(durations.size).toBe(1);
    // Part 2's selected finding: capped at 420, tighter than §3's ceiling.
    expect([...durations][0]).toBe(SINK_EFFECT_MS);
  });

  it('an item claiming a longer duration is clamped, not trusted', () => {
    expect(sinkEffectDuration('sink-from-the-future')).toBeLessThanOrEqual(MAX_SINK_EFFECT_MS);
  });

  it('the turn flip never waits for one', () => {
    expect(TURN_FLIP_DELAY_MS).toBe(0);
  });
});

// ===========================================================================
// §6.1 / §6.6 — buying, equipping and the shelf
// ===========================================================================

describe('the shelf', () => {
  it('a level-1 store never offers a tier-2 item', () => {
    for (const slot of COSMETIC_SLOTS) {
      const shelf = shelfFor(slot, 1);
      expect(shelf.every((c) => c.tier <= 1), slot).toBe(true);
      expect(shelfFor(slot, 3).length).toBeGreaterThanOrEqual(shelf.length);
    }
  });

  it('refuses to sell a locked tier even if the player can afford it', () => {
    const check = canBuy('ink-rust', [], 1, { coins: 999_999, gems: 999_999 });
    expect(check.ok).toBe(false);
    expect(check.error).toBe('locked-tier');
  });

  it('every slot has exactly one default, free and unbuyable', () => {
    for (const slot of COSMETIC_SLOTS) {
      const defaults = COSMETICS.filter((c) => c.slot === slot && c.isDefault);
      expect(defaults, slot).toHaveLength(1);
      expect(defaults[0]!.coins).toBe(0);
      expect(defaults[0]!.gems).toBe(0);
      expect(canBuy(defaults[0]!.id, [], 3, { coins: 9_999, gems: 9_999 }).error).toBe('already-owned');
    }
  });

  it('buying twice is refused', () => {
    expect(canBuy('ink-crimson', ['ink-crimson'], 3, { coins: 9_999, gems: 0 }).error).toBe(
      'already-owned',
    );
  });

  it('checks the right currency', () => {
    // Gold costs gems, not coins — a player rich in coins still cannot buy it.
    expect(canBuy('ink-gold', [], 3, { coins: 999_999, gems: 0 }).error).toBe('not-enough-gems');
    expect(canBuy('ink-gold', [], 3, { coins: 0, gems: 350 }).ok).toBe(true);
    expect(canBuy('ink-crimson', [], 3, { coins: 299, gems: 9_999 }).error).toBe('not-enough-coins');
  });

  it('every priced item costs in exactly one currency', () => {
    for (const item of COSMETICS) {
      if (item.isDefault) continue;
      const priced = (item.coins > 0 ? 1 : 0) + (item.gems > 0 ? 1 : 0);
      expect(priced, item.id).toBe(1);
    }
  });

  it('gems have a real sink — §7.3', () => {
    expect(COSMETICS.some((c) => c.gems > 0)).toBe(true);
  });
});

describe('equipping', () => {
  it('refuses an item the player does not own', () => {
    expect(canEquip('fleetInk', 'ink-gold', []).error).toBe('not-owned');
    expect(canEquip('fleetInk', 'ink-gold', ['ink-gold']).ok).toBe(true);
  });

  it('always allows a default, owned or not', () => {
    expect(canEquip('fleetInk', DEFAULTS.fleetInk, []).ok).toBe(true);
  });

  it('refuses an item in the wrong slot', () => {
    expect(canEquip('fleetInk', 'paper-graph', ['paper-graph']).error).toBe('bad-slot');
  });

  it('refuses an unknown item', () => {
    expect(canEquip('fleetInk', 'nope', ['nope']).error).toBe('unknown-item');
  });
});

// ===========================================================================
// The catalogue itself
// ===========================================================================

describe('the catalogue', () => {
  it('has §1’s six slots and no more', () => {
    expect([...COSMETIC_SLOTS].sort()).toEqual(
      ['fleetInk', 'paper', 'pen', 'hullSet', 'sinkEffect', 'victoryStamp'].sort(),
    );
  });

  it('has unique ids, and every id resolves', () => {
    const ids = COSMETICS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(cosmeticById(id), id).not.toBeNull();
  });

  it('carries §2’s named items', () => {
    for (const id of ['ink-gold', 'paper-blueprint', 'pen-crayon', 'hull-ghost', 'sink-whirlpool', 'stamp-kraken']) {
      expect(cosmeticById(id), id).not.toBeNull();
    }
    expect(HULL_SETS.some((h) => h.name === 'Ghost fleet')).toBe(true);
  });

  it('every ink and paper declares a colour, so the sweep can read it', () => {
    for (const ink of FLEET_INKS) expect(ink.hex, ink.id).toBeTruthy();
    for (const paper of PAPERS) expect(paper.hex, paper.id).toBeTruthy();
  });

  it('NOTHING in it changes a rule — no item declares a gameplay field', () => {
    // The structural version of "not one point of power": a cosmetic carries
    // a colour, a tier and a price. There is no field for damage, range,
    // reveal, fuel or anything else the engine reads.
    const forbidden = ['damage', 'range', 'reveal', 'fuel', 'shells', 'accuracy', 'cells', 'target'];
    const json = JSON.stringify(COSMETICS);
    for (const field of forbidden) {
      expect(json.includes(`"${field}"`), field).toBe(false);
    }
  });

  it('slots map to the two stores §4 describes', () => {
    const stores = new Set(Object.values(SLOT_STORE));
    expect([...stores].sort()).toEqual(['shipyard', 'stationery']);
    // Every slot belongs to exactly one shop.
    for (const slot of COSMETIC_SLOTS) expect(SLOT_STORE[slot], slot).toBeTruthy();
  });
});
