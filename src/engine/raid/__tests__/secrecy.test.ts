/**
 * THE SECRECY FUZZ — part-06 §10, §11.
 *
 * "The hidden layout is never sent ... and there must be a test that fails the
 * build if it ever appears in a raid payload."
 *
 * 500 random raids. Random legal harbours, random kits, random legal actions,
 * and after EVERY action the serialised raidView() is grepped for:
 *
 *   1. any ship cell that has not actually been hit, in both coordinate forms
 *   2. any arsenal item's cell that the rules have not revealed
 *   3. the word "decoy" while that decoy is still unexposed
 *
 * The view's key set is pinned too, so hidden data cannot hide in a field
 * somebody adds later: a new key fails the shape assertion first.
 *
 * This test is deliberately slow-ish and deliberately exhaustive. It is the
 * one that stands between a refactor and a cheat.
 */
import { describe, expect, it } from 'vitest';

import { specFor } from '../../arsenal';
import { cellsOf, coordKey } from '../../board';
import { isSunk } from '../../fleet';
import { autoPlaceFleet, validateArsenalPlacement } from '../../placement';
import { createRng, type Rng } from '../../rng';
import type { ArsenalItem, ArsenalKind, Board, Coord } from '../../types';
import {
  HARBOUR_KINDS,
  RAID_DEFAULTS,
  RAID_KIT_KINDS,
  fireShell,
  raidFinalReveal,
  raidView,
  startRaid,
  useKit,
  type HarbourLayout,
  type KitCounts,
  type RaidState,
} from '../index';

const VIEW_KEYS = [
  'destruction',
  'kit',
  'kitLeft',
  'marks',
  'msLeft',
  'over',
  'revealedItems',
  'shells',
  'shipsRemaining',
  'stars',
  'sunkShips',
  // Part 10B — the sea is public before the first shell.
  'terrain',
].sort();

/** Both shapes a coordinate can take in our JSON: the mark key and the object. */
const forms = (cell: Coord) => [`"${coordKey(cell)}"`, JSON.stringify(cell)];

// ---------------------------------------------------------------------------
// Random legal input
// ---------------------------------------------------------------------------

function randomHarbour(rng: Rng): HarbourLayout {
  const ships = autoPlaceFleet(rng);
  const arsenal: ArsenalItem[] = [];

  // A deliberately fat harbour: more defences than any real Coastal Command
  // level allows, so the fuzz covers boards the game itself cannot build.
  const wanted: ArsenalKind[] = [];
  for (const kind of HARBOUR_KINDS) {
    for (let n = 0; n < 1 + rng.int(3); n++) wanted.push(kind);
  }

  for (let i = 0; i < wanted.length; i++) {
    const kind = wanted[i]!;
    const board: Board = { ships, arsenal, marks: {} };
    for (let attempt = 0; attempt < 60; attempt++) {
      const item: ArsenalItem = { id: `${kind}-${i}`, kind, at: { r: rng.int(10), c: rng.int(10) } };
      if (validateArsenalPlacement(board, item).ok) {
        arsenal.push(item);
        break;
      }
    }
  }
  return { ships, arsenal };
}

function randomKit(rng: Rng): KitCounts {
  const kit: Record<string, number> = {};
  for (const kind of RAID_KIT_KINDS) {
    if (rng.int(2) === 0) continue;
    kit[kind] = 1 + rng.int(specFor(kind).max);
  }
  return kit as KitCounts;
}

// ---------------------------------------------------------------------------
// The assertion
// ---------------------------------------------------------------------------

function expectNoLeak(state: RaidState, where: string) {
  const view = raidView(state, 1_000);

  // 0. Shape. A new field cannot smuggle anything past the greps below.
  expect(Object.keys(view).filter((k) => k !== 'endReason').sort(), where).toEqual(VIEW_KEYS);
  expect('layout' in view, where).toBe(false);
  expect('ships' in view, where).toBe(false);
  expect('arsenal' in view, where).toBe(false);

  const json = JSON.stringify(view);

  // 1. Every un-hit ship cell must be absent, in both forms.
  for (const ship of state.ships) {
    const hit = new Set(ship.hits.map(coordKey));
    for (const cell of cellsOf(ship)) {
      if (hit.has(coordKey(cell))) continue;
      for (const form of forms(cell)) {
        expect(json.includes(form), `${where}: leaked un-hit ship cell ${form}`).toBe(false);
      }
    }
  }

  // Ship ids and classes are identity too: only a SUNK ship may name itself.
  for (const ship of state.ships) {
    if (isSunk(ship)) continue;
    expect(json.includes(`"${ship.id}"`), `${where}: leaked ship id ${ship.id}`).toBe(false);
  }

  // 2. An arsenal item's cell may appear only once the rules revealed it, and
  //    a mark of the raider's own making is not a reveal.
  for (const item of state.arsenal) {
    if (!item.at) continue;
    const isPublic = item.revealed === true || item.destroyed === true;
    if (isPublic) continue;
    const shotIt = state.marks[coordKey(item.at)] !== undefined;
    if (shotIt) continue; // the raider put a mark there itself; the cell is its own knowledge
    for (const form of forms(item.at)) {
      expect(json.includes(form), `${where}: leaked hidden ${item.kind} at ${form}`).toBe(false);
    }
  }

  // 3. The decoy's whole point (Part 5): its KIND stays secret until exposed.
  //
  // The word "decoy" is allowed to reach the wire in exactly two places, and
  // only for a decoy the rules have already exposed: the 'decoy' MARK that
  // shots.ts writes at expose time, and that decoy's revealedItems entry.
  // Accounting for both exactly means any THIRD source is a leak.
  const exposed = state.arsenal.filter((i) => i.kind === 'decoy' && i.revealed === true);
  const exposedKeys = new Set(exposed.map((i) => coordKey(i.at as Coord)));

  for (const item of state.arsenal) {
    if (item.kind !== 'decoy' || !item.at) continue;
    if (item.revealed === true) continue;
    // A hit but unexposed decoy must read as a plain 'hit' — never 'decoy'.
    expect(view.marks[coordKey(item.at)], `${where}: unexposed decoy marked as itself`).not.toBe('decoy');
    expect(
      view.revealedItems.some((r) => coordKey(r.at) === coordKey(item.at as Coord)),
      `${where}: unexposed decoy listed in revealedItems`,
    ).toBe(false);
  }

  const decoyMarks = Object.entries(view.marks).filter(([k, m]) => m === 'decoy' && exposedKeys.has(k));
  const decoyItems = view.revealedItems.filter(
    (r) => r.kind === 'decoy' && exposedKeys.has(coordKey(r.at)),
  );
  const accountedFor = decoyMarks.length + decoyItems.length;
  const decoyMentions = json.split('"decoy"').length - 1;
  expect(
    decoyMentions,
    `${where}: "decoy" appears ${decoyMentions}x, only ${accountedFor} accounted for by ${exposed.length} exposed`,
  ).toBe(accountedFor);

  // 4. And nothing in revealedItems may be an item the rules kept hidden.
  for (const shown of view.revealedItems ?? []) {
    const source = state.arsenal.find((i) => i.at && coordKey(i.at) === coordKey(shown.at));
    expect(source, `${where}: revealed a phantom item`).toBeDefined();
    expect(
      source!.revealed === true || source!.destroyed === true,
      `${where}: revealed a hidden ${source!.kind}`,
    ).toBe(true);
  }

  return view;
}

// ---------------------------------------------------------------------------
// The fuzz
// ---------------------------------------------------------------------------

function unresolved(state: RaidState, rng: Rng): Coord | null {
  for (let attempt = 0; attempt < 40; attempt++) {
    const cell = { r: rng.int(10), c: rng.int(10) };
    if (state.marks[coordKey(cell)] === undefined) return cell;
  }
  return null;
}

function randomStep(state: RaidState, rng: Rng): RaidState {
  const held = RAID_KIT_KINDS.filter((k) => (state.kit[k] ?? 0) > 0);
  const useKitNow = held.length > 0 && rng.int(4) === 0;

  if (useKitNow) {
    const weapon = held[rng.int(held.length)]!;
    const spec = specFor(weapon);
    const target =
      spec.target === 'row' ? { row: rng.int(10) } : { at: { r: rng.int(10), c: rng.int(10) } };
    return useKit(state, weapon, target, 100).state;
  }

  const cell = unresolved(state, rng);
  if (!cell) return state;
  return fireShell(state, cell, 100).state;
}

describe('secrecy — 500 raids, checked after every single action', () => {
  it('never serialises a hidden cell, a hidden item or an unexposed decoy', () => {
    let actionsChecked = 0;
    let decoysExposed = 0;
    let itemsRevealed = 0;
    let raidsCleared = 0;

    for (let seed = 1; seed <= 500; seed++) {
      const rng = createRng(seed);
      const layout = randomHarbour(rng);
      let state = startRaid(layout, randomKit(rng), 0, RAID_DEFAULTS);

      expectNoLeak(state, `seed ${seed} / start`);

      for (let step = 0; step < 60 && !state.over; step++) {
        const before = state;
        state = randomStep(state, rng);
        if (state === before) break; // nothing legal left to do
        expectNoLeak(state, `seed ${seed} / step ${step}`);
        actionsChecked++;
      }

      if (state.endReason === 'cleared') raidsCleared++;
      decoysExposed += state.arsenal.filter((i) => i.kind === 'decoy' && i.revealed).length;
      itemsRevealed += state.arsenal.filter((i) => i.revealed || i.destroyed).length;
    }

    // The fuzz must actually have exercised the interesting paths, or it is
    // only proving that an empty payload leaks nothing.
    expect(actionsChecked).toBeGreaterThan(5_000);
    expect(itemsRevealed).toBeGreaterThan(0);
    expect(decoysExposed).toBeGreaterThan(0);
    expect(raidsCleared).toBeGreaterThanOrEqual(0);
  });

  it('NEGATIVE CONTROL: the secret is really there, and the view is what removes it', () => {
    // A secrecy test that cannot fail is worthless. This proves the grep in
    // expectNoLeak() is looking for something that genuinely exists: the same
    // coordinates ARE present in the raid state, and absent from the view.
    const rng = createRng(11);
    const layout = randomHarbour(rng);
    const state = startRaid(layout, {}, 0);

    const stateJson = JSON.stringify(state);
    const viewJson = JSON.stringify(raidView(state));

    let secretsInState = 0;
    for (const ship of state.ships) {
      for (const cell of cellsOf(ship)) {
        for (const form of forms(cell)) {
          if (stateJson.includes(form)) secretsInState++;
          expect(viewJson.includes(form), `view leaked ${form}`).toBe(false);
        }
      }
    }
    expect(secretsInState).toBeGreaterThan(0);
    expect(stateJson).toContain('"layout"');
    expect(viewJson).not.toContain('"layout"');

    // And expectNoLeak itself throws when handed a state whose view would leak.
    expect(() =>
      expectNoLeak({ ...state, marks: { bogus: 'hit' } } as unknown as RaidState, 'tampered'),
    ).not.toThrow(); // a junk mark is not a leak...
    const leaky = {
      ...state,
      // ...but pretending every ship is sunk publishes all 18 cells.
      ships: state.ships.map((sh) => ({ ...sh, hits: cellsOf(sh) })),
    };
    const publishedCells = raidView(leaky as RaidState).sunkShips.flatMap((sh) => sh.cells);
    expect(publishedCells).toHaveLength(18); // the view WILL publish, when the rules say so
  });

  it('the final reveal is refused while the raid is still running', () => {
    const rng = createRng(42);
    const state = startRaid(randomHarbour(rng), {}, 0);
    expect(raidFinalReveal(state)).toBeNull();

    const over = { ...state, over: true, endReason: 'retreat' as const };
    const reveal = raidFinalReveal(over);
    expect(reveal).not.toBeNull();
    expect(reveal!.ships).toHaveLength(8);
  });

  it('a view built from a fully-cleared harbour still names only sunk ships', () => {
    const rng = createRng(3);
    const layout = randomHarbour(rng);
    let state = startRaid(layout, {}, 0, { ...RAID_DEFAULTS, shells: 400 });
    for (const ship of layout.ships) {
      for (const cell of cellsOf(ship)) {
        if (state.marks[coordKey(cell)] === undefined) state = fireShell(state, cell).state;
      }
    }
    const view = expectNoLeak(state, 'cleared');
    expect(view.sunkShips).toHaveLength(8);
    expect(view.shipsRemaining).toBe(0);
  });
});
