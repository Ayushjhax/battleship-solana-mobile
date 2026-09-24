/**
 * The fleet endpoints — part-08 §6.
 *
 * Same shape as the city's and the raid's: the user id comes from a verified
 * Supabase token and never from the body, every failure is a typed code, and
 * everything is behind `portCity.fleets`, which is OFF by default.
 *
 * Four groups: the roster (§1), quick chat (§2), donations (§3), wars (§4),
 * and visits and friendly raids (§5).
 *
 * TWO THINGS THAT ARE DELIBERATELY ABSENT FROM RESPONSES HERE:
 *   - `war_member.harbour`. A war harbour is hidden exactly as a raid target's
 *     is (Part 6 §10), and `toWarMember` does not map the column, so /war has
 *     no field that could carry one.
 *   - a visited city's stored production and scrap pile. `publicCity()` keeps
 *     levels and drops the rest — see its header.
 *
 * §2's free text has no endpoint here, and will not have one until moderation,
 * muting and reporting are designed. `/fleet/chat` takes a `kind` of 'phrase'
 * or 'sticker' and a `code`; there is no `text` parameter to add one to.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  FLEET_CREATE_COST_COINS,
  FLEET_DESCRIPTION_MAX,
  FLEET_EMBLEM_BADGES,
  FLEET_EMBLEM_TINTS,
  FLEET_NAME_MAX,
  FLEET_NAME_MIN,
  checkSend,
  rosterOrder,
  successorFor,
} from '@engine/fleets';

import { verifyAccessToken } from '../auth';
import { cityRepo } from '../city/repo';
import { isEnabled } from '../features';
import { admiraltyLevelFrom, fleetHallLevelFrom } from './config';
import { fleetRepo } from './repo';
import { warScoreboard } from './scheduler';
import {
  checkFriendly,
  fillRequest,
  listRequests,
  postRequest,
  recordWarRaid,
  setOptIn,
  setWarHarbour,
  startWar,
} from './service';

const ChatBody = z.object({
  // Two kinds. There is no third, and no `text`.
  kind: z.enum(['phrase', 'sticker']),
  code: z.string().max(16),
});

const CreateBody = z.object({
  requestId: z.string().uuid(),
  name: z.string().min(FLEET_NAME_MIN).max(FLEET_NAME_MAX),
  description: z.string().max(FLEET_DESCRIPTION_MAX).default(''),
  emblemBadge: z.number().int().min(0).max(FLEET_EMBLEM_BADGES - 1),
  emblemTint: z.number().int().min(0).max(FLEET_EMBLEM_TINTS - 1),
  policy: z.enum(['open', 'request', 'closed']),
  minRenown: z.number().int().min(0).max(10_000),
});

const RequestItemBody = z.object({ requestId: z.string().uuid(), item: z.string().max(32) });
const FillBody = z.object({ requestId: z.string().uuid(), donationId: z.string().uuid() });
const StartWarBody = z.object({ requestId: z.string().uuid(), size: z.union([z.literal(5), z.literal(10), z.literal(15)]) });
const OptInBody = z.object({ optIn: z.boolean() });
const WarHarbourBody = z.object({
  layout: z.object({ ships: z.array(z.unknown()), arsenal: z.array(z.unknown()) }),
});
const WarRaidBody = z.object({
  raidId: z.string().uuid(),
  targetUserId: z.string().uuid(),
  stars: z.number().int().min(0).max(3),
  destruction: z.number().min(0).max(1),
});

async function verifiedUserId(authorization: string | undefined): Promise<string | null> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return null;
  const verified = await verifyAccessToken(token);
  return verified.ok ? verified.token.userId : null;
}

export function registerFleetRoutes(app: FastifyInstance): void {
  async function handle(
    request: { headers: Record<string, unknown>; body?: unknown },
    reply: {
      code: (n: number) => { send: (body: unknown) => unknown };
      header: (k: string, v: string) => unknown;
    },
    run: (userId: string, body: unknown, now: number) => Promise<unknown>,
  ): Promise<unknown> {
    const userId = await verifiedUserId(request.headers.authorization as string | undefined);
    if (!userId) return reply.code(401).send({ error: 'valid gameplay session required' });

    reply.header('Cache-Control', 'no-store');
    if (!isEnabled('portCity.fleets')) return reply.code(409).send({ code: 'feature-off' });

    const now = Date.now();
    try {
      const body = await run(userId, request.body, now);
      return reply.code(200).send({ ...(body as object), serverNow: now });
    } catch (error) {
      app.log.error(error, 'fleet request failed');
      const code = (error as { code?: string }).code ?? 'internal';
      return reply.code(code === 'internal' ? 503 : 409).send({ code });
    }
  }

  // -------------------------------------------------------------------------
  // The roster (§1)
  // -------------------------------------------------------------------------

  app.get('/fleet', async (request, reply) =>
    handle(request as never, reply as never, async (userId) => {
      const repo = fleetRepo();
      const membership = await repo.membershipOf(userId);
      if (!membership) return { fleet: null, members: [], myRole: null };

      const [fleet, members] = await Promise.all([
        repo.loadFleet(membership.fleetId),
        repo.members(membership.fleetId),
      ]);
      return {
        fleet,
        // The order is the rules', not the database's — merit first (§3).
        members: rosterOrder(members),
        myRole: membership.role,
      };
    }),
  );

  app.post('/fleet/create', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body) => {
      const parsed = CreateBody.safeParse(body);
      if (!parsed.success) throw Object.assign(new Error('bad body'), { code: 'not-found' });

      const repo = fleetRepo();
      const fleetId = crypto.randomUUID();
      const outcome = await repo.createFleet({
        fleetId,
        userId,
        name: parsed.data.name,
        description: parsed.data.description,
        badge: parsed.data.emblemBadge,
        tint: parsed.data.emblemTint,
        policy: parsed.data.policy,
        minRenown: parsed.data.minRenown,
        costCoins: FLEET_CREATE_COST_COINS,
      });
      if (outcome !== 'ok') throw Object.assign(new Error(outcome), { code: outcome });

      const [fleet, members] = await Promise.all([repo.loadFleet(fleetId), repo.members(fleetId)]);
      return { fleet, members: rosterOrder(members), myRole: 'admiral' };
    }),
  );

  /**
   * §1 — "Leaving is always allowed." The successor is chosen by the RULES
   * (`successorFor`) and handed to the SQL, so the ordering has exactly one
   * implementation and the database only applies it.
   */
  app.post('/fleet/leave', async (request, reply) =>
    handle(request as never, reply as never, async (userId) => {
      const repo = fleetRepo();
      const membership = await repo.membershipOf(userId);
      if (!membership) throw Object.assign(new Error('not in a fleet'), { code: 'not-in-a-fleet' });

      let successorId: string | null = null;
      if (membership.role === 'admiral') {
        const succession = successorFor(await repo.members(membership.fleetId), userId);
        successorId = succession.kind === 'promoted' ? succession.userId : null;
      }

      const outcome = await repo.leaveFleet(userId, successorId);
      return { outcome, fleet: null, members: [], myRole: null };
    }),
  );

  // -------------------------------------------------------------------------
  // Quick chat (§2)
  // -------------------------------------------------------------------------

  app.post('/fleet/chat', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body, now) => {
      const parsed = ChatBody.safeParse(body);
      if (!parsed.success) throw Object.assign(new Error('bad body'), { code: 'not-found' });

      const repo = fleetRepo();
      const membership = await repo.membershipOf(userId);
      if (!membership) throw Object.assign(new Error('not in a fleet'), { code: 'not-in-a-fleet' });

      // The single gate: a known phrase or an unlocked sticker, inside the
      // rate limit. Anything else — including anything that looks like free
      // text in the `code` — is refused here and never reaches a row.
      // §2 — the Fleet Hall level gates which stickers are unlocked.
      const city = await cityRepo().load(userId, now);
      const check = checkSend({
        kind: parsed.data.kind,
        code: parsed.data.code,
        fleetHallLevel: fleetHallLevelFrom(city?.state),
        isMember: true,
        recent: await repo.recentBy(membership.fleetId, userId, 60_000),
        now,
      });
      if (!check.ok) {
        throw Object.assign(new Error(check.error ?? 'refused'), {
          code: check.error === 'too-fast' || check.error === 'too-many' ? 'rate-limited' : 'not-allowed',
        });
      }

      await repo.postMessage({
        fleetId: membership.fleetId,
        userId,
        kind: parsed.data.kind,
        code: parsed.data.code,
        at: now,
      });
      return { sent: true };
    }),
  );

  app.get('/fleet/chat', async (request, reply) =>
    handle(request as never, reply as never, async (userId) => {
      const repo = fleetRepo();
      const membership = await repo.membershipOf(userId);
      if (!membership) return { messages: [] };
      return { messages: await repo.recentMessages(membership.fleetId, 60) };
    }),
  );

  // -------------------------------------------------------------------------
  // The Flag Hall (§5)
  // -------------------------------------------------------------------------

  app.get('/fleet/flags', async (request, reply) =>
    handle(request as never, reply as never, async (userId) => ({
      flags: await fleetRepo().flagWall(userId),
    })),
  );

  // -------------------------------------------------------------------------
  // Donations (§3)
  // -------------------------------------------------------------------------

  app.get('/fleet/donations', async (request, reply) =>
    handle(request as never, reply as never, async (userId) => listRequests(userId)),
  );

  app.post('/fleet/donation/request', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body, now) => {
      const parsed = RequestItemBody.safeParse(body);
      if (!parsed.success) throw coded('not-found');

      const city = await cityRepo().load(userId, now);
      const outcome = await postRequest(userId, parsed.data.item as never, now, {
        fleetHallLevel: fleetHallLevelFrom(city?.state),
      });
      if (!outcome.ok) throw coded(outcome.error, outcome.detail);
      return outcome.body;
    }),
  );

  app.post('/fleet/donation/fill', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body, now) => {
      const parsed = FillBody.safeParse(body);
      if (!parsed.success) throw coded('not-found');

      const city = await cityRepo().load(userId, now);
      const outcome = await fillRequest(userId, parsed.data.donationId, city?.coins ?? 0);
      if (!outcome.ok) throw coded(outcome.error, outcome.detail);
      return outcome.body;
    }),
  );

  // -------------------------------------------------------------------------
  // Wars (§4)
  // -------------------------------------------------------------------------

  app.post('/war/start', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body, now) => {
      const parsed = StartWarBody.safeParse(body);
      if (!parsed.success) throw coded('not-found');

      // §1 — the Fleet Hall is an Admiralty 4 building, and a war needs one.
      const city = await cityRepo().load(userId, now);
      if (admiraltyLevelFrom(city?.state) < 4) throw coded('not-allowed');

      const outcome = await startWar(userId, parsed.data.size, now);
      if (!outcome.ok) throw coded(outcome.error, outcome.detail);
      return outcome.body;
    }),
  );

  app.post('/war/opt-in', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body) => {
      const parsed = OptInBody.safeParse(body);
      if (!parsed.success) throw coded('not-found');
      const outcome = await setOptIn(userId, parsed.data.optIn);
      if (!outcome.ok) throw coded(outcome.error, outcome.detail);
      return outcome.body;
    }),
  );

  app.post('/war/harbour', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body) => {
      const parsed = WarHarbourBody.safeParse(body);
      if (!parsed.success) throw coded('not-found');
      const outcome = await setWarHarbour(userId, parsed.data.layout);
      if (!outcome.ok) throw coded(outcome.error, outcome.detail);
      return outcome.body;
    }),
  );

  app.post('/war/raid', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body) => {
      const parsed = WarRaidBody.safeParse(body);
      if (!parsed.success) throw coded('not-found');
      const outcome = await recordWarRaid(userId, parsed.data);
      if (!outcome.ok) throw coded(outcome.error, outcome.detail);
      return outcome.body;
    }),
  );

  /** The live scoreboard — the same scoring function the settlement uses. */
  app.get('/war', async (request, reply) =>
    handle(request as never, reply as never, async (userId) => {
      const repo = fleetRepo();
      const membership = await repo.membershipOf(userId);
      if (!membership) return { war: null, scoreboard: null, members: [] };

      const warId = await repo.activeWarFor(membership.fleetId);
      if (!warId) return { war: null, scoreboard: null, members: [] };

      const [war, members, scoreboard] = await Promise.all([
        repo.loadWar(warId),
        repo.warMembers(warId),
        warScoreboard(warId),
      ]);
      // NOTE: `members` carries no `harbour` — the war harbours are hidden
      // exactly as a raid target's is (Part 6 §10). `toWarMember` does not
      // map the column, so there is no field here that could hold one.
      return { war, scoreboard, members };
    }),
  );

  // -------------------------------------------------------------------------
  // Visits and friendly raids (§5)
  // -------------------------------------------------------------------------

  /**
   * §5 — "a read-only render of their buildings, levels, renown and equipped
   * cosmetics. No loot, no renown, no timers."
   *
   * It returns the city STATE, which holds building levels — and also the
   * stored production and the scrap pile. Those are stripped here: a visit is
   * a look at someone's town, not a scouting report on what a raid would take.
   */
  app.get('/visit/:userId', async (request, reply) =>
    handle(request as never, reply as never, async (_me, _body, now) => {
      const target = (request as { params?: { userId?: string } }).params?.userId ?? '';
      if (!target) throw coded('not-found');

      const city = await cityRepo().load(target, now);
      if (!city) throw coded('not-found');
      return { city: publicCity(city.state) };
    }),
  );

  app.get('/fleet/friendly/:userId', async (request, reply) =>
    handle(request as never, reply as never, async (userId) => {
      const target = (request as { params?: { userId?: string } }).params?.userId ?? '';
      const outcome = await checkFriendly(userId, target);
      if (!outcome.ok) throw coded(outcome.error, outcome.detail);
      return outcome.body;
    }),
  );
}

/** A typed failure the `handle` wrapper turns into a 409 with a code. */
function coded(code: string, detail?: string): Error {
  return Object.assign(new Error(detail ?? code), { code });
}

/**
 * §5 — what a visitor may see of someone else's city.
 *
 * Levels and names, yes. Uncollected production and the scrap pile, NO: those
 * are what a raid takes (Part 6 §7.2), and letting anyone read them turns the
 * visit screen into a free scouting tool that bypasses the search cost.
 */
function publicCity(state: unknown): unknown {
  const city = state as { buildings?: Record<string, { level?: number; upgrading?: unknown }> } | null;
  if (!city?.buildings) return { buildings: {} };
  const buildings: Record<string, { level: number }> = {};
  for (const [id, building] of Object.entries(city.buildings)) {
    buildings[id] = { level: building.level ?? 0 };
  }
  return { buildings };
}

/**
 * §5 — called by the match server when a ranked match ends and by the raid
 * settlement, with the loser's country. `earnsFlag()` (in the engine) decides
 * whether it counts; `flag_record` makes it once-only.
 */
export async function recordFlagIfEarned(
  winnerId: string,
  loserCountry: string | null,
): Promise<boolean> {
  if (!isEnabled('portCity.fleets') || !loserCountry) return false;
  return fleetRepo().recordFlag(winnerId, loserCountry);
}
