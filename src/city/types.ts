/**
 * The city wire types — the shape server/src/city/service.ts sends.
 *
 * Kept in one file on purpose: everything the client knows about Part 1's API
 * is here, so if the server's contract moves, the blast radius is one import.
 */
import type { BuildingId, CityError, CityState } from '@engine/city';

export interface CityWallet {
  readonly coins: number;
  readonly steel: number;
  readonly gems: number;
}

export interface CitySnapshot {
  readonly city: CityState;
  readonly wallet: CityWallet;
  readonly freeWorkers: number;
  readonly collectable: { readonly total: number; readonly ids: readonly BuildingId[] };
  /** Plot features the server has switched on, minus the `portCity.` prefix. */
  readonly features: readonly string[];
  /**
   * part-05 §5 — the Academy items this player has RESEARCHED. Parts 6, 7 and
   * 8 all gate on it (a harbour's nets and decoys, a kit's minesweeper), and
   * it replaced DECISIONS D23's "is the Academy built at all" stand-in.
   */
  readonly unlocks: readonly string[];
}

export interface CityResponse {
  readonly city: CitySnapshot;
  /** The server's clock. The client renders every timer from this, never Date.now(). */
  readonly serverNow: number;
}

/** Transport-level codes the API can add to the engine's typed errors. */
export type CityApiErrorCode =
  | CityError
  | 'rate-limited'
  | 'version-conflict'
  | 'no-profile'
  | 'internal'
  | 'offline'
  | 'unauthenticated';

export class CityApiError extends Error {
  readonly code: CityApiErrorCode;
  constructor(code: CityApiErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CityApiError';
    this.code = code;
  }
}

export interface FeatureConfig {
  readonly features: Readonly<Record<string, boolean>>;
  /** Part 10B — the season sea, announced before placement. Null when seas off. */
  readonly seasonSea?: { readonly id: string; readonly name: string } | null;
  readonly livingWorld?: {
    readonly seasonWindows: readonly import('@engine/liveWorld').SeasonWindow[];
    readonly weatherSeed: number;
  };
  readonly serverNow: number;
}
