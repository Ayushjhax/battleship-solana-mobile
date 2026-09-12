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
import { FUEL_BUDGET, GRID_SIZE } from '@engine/types';

export const PROTOCOL_VERSION = 1 as const;

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
export const ArsenalKindSchema = z.enum([
  'torpedoBomber',
  'doubleTorpedoBomber',
  'bomber',
  'atomicBomber',
  'aaGun',
  'radar',
  'mine',
  'submarine',
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
  }),
  z.object({ t: z.literal('queue'), v: z.literal(1), mode: MatchModeSchema }),
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
  | { t: 'queued'; v: 1; position: number; onlineCount: number }
  | {
      t: 'matched';
      v: 1;
      matchId: string;
      you: OpponentSummary;
      opponent: OpponentSummary;
      mode: MatchMode;
      fuelBudget: number;
      layoutDeadline: number;
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
  | { t: 'over'; v: 1; winnerId: string; reason: GameOverReason; rewards: MatchRewards }
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
  return { type: 'SUBMIT_LAYOUT', playerId, ships: layout.ships, arsenal: layout.arsenal };
}

export function toMatchAction(playerId: string, payload: ActionPayload): MatchAction {
  return payload.type === 'FIRE'
    ? { type: 'FIRE', playerId, at: payload.at }
    : { type: 'USE_ARSENAL', playerId, itemId: payload.itemId, at: payload.at, row: payload.row };
}

/** Referenced so this file documents the full ship-class vocabulary at a glance. */
export const SHIP_CLASSES: readonly ShipClass[] = ['battleship', 'cruiser', 'destroyer', 'boat'];
export { FUEL_BUDGET };
