/**
 * Placement-session state. The UI may preview freely, but every committed
 * board change is delegated to the pure placement engine in src/engine.
 */
import { specFor } from '../engine/arsenal';
import { cellsOf, emptyBoard, halo, inBounds, sameCoord } from '../engine/board';
import { captainFuel } from '../engine/captains';
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
  validateArsenalPlacement,
  validateLayout,
  validatePlacement,
} from '../engine/placement';
import { createRng } from '../engine/rng';
import { WATER, terrainForSea, type SeaId, type Terrain } from '../engine/terrain';
import type { Difficulty } from '../engine/ai';
import {
  FUEL_BUDGET,
  type ArsenalItem,
  type ArsenalKind,
  type Board,
  type CaptainId,
  type Coord,
  type MatchMode,
  type Orientation,
  type Ship,
} from '../engine/types';
import { create } from 'zustand';

/**
 * Where this layout is going.
 *
 * `'harbour'` is Part 7's defence editor. It is a MODE, not a second screen:
 * the editor is app/(game)/placement.tsx with a different budget, a filtered
 * shop and different button copy. Everything else — drag, rotate, shuffle,
 * reset, the halo rules, the unsaved guard — is the same code, so a fix to
 * placement fixes both.
 */
export type PlacementMode = 'ai' | 'hotseat' | 'online' | 'harbour';

/** Part 7 §2 — what makes the placement screen a defence editor. */
export interface PlacementSetup {
  readonly fuelBudget?: number;
  readonly allowedKinds?: readonly ArsenalKind[];
  readonly kindCaps?: Readonly<Partial<Record<ArsenalKind, number>>>;
  readonly fuelLabel?: string;
  /** Part 10B — the seas the Lighthouse has unlocked (Open always included). */
  readonly unlockedSeas?: readonly SeaId[];
  /** Part 10B — the sea to start on; must be unlocked, defaults to open. */
  readonly seaId?: SeaId;
}

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
  /**
   * Part 7 §2.2 — the harbour shop offers own-board items only. `null` means
   * "every kind the ruleset allows", which is what a match does.
   */
  readonly allowedKinds: readonly ArsenalKind[] | null;
  /**
   * Part 7 §2.2 — Coastal Command's per-kind caps, which are NOT
   * `specFor(kind).max`: a harbour at Coastal Command 6 holds 8 mines where a
   * match allows 5. `null` means the match caps apply.
   */
  readonly kindCaps: Readonly<Partial<Record<ArsenalKind, number>>> | null;
  /** Part 7 §2.1 — "Harbour fuel 74 / 90" instead of the match's "Fuel". */
  readonly fuelLabel: string;
  readonly difficulty: Difficulty;
  readonly ruleset: MatchMode;
  /** Part 10A — the captain this layout is taking. Null means none. */
  readonly captainId: CaptainId | null;
  /** Part 10B — the sea this layout is being arranged for. */
  readonly seaId: SeaId;
  readonly unlockedSeas: readonly SeaId[];
  readonly playerOneName: string;
  readonly playerTwoName: string;
  readonly validationReason: string | null;
  readonly pendingArsenalId: string | null;
  readonly hotseatPlayer: 1 | 2;
  readonly playerOneShips: readonly Ship[] | null;
  readonly playerTwoShips: readonly Ship[] | null;
  readonly playerOneArsenal: readonly ArsenalItem[] | null;
  readonly playerTwoArsenal: readonly ArsenalItem[] | null;
  /** Hot-seat: each player's own captain, saved at the handoff. */
  readonly playerOneCaptain: CaptainId | null;
  readonly playerTwoCaptain: CaptainId | null;
  readonly handoffVisible: boolean;
}

interface PlacementActions {
  initialize: (
    mode: PlacementMode,
    seed: number,
    ruleset?: MatchMode,
    options?: PlacementSetup,
  ) => void;
  /** Part 7 — loads a saved harbour into the editor instead of autoplacing. */
  loadLayout: (ships: readonly Ship[], arsenal: readonly ArsenalItem[], seaId?: SeaId) => void;
  setDifficulty: (difficulty: Difficulty) => void;
  /** Part 10A — picks this layout's captain. Refused in Classic or over budget. */
  setCaptain: (captainId: CaptainId | null) => PlacementMutation;
  /** Part 10B — picks this layout's sea. Refused when the Lighthouse has not unlocked it. */
  setSea: (seaId: SeaId) => PlacementMutation;
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
  allowedKinds: null,
  kindCaps: null,
  fuelLabel: 'Fuel',
  mode: 'ai',
  difficulty: 'normal',
  ruleset: 'advanced',
  captainId: null,
  seaId: 'open',
  unlockedSeas: ['open'],
  playerOneName: 'Player 1',
  playerTwoName: 'Player 2',
  validationReason: null,
  pendingArsenalId: null,
  hotseatPlayer: 1,
  playerOneShips: null,
  playerTwoShips: null,
  playerOneArsenal: null,
  playerTwoArsenal: null,
  playerOneCaptain: null,
  playerTwoCaptain: null,
  handoffVisible: false,

  initialize: (mode, seed, ruleset = 'advanced', options) => {
    const unlockedSeas = options?.unlockedSeas ?? ['open'];
    const seaId =
      options?.seaId && unlockedSeas.includes(options.seaId) ? options.seaId : 'open';
    return set({
      ships: autoPlaceFleet(createRng(seed), terrainForSea(seaId)),
      arsenal: [],
      fuelSpent: 0,
      mode,
      fuelBudget: options?.fuelBudget ?? FUEL_BUDGET,
      allowedKinds: options?.allowedKinds ?? null,
      kindCaps: options?.kindCaps ?? null,
      fuelLabel: options?.fuelLabel ?? 'Fuel',
      difficulty: 'normal',
      ruleset,
      captainId: null,
      seaId,
      unlockedSeas,
      validationReason: null,
      pendingArsenalId: null,
      hotseatPlayer: 1,
      playerOneShips: null,
      playerTwoShips: null,
      playerOneArsenal: null,
      playerTwoArsenal: null,
      playerOneCaptain: null,
      playerTwoCaptain: null,
      handoffVisible: false,
    });
  },

  /**
   * Part 7 — opens the editor on the harbour the server already has, instead
   * of the random layout `initialize` makes. Kept separate from `initialize`
   * so the budget/caps setup and the contents are independent: a failed
   * harbour fetch still leaves a legal, editable board.
   *
   * Part 10B — the sea comes with the saved layout, which the server already
   * validated on that sea, so it is adopted without re-validating against the
   * placeholder board.
   */
  loadLayout: (ships, arsenal, seaId) =>
    set({
      ships: [...ships],
      arsenal: [...arsenal],
      fuelSpent: arsenalFuelSpent(arsenal),
      ...(seaId ? { seaId } : {}),
      validationReason: null,
      pendingArsenalId: null,
    }),

  setDifficulty: (difficulty) => set({ difficulty }),

  /**
   * Part 10A — one captain, priced in fuel out of the same 260. Classic has
   * none, and a captain that does not fit beside the arsenal is refused
   * rather than silently unspent.
   */
  setCaptain: (captainId) => {
    const state = get();
    if (captainId !== null && state.ruleset === 'classic') {
      const reason = 'classic mode has no captains';
      set({ validationReason: reason });
      return { ok: false, reason };
    }
    if (captainId !== null && arsenalFuelSpent(state.arsenal) + captainFuel(captainId) > state.fuelBudget) {
      const reason = 'not enough fuel for this captain';
      set({ validationReason: reason });
      return { ok: false, reason };
    }
    set({ captainId, validationReason: null });
    return { ok: true };
  },

  /**
   * Part 10B — the sea is a layout choice, so changing it re-checks the
   * layout: a fleet legal on Open Sea may not fit a reef. The Lighthouse
   * gates the list; ranked never consults it (the server picks the season sea
   * and the client reads it from /config before placement).
   */
  setSea: (seaId) => {
    const state = get();
    if (!state.unlockedSeas.includes(seaId)) {
      const reason = `${seaId} needs a higher Lighthouse`;
      set({ validationReason: reason });
      return { ok: false, reason };
    }
    if (seaId === state.seaId) return { ok: true };
    const terrain = terrainForSea(seaId);
    const check = validateLayout(state.ships, terrain);
    if (!check.ok) {
      const reason = check.reason;
      set({ validationReason: reason });
      return { ok: false, reason };
    }
    // Items too: an island may not be under a gun, mine, net or decoy.
    const board = boardOf(state);
    for (const item of board.arsenal) {
      const itemCheck = validateArsenalPlacement(board, item, terrain);
      if (!itemCheck.ok) {
        set({ validationReason: `${item.id}: ${itemCheck.reason}` });
        return { ok: false, reason: itemCheck.reason };
      }
    }
    set({ seaId, validationReason: null });
    return { ok: true };
  },

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
      captainId: ruleset === 'classic' ? null : state.captainId,
      pendingArsenalId: null,
      validationReason: null,
    });
  },

  autoPlace: (seed) =>
    set({
      ships: autoPlaceFleet(createRng(seed), terrainForSea(get().seaId)),
      validationReason: null,
    }),

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
    const result = placeShip(boardOf(state), candidate, terrainForSea(state.seaId));
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
    const result = rotateShip(boardOf(state), shipId, terrainForSea(state.seaId));
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
    // A second tap while one item is still waiting for its cell used to buy
    // another and overwrite pendingArsenalId, stranding the first: fuel spent
    // on an item with no square, invisible on the board and unplaceable.
    if (state.pendingArsenalId) {
      const reason = 'place the current item first';
      set({ validationReason: reason });
      return { ok: false, reason };
    }
    // Part 7 §2.2 — the harbour's shop and caps. ONE guard in front of the
    // existing purchase, not a second purchase path: everything below this
    // line is the same code the match uses.
    if (state.allowedKinds && !state.allowedKinds.includes(kind)) {
      const reason = 'that one is not stocked here';
      set({ validationReason: reason });
      return { ok: false, reason };
    }
    if (state.kindCaps) {
      const cap = state.kindCaps[kind] ?? 0;
      const held = state.arsenal.filter((item) => item.kind === kind).length;
      if (held >= cap) {
        const reason =
          cap === 0 ? 'none of those are supplied here' : `only ${cap} of those are supplied`;
        set({ validationReason: reason });
        return { ok: false, reason };
      }
    }

    // Part 10A — the captain is fuel too, so the arsenal shop must budget
    // around it. The reducer re-checks the whole submission anyway; this is
    // what keeps the UI from offering a purchase it will have to undo.
    const budget = state.fuelBudget - captainFuel(state.captainId);
    const result = purchaseArsenalItem(boardOf(state), kind, budget);
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
    const result = placeArsenalItem(
      boardOf(state),
      state.pendingArsenalId,
      at,
      terrainForSea(state.seaId),
    );
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
    const result = placeArsenalItem(boardOf(state), itemId, at, terrainForSea(state.seaId));
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
    const check = validateLayout(state.ships, terrainForSea(state.seaId));
    if (!check.ok || state.ships.length !== FLEET_SHIP_COUNT) {
      const reason = check.ok ? 'place every ship before battle' : check.reason;
      set({ validationReason: reason });
      return { ok: false, reason };
    }
    set({
      playerOneShips: [...state.ships],
      playerOneArsenal: [...state.arsenal],
      playerOneCaptain: state.captainId,
      ships: autoPlaceFleet(createRng(seed), terrainForSea(state.seaId)),
      arsenal: [],
      fuelSpent: 0,
      captainId: null,
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
    const check = validateLayout(state.ships, terrainForSea(state.seaId));
    if (!check.ok || state.ships.length !== FLEET_SHIP_COUNT) {
      const reason = check.ok ? 'place every ship before battle' : check.reason;
      set({ validationReason: reason });
      return { ok: false, reason };
    }
    set({
      playerTwoShips: [...state.ships],
      playerTwoArsenal: [...state.arsenal],
      playerTwoCaptain: state.captainId,
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
  terrain: Terrain = WATER,
): readonly PlacementPreviewCell[] {
  const source = fleetShip(shipId, ships);
  if (!source) return [];
  const board: Board = { ...emptyBoard(), ships, arsenal };

  return Array.from({ length: 100 }, (_, index): PlacementPreviewCell => {
    const origin = { r: Math.floor(index / 10), c: index % 10 };
    const candidate: Ship = { ...source, origin, orientation, hits: [] };
    const result = validatePlacement(board, candidate, terrain);
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
