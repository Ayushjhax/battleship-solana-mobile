/**
 * THE WIRE PROTOCOL. Written first and FROZEN — the client track (P13) codes
 * against this in parallel. Every message carries `v: 1`. Don't change a
 * shape here without updating both sides; add new message types instead of
 * repurposing old ones.
 *
 * Every inbound message is parsed with `ClientMessageSchema` before it
 * reaches a room — see server/src/ws.ts. The server is authoritative:
 * clients send intents (`action`), never outcomes. `LayoutPayload` mirrors
 * the engine's `SUBMIT_LAYOUT` action; `MatchAction`/`MatchEvent`/`PlayerView`
 * are re-exported from the engine so the wire and the reducer never drift
 * apart — see CLAUDE.md > Engine purity.
 */
import { z } from 'zod';
import type { GameOverReason, MatchAction, MatchEvent, MatchMode, PlayerView, ShipClass } from '@engine/types';
import type { SeaId } from '@engine/terrain';
import { FUEL_BUDGET, GRID_SIZE } from '@engine/types';

/**
 * Bumped to 2 by Part 5 (new arsenal kinds and marks) and to 3 by Part 10
 * (captains in the match config and terrain in `matched`/`state` frames).
 *
 * The gate is DEFERRED, not immediate: `hello` carries an optional
 * `protocol`, absent meaning 1, and a client below the required version is
 * refused at `queue` ONLY while the matching Port City flag is on. With every
 * flag off — the default — every existing client keeps working exactly as
 * before.
 */
export const PROTOCOL_VERSION = 3 as const;

/** The oldest client the server will queue once the Academy is live. */
export const MIN_PROTOCOL = 2;

/** Part 10 — the oldest client that can draw captains and terrain. */
export const MIN_PROTOCOL_PART10 = 3;

export interface ProtocolGatedFeatures {
  readonly academy: boolean;
  readonly captains: boolean;
  readonly seas: boolean;
}

/** Minimum safe client protocol for the currently enabled wire features. */
export function minimumProtocolForFeatures(features: ProtocolGatedFeatures): number {
  if (features.captains || features.seas) return MIN_PROTOCOL_PART10;
  if (features.academy) return MIN_PROTOCOL;
  return 1;
}

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export const CoordSchema = z.object({
  r: z.number().int().min(0).max(GRID_SIZE - 1),
  c: z.number().int().min(0).max(GRID_SIZE - 1),
});

export const OrientationSchema = z.enum(['h', 'v']);
export const ShipClassSchema = z.enum(['battleship', 'cruiser', 'destroyer', 'boat']);
export const MatchModeSchema = z.enum(['classic', 'advanced']);
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
  // Part 5 — the Naval Academy's three.
  'sonar_net',
  'decoy',
  'minesweeper',
]);

export const ShipSchema = z.object({
  id: z.string().min(1).max(64),
  class: ShipClassSchema,
  len: z.number().int().min(1).max(4),
  origin: CoordSchema,
  orientation: OrientationSchema,
  hits: z.array(CoordSchema).max(4).default([]),
});

export const ArsenalItemSchema = z.object({
  id: z.string().min(1).max(64),
  kind: ArsenalKindSchema,
  at: CoordSchema.optional(),
});

/** What `ready` carries — mirrors the engine's SUBMIT_LAYOUT action minus playerId. */
export const LayoutPayloadSchema = z.object({
  ships: z.array(ShipSchema).max(10),
  arsenal: z.array(ArsenalItemSchema).max(16).default([]),
  /** Part 10A. Absent means no captain; null is accepted as "no captain" too. */
  captainId: CaptainIdSchema.nullish(),
});
export type LayoutPayload = z.infer<typeof LayoutPayloadSchema>;

/** A request to apply a MatchAction, minus the playerId — the socket's own id is used. */
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

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export const ClientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    v: z.literal(1),
    token: z.string().min(1).max(4096),
    resumeMatchId: z.string().uuid().optional(),
    /** Part 5. Absent means 1 — a client built before the Academy shipped. */
    protocol: z.number().int().min(1).max(99).optional(),
  }),
  z.object({
    t: z.literal('queue'),
    v: z.literal(1),
    mode: MatchModeSchema,
    wagered: z.boolean().default(false),
    opponent: z.enum(['player', 'bot']).default('player'),
    wagerRequestId: z.string().uuid().optional(),
  }),
  z.object({ t: z.literal('cancelQueue'), v: z.literal(1) }),
  z.object({ t: z.literal('ready'), v: z.literal(1), layout: LayoutPayloadSchema }),
  z.object({ t: z.literal('action'), v: z.literal(1), seq: z.number().int().min(0), action: ActionPayloadSchema }),
  z.object({ t: z.literal('resign'), v: z.literal(1) }),
  z.object({ t: z.literal('ping'), v: z.literal(1) }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export interface OpponentSummary {
  readonly id: string;
  readonly name: string;
  readonly avatarId: number;
  readonly avatarColor: string;
  readonly countryCode: string | null;
  readonly rankPoints: number;
  readonly isBot: boolean;
}

export interface MatchRewards {
  readonly points: number;
  readonly coins: number;
}

export type ServerMessage =
  | { t: 'hello:ok'; v: 1; playerId: string }
  | {
      t: 'queued';
      v: 1;
      position: number;
      onlineCount: number;
      pointBalance?: number;
      /**
       * How long until the authoritative matchmaker falls back to a bot, in
       * ms. Optional and additive: an older client ignores it; a newer one
       * shows the countdown without owning the deadline. Never present on the
       * explicit `opponent: 'bot'` path, which pairs immediately.
       */
      fallbackInMs?: number;
    }
  | {
      t: 'queue:cancelled';
      v: 1;
      refunded: boolean;
      reason: 'cancelled' | 'opponent_cancelled';
      pointBalance?: number;
    }
  | {
      t: 'matched';
      v: 1;
      matchId: string;
      you: OpponentSummary;
      opponent: OpponentSummary;
      mode: MatchMode;
      fuelBudget: number;
      layoutDeadline: number;
      /** Part 10B — the season sea, identical for both players. */
      sea?: SeaId;
      wagered: boolean;
      wagerStake: number;
    }
  /**
   * Masked and authoritative — never MatchState. See CLAUDE.md > Engine
   * purity. `opponentDisconnected` is a networking fact, not a rules fact, so
   * it rides alongside `view` rather than inside PlayerView (which the client
   * also builds offline, where "disconnected" has no meaning).
   */
  | { t: 'state'; v: 1; seq: number; view: PlayerView; opponentDisconnected?: boolean }
  /** The animation script the client replays, in order — see src/fx/EventPlayer.ts. */
  | { t: 'events'; v: 1; seq: number; events: readonly MatchEvent[] }
  | { t: 'turn'; v: 1; playerId: string; endsAt: number }
  | {
      t: 'over';
      v: 1;
      winnerId: string;
      reason: GameOverReason;
      rewards: MatchRewards;
      /**
       * What the wager settlement actually paid. `prize` is the winner's net
       * (0 for the loser); `gross`/`fee`/`payout` are the server's authoritative
       * breakdown (0025) and are absent on a server that predates the platform
       * fee, in which case the client must not invent a fee.
       */
      wager?: {
        stake: number;
        prize: number;
        balance: number;
        gross?: number;
        fee?: number;
        payout?: number;
      };
      /**
       * Steel the server credited to THIS player's Scrapyard, after the
       * Scrapyard bonus (Port City part-02 §8). Additive and optional, so an
       * older client simply ignores it. Absent when nothing was salvaged.
       */
      salvage?: { steel: number };
    }
  | { t: 'error'; v: 1; code: ErrorCode; message: string }
  | { t: 'pong'; v: 1 };

export type ErrorCode =
  | 'bad_message'
  | 'unauthenticated'
  | 'rate_limited'
  | 'too_large'
  | 'not_in_room'
  | 'wrong_phase'
  | 'illegal_action'
  | 'already_queued'
  | 'insufficient_points'
  /** Part 5: this build is too old to be shown the new marks. */
  | 'upgrade_required'
  | 'internal';

export function encode(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function decode(raw: unknown): { ok: true; message: ClientMessage } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }
  const result = ClientMessageSchema.safeParse(parsed);
  return result.success ? { ok: true, message: result.data } : { ok: false, error: result.error.message };
}

/** LayoutPayload/ActionPayload -> the engine's MatchAction, with the caller's playerId attached. */
export function toSubmitLayoutAction(playerId: string, layout: LayoutPayload): MatchAction {
  return {
    type: 'SUBMIT_LAYOUT',
    playerId,
    ships: layout.ships,
    arsenal: layout.arsenal,
    ...(layout.captainId ? { captainId: layout.captainId } : {}),
  };
}

export function toMatchAction(playerId: string, payload: ActionPayload): MatchAction {
  return payload.type === 'FIRE'
    ? { type: 'FIRE', playerId, at: payload.at }
    : { type: 'USE_ARSENAL', playerId, itemId: payload.itemId, at: payload.at, row: payload.row };
}

/** Referenced so this file documents the full ship-class vocabulary at a glance. */
export const SHIP_CLASSES: readonly ShipClass[] = ['battleship', 'cruiser', 'destroyer', 'boat'];
export { FUEL_BUDGET };
