/**
 * The vocabulary of a match. Everything in src/engine depends on this file.
 *
 * PURITY: no imports from react, react-native, expo-*, or any other src/
 * directory — ever. The Node match server imports this source directly.
 * See CLAUDE.md > Engine purity.
 *
 * Rules reference: docs/brief.md section 3.
 */

/** Grid is 10 x 10. Rows A-J top to bottom, columns 1-10 left to right. */
export const GRID_SIZE = 10;

/** docs/brief.md 3.3 — turn timer. */
export const TURN_SECONDS = 20;

/** docs/brief.md 3.3 — two consecutive timeouts forfeit the match. */
export const MAX_CONSECUTIVE_TIMEOUTS = 2;

/** docs/brief.md 3.4 — advanced-mode arsenal budget. */
export const FUEL_BUDGET = 260;

/** Internal coordinates are always numeric. Letters are display only. */
export interface Coord {
  readonly r: number; // 0..9
  readonly c: number; // 0..9
}

export type Orientation = 'h' | 'v';

export type MatchMode = 'classic' | 'advanced';

export type ShipClass = 'battleship' | 'cruiser' | 'destroyer' | 'boat';

export interface Ship {
  readonly id: string;
  readonly class: ShipClass;
  readonly len: number;
  /** The first cell; the ship extends right (h) or down (v) from here. */
  readonly origin: Coord;
  readonly orientation: Orientation;
  /** Cells of this ship that have been hit. */
  readonly hits: readonly Coord[];
}

/** docs/brief.md 3.4 — the eight arsenal kinds. */
export type ArsenalKind =
  | 'torpedoBomber'
  | 'doubleTorpedoBomber'
  | 'bomber'
  | 'atomicBomber'
  | 'aaGun'
  | 'radar'
  | 'mine'
  | 'submarine';

/** Offensive items are spent on the enemy board; own-board items occupy a cell. */
export type ArsenalPlacement = 'offensive' | 'own board';

export interface ArsenalItem {
  readonly id: string;
  readonly kind: ArsenalKind;
  /** Only for own-board kinds (aaGun, mine, radar). Offensive items have none. */
  readonly at?: Coord;
  /** Spent: an offensive item fired, a radar scanned, a mine detonated. */
  readonly used?: boolean;
  /** An own-board item hit by normal fire. */
  readonly destroyed?: boolean;
  /** The attacker has learned this own-board item's cell (AA gun that downed a plane). */
  readonly revealed?: boolean;
}

export type CellState = 'unknown' | 'miss' | 'hit' | 'sunk' | 'revealed' | 'mine';

/** Keyed by coordKey(); a missing key means 'unknown'. */
export type Marks = Readonly<Record<string, CellState>>;

/**
 * One player's board. `marks` is what the OPPONENT has learned about it — every
 * mark on a board was made by the other side's shots. That is why an enemy
 * board's marks can be shown to a player in full, and nothing else can.
 */
export interface Board {
  readonly ships: readonly Ship[];
  readonly arsenal: readonly ArsenalItem[];
  readonly marks: Marks;
}

export interface PlayerState {
  readonly id: string;
  readonly board: Board;
  readonly fuelSpent: number;
  readonly consecutiveTimeouts: number;
  /** Layout submitted and accepted. */
  readonly ready: boolean;
}

export type MatchPhase = 'placing' | 'playing' | 'over';

/**
 * The authoritative state. It holds BOTH boards in full, so it never leaves the
 * process that owns the match — clients only ever get projectView() output.
 * The engine never reads a clock: turn timing is the server's job (TIMEOUT).
 */
export interface MatchState {
  readonly id: string;
  readonly mode: MatchMode;
  readonly seed: number;
  readonly phase: MatchPhase;
  readonly players: readonly [PlayerState, PlayerState];
  /** Player id whose turn it is. First turn is a coin flip from the seed. */
  readonly turn: string;
  readonly winner: string | null;
  /** Actions accepted while playing (FIRE / USE_ARSENAL), for stats and tests. */
  readonly moves: number;
}

/** Actions are requests. The server validates every one of them via reduce(). */
export type MatchAction =
  | {
      type: 'SUBMIT_LAYOUT';
      playerId: string;
      ships: readonly Ship[];
      arsenal: readonly ArsenalItem[];
    }
  | { type: 'FIRE'; playerId: string; at: Coord }
  | { type: 'USE_ARSENAL'; playerId: string; itemId: string; at?: Coord; row?: number }
  | { type: 'TIMEOUT'; playerId: string }
  | { type: 'RESIGN'; playerId: string };

export type GameOverReason = 'fleet' | 'forfeit' | 'resign';

/**
 * Events are the animation script the UI replays, in order. `playerId` is the
 * player who acted; cells refer to the OTHER player's board. Every event is
 * safe to broadcast to both players: it only ever names cells that the rules
 * have just made public.
 */
export type MatchEvent =
  | { type: 'REJECTED'; playerId: string; reason: string }
  | { type: 'LAYOUT_ACCEPTED'; playerId: string }
  | { type: 'MATCH_STARTED'; turn: string }
  | { type: 'HIT'; playerId: string; at: Coord }
  | { type: 'MISS'; playerId: string; at: Coord }
  | {
      type: 'SUNK';
      playerId: string;
      shipId: string;
      shipClass: ShipClass;
      cells: readonly Coord[];
    }
  | { type: 'AUTO_REVEAL'; playerId: string; cells: readonly Coord[] }
  | { type: 'MINE_TRIGGERED'; playerId: string; at: Coord }
  | { type: 'ITEM_HIT'; playerId: string; kind: ArsenalKind; at: Coord }
  | {
      type: 'ARSENAL_USED';
      playerId: string;
      itemId: string;
      kind: ArsenalKind;
      at?: Coord;
      row?: number;
    }
  | {
      type: 'AIRCRAFT_LAUNCHED';
      playerId: string;
      kind: 'torpedoBomber' | 'doubleTorpedoBomber' | 'bomber' | 'atomicBomber';
      rows: readonly number[];
      at?: Coord;
    }
  | {
      type: 'BOMB_DROPPED';
      playerId: string;
      kind: 'bomber' | 'atomicBomber';
      at: Coord;
      index: number;
      total: number;
    }
  | { type: 'AIRCRAFT_DOWNED'; playerId: string; kind: ArsenalKind; gunAt: Coord }
  | { type: 'TORPEDO_TRAVEL'; playerId: string; path: readonly Coord[]; hitAt: Coord | null }
  | { type: 'TORPEDO_RUN'; playerId: string; path: readonly Coord[]; hitAt: Coord | null }
  | { type: 'SUBMARINE_SURFACED'; playerId: string; at: Coord }
  | { type: 'NUKE_FLASH'; playerId: string; at: Coord; cells: readonly Coord[] }
  | { type: 'RADAR_RESULT'; playerId: string; at: Coord; count: number }
  | { type: 'TURN_CHANGED'; turn: string }
  | { type: 'TIMEOUT'; playerId: string; consecutive: number }
  | { type: 'RESIGNED'; playerId: string }
  | { type: 'GAME_OVER'; winner: string; reason: GameOverReason };

/** A sunk enemy ship — every cell is already marked, so it is public. */
export interface SunkShipView {
  readonly id: string;
  readonly class: ShipClass;
  readonly cells: readonly Coord[];
}

/** An enemy own-board item the player has learned about. */
export interface RevealedItemView {
  readonly kind: ArsenalKind;
  readonly at: Coord;
  readonly destroyed: boolean;
}

/**
 * What a single player is allowed to know. projectView() in match.ts builds
 * it: the player's own board in full, and of the enemy ONLY what the rules
 * have made public. There is no `ships` on the enemy side, by design.
 */
export interface PlayerView {
  readonly matchId: string;
  readonly mode: MatchMode;
  readonly phase: MatchPhase;
  readonly turn: string;
  readonly winner: string | null;
  readonly moves: number;
  readonly you: PlayerState;
  readonly enemy: {
    readonly id: string;
    readonly ready: boolean;
    readonly marks: Marks;
    readonly sunkShips: readonly SunkShipView[];
    readonly shipsRemaining: number;
    readonly revealedItems: readonly RevealedItemView[];
  };
}
