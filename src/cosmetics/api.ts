/**
 * The typed cosmetics client — part-03 §5.
 *
 * The catalogue is SERVER-DRIVEN (§5), so the shelves come down the wire and
 * the client renders what it is told. It still knows the engine catalogue —
 * that is how it draws a preview without a round trip — but an item the server
 * sends that the client does not recognise renders as its slot's default
 * rather than as nothing (§6.4).
 */
import { z } from 'zod';

import { requestWithRetry, type SendInit } from '@/net/featureClient';
import { randomUuid } from '@/util/uuid';

export const COSMETIC_ERROR_CODES = [
  'offline',
  'unauthenticated',
  'internal',
  'feature-off',
  'no-profile',
  'already-owned',
  'not-enough-coins',
  'not-enough-gems',
  'locked-tier',
  'unknown-item',
  'not-owned',
  'bad-slot',
] as const;

export type CosmeticErrorCode = (typeof COSMETIC_ERROR_CODES)[number];

export function asCosmeticErrorCode(raw: string): CosmeticErrorCode {
  return (COSMETIC_ERROR_CODES as readonly string[]).includes(raw)
    ? (raw as CosmeticErrorCode)
    : 'internal';
}

export class CosmeticApiError extends Error {
  readonly code: CosmeticErrorCode;
  constructor(code: CosmeticErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'CosmeticApiError';
    this.code = code;
  }
}

const TRANSPORT = {
  makeError: (code: CosmeticErrorCode, detail?: string) => new CosmeticApiError(code, detail),
  asCode: asCosmeticErrorCode,
};

function request(path: string, init: SendInit): Promise<unknown> {
  return requestWithRetry(path, init, TRANSPORT);
}

const ItemSchema = z.object({
  id: z.string(),
  slot: z.string(),
  name: z.string(),
  tier: z.number().int(),
  coins: z.number().int(),
  gems: z.number().int(),
  isDefault: z.boolean().optional(),
  hex: z.string().optional(),
  onDark: z.string().optional(),
  onLight: z.string().optional(),
  durationMs: z.number().int().optional(),
});

export const StoreSchema = z.object({
  shelves: z.array(
    z.object({
      slot: z.string(),
      store: z.enum(['shipyard', 'stationery']),
      items: z.array(ItemSchema),
    }),
  ),
  owned: z.array(z.string()),
  equipped: z.record(z.string(), z.string()),
  wallet: z.object({ coins: z.number().int(), gems: z.number().int() }),
  levels: z.object({ shipyard: z.number().int(), stationery: z.number().int() }),
  serverNow: z.number(),
});

export type Store = z.infer<typeof StoreSchema>;

function parse<T extends z.ZodTypeAny>(schema: T, data: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new CosmeticApiError('internal', `${what}: ${result.error.issues[0]?.message ?? 'bad shape'}`);
  }
  return result.data;
}

export async function getStore(): Promise<Store> {
  return parse(StoreSchema, await request('/cosmetics', { method: 'GET' }), 'cosmetics');
}

export async function buyCosmetic(itemId: string, requestId = randomUuid()): Promise<void> {
  await request('/cosmetics/buy', { method: 'POST', body: { itemId, requestId } });
}

export async function equipCosmetic(
  slot: string,
  itemId: string,
  requestId = randomUuid(),
): Promise<void> {
  await request('/cosmetics/equip', { method: 'POST', body: { slot, itemId, requestId } });
}

/**
 * §4 — "a `GemStore` adapter interface with a `NotAvailable` implementation.
 * The button shows 'Coming soon' and the screen exists so IAP can be dropped
 * in later."
 */
export interface GemStore {
  readonly available: boolean;
  readonly label: string;
  buy(packId: string): Promise<{ ok: false; reason: string }>;
}

export const NotAvailableGemStore: GemStore = {
  available: false,
  label: 'Coming soon',
  async buy() {
    return { ok: false, reason: 'The chandler has not opened yet.' };
  },
};
