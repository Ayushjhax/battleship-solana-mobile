/**
 * The typed bounty client — part-04 §3.
 *
 * Transport is the shared `src/net/featureClient.ts`. Every response is
 * parsed; nothing here computes a reward or a progress number, because §3 is
 * explicit that "Progress is never accepted from the client" — which cuts
 * both ways: the client does not send it, and it does not invent it either.
 */
import { z } from 'zod';

import { requestWithRetry, type SendInit } from '@/net/featureClient';
import { randomUuid } from '@/util/uuid';

export const BOUNTY_ERROR_CODES = [
  'offline',
  'unauthenticated',
  'internal',
  'feature-off',
  'no-profile',
  'not-claimable',
  'not-enough-gems',
  'no-alternative',
  'unknown-slot',
] as const;

export type BountyErrorCode = (typeof BOUNTY_ERROR_CODES)[number];

export function asBountyErrorCode(raw: string): BountyErrorCode {
  return (BOUNTY_ERROR_CODES as readonly string[]).includes(raw)
    ? (raw as BountyErrorCode)
    : 'internal';
}

export class BountyApiError extends Error {
  readonly code: BountyErrorCode;
  constructor(code: BountyErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'BountyApiError';
    this.code = code;
  }
}

const TRANSPORT = {
  makeError: (code: BountyErrorCode, detail?: string) => new BountyApiError(code, detail),
  asCode: asBountyErrorCode,
};

function request(path: string, init: SendInit): Promise<unknown> {
  return requestWithRetry(path, init, TRANSPORT);
}

function parse<T extends z.ZodTypeAny>(schema: T, data: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new BountyApiError('internal', `${what}: ${result.error.issues[0]?.message ?? 'bad shape'}`);
  }
  return result.data;
}

const RewardSchema = z.object({
  coins: z.number().int(),
  steel: z.number().int(),
  ink: z.number().int(),
  gems: z.number().int(),
});

export const BoardSchema = z.object({
  contracts: z.array(
    z.object({
      slot: z.number().int(),
      contractId: z.string(),
      progress: z.number().int(),
      target: z.number().int(),
      state: z.enum(['active', 'done', 'claimed']),
      scope: z.enum(['daily', 'weekly']),
      issuedAt: z.number(),
      expiresAt: z.number(),
      title: z.string(),
      tier: z.string(),
      reward: RewardSchema,
    }),
  ),
  rerollsUsed: z.number().int(),
  nextRerollGems: z.number().int(),
  serverNow: z.number(),
});

export type Board = z.infer<typeof BoardSchema>;

export const LogSchema = z.object({
  ink: z.number().int(),
  premium: z.boolean(),
  claimed: z.array(z.number().int()),
  claimable: z.array(z.number().int()),
  seasonId: z.number().int(),
  serverNow: z.number(),
});

export type Log = z.infer<typeof LogSchema>;

export async function getBoard(): Promise<Board> {
  return parse(BoardSchema, await request('/bounties', { method: 'GET' }), 'bounties');
}

export async function claimBounty(slot: number, requestId = randomUuid()): Promise<void> {
  await request('/bounties/claim', { method: 'POST', body: { slot, requestId } });
}

export async function rerollBounty(slot: number, requestId = randomUuid()): Promise<void> {
  await request('/bounties/reroll', { method: 'POST', body: { slot, requestId } });
}

export async function getLog(): Promise<Log> {
  return parse(LogSchema, await request('/log', { method: 'GET' }), 'log');
}

export async function claimPage(page: number, requestId = randomUuid()): Promise<void> {
  await request('/log/claim', { method: 'POST', body: { page, requestId } });
}

export async function buyPremium(requestId = randomUuid()): Promise<void> {
  await request('/log/premium', { method: 'POST', body: { requestId } });
}
