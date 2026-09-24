/**
 * The typed raid client — part-07 §2, §3.
 *
 * Transport is `src/net/featureClient.ts`, shared with the city (Part 1), so
 * the requestId, retry and offline rules are one implementation rather than
 * two. What is local to this file is the vocabulary: the endpoints, the typed
 * errors, and — most importantly — **the parse**.
 *
 * Every response goes through its zod schema before it leaves this module. A
 * raid payload that carried a layout would fail `RaidViewSchema.strict()` and
 * be reported as `internal`, which is the right outcome: the screen shows the
 * Captain saying something went wrong, rather than the defender's fleet.
 */
import type { z } from 'zod';

import { requestWithRetry, type SendInit } from '@/net/featureClient';
import { randomUuid } from '@/util/uuid';

import {
  ActionResponseSchema,
  DefenceLogSchema,
  HarbourResponseSchema,
  OpenResponseSchema,
  RaidApiError,
  ReplaySchema,
  SaveHarbourResponseSchema,
  SearchResponseSchema,
  SettlementSchema,
  StatusResponseSchema,
  asRaidErrorCode,
  type ActionResponse,
  type DefenceLogEntry,
  type HarbourResponse,
  type OpenResponse,
  type Replay,
  type SearchResponse,
  type Settlement,
  type StatusResponse,
  type TargetCard,
} from './types';

const TRANSPORT = {
  makeError: (code: ReturnType<typeof asRaidErrorCode>, detail?: string) =>
    new RaidApiError(code, detail),
  asCode: asRaidErrorCode,
};

async function request(path: string, init: SendInit): Promise<unknown> {
  return requestWithRetry(path, init, TRANSPORT);
}

/**
 * Parses, or turns a schema failure into a typed error. A malformed response
 * is `internal`, never a crash and never a half-rendered screen.
 */
function parse<T extends z.ZodTypeAny>(schema: T, data: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new RaidApiError('internal', `${what}: ${result.error.issues[0]?.message ?? 'bad shape'}`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// The harbour (§1, §2)
// ---------------------------------------------------------------------------

export async function getHarbour(): Promise<HarbourResponse> {
  return parse(HarbourResponseSchema, await request('/raid/harbour', { method: 'GET' }), 'harbour');
}

export async function saveHarbour(
  layout: {
    ships: readonly unknown[];
    arsenal: readonly unknown[];
    /** Part 10B — the sea this harbour defends on. */
    sea?: string;
  },
  requestId = randomUuid(),
): Promise<{ fuelUsed: number }> {
  return parse(
    SaveHarbourResponseSchema,
    await request('/raid/harbour', { method: 'POST', body: { layout, requestId } }),
    'saveHarbour',
  );
}

// ---------------------------------------------------------------------------
// The search (§3 step 2)
// ---------------------------------------------------------------------------

export async function searchTarget(
  searchesThisSession: number,
  requestId = randomUuid(),
): Promise<SearchResponse> {
  return parse(
    SearchResponseSchema,
    await request('/raid/search', { method: 'POST', body: { requestId, searchesThisSession } }),
    'search',
  );
}

// ---------------------------------------------------------------------------
// The raid (§3 step 3)
// ---------------------------------------------------------------------------

export async function openRaid(input: {
  raidId: string;
  card: TargetCard;
  kit: Readonly<Record<string, number>>;
  dropShield?: boolean;
  requestId?: string;
}): Promise<OpenResponse> {
  return parse(
    OpenResponseSchema,
    await request('/raid/open', {
      method: 'POST',
      body: {
        requestId: input.requestId ?? randomUuid(),
        raidId: input.raidId,
        card: input.card,
        kit: input.kit,
        dropShield: input.dropShield ?? false,
      },
    }),
    'open',
  );
}

export type RaidActionBody =
  | { kind: 'fire'; raidId: string; at: { r: number; c: number } }
  | { kind: 'use'; raidId: string; weapon: string; at?: { r: number; c: number }; row?: number }
  | { kind: 'retreat'; raidId: string };

export async function sendRaidAction(body: RaidActionBody): Promise<ActionResponse> {
  return parse(
    ActionResponseSchema,
    await request('/raid/action', { method: 'POST', body }),
    'action',
  );
}

export async function settleRaid(raidId: string): Promise<Settlement> {
  return parse(
    SettlementSchema,
    await request('/raid/settle', { method: 'POST', body: { raidId } }),
    'settle',
  );
}

/**
 * §4 of the plan — the single mechanism behind "a raid never ends without a
 * result the player can see". Called on every `AppState` return and every
 * reconnect.
 */
export async function getRaidStatus(): Promise<StatusResponse> {
  return parse(StatusResponseSchema, await request('/raid/status', { method: 'GET' }), 'status');
}

// ---------------------------------------------------------------------------
// The defence log (§4) and the replay (§5)
// ---------------------------------------------------------------------------

export async function getDefenceLog(): Promise<{ entries: DefenceLogEntry[] }> {
  return parse(DefenceLogSchema, await request('/raid/log', { method: 'GET' }), 'log');
}

export async function markLogRead(raidIds: readonly string[]): Promise<void> {
  await request('/raid/log/read', { method: 'POST', body: { raidIds } });
}

export async function getReplay(raidId: string): Promise<Replay> {
  return parse(
    ReplaySchema,
    await request(`/raid/replay/${encodeURIComponent(raidId)}`, { method: 'GET' }),
    'replay',
  );
}
