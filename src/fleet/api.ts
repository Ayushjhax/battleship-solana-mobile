/**
 * The typed fleet client — part-08 §6.
 *
 * Transport is `src/net/featureClient.ts`, shared with the city (Part 1) and
 * the raid (Part 7), so requestId, retry-on-network-only and the 12-second
 * timeout are one implementation rather than three.
 *
 * Every response goes through its zod schema before it leaves this module,
 * and the schemas are STRICT for the same reason Part 7's were: a field
 * nobody declared is a parse failure, not a silent passenger.
 */
import { z } from 'zod';

import { requestWithRetry, type SendInit } from '@/net/featureClient';
import { randomUuid } from '@/util/uuid';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const FLEET_ERROR_CODES = [
  'offline',
  'unauthenticated',
  'internal',
  'feature-off',
  'no-profile',
  'needs-admiralty',
  'already-in-a-fleet',
  'not-in-a-fleet',
  'insufficient-coins',
  'fleet-full',
  'not-allowed',
  'already-filled',
  'on-cooldown',
  'no-room',
  'not-found',
  'rate-limited',
] as const;

export type FleetApiErrorCode = (typeof FLEET_ERROR_CODES)[number];

export function asFleetErrorCode(raw: string): FleetApiErrorCode {
  return (FLEET_ERROR_CODES as readonly string[]).includes(raw)
    ? (raw as FleetApiErrorCode)
    : 'internal';
}

export class FleetApiError extends Error {
  readonly code: FleetApiErrorCode;
  readonly detail?: string;

  constructor(code: FleetApiErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'FleetApiError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const TRANSPORT = {
  makeError: (code: FleetApiErrorCode, detail?: string) => new FleetApiError(code, detail),
  asCode: asFleetErrorCode,
};

function request(path: string, init: SendInit): Promise<unknown> {
  return requestWithRetry(path, init, TRANSPORT);
}

function parse<T extends z.ZodTypeAny>(schema: T, data: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new FleetApiError('internal', `${what}: ${result.error.issues[0]?.message ?? 'bad shape'}`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const MemberSchema = z
  .object({
    userId: z.string(),
    name: z.string(),
    avatarId: z.number().int(),
    avatarColor: z.string(),
    countryCode: z.string().nullable(),
    role: z.enum(['admiral', 'commodore', 'officer', 'sailor']),
    merit: z.number().int(),
    renown: z.number().int(),
    joinedAt: z.string(),
    warOptIn: z.boolean(),
  })
  .strict();

const FleetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    emblemBadge: z.number().int(),
    emblemTint: z.number().int(),
    policy: z.enum(['open', 'request', 'closed']),
    minRenown: z.number().int(),
    archived: z.boolean(),
  })
  .strict();

export const FleetViewSchema = z.object({
  fleet: FleetSchema.nullable(),
  members: z.array(MemberSchema),
  myRole: z.enum(['admiral', 'commodore', 'officer', 'sailor']).nullable(),
  serverNow: z.number(),
});

export type FleetView = z.infer<typeof FleetViewSchema>;

export const FlagWallSchema = z.object({
  flags: z.array(z.object({ countryCode: z.string(), firstAt: z.string() })),
  serverNow: z.number(),
});

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export async function getMyFleet(): Promise<FleetView> {
  return parse(FleetViewSchema, await request('/fleet', { method: 'GET' }), 'fleet');
}

export async function createFleet(input: {
  name: string;
  description: string;
  emblemBadge: number;
  emblemTint: number;
  policy: string;
  minRenown: number;
  requestId?: string;
}): Promise<FleetView> {
  return parse(
    FleetViewSchema,
    await request('/fleet/create', {
      method: 'POST',
      body: { ...input, requestId: input.requestId ?? randomUuid() },
    }),
    'createFleet',
  );
}

export async function leaveFleet(requestId = randomUuid()): Promise<void> {
  await request('/fleet/leave', { method: 'POST', body: { requestId } });
}

export async function sendQuickChat(kind: 'phrase' | 'sticker', code: string): Promise<void> {
  // There is no `text` parameter, and there is no third `kind`. §2.
  await request('/fleet/chat', { method: 'POST', body: { kind, code } });
}

export async function requestItem(item: string, requestId = randomUuid()): Promise<void> {
  await request('/fleet/donation/request', { method: 'POST', body: { item, requestId } });
}

export async function fillDonation(donationId: string, requestId = randomUuid()): Promise<void> {
  await request('/fleet/donation/fill', { method: 'POST', body: { donationId, requestId } });
}

// ---------------------------------------------------------------------------
// The Flag Hall (§5)
// ---------------------------------------------------------------------------

export async function getFlagWall(): Promise<readonly { countryCode: string; firstAt: string }[]> {
  const body = parse(FlagWallSchema, await request('/fleet/flags', { method: 'GET' }), 'flags');
  return body.flags;
}

// ---------------------------------------------------------------------------
// Donations (§3)
// ---------------------------------------------------------------------------

const DonationSchema = z.object({
  id: z.string(),
  fleetId: z.string(),
  requesterId: z.string(),
  item: z.string(),
  at: z.number(),
  donorId: z.string().nullable(),
  filledAt: z.number().nullable(),
  consumedAt: z.number().nullable(),
});

export const DonationsSchema = z.object({
  requests: z.array(DonationSchema),
  held: z.array(DonationSchema),
  costs: z.record(z.string(), z.number().int()),
  serverNow: z.number(),
});

export type Donations = z.infer<typeof DonationsSchema>;

export async function getDonations(): Promise<Donations> {
  return parse(DonationsSchema, await request('/fleet/donations', { method: 'GET' }), 'donations');
}

// ---------------------------------------------------------------------------
// Chat (§2)
// ---------------------------------------------------------------------------

export const ChatLogSchema = z.object({
  messages: z.array(
    z.object({
      fleetId: z.string(),
      userId: z.string(),
      kind: z.enum(['phrase', 'sticker']),
      code: z.string(),
      at: z.number(),
    }),
  ),
  serverNow: z.number(),
});

export async function getChat() {
  return parse(ChatLogSchema, await request('/fleet/chat', { method: 'GET' }), 'chat').messages;
}

// ---------------------------------------------------------------------------
// Wars (§4)
// ---------------------------------------------------------------------------

const TargetScoreSchema = z.object({
  targetUserId: z.string(),
  stars: z.number().int(),
  destruction: z.number(),
  finishedAt: z.number(),
  byUserId: z.string().nullable(),
  attempts: z.number().int(),
});

const SideScoreSchema = z.object({
  stars: z.number().int(),
  destruction: z.number(),
  lastFinishAt: z.number(),
  targets: z.array(TargetScoreSchema),
});

export const WarViewSchema = z.object({
  war: z
    .object({
      id: z.string(),
      fleetA: z.string(),
      fleetB: z.string().nullable(),
      size: z.number().int(),
      state: z.enum(['searching', 'prep', 'battle', 'settling', 'ended', 'cancelled']),
      searchStartedAt: z.number(),
      prepEndsAt: z.number().nullable(),
      battleEndsAt: z.number().nullable(),
      settledAt: z.number().nullable(),
      starsA: z.number().int(),
      starsB: z.number().int(),
    })
    .nullable(),
  scoreboard: z.object({ a: SideScoreSchema, b: SideScoreSchema }).nullable(),
  /**
   * NOTE: no `harbour`. A war harbour is hidden exactly as a raid target's is
   * (Part 6 §10), and this schema is strict-by-omission — a server that sent
   * one would have it dropped here, before any component could render it.
   */
  members: z.array(
    z.object({
      warId: z.string(),
      userId: z.string(),
      fleetId: z.string(),
      renown: z.number().int(),
      raidsUsed: z.number().int(),
    }),
  ),
  serverNow: z.number(),
});

export type WarView = z.infer<typeof WarViewSchema>;

export async function getWar(): Promise<WarView> {
  return parse(WarViewSchema, await request('/war', { method: 'GET' }), 'war');
}

export async function startWar(size: 5 | 10 | 15, requestId = randomUuid()) {
  return request('/war/start', { method: 'POST', body: { size, requestId } });
}

export async function setWarOptIn(optIn: boolean) {
  return request('/war/opt-in', { method: 'POST', body: { optIn } });
}

export async function saveWarHarbour(layout: { ships: readonly unknown[]; arsenal: readonly unknown[] }) {
  return request('/war/harbour', { method: 'POST', body: { layout } });
}

// ---------------------------------------------------------------------------
// Visits and friendly raids (§5)
// ---------------------------------------------------------------------------

export const VisitSchema = z.object({
  city: z.object({ buildings: z.record(z.string(), z.object({ level: z.number().int() })) }),
  serverNow: z.number(),
});

export type Visit = z.infer<typeof VisitSchema>;

export async function visitCity(userId: string): Promise<Visit> {
  return parse(
    VisitSchema,
    await request(`/visit/${encodeURIComponent(userId)}`, { method: 'GET' }),
    'visit',
  );
}

export async function canRaidFriendly(userId: string): Promise<boolean> {
  try {
    await request(`/fleet/friendly/${encodeURIComponent(userId)}`, { method: 'GET' });
    return true;
  } catch {
    return false;
  }
}
