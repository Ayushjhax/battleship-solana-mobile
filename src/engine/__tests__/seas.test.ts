/**
 * Part 10B — terrain and the five seas, rule by rule.
 *
 * Custom terrains are built for the shot rules so the case under test is the
 * only thing on the board; the five REAL seas are checked for their shape,
 * their placement rules and their generator separately.
 */
import { describe, expect, it } from 'vitest';
import { createMatch, projectView, reduce } from '../match';
import { autoPlaceFleet, validateArsenalPlacement, validateLayout, validatePlacement } from '../placement';
import { createRng } from '../rng';
import { startRaid, fireShell, replayRaid, raidView } from '../raid';
import {
  SEAS,
  SEASON_SEA_CYCLE,
  WATER,
  currentSeasonSeaAt,
  isTerrain,
  seasonNumberAt,
  seasonSeaFor,
  seaSpec,
  terrainForSea,
  unlockedSeasFor,
  type SeaId,
  type Terrain,
  type TerrainCell,
} from '../terrain';
import { GRID_SIZE, type ArsenalItem, type Ship } from '../types';
import { P0, P1, startMatch, types } from './fixtures';

/** A 10 x 10 board with the named cells set, everything else water. */
function terrainWith(cells: Readonly<Record<string, TerrainCell>>): Terrain {
  return Array.from({ length: GRID_SIZE }, (_, r) =>
    Array.from({ length: GRID_SIZE }, (_, c) => cells[`${r},${c}`] ?? 'water'),
  );
}

const ship = (
  id: string,
  cls: Ship['class'],
  len: number,
  r: number,
  c: number,
  orientation: Ship['orientation'],
): Ship => ({ id, class: cls, len, origin: { r, c }, orientation, hits: [] });

// Cells that are empty on BOTH fixture layouts, so a custom island there keeps
// both submissions legal: row 1 outside columns 3/5/7/9, rows 8-9 everywhere.
const ISLAND = terrainWith({ '1,2': 'island' });
const REEF = terrainWith({ '8,0': 'reef', '8,1': 'reef', '9,0': 'reef' });

describe('the five seas', () => {
  it('are well-formed, fixed tables with the documented cells', () => {
    expect(SEAS.map((sea) => sea.id)).toEqual([
      'open',
      'archipelago',
      'coral',
      'fogbank',
      'strait',
    ]);
    for (const sea of SEAS) {
      expect(isTerrain(sea.terrain)).toBe(true);
      expect(sea.terrain).toHaveLength(GRID_SIZE);
    }
    expect(seaSpec('open').terrain).toBe(WATER);
    expect(WATER.every((row) => row.every((cell) => cell === 'water'))).toBe(true);

    const count = (id: SeaId, cell: TerrainCell): number =>
      terrainForSea(id)
        .flat()
        .filter((c) => c === cell).length;
    expect(count('archipelago', 'island')).toBe(7);
    expect(count('archipelago', 'reef')).toBe(0);
    expect(count('archipelago', 'fog')).toBe(0);
    expect(count('coral', 'reef')).toBe(30);
    expect(count('coral', 'island')).toBe(0);
    expect(count('fogbank', 'fog')).toBe(50);
    expect(count('fogbank', 'island')).toBe(0);
    expect(count('strait', 'island')).toBe(6);
    expect(count('strait', 'reef')).toBe(12);
  });

  it('Classic is Open Sea only, even when a sea is handed to createMatch', () => {
    const state = startMatch({ mode: 'classic', terrain: terrainForSea('coral') });
    expect(state.terrain).toBe(WATER);
    expect(projectView(state, P0).terrain).toBe(WATER);
  });

  it('a terrain match exposes the same sea to both players', () => {
    // Fogbank admits both fixture layouts (fog never constrains placement);
    // the island seas are exercised with generated fleets elsewhere.
    const state = startMatch({ mode: 'advanced', terrain: terrainForSea('fogbank') });
    expect(projectView(state, P0).terrain).toBe(projectView(state, P1).terrain);
    expect(projectView(state, P0).terrain).toBe(terrainForSea('fogbank'));
  });
});

describe('placement on terrain', () => {
  const board = { ships: [], arsenal: [], marks: {} };

  it('refuses a ship on an island', () => {
    const check = validatePlacement(board, ship('boat-1', 'boat', 1, 1, 2, 'h'), ISLAND);
    expect(check).toEqual({ ok: false, reason: 'may not sit on an island' });
  });

  it('refuses a long ship on a reef and allows a short one', () => {
    const battleship = ship('battleship-1', 'battleship', 4, 8, 0, 'h');
    expect(validatePlacement(board, battleship, REEF)).toEqual({
      ok: false,
      reason: 'only destroyers and boats may sit on a reef',
    });
    expect(validatePlacement(board, ship('destroyer-1', 'destroyer', 2, 8, 0, 'h'), REEF)).toEqual({
      ok: true,
    });
    expect(validatePlacement(board, ship('boat-1', 'boat', 1, 9, 0, 'h'), REEF)).toEqual({
      ok: true,
    });
  });

  it('refuses an item on an island and allows one on a reef', () => {
    const mine: ArsenalItem = { id: 'mine-1', kind: 'mine', at: { r: 1, c: 2 } };
    expect(validateArsenalPlacement(board, mine, ISLAND)).toEqual({
      ok: false,
      reason: 'may not sit on an island',
    });
    const reefMine: ArsenalItem = { id: 'mine-1', kind: 'mine', at: { r: 8, c: 0 } };
    expect(validateArsenalPlacement(board, reefMine, REEF)).toEqual({ ok: true });
  });

  it('validateLayout and autoPlaceFleet respect the sea', () => {
    expect(validateLayout([ship('battleship-1', 'battleship', 4, 8, 0, 'h')], REEF).ok).toBe(
      false,
    );
    const fleet = autoPlaceFleet(createRng(3), REEF);
    expect(validateLayout(fleet, REEF)).toEqual({ ok: true });
  });

  it('every generated ship on every real sea is legal there', () => {
    for (const sea of SEAS) {
      for (let seed = 0; seed < 25; seed++) {
        const fleet = autoPlaceFleet(createRng(seed * 31 + 1), sea.terrain);
        expect(validateLayout(fleet, sea.terrain).ok, `${sea.id} seed ${seed}`).toBe(true);
      }
    }
  });
});

describe('shots on terrain', () => {
  it('an island can never be fired on, and the refusal costs nothing', () => {
    const state = startMatch({ mode: 'advanced', terrain: ISLAND, first: P0 });
    const shot = reduce(state, { type: 'FIRE', playerId: P0, at: { r: 1, c: 2 } });
    expect(types(shot.events)).toEqual(['REJECTED']);
    expect(shot.state.turn).toBe(P0);
    expect(shot.state.moves).toBe(0);
    expect(shot.state.players[1].board.marks['1,2']).toBeUndefined();
  });

  it('a torpedo run stops dead at an island', () => {
    const state = startMatch({
      mode: 'advanced',
      terrain: ISLAND,
      arsenalA: [{ id: 'tb-1', kind: 'torpedoBomber' }],
      first: P0,
    });
    const run = reduce(state, { type: 'USE_ARSENAL', playerId: P0, itemId: 'tb-1', row: 1 });
    const travel = run.events.find((e) => e.type === 'TORPEDO_TRAVEL');
    expect(travel?.type === 'TORPEDO_TRAVEL' && travel.hitAt).toBeNull();
    expect(travel?.type === 'TORPEDO_TRAVEL' && travel.path.at(-1)).toEqual({ r: 1, c: 2 });
    // The destroyer behind the island at (1,5) is untouched.
    expect(run.state.players[1].board.marks['1,5']).toBeUndefined();
    expect(run.state.turn).toBe(P1);
  });

  it('a ship before the island is still hit normally', () => {
    const late = terrainWith({ '1,8': 'island' });
    const state = startMatch({
      mode: 'advanced',
      terrain: late,
      arsenalA: [{ id: 'tb-1', kind: 'torpedoBomber' }],
      first: P0,
    });
    const run = reduce(state, { type: 'USE_ARSENAL', playerId: P0, itemId: 'tb-1', row: 1 });
    expect(run.state.players[1].board.marks['1,5']).toBe('hit');
    expect(run.state.turn).toBe(P0);
  });

  it('a bomb or blast that covers an island does nothing there', () => {
    const withIsland = terrainWith({ '8,1': 'island' });
    const state = startMatch({
      mode: 'advanced',
      terrain: withIsland,
      arsenalA: [
        { id: 'b-1', kind: 'bomber' },
        { id: 'a-1', kind: 'atomicBomber' },
      ],
      first: P0,
    });
    const bomberRun = reduce(state, { type: 'USE_ARSENAL', playerId: P0, itemId: 'b-1', at: { r: 8, c: 0 } });
    const dropped = bomberRun.events.filter((e) => e.type === 'BOMB_DROPPED');
    const islandDrop = dropped.find((e) => e.type === 'BOMB_DROPPED' && e.at.r === 8 && e.at.c === 1);
    expect(islandDrop?.type === 'BOMB_DROPPED' && islandDrop.resolves).toBe(false);
    expect(bomberRun.state.players[1].board.marks['8,1']).toBeUndefined();
    expect(bomberRun.state.players[1].board.marks['8,0']).toBe('miss');

    const nuke = reduce(
      { ...state, turn: P0 },
      { type: 'USE_ARSENAL', playerId: P0, itemId: 'a-1', at: { r: 8, c: 0 } },
    );
    const flash = nuke.events.find((e) => e.type === 'NUKE_FLASH');
    expect(flash?.type === 'NUKE_FLASH' && flash.resolvedCells).not.toContainEqual({ r: 8, c: 1 });
    expect(nuke.state.players[1].board.marks['8,1']).toBeUndefined();
  });

  it('a submarine cannot surface on an island', () => {
    const state = startMatch({
      mode: 'advanced',
      terrain: ISLAND,
      arsenalA: [{ id: 'sub-1', kind: 'submarine' }],
      first: P0,
    });
    const run = reduce(state, { type: 'USE_ARSENAL', playerId: P0, itemId: 'sub-1', at: { r: 1, c: 2 } });
    expect(types(run.events)).toEqual(['REJECTED']);
    expect(run.state.players[0].board.arsenal[0]?.used).toBeUndefined();
  });

  it('radar counts ships, not islands', () => {
    const withIslands = terrainWith({ '8,4': 'island', '9,6': 'island' });
    const state = startMatch({
      mode: 'advanced',
      terrain: withIslands,
      arsenalA: [{ id: 'r-1', kind: 'radar', at: { r: 9, c: 9 } }],
      first: P0,
    });
    const scan = reduce(state, { type: 'USE_ARSENAL', playerId: P0, itemId: 'r-1', at: { r: 8, c: 5 } });
    const result = scan.events.find((e) => e.type === 'RADAR_RESULT');
    // Only destroyer-3's cell at (7,5) is in the 3x3.
    expect(result?.type === 'RADAR_RESULT' && result.count).toBe(1);
  });

  it('fog suppresses only the fogged part of a halo', () => {
    const state = startMatch({ mode: 'advanced', terrain: terrainForSea('fogbank'), first: P0 });
    // Sink destroyer-1 on (0,5)-(1,5). Its halo spans columns 4-6; columns
    // 5-9 are fog, so only the western cells at (0,4),(1,4),(2,4) hatch.
    let next = state;
    for (const at of [
      { r: 0, c: 5 },
      { r: 1, c: 5 },
    ]) {
      next = reduce(next, { type: 'FIRE', playerId: P0, at }).state;
    }
    const reveal = next.players[1].board.marks;
    const hatched = Object.entries(reveal).filter(([, mark]) => mark === 'revealed');
    expect(hatched.map(([key]) => key).sort()).toEqual(['0,4', '1,4', '2,4']);
    // The fogged halo cell at (0,6) was never hatched.
    expect(reveal['0,6']).toBeUndefined();
  });

  it('a decoy beside an island can still be exposed (D38)', () => {
    const withIsland = terrainWith({ '8,0': 'island' });
    const state = startMatch({
      mode: 'advanced',
      terrain: withIsland,
      arsenalB: [{ id: 'decoy-1', kind: 'decoy', at: { r: 8, c: 1 } }],
      first: P0,
    });
    // Hit the decoy first (an un-hit decoy cannot expose), then mark every
    // neighbour except the island, which is public knowledge already. Each
    // miss would hand the turn over, so it is forced back between shots.
    let next = state;
    for (const at of [
      { r: 8, c: 1 },
      { r: 7, c: 0 },
      { r: 7, c: 1 },
      { r: 7, c: 2 },
      { r: 8, c: 2 },
      { r: 9, c: 0 },
      { r: 9, c: 1 },
      { r: 9, c: 2 },
    ]) {
      next = reduce({ ...next, turn: P0 }, { type: 'FIRE', playerId: P0, at }).state;
    }
    expect(next.players[1].board.marks['8,1']).toBe('decoy');
  });

  it('an island is public from the start, so the AI can never aim at one', () => {
    // The AI reads only a PlayerView; terrain is on it. `chooseMove` is
    // covered by the per-sea convergence test in seas-ai.test.ts; here the
    // engine guarantee: a FIRE at an island is refused, so the AI physically
    // cannot land one.
    const state = startMatch({ mode: 'advanced', terrain: ISLAND, first: P0 });
    const fired = reduce(state, { type: 'FIRE', playerId: P0, at: { r: 1, c: 2 } });
    expect(types(fired.events)).toEqual(['REJECTED']);
  });

  it('a terrain match replays exactly', () => {
    const script = [
      { type: 'FIRE' as const, playerId: P0, at: { r: 0, c: 0 } },
      { type: 'FIRE' as const, playerId: P0, at: { r: 1, c: 0 } },
      { type: 'FIRE' as const, playerId: P1, at: { r: 0, c: 4 } },
      { type: 'USE_ARSENAL' as const, playerId: P0, itemId: 'tb-1', row: 2 },
    ];
    const run = () => {
      let state = startMatch({
        mode: 'advanced',
        terrain: terrainForSea('fogbank'),
        arsenalA: [{ id: 'tb-1', kind: 'torpedoBomber' }],
        seed: 5,
      });
      const events: { type: string }[] = [];
      for (const action of script) {
        const result = reduce(state, action);
        events.push(...result.events);
        state = result.state;
      }
      return events;
    };
    expect(run()).toEqual(run());
  });
});

describe('raids on terrain', () => {
  it('the harbour sea rides the raid config and the view', () => {
    const coral = terrainForSea('coral');
    const layout = {
      ships: autoPlaceFleet(createRng(1), coral),
      arsenal: [],
      sea: 'coral' as const,
    };
    const state = startRaid(layout, {}, 0, {
      shells: 30,
      minePenalty: 2,
      timeLimitMs: 240_000,
      terrain: coral,
    });
    expect(raidView(state, 0).terrain).toBe(coral);

    // An island — wait, Coral has no islands; use a reef cell for legality and
    // prove the island refusal on a custom config.
    const islandState = startRaid(
      { ships: autoPlaceFleet(createRng(2)), arsenal: [] },
      {},
      0,
      {
        shells: 30,
        minePenalty: 2,
        timeLimitMs: 240_000,
        terrain: ISLAND,
      },
    );
    const refused = fireShell(islandState, { r: 1, c: 2 }, 0);
    expect(refused.error).toBe('illegal-cell');
    expect(refused.state.shells).toBe(30);
  });

  it('a raid on terrain replays exactly', () => {
    const strait = terrainForSea('strait');
    const layout = {
      ships: autoPlaceFleet(createRng(4), strait),
      arsenal: [],
      sea: 'strait' as const,
    };
    const config = {
      shells: 30,
      minePenalty: 2,
      timeLimitMs: 240_000,
      terrain: strait,
    };
    const actions = [
      { kind: 'fire' as const, at: { r: 9, c: 9 } },
      { kind: 'fire' as const, at: { r: 9, c: 8 } },
      { kind: 'use' as const, weapon: 'torpedoBomber' as const, row: 4 },
    ];
    const first = replayRaid(layout, { torpedoBomber: 1 }, actions, config);
    const second = replayRaid(layout, { torpedoBomber: 1 }, actions, config);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('the season sea and the Lighthouse ladder', () => {
  it('Open Sea is at least every other season, structurally', () => {
    expect(SEASON_SEA_CYCLE.length % 2).toBe(0);
    for (let season = 0; season < 200; season++) {
      const here = seasonSeaFor(season);
      const next = seasonSeaFor(season + 1);
      expect(here === 'open' || next === 'open', `seasons ${season}/${season + 1}`).toBe(true);
    }
  });

  it('rotates through every sea and is deterministic', () => {
    const seen = new Set<SeaId>();
    for (let season = 1; season <= 8; season++) seen.add(seasonSeaFor(season));
    expect([...seen].sort()).toEqual(['archipelago', 'coral', 'fogbank', 'open', 'strait'].sort());
    expect(seasonSeaFor(11)).toBe(seasonSeaFor(11 + SEASON_SEA_CYCLE.length));
    expect(seasonSeaFor(0)).toBe(seasonSeaFor(-SEASON_SEA_CYCLE.length));
  });

  it('the date-based season number is monotone and 28 days long', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(seasonNumberAt(28 * day - 1)).toBe(seasonNumberAt(27 * day));
    expect(seasonNumberAt(28 * day)).toBe(seasonNumberAt(28 * day - 1) + 1);
    expect(currentSeasonSeaAt(0)).toBe(seasonSeaFor(seasonNumberAt(0)));
  });

  it('the Lighthouse unlocks one sea per level, Open always', () => {
    expect(unlockedSeasFor(0)).toEqual(['open']);
    expect(unlockedSeasFor(1)).toEqual(['open', 'archipelago']);
    expect(unlockedSeasFor(2)).toEqual(['open', 'archipelago', 'coral']);
    expect(unlockedSeasFor(3)).toEqual(['open', 'archipelago', 'coral', 'fogbank']);
    expect(unlockedSeasFor(4)).toEqual(['open', 'archipelago', 'coral', 'fogbank', 'strait']);
    // Beyond max, clamped rather than undefined.
    expect(unlockedSeasFor(9)).toEqual(unlockedSeasFor(4));
  });

  it('the terrain grid is pure data: no ship or item information can hide in it', () => {
    // A sea is built only from the three public cell kinds; the type system
    // says so, and this pins the runtime shape for anything that serialises.
    for (const sea of SEAS) {
      const json = JSON.stringify(sea.terrain);
      expect(json).not.toContain('ship');
      expect(json).not.toContain('hit');
      for (const row of sea.terrain) {
        for (const cell of row) {
          expect(['water', 'island', 'reef', 'fog']).toContain(cell);
        }
      }
    }
  });
});
