/**
 * The client's mirror of server/src/protocol.ts — FROZEN in P12, coded
 * against here in P13. This is a deliberate duplication, not a shared
 * import: the server is a separate Node package (its own tsconfig, its own
 * `"type": "module"` boundary — see src/engine/package.json's header for why
 * that matters) and Metro bundles only what lives under this app's own root.
 * Keep the two in lockstep by hand; don't repurpose a shape, add a new one.
 *
 * Outbound (ClientMessage) needs no zod: this app fully controls what it
 * sends, so plain types plus stamping builders are enough. Inbound
 * (ServerMessage) is untrusted network input and is fully zod-validated —
 * `decode()` is the one gate everything from the socket passes through.
 *
 * MatchEvent is validated loosely on purpose: src/engine/types.ts's event
 * union has ~20 variants and keeps growing (P08 added seven), while
 * src/fx/applyEvent.ts already has a default case for an event kind it
 * doesn't recognise. Duplicating the full discriminated union here would
 * mean touching this frozen file every time the engine gains a weapon
 * animation, for a check the engine's own reducer already made — the server
 * is the trusted authority for event *content*, not an adversary this file
 * needs to defend against. What's actually worth validating deeply is
 * PlayerView, since a malformed one would crash board rendering.
 */
import { z } from 'zod';
import type { ArsenalItem, CaptainId, MatchEvent, MatchMode, PlayerView, Ship } from '@engine/types';
import { FUEL_BUDGET, GRID_SIZE } from '@engine/types';

/** Mirrors server/src/protocol.ts. Part 5 bumped this to 2; Part 10 to 3. */
export const PROTOCOL_VERSION = 3 as const;

// ---------------------------------------------------------------------------
// Shared shapes (mirrors server/src/protocol.ts)
// ---------------------------------------------------------------------------

export const CoordSchema = z.object({
  r: z.number().int().min(0).max(GRID_SIZE - 1),
  c: z.number().int().min(0).max(GRID_SIZE - 1),
});

export const CellStateSchema = z.enum(['unknown', 'miss', 'hit', 'sunk', 'revealed', 'mine']);
/** Part 10B — mirrors the engine's TerrainCell union. */
export const TerrainCellSchema = z.enum(['water', 'island', 'reef', 'fog']);
export const OrientationSchema = z.enum(['h', 'v']);
export const ShipClassSchema = z.enum(['battleship', 'cruiser', 'destroyer', 'boat']);
export const MatchModeSchema = z.enum(['classic', 'advanced']);
export const MatchPhaseSchema = z.enum(['placing', 'playing', 'over']);
/** Part 10A — mirrors the engine's CaptainId union. */
export const CaptainIdSchema = z.enum(['berhan', 'mara', 'ivo', 'tomas', 'rosa', 'oldCaptain']);
export const ArsenalKindSchema = z.enum([
  'torpedoBomber',
  'doubleTorpedoBomber',
  'bomber',
  'atomicBomber',
  'aaGun',
  'radar',
  'mine',
  'submarine',
  // Part 5 — mirrors server/src/protocol.ts.
  'sonar_net',
  'decoy',
  'minesweeper',
]);
export const GameOverReasonSchema = z.enum(['fleet', 'forfeit', 'resign']);

export const ShipSchema = z.object({
  id: z.string().min(1).max(64),
  class: ShipClassSchema,
  len: z.number().int().min(1).max(4),
  origin: CoordSchema,
  orientation: OrientationSchema,
  hits: z.array(CoordSchema).max(4),
});

export const ArsenalItemSchema = z.object({
  id: z.string().min(1).max(64),
  kind: ArsenalKindSchema,
  at: CoordSchema.optional(),
  used: z.boolean().optional(),
  destroyed: z.boolean().optional(),
  revealed: z.boolean().optional(),
});

/** What `ready` carries — mirrors the engine's SUBMIT_LAYOUT action minus playerId. */
export const LayoutPayloadSchema = z.object({
  ships: z.array(ShipSchema).max(10),
  arsenal: z.array(ArsenalItemSchema).max(16),
  captainId: CaptainIdSchema.nullish(),
});
export type LayoutPayload = z.infer<typeof LayoutPayloadSchema>;

export const ActionPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('FIRE'), at: CoordSchema }),
  z.object({
    type: z.literal('USE_ARSENAL'),
    itemId: z.string().min(1).max(64),
    at: CoordSchema.optional(),
    row: z.number().int().min(0).max(GRID_SIZE - 1).optional(),
  }),
]);
export type ActionPayload = z.infer<typeof ActionPayloadSchema>;

const MarksSchema = z.record(z.string(), CellStateSchema);

const BoardSchema = z.object({
  ships: z.array(ShipSchema),
  arsenal: z.array(ArsenalItemSchema),
  marks: MarksSchema,
});

const PlayerStateSchema = z.object({
  id: z.string().min(1),
  board: BoardSchema,
  fuelSpent: z.number().int(),
  consecutiveTimeouts: z.number().int(),
  ready: z.boolean(),
  // Part 10A — an older server simply does not send these.
  captainId: CaptainIdSchema.nullish(),
  captainUsed: z.boolean().optional(),
});

const SunkShipViewSchema = z.object({
  id: z.string().min(1),
  class: ShipClassSchema,
  cells: z.array(CoordSchema),
});

const RevealedItemViewSchema = z.object({
  kind: ArsenalKindSchema,
  at: CoordSchema,
  destroyed: z.boolean(),
  /** Part 10A — Mara's gun that survived its first hit. */
  damaged: z.boolean().optional(),
});

/** Deep-validated: a malformed view would crash board rendering. */
export const PlayerViewSchema: z.ZodType<PlayerView> = z.object({
  matchId: z.string().min(1),
  mode: MatchModeSchema,
  phase: MatchPhaseSchema,
  turn: z.string().min(1),
  winner: z.string().nullable(),
  moves: z.number().int(),
  /** Part 10B — the public sea. Optional so an older server still parses. */
  terrain: z.array(z.array(TerrainCellSchema)).optional(),
  you: PlayerStateSchema,
  enemy: z.object({
    id: z.string().min(1),
    ready: z.boolean(),
    marks: MarksSchema,
    sunkShips: z.array(SunkShipViewSchema),
    shipsRemaining: z.number().int(),
    revealedItems: z.array(RevealedItemViewSchema),
    // Part 10A — public at the arena reveal by design.
    captainId: CaptainIdSchema.nullish(),
    captainUsed: z.boolean().optional(),
  }),
}) as unknown as z.ZodType<PlayerView>;

/** Loosely validated — see the header comment on why. */
const MatchEventSchema = z
  .object({ type: z.string().min(1) })
  .catchall(z.unknown()) as unknown as z.ZodType<MatchEvent>;

export const OpponentSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  avatarId: z.number().int(),
  avatarColor: z.string(),
  countryCode: z.string().nullable(),
  rankPoints: z.number().int(),
  isBot: z.boolean(),
});
export type OpponentSummary = z.infer<typeof OpponentSummarySchema>;

export const MatchRewardsSchema = z.object({
  points: z.number().int(),
  coins: z.number().int(),
});
export type MatchRewards = z.infer<typeof MatchRewardsSchema>;

export const ErrorCodeSchema = z.enum([
  'bad_message',
  'unauthenticated',
  'rate_limited',
  'too_large',
  'not_in_room',
  'wrong_phase',
  'illegal_action',
  'already_queued',
  'insufficient_points',
  'upgrade_required',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

// ---------------------------------------------------------------------------
// Server -> Client (untrusted; fully validated)
// ---------------------------------------------------------------------------

export const ServerMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello:ok'), v: z.literal(1), playerId: z.string().min(1) }),
  z.object({
    t: z.literal('queued'),
    v: z.literal(1),
    position: z.number().int(),
    onlineCount: z.number().int(),
    pointBalance: z.number().int().nonnegative().optional(),
  }),
  z.object({
    t: z.literal('queue:cancelled'),
    v: z.literal(1),
    refunded: z.boolean(),
    reason: z.enum(['cancelled', 'opponent_cancelled']),
    pointBalance: z.number().int().nonnegative().optional(),
  }),
  z.object({
    t: z.literal('matched'),
    v: z.literal(1),
    matchId: z.string().uuid(),
    you: OpponentSummarySchema,
    opponent: OpponentSummarySchema,
    mode: MatchModeSchema,
    fuelBudget: z.number().int(),
    layoutDeadline: z.number(),
    /** Part 10B — the season sea, identical for both seats. */
    sea: z.string().optional(),
    wagered: z.boolean().default(false),
    wagerStake: z.number().int().nonnegative().default(0),
  }),
  z.object({
    t: z.literal('state'),
    v: z.literal(1),
    seq: z.number().int(),
    view: PlayerViewSchema,
    opponentDisconnected: z.boolean().optional(),
  }),
  z.object({
    t: z.literal('events'),
    v: z.literal(1),
    seq: z.number().int(),
    events: z.array(MatchEventSchema),
  }),
  z.object({
    t: z.literal('turn'),
    v: z.literal(1),
    playerId: z.string().min(1),
    endsAt: z.number(),
  }),
  z.object({
    t: z.literal('over'),
    v: z.literal(1),
    winnerId: z.string().min(1),
    reason: GameOverReasonSchema,
    rewards: MatchRewardsSchema,
    wager: z
      .object({
        stake: z.number().int().nonnegative(),
        prize: z.number().int().nonnegative(),
        balance: z.number().int().nonnegative(),
      })
      .optional(),
    /**
     * Port City part-02 §8. Steel the SERVER credited to this player's
     * Scrapyard, after the bonus — the Result screen renders it and never
     * recomputes it. Optional, so a server without 0015 simply omits it.
     * Mirrors server/src/protocol.ts's `over`; keep the two in lockstep.
     */
    salvage: z.object({ steel: z.number().int().nonnegative() }).optional(),
  }),
  z.object({
    t: z.literal('error'),
    v: z.literal(1),
    code: ErrorCodeSchema,
    message: z.string(),
  }),
  z.object({ t: z.literal('pong'), v: z.literal(1) }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export function decodeServerMessage(raw: unknown): { ok: true; message: ServerMessage } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }
  const result = ServerMessageSchema.safeParse(parsed);
  return result.success ? { ok: true, message: result.data } : { ok: false, error: result.error.message };
}

// ---------------------------------------------------------------------------
// Client -> Server (trusted output — plain types, stamping builders)
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { t: 'hello'; v: 1; token: string; resumeMatchId?: string; protocol?: number }
  | {
      t: 'queue';
      v: 1;
      mode: MatchMode;
      wagered: boolean;
      opponent: 'player' | 'bot';
      wagerRequestId?: string;
    }
  | { t: 'cancelQueue'; v: 1 }
  | { t: 'ready'; v: 1; layout: LayoutPayload }
  | { t: 'action'; v: 1; seq: number; action: ActionPayload }
  | { t: 'resign'; v: 1 }
  | { t: 'ping'; v: 1 };

export function encodeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}

/**
 * Part 5 — `hello` now announces which protocol this build speaks. A server
 * that does not know the field ignores it; a server with the Academy on uses
 * it to refuse builds too old to draw the new marks.
 */
export function helloMessage(token: string, resumeMatchId?: string): ClientMessage {
  return resumeMatchId
    ? { t: 'hello', v: 1, token, resumeMatchId, protocol: PROTOCOL_VERSION }
    : { t: 'hello', v: 1, token, protocol: PROTOCOL_VERSION };
}
export function queueMessage(
  mode: MatchMode,
  wagered: boolean,
  opponent: 'player' | 'bot',
  wagerRequestId?: string,
): ClientMessage {
  return {
    t: 'queue',
    v: 1,
    mode,
    wagered,
    opponent,
    ...(wagerRequestId ? { wagerRequestId } : {}),
  };
}
export function cancelQueueMessage(): ClientMessage {
  return { t: 'cancelQueue', v: 1 };
}
export function readyMessage(layout: LayoutPayload): ClientMessage {
  return { t: 'ready', v: 1, layout };
}
export function actionMessage(seq: number, action: ActionPayload): ClientMessage {
  return { t: 'action', v: 1, seq, action };
}
export function resignMessage(): ClientMessage {
  return { t: 'resign', v: 1 };
}
export function pingMessage(): ClientMessage {
  return { t: 'ping', v: 1 };
}

/** The placement store's fleet, trimmed to exactly the wire shape. */
export function toLayoutPayload(
  ships: readonly Ship[],
  arsenal: readonly ArsenalItem[],
  captainId?: CaptainId | null,
): LayoutPayload {
  return {
    ships: ships.map((s) => ({
      id: s.id,
      class: s.class,
      len: s.len,
      origin: { r: s.origin.r, c: s.origin.c },
      orientation: s.orientation,
      hits: s.hits.map((h) => ({ r: h.r, c: h.c })),
    })),
    arsenal: arsenal.map((a) => ({
      id: a.id,
      kind: a.kind,
      ...(a.at ? { at: { r: a.at.r, c: a.at.c } } : {}),
    })),
    ...(captainId ? { captainId } : {}),
  };
}

export { FUEL_BUDGET };
