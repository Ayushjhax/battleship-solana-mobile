/**
 * The raid client's wire types — part-07 §2, and the hard rule from §9.2:
 * "Nothing in the UI reveals anything the server did not send."
 *
 * THE PARSE BOUNDARY IS THE ENFORCEMENT. Part 6 made the secret structural on
 * the server (`RaidView` has no field that could hold a layout). This file is
 * the same guarantee on the client, one layer further out: `RaidViewSchema`
 * is a **strict** zod object, so a payload carrying `ships`, `arsenal` or
 * `layout` is REJECTED rather than quietly passed along to a component that
 * might one day render it.
 *
 * That matters because the client is the side an attacker actually controls.
 * A patched server, a proxy, a replayed response — none of them can put a
 * ship into the raid screen's props, because the parse fails first.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Every code the raid API can return, plus the three transport ones. */
export const RAID_ERROR_CODES = [
  'offline',
  'unauthenticated',
  'internal',
  'feature-off',
  'no-profile',
  'needs-admiralty',
  'no-harbour',
  'bad-harbour',
  'bad-kit',
  'insufficient-coins',
  'target-locked',
  'raid-in-progress',
  'no-session',
  'not-found',
  'rate-limited',
] as const;

export type RaidApiErrorCode = (typeof RAID_ERROR_CODES)[number];

export function asRaidErrorCode(raw: string): RaidApiErrorCode {
  return (RAID_ERROR_CODES as readonly string[]).includes(raw)
    ? (raw as RaidApiErrorCode)
    : 'internal';
}

export class RaidApiError extends Error {
  readonly code: RaidApiErrorCode;
  readonly detail?: string;

  constructor(code: RaidApiErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'RaidApiError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// The view — the ONLY thing the raid screen renders from
// ---------------------------------------------------------------------------

const Coord = z.object({ r: z.number().int(), c: z.number().int() });

const SunkShip = z.object({
  id: z.string(),
  class: z.string(),
  cells: z.array(Coord),
});

const RevealedItem = z.object({
  kind: z.string(),
  at: Coord,
  destroyed: z.boolean(),
});

/**
 * `.strict()` is load-bearing, not tidiness: it is what makes an extra
 * `ships` key a parse ERROR instead of an ignored field that a future
 * `{...view}` spread would carry into a component's props.
 */
export const RaidViewSchema = z
  .object({
    marks: z.record(z.string(), z.string()),
    sunkShips: z.array(SunkShip),
    revealedItems: z.array(RevealedItem),
    shipsRemaining: z.number().int(),
    /** Part 10B — the harbour's public sea. */
    terrain: z.array(z.array(z.string())).optional(),
    shells: z.number().int(),
    kit: z.record(z.string(), z.number().int()),
    kitLeft: z.number().int(),
    stars: z.number().int().min(0).max(3),
    destruction: z.number().min(0).max(1),
    over: z.boolean(),
    endReason: z.string().optional(),
    msLeft: z.number(),
  })
  .strict();

export type RaidView = z.infer<typeof RaidViewSchema>;

// ---------------------------------------------------------------------------
// The target card (§3 step 2)
// ---------------------------------------------------------------------------

export const TargetCardSchema = z
  .object({
    kind: z.enum(['player', 'cove']),
    userId: z.string().nullable(),
    coveSeed: z.number().int().nullable(),
    name: z.string(),
    avatarId: z.number().int(),
    avatarColor: z.string(),
    countryCode: z.string().nullable(),
    admiraltyLevel: z.number().int(),
    renown: z.number().int(),
    loot: z.object({ coins: z.number().int(), steel: z.number().int() }),
    renownOffer: z.object({ best: z.number().int(), worst: z.number().int() }),
    costCoins: z.number().int(),
  })
  .strict();

export type TargetCard = z.infer<typeof TargetCardSchema>;

export const SearchResponseSchema = z.object({
  card: TargetCardSchema,
  serverNow: z.number(),
});

export type SearchResponse = z.infer<typeof SearchResponseSchema>;

// ---------------------------------------------------------------------------
// Opening, acting, settling
// ---------------------------------------------------------------------------

export const SessionTargetSchema = z.object({
  kind: z.enum(['player', 'cove']),
  defenderId: z.string().nullable(),
  coveSeed: z.number().int().nullable(),
  name: z.string(),
  admiraltyLevel: z.number().int(),
  renown: z.number().int(),
});

export type SessionTarget = z.infer<typeof SessionTargetSchema>;

export const OpenResponseSchema = z.object({
  raidId: z.string(),
  target: SessionTargetSchema,
  view: RaidViewSchema,
  serverNow: z.number(),
});

export type OpenResponse = z.infer<typeof OpenResponseSchema>;

/** Events are validated loosely on purpose — see src/net/protocol.ts's note. */
const LooseEvent = z.object({ type: z.string() }).passthrough();

export const ActionResponseSchema = z.object({
  accepted: z.boolean(),
  rejected: z.string().optional(),
  view: RaidViewSchema,
  events: z.array(LooseEvent),
  shellDelta: z.number().int(),
  over: z.boolean(),
  serverNow: z.number(),
});

export type ActionResponse = z.infer<typeof ActionResponseSchema>;

export const SettlementSchema = z.object({
  raidId: z.string(),
  stars: z.number().int().min(0).max(3),
  destruction: z.number().min(0).max(1),
  endReason: z.string(),
  earned: z.object({
    coins: z.number().int(),
    steel: z.number().int(),
    starBonusSteel: z.number().int(),
  }),
  taken: z.object({ coins: z.number().int(), steel: z.number().int() }),
  renown: z.object({
    before: z.number().int(),
    after: z.number().int(),
    delta: z.number().int(),
  }),
  shieldHours: z.number().int(),
  /**
   * §8 — the full layout, and the ONE place it is legitimate: the raid is
   * over. Deliberately untyped here; only the replay/reveal components read
   * it, and they are reached only after `over`.
   */
  reveal: z.unknown().nullable(),
  view: RaidViewSchema,
  serverNow: z.number(),
});

export type Settlement = z.infer<typeof SettlementSchema>;

// ---------------------------------------------------------------------------
// The harbour (§1, §2)
// ---------------------------------------------------------------------------

/**
 * Your OWN harbour, which you may see in full — you drew it. The schema is
 * loose about the ship/item shape because the engine's types own it; it is
 * handed straight to `GridBoard`, which takes engine types.
 */
export const HarbourResponseSchema = z.object({
  layout: z.object({
    ships: z.array(z.unknown()),
    arsenal: z.array(z.unknown()),
    /** Part 10B — the sea this harbour defends on. */
    sea: z.string().optional(),
  }),
  serverNow: z.number(),
});

export type HarbourResponse = z.infer<typeof HarbourResponseSchema>;

export const SaveHarbourResponseSchema = z.object({
  fuelUsed: z.number().int(),
  serverNow: z.number(),
});

export const StatusResponseSchema = z.object({
  active: z.boolean(),
  raidId: z.string().optional(),
  target: SessionTargetSchema.optional(),
  view: RaidViewSchema.optional(),
  serverNow: z.number(),
});

export type StatusResponse = z.infer<typeof StatusResponseSchema>;

// ---------------------------------------------------------------------------
// The defence log (§4)
// ---------------------------------------------------------------------------

export const DefenceLogEntrySchema = z.object({
  raidId: z.string(),
  attackerId: z.string().nullable(),
  attackerName: z.string(),
  avatarId: z.number().int(),
  avatarColor: z.string(),
  countryCode: z.string().nullable(),
  at: z.string(),
  stars: z.number().int().min(0).max(3),
  destruction: z.number().min(0).max(1),
  takenCoins: z.number().int(),
  takenSteel: z.number().int(),
  renownDelta: z.number().int(),
  /** Set once the player has opened it. Dog-ears until then (§4). */
  read: z.boolean(),
  /** False once revenge has been taken — §8.6, exactly once per raid. */
  revengeAvailable: z.boolean(),
});

export type DefenceLogEntry = z.infer<typeof DefenceLogEntrySchema>;

export const DefenceLogSchema = z.object({
  entries: z.array(DefenceLogEntrySchema),
  serverNow: z.number(),
});

// ---------------------------------------------------------------------------
// The replay (§5)
// ---------------------------------------------------------------------------

export const ReplaySchema = z.object({
  raidId: z.string(),
  mode: z.enum(['replayed', 'as-recorded']),
  viewer: z.enum(['attacker', 'defender']),
  actions: z.array(z.unknown()),
  results: z.array(z.unknown()).optional(),
  stars: z.number().int().min(0).max(3),
  destruction: z.number().min(0).max(1),
  endReason: z.string().nullable(),
  /** Legitimate: the raid is over (§8). */
  layout: z.object({ ships: z.array(z.unknown()), arsenal: z.array(z.unknown()) }),
  kit: z.record(z.string(), z.number().int()),
  config: z.object({
    shells: z.number().int(),
    minePenalty: z.number().int(),
    timeLimitMs: z.number().int(),
  }),
  serverNow: z.number(),
});

export type Replay = z.infer<typeof ReplaySchema>;
