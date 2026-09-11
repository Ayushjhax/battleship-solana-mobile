/**
 * The client <-> server contract. Written first, then frozen — both tracks meet
 * here (docs/brief.md section 6). P12/P13 extend it; changes need both sides.
 *
 * Every inbound message is parsed with zod before it reaches a room. The server
 * is authoritative: clients send intents, never outcomes.
 */
import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

export const CoordSchema = z.object({
  r: z.number().int().min(0).max(9),
  c: z.number().int().min(0).max(9),
});

export const OrientationSchema = z.enum(['h', 'v']);
export const ShipClassSchema = z.enum(['battleship', 'cruiser', 'destroyer', 'boat']);
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
  id: z.string().min(1),
  class: ShipClassSchema,
  len: z.number().int().min(1).max(4),
  origin: CoordSchema,
  orientation: OrientationSchema,
  hits: z.array(CoordSchema).default([]),
});

export const ArsenalItemSchema = z.object({
  id: z.string().min(1),
  kind: ArsenalKindSchema,
  at: CoordSchema.optional(),
});

/** Client -> server. */
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('HELLO'), version: z.number().int(), token: z.string().optional() }),
  z.object({ type: z.literal('QUEUE'), mode: z.enum(['classic', 'advanced']) }),
  z.object({ type: z.literal('CANCEL_QUEUE') }),
  z.object({
    type: z.literal('SUBMIT_LAYOUT'),
    ships: z.array(ShipSchema),
    arsenal: z.array(ArsenalItemSchema).default([]),
  }),
  z.object({ type: z.literal('FIRE'), at: CoordSchema }),
  z.object({
    type: z.literal('USE_ARSENAL'),
    itemId: z.string().min(1),
    at: CoordSchema.optional(),
    row: z.number().int().min(0).max(9).optional(),
  }),
  z.object({ type: z.literal('RESIGN') }),
  z.object({ type: z.literal('PING') }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/**
 * Server -> client. `view` is always the masked projection from
 * engine.projectView() — the raw MatchState never leaves this process.
 */
export type ServerMessage =
  | { type: 'WELCOME'; version: number; playerId: string }
  | { type: 'QUEUED'; position: number }
  | { type: 'MATCH_FOUND'; matchId: string; opponent: { name: string; avatar: number } }
  | { type: 'STATE'; view: unknown }
  | { type: 'EVENTS'; events: unknown[] }
  | { type: 'TURN'; turn: string; endsAt: number }
  | { type: 'MATCH_OVER'; winner: string }
  | { type: 'PONG' }
  | { type: 'ERROR'; code: string; message: string };

export function encode(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function decode(raw: string): ClientMessage | null {
  try {
    const parsed = ClientMessageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
