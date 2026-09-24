/**
 * Fleets — the SOCIAL unit — docs/port-city/part-08-fleets.md.
 *
 * ⚠ NAMING. `src/engine/fleet.ts` (SINGULAR) is a different thing entirely:
 * it is the eight ships a player places on a board (`FLEET_SPEC`,
 * `FLEET_SHIP_COUNT = 8`, `FLEET_CELL_COUNT = 18`). THIS module (PLURAL) is
 * the 30-captain social unit with an Admiral, donations and wars.
 *
 * The design doc, the SQL tables (`fleet_member`, `fleet_request`) and the
 * endpoints (`/fleet/*`) all say "fleet" for the social unit, so renaming it
 * in code alone would mean translating at every boundary forever. The two
 * modules share no export name, so a wrong import is a type error rather than
 * a silent wrong answer — and a test pins that this module exports nothing
 * about ships.
 *
 * PURITY: like every other `src/engine` module, no React, no I/O, no
 * `Date.now()`, no `Math.random()`. Time is a parameter.
 */

// ---------------------------------------------------------------------------
// The fleet itself (§1)
// ---------------------------------------------------------------------------

/** §1 — "Roles: Admiral (one), Commodore, Officer, Sailor." */
export const FLEET_ROLES = ['admiral', 'commodore', 'officer', 'sailor'] as const;
export type FleetRole = (typeof FLEET_ROLES)[number];

export type FleetPolicy = 'open' | 'request' | 'closed';

/** §1 — "Up to 30 captains." */
export const FLEET_MAX_MEMBERS = 30;

/** §1 — "Built at the Fleet Hall (Admiralty 4). Creating one costs 500 coins." */
export const FLEET_MIN_ADMIRALTY = 4;
export const FLEET_CREATE_COST_COINS = 500;

/** §1 — "Name (3–16 chars), description (up to 120)". */
export const FLEET_NAME_MIN = 3;
export const FLEET_NAME_MAX = 16;
export const FLEET_DESCRIPTION_MAX = 120;

/** §1 — "emblem (12 ink badges × 10 tints)". */
export const FLEET_EMBLEM_BADGES = 12;
export const FLEET_EMBLEM_TINTS = 10;

export interface FleetMember {
  readonly userId: string;
  readonly role: FleetRole;
  readonly joinedAt: number;
  /** §3 — "a visible counter ... a reputation, not a currency". */
  readonly merit: number;
  /** For succession: an inactive Admiral's flag still passes to someone real. */
  readonly lastSeenAt?: number;
}

export interface Fleet {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly emblemBadge: number;
  readonly emblemTint: number;
  readonly policy: FleetPolicy;
  readonly minRenown: number;
  readonly createdAt: number;
  readonly archived: boolean;
}

// ---------------------------------------------------------------------------
// Donations (§3)
// ---------------------------------------------------------------------------

export type DonationState = 'open' | 'filled' | 'consumed' | 'expired';

export interface DonationRequest {
  readonly id: string;
  readonly fleetId: string;
  readonly requesterId: string;
  /** One offensive item kind. */
  readonly item: string;
  readonly at: number;
  readonly donorId: string | null;
  readonly filledAt: number | null;
  readonly consumedAt: number | null;
}

/**
 * A filled donation sitting in the requester's reinforcement slot.
 *
 * It is NOT an `ArsenalItem` and must never become one outside a raid or a
 * war — see `usableReinforcements()` in ./donations.ts, and the ranked
 * integrity rule in §3.
 */
export interface Reinforcement {
  readonly id: string;
  readonly item: string;
  readonly fuel: number;
  readonly donorId: string;
  readonly filledAt: number;
}

/**
 * Where a layout is being built. The whole ranked-integrity rule is one
 * `switch` over this, in one function, with one test per arm.
 */
export type LayoutContext = 'ranked' | 'raid' | 'war' | 'friendly';

// ---------------------------------------------------------------------------
// Wars (§4)
// ---------------------------------------------------------------------------

/**
 * §6 — "Use a state machine with a `settled_at` marker rather than a timer in
 * memory." These are the states; `settled_at` is the marker, and it lives on
 * the row, not here.
 */
export const WAR_STATES = ['searching', 'prep', 'battle', 'settling', 'ended', 'cancelled'] as const;
export type WarState = (typeof WAR_STATES)[number];

/** §4 — "War sizes: 5v5, 10v10, 15v15". */
export const WAR_SIZES = [5, 10, 15] as const;
export type WarSize = (typeof WAR_SIZES)[number];

export interface War {
  readonly id: string;
  readonly fleetA: string;
  readonly fleetB: string | null;
  readonly size: WarSize;
  readonly state: WarState;
  readonly searchStartedAt: number;
  readonly prepEndsAt: number | null;
  readonly battleEndsAt: number | null;
  readonly settledAt: number | null;
  readonly starsA: number;
  readonly starsB: number;
}

export interface WarMember {
  readonly warId: string;
  readonly userId: string;
  readonly fleetId: string;
  readonly renown: number;
  /** §4 — "2 raids" each. */
  readonly raidsUsed: number;
}

/** One raid against one enemy war harbour. */
export interface WarRaid {
  readonly warId: string;
  readonly raidId: string;
  readonly attackerId: string;
  readonly targetUserId: string;
  readonly stars: number;
  readonly destruction: number;
  /** For the second tiebreak: "then on the earlier finish". */
  readonly finishedAt: number;
}

// ---------------------------------------------------------------------------
// Chat (§2)
// ---------------------------------------------------------------------------

export type ChatKind = 'phrase' | 'sticker';

export interface ChatMessage {
  readonly fleetId: string;
  readonly userId: string;
  readonly kind: ChatKind;
  /** A phrase id or a sticker id. NEVER free text — see ./chat.ts. */
  readonly code: string;
  readonly at: number;
}
