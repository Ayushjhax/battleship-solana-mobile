/**
 * Placement-session state. The UI may preview freely, but every committed
 * board change is delegated to the pure placement engine in src/engine.
 */
import { specFor } from '../engine/arsenal';
import { cellsOf, emptyBoard, halo, inBounds, sameCoord } from '../engine/board';
import { FLEET_SHIP_COUNT, makeFleet } from '../engine/fleet';
import {
  arsenalFuelSpent,
  autoPlaceFleet,
  placeArsenalItem,
  placeShip,
  purchaseArsenalItem,
  removeShip,
  rotateShip,
  sellArsenalItem,
  validateLayout,
  validatePlacement,
} from '../engine/placement';
import { createRng } from '../engine/rng';
import type { Difficulty } from '../engine/ai';
import {
  FUEL_BUDGET,
  type ArsenalItem,
  type ArsenalKind,
  type Board,
  type Coord,
  type MatchMode,
  type Orientation,
  type Ship,
} from '../engine/types';
import { create } from 'zustand';

export type PlacementMode = 'ai' | 'hotseat' | 'online';

export interface PlacementMutation {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface PlacementPreviewCell {
  readonly ok: boolean;
  readonly reason: string | null;
  /** Board-cell indices to tint when the engine rejects this candidate. */
  readonly conflictCells: readonly number[];
}

interface PlacementData {
  readonly ships: readonly Ship[];
  readonly arsenal: readonly ArsenalItem[];
  readonly fuelSpent: number;
  readonly fuelBudget: number;
  readonly mode: PlacementMode;
  readonly difficulty: Difficulty;
  readonly ruleset: MatchMode;
  readonly playerOneName: string;
  readonly playerTwoName: string;
  readonly validationReason: string | null;
  readonly pendingArsenalId: string | null;
  readonly hotseatPlayer: 1 | 2;
  readonly playerOneShips: readonly Ship[] | null;
  readonly playerTwoShips: readonly Ship[] | null;
  readonly playerOneArsenal: readonly ArsenalItem[] | null;
  readonly playerTwoArsenal: readonly ArsenalItem[] | null;
  readonly handoffVisible: boolean;
}

interface PlacementActions {
  initialize: (mode: PlacementMode, seed: number, ruleset?: MatchMode) => void;
  setDifficulty: (difficulty: Difficulty) => void;
  setHotseatNames: (playerOneName: string, playerTwoName: string) => void;
  setRuleset: (ruleset: MatchMode) => void;
  autoPlace: (seed: number) => void;
  clearFleet: () => void;
  placeAt: (shipId: string, origin: Coord, orientation: Orientation) => PlacementMutation;
  remove: (shipId: string) => PlacementMutation;
  rotate: (shipId: string) => PlacementMutation;
  buyArsenal: (kind: ArsenalKind) => PlacementMutation & { itemId?: string };
  placePendingArsenal: (at: Coord) => PlacementMutation;
  moveArsenal: (itemId: string, at: Coord) => PlacementMutation;
  sellArsenal: (itemId: string) => PlacementMutation;
  /**
   * Sells every item that sits on the board (AA guns, mines, radar), and one
   * still waiting to be placed, at full price — what Shuffle and Reset do
   * before they touch the ships, since a new layout cannot respect them.
   * Bought offensive items are untouched. Returns the fuel given back.
   */
  sellPlacedArsenal: () => number;
  cancelPendingArsenal: () => void;
  setValidationReason: (reason: string | null) => void;
  beginSecondPlayer: (seed: number) => PlacementMutation;
  dismissHandoff: () => void;
  finishSecondPlayer: () => PlacementMutation;
}

export type PlacementState = PlacementData & PlacementActions;

function boardOf(state: Pick<PlacementData, 'ships' | 'arsenal'>): Board {
  return { ...emptyBoard(), ships: state.ships, arsenal: state.arsenal };
}

function fleetShip(shipId: string, ships: readonly Ship[]) {
  return ships.find((ship) => ship.id === shipId) ?? makeFleet().find((ship) => ship.id === shipId);
}

export const usePlacement = create<PlacementState>((set, get) => ({
  ships: [],
  arsenal: [],
  fuelSpent: 0,
  fuelBudget: FUEL_BUDGET,
  mode: 'ai',
  difficulty: 'normal',
  ruleset: 'advanced',
  playerOneName: 'Player 1',
  playerTwoName: 'Player 2',
  validationReason: null,
  pendingArsenalId: null,
  hotseatPlayer: 1,
  playerOneShips: null,
  playerTwoShips: null,
  playerOneArsenal: null,
  playerTwoArsenal: null,
  handoffVisible: false,

  initialize: (mode, seed, ruleset = 'advanced') =>
    set({
      ships: autoPlaceFleet(createRng(seed)),
      arsenal: [],
      fuelSpent: 0,
      mode,
      difficulty: 'normal',
      ruleset,
      validationReason: null,
      pendingArsenalId: null,
      hotseatPlayer: 1,
      playerOneShips: null,
      playerTwoShips: null,
      playerOneArsenal: null,
      playerTwoArsenal: null,
      handoffVisible: false,
    }),

  setDifficulty: (difficulty) => set({ difficulty }),

  setHotseatNames: (playerOneName, playerTwoName) =>
    set({
      playerOneName: playerOneName.trim() || 'Player 1',
      playerTwoName: playerTwoName.trim() || 'Player 2',
    }),

  setRuleset: (ruleset) => {
    const state = get();
    if (ruleset === state.ruleset) return;
    let board = boardOf(state);
    if (ruleset === 'classic') {
      for (const item of [...board.arsenal]) {
        const result = sellArsenalItem(board, item.id);
        if (result.ok) board = result.board;
      }
    }
    set({
      ruleset,
      arsenal: board.arsenal,
      fuelSpent: arsenalFuelSpent(board.arsenal),
      pendingArsenalId: null,
      validationReason: null,
    });
  },

  autoPlace: (seed) => set({ ships: autoPlaceFleet(createRng(seed)), validationReason: null }),

  clearFleet: () => {
    let board = boardOf(get());
    for (const ship of [...board.ships]) {
      const result = removeShip(board, ship.id);
      if (result.ok) board = result.board;
    }
    set({ ships: board.ships, validationReason: null });
  },

  placeAt: (shipId, origin, orientation) => {
    const state = get();
    const source = fleetShip(shipId, state.ships);
    if (!source) return { ok: false, reason: `no ship ${shipId} in the fleet` };
    const candidate: Ship = { ...source, origin, orientation, hits: [] };
    const result = placeShip(boardOf(state), candidate);
    if (!result.ok) {
      set({ validationReason: result.reason });
      return { ok: false, reason: result.reason };
    }
    set({ ships: result.board.ships, validationReason: null });
    return { ok: true };
  },

  remove: (shipId) => {
    const state = get();
    const result = removeShip(boardOf(state), shipId);
    if (!result.ok) {
      set({ validationReason: result.reason });
      return { ok: false, reason: result.reason };
    }
    set({ ships: result.board.ships, validationReason: null });
    return { ok: true };
  },

  rotate: (shipId) => {
    const state = get();
    const result = rotateShip(boardOf(state), shipId);
    if (!result.ok) {
      set({ validationReason: result.reason });
      return { ok: false, reason: result.reason };
    }
    set({ ships: result.board.ships, validationReason: null });
    return { ok: true };
  },

  buyArsenal: (kind) => {
    const state = get();
    if (state.ruleset === 'classic') {
      return { ok: false, reason: 'classic mode has no arsenal' };
    }
    const result = purchaseArsenalItem(boardOf(state), kind, state.fuelBudget);
    if (!result.ok) {
      set({ validationReason: result.reason });
      return { ok: false, reason: result.reason };
    }
    const pendingArsenalId =
      result.item?.at === undefined && (kind === 'aaGun' || kind === 'mine' || kind === 'radar')
        ? (result.item?.id ?? null)
        : null;
    set({
      arsenal: result.board.arsenal,
      fuelSpent: result.fuelSpent,
      pendingArsenalId,
      validationReason: null,
    });
    return { ok: true, itemId: result.item?.id };
  },

  placePendingArsenal: (at) => {
    const state = get();
    if (!state.pendingArsenalId) return { ok: false, reason: 'no item is waiting to be placed' };
    const result = placeArsenalItem(boardOf(state), state.pendingArsenalId, at);
    if (!result.ok) {
      set({ validationReason: result.reason });
      return { ok: false, reason: result.reason };
    }
    set({
      arsenal: result.board.arsenal,
      fuelSpent: result.fuelSpent,
      pendingArsenalId: null,
      validationReason: null,
    });
    return { ok: true };
  },

  moveArsenal: (itemId, at) => {
    const state = get();
    const result = placeArsenalItem(boardOf(state), itemId, at);
    if (!result.ok) {
      set({ validationReason: result.reason });
      return { ok: false, reason: result.reason };
    }
    set({ arsenal: result.board.arsenal, fuelSpent: result.fuelSpent, validationReason: null });
    return { ok: true };
  },

  sellArsenal: (itemId) => {
    const state = get();
    const result = sellArsenalItem(boardOf(state), itemId);
    if (!result.ok) {
      set({ validationReason: result.reason });
      return { ok: false, reason: result.reason };
    }
    set({
      arsenal: result.board.arsenal,
      fuelSpent: result.fuelSpent,
      pendingArsenalId: state.pendingArsenalId === itemId ? null : state.pendingArsenalId,
      validationReason: null,
    });
    return { ok: true };
  },

  sellPlacedArsenal: () => {
    const state = get();
    let board = boardOf(state);
    let refunded = 0;
    for (const item of [...board.arsenal]) {
      if (item.at === undefined && item.id !== state.pendingArsenalId) continue;
      const result = sellArsenalItem(board, item.id);
      if (!result.ok) continue;
      board = result.board;
      refunded += specFor(item.kind).cost;
    }
    if (refunded === 0) return 0;
    set({
      arsenal: board.arsenal,
      fuelSpent: arsenalFuelSpent(board.arsenal),
      pendingArsenalId: null,
      validationReason: null,
    });
    return refunded;
  },

  cancelPendingArsenal: () => {
    const state = get();
    if (!state.pendingArsenalId) return;
    const result = sellArsenalItem(boardOf(state), state.pendingArsenalId);
    if (!result.ok) return;
    set({
      arsenal: result.board.arsenal,
      fuelSpent: result.fuelSpent,
      pendingArsenalId: null,
      validationReason: null,
    });
  },

  setValidationReason: (validationReason) => set({ validationReason }),

  beginSecondPlayer: (seed) => {
    const state = get();
    const check = validateLayout(state.ships);
    if (!check.ok || state.ships.length !== FLEET_SHIP_COUNT) {
      const reason = check.ok ? 'place every ship before battle' : check.reason;
      set({ validationReason: reason });
      return { ok: false, reason };
    }
    set({
      playerOneShips: [...state.ships],
      playerOneArsenal: [...state.arsenal],
      ships: autoPlaceFleet(createRng(seed)),
      arsenal: [],
      fuelSpent: 0,
      pendingArsenalId: null,
      hotseatPlayer: 2,
      handoffVisible: true,
      validationReason: null,
    });
    return { ok: true };
  },

  dismissHandoff: () => set({ handoffVisible: false }),

  finishSecondPlayer: () => {
    const state = get();
    const check = validateLayout(state.ships);
    if (!check.ok || state.ships.length !== FLEET_SHIP_COUNT) {
      const reason = check.ok ? 'place every ship before battle' : check.reason;
      set({ validationReason: reason });
      return { ok: false, reason };
    }
    set({
      playerTwoShips: [...state.ships],
      playerTwoArsenal: [...state.arsenal],
      validationReason: null,
    });
    return { ok: true };
  },
}));

/**
 * Builds the 10x10 lookup read by the gesture worklet. Engine validation runs
 * once here, never in the pan callback. The conflict list is explanatory art:
 * placement validity itself always comes from validatePlacement().
 */
export function buildPlacementPreview(
  ships: readonly Ship[],
  arsenal: readonly ArsenalItem[],
  shipId: string,
  orientation: Orientation,
): readonly PlacementPreviewCell[] {
  const source = fleetShip(shipId, ships);
  if (!source) return [];
  const board: Board = { ...emptyBoard(), ships, arsenal };

  return Array.from({ length: 100 }, (_, index): PlacementPreviewCell => {
    const origin = { r: Math.floor(index / 10), c: index % 10 };
    const candidate: Ship = { ...source, origin, orientation, hits: [] };
    const result = validatePlacement(board, candidate);
    if (result.ok) return { ok: true, reason: null, conflictCells: [] };

    const footprint = cellsOf(candidate).filter(inBounds);
    const others = ships.filter((ship) => ship.id !== shipId);
    const conflicts = footprint.filter((cell) => {
      if (result.reason === 'overlaps another ship') {
        return others.some((other) => cellsOf(other).some((occupied) => sameCoord(occupied, cell)));
      }
      if (result.reason === 'ships may not touch') {
        return others.some((other) => halo(other).some((forbidden) => sameCoord(forbidden, cell)));
      }
      return true;
    });

    return {
      ok: false,
      reason: result.reason,
      conflictCells: conflicts.map((cell) => cell.r * 10 + cell.c),
    };
  });
}
