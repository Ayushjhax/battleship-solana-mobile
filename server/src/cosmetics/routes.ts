/**
 * The cosmetics endpoints — part-03 §5.
 *
 * `GET /cosmetics` → catalogue + owned + equipped.
 * `POST /cosmetics/buy` `{ itemId, requestId }`
 * `POST /cosmetics/equip` `{ slot, itemId, requestId }`
 *
 * §5 wants the catalogue "server-driven, so a season can add items without an
 * app update". It is served from `@engine/cosmetics`, which both sides import
 * — so today the two always agree, and when a season needs to add an item the
 * server can start sending rows the client does not know. The client already
 * copes: `resolveRemote()` falls back to the default for any id it cannot
 * place (§6.4).
 *
 * §3's rule that this file exists to keep: "**A client that claims to own
 * something it does not is rejected, and the match payload is built from the
 * server's copy.**" Ownership is checked in `canBuy`/`canEquip` AND again in
 * SQL, and `/cosmetics/equipped/:userId` is what the match payload reads.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  COSMETICS,
  COSMETIC_SLOTS,
  DEFAULTS,
  SLOT_STORE,
  canBuy,
  canEquip,
  cosmeticById,
  payloadFor,
  resolveEquipped,
  shelfFor,
  type CosmeticSlot,
} from '@engine/cosmetics';

import { verifyAccessToken } from '../auth';
import { db } from '../db';
import { isEnabled } from '../features';

const BuyBody = z.object({ requestId: z.string().uuid(), itemId: z.string().max(48) });
const EquipBody = z.object({
  requestId: z.string().uuid(),
  slot: z.enum(COSMETIC_SLOTS),
  itemId: z.string().max(48),
});

type LooseRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const client = db();
  const rpc = client.rpc.bind(client) as unknown as LooseRpc;
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

export interface CosmeticsRow {
  readonly owned: readonly string[];
  readonly equipped: Record<string, string>;
  readonly coins: number;
  readonly gems: number;
  readonly shipyardLevel: number;
  readonly stationeryLevel: number;
}

export interface CosmeticsRepo {
  load(userId: string): Promise<CosmeticsRow | null>;
  buy(userId: string, itemId: string, coins: number, gems: number): Promise<string>;
  equip(userId: string, slot: string, itemId: string, isDefault: boolean): Promise<string>;
}

export const supabaseCosmeticsRepo: CosmeticsRepo = {
  async load(userId) {
    const rows = (await call('cosmetics_load', { p_user_id: userId })) as
      | {
          owned: string[] | null;
          equipped: Record<string, string> | null;
          coins: number;
          gems: number;
          shipyard_level: number;
          stationery_level: number;
        }[]
      | null;
    const row = rows?.[0];
    if (!row) return null;
    return {
      owned: row.owned ?? [],
      equipped: row.equipped ?? {},
      coins: row.coins,
      gems: row.gems,
      shipyardLevel: row.shipyard_level,
      stationeryLevel: row.stationery_level,
    };
  },

  async buy(userId, itemId, coins, gems) {
    return String(
      await call('cosmetics_buy', { p_user_id: userId, p_item: itemId, p_coins: coins, p_gems: gems }),
    );
  },

  async equip(userId, slot, itemId, isDefault) {
    return String(
      await call('cosmetics_equip', {
        p_user_id: userId,
        p_slot: slot,
        p_item: itemId,
        p_is_default: isDefault,
      }),
    );
  },
};

let active: CosmeticsRepo = supabaseCosmeticsRepo;
export function cosmeticsRepo(): CosmeticsRepo {
  return active;
}
export function __setCosmeticsRepoForTests(repo: CosmeticsRepo | null): void {
  active = repo ?? supabaseCosmeticsRepo;
}

/** The store level that gates a slot's shelf (§2). */
function levelFor(slot: CosmeticSlot, row: CosmeticsRow): number {
  return SLOT_STORE[slot] === 'shipyard' ? row.shipyardLevel : row.stationeryLevel;
}

/**
 * §3 — the match payload's cosmetics, built from the SERVER's copy.
 * Exported so the room can call it when it assembles the arena reveal.
 */
export async function cosmeticsPayloadFor(userId: string) {
  if (!isEnabled('portCity.cosmetics')) return payloadFor(resolveEquipped({}));
  const row = await cosmeticsRepo().load(userId);
  return payloadFor(resolveEquipped(row?.equipped ?? {}));
}

export function registerCosmeticsRoutes(app: FastifyInstance): void {
  async function handle(
    request: { headers: Record<string, unknown>; body?: unknown },
    reply: {
      code: (n: number) => { send: (body: unknown) => unknown };
      header: (k: string, v: string) => unknown;
    },
    run: (userId: string, body: unknown) => Promise<unknown>,
  ): Promise<unknown> {
    const authorization = request.headers.authorization as string | undefined;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const verified = token ? await verifyAccessToken(token) : null;
    if (!verified?.ok) return reply.code(401).send({ error: 'valid gameplay session required' });

    reply.header('Cache-Control', 'no-store');
    if (!isEnabled('portCity.cosmetics')) return reply.code(409).send({ code: 'feature-off' });

    try {
      return reply.code(200).send(await run(verified.token.userId, request.body));
    } catch (error) {
      app.log.error(error, 'cosmetics request failed');
      const code = (error as { code?: string }).code ?? 'internal';
      return reply.code(code === 'internal' ? 503 : 409).send({ code });
    }
  }

  app.get('/cosmetics', async (request, reply) =>
    handle(request as never, reply as never, async (userId) => {
      const row = await cosmeticsRepo().load(userId);
      if (!row) throw Object.assign(new Error('no city'), { code: 'no-profile' });

      // §2 — the shelf is gated by the store's level, per slot.
      const shelves = COSMETIC_SLOTS.map((slot) => ({
        slot,
        store: SLOT_STORE[slot],
        items: shelfFor(slot, levelFor(slot, row)),
      }));

      return {
        shelves,
        owned: row.owned,
        equipped: resolveEquipped(row.equipped),
        wallet: { coins: row.coins, gems: row.gems },
        levels: { shipyard: row.shipyardLevel, stationery: row.stationeryLevel },
        serverNow: Date.now(),
      };
    }),
  );

  app.post('/cosmetics/buy', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body) => {
      const parsed = BuyBody.safeParse(body);
      if (!parsed.success) throw Object.assign(new Error('bad body'), { code: 'unknown-item' });

      const repo = cosmeticsRepo();
      const row = await repo.load(userId);
      if (!row) throw Object.assign(new Error('no city'), { code: 'no-profile' });

      const item = cosmeticById(parsed.data.itemId);
      if (!item) throw Object.assign(new Error('unknown'), { code: 'unknown-item' });

      const check = canBuy(item.id, row.owned, levelFor(item.slot, row), {
        coins: row.coins,
        gems: row.gems,
      });
      if (!check.ok) throw Object.assign(new Error(check.error!), { code: check.error });

      const outcome = await repo.buy(userId, item.id, check.coins, check.gems);
      if (outcome !== 'ok') throw Object.assign(new Error(outcome), { code: outcome });

      return { bought: item.id, coins: check.coins, gems: check.gems, serverNow: Date.now() };
    }),
  );

  app.post('/cosmetics/equip', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body) => {
      const parsed = EquipBody.safeParse(body);
      if (!parsed.success) throw Object.assign(new Error('bad body'), { code: 'bad-slot' });

      const repo = cosmeticsRepo();
      const row = await repo.load(userId);
      if (!row) throw Object.assign(new Error('no city'), { code: 'no-profile' });

      const check = canEquip(parsed.data.slot, parsed.data.itemId, row.owned);
      if (!check.ok) throw Object.assign(new Error(check.error!), { code: check.error });

      const item = cosmeticById(parsed.data.itemId)!;
      const outcome = await repo.equip(userId, parsed.data.slot, item.id, item.isDefault === true);
      if (outcome !== 'ok') throw Object.assign(new Error(outcome), { code: outcome });

      return {
        equipped: resolveEquipped({ ...row.equipped, [parsed.data.slot]: item.id }),
        serverNow: Date.now(),
      };
    }),
  );
}

export { COSMETICS, DEFAULTS };
