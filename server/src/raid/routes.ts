/**
 * The raid endpoints — part-06 §5, §6.
 *
 * Same shape as the city's (server/src/city/routes.ts): the user id comes from
 * a verified Supabase token and never from the body, so there is no parameter
 * that would let user A act on user B's raid. Every failure is a typed code.
 *
 * NO RAID UI SHIPS IN THIS PART. These routes exist so the rules and the
 * settlement can be driven end to end by the tests; the screen is a later
 * part. They are behind `portCity.raids`, which is OFF by default, and every
 * one of them returns `feature-off` while it is.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { CityState } from '@engine/city';
import type { RaidView } from '@engine/raid';
import type { ArsenalKind, Coord } from '@engine/types';

import { verifyAccessToken } from '../auth';
import { cityRepo } from '../city/repo';
import { getSession, sessionForAttacker, type SessionTarget } from './session';
import {
  claimRevenge,
  defenceLog,
  ensureHarbour,
  markDefenceLogRead,
  openRaid,
  raidReplay,
  raidsEnabled,
  saveHarbour,
  searchTargets,
  settle,
  statusFor,
  sweepRaids,
  type Outcome,
  type TargetCard,
} from './service';

const Coordinate = z.object({ r: z.number().int().min(0).max(9), c: z.number().int().min(0).max(9) });

const HarbourBody = z.object({
  layout: z.object({
    ships: z.array(z.unknown()),
    arsenal: z.array(z.unknown()),
    /** Part 10B — the sea this harbour defends on. Absent means Open Sea. */
    sea: z.string().max(16).optional(),
  }),
});

const SearchBody = z.object({
  requestId: z.string().uuid(),
  searchesThisSession: z.number().int().min(0).max(64).default(0),
});

const OpenBody = z.object({
  requestId: z.string().uuid(),
  raidId: z.string().uuid(),
  card: z.object({
    kind: z.enum(['player', 'cove']),
    userId: z.string().uuid().nullable(),
    coveSeed: z.number().int().nullable(),
    name: z.string().max(64),
    avatarId: z.number().int(),
    avatarColor: z.string().max(32),
    countryCode: z.string().max(8).nullable(),
    admiraltyLevel: z.number().int().min(0).max(12),
    renown: z.number().int().min(0),
    loot: z.object({ coins: z.number().int().min(0), steel: z.number().int().min(0) }),
    renownOffer: z.object({ best: z.number().int(), worst: z.number().int() }),
    costCoins: z.number().int().min(0),
  }),
  kit: z.record(z.string(), z.number().int().min(0)).default({}),
  dropShield: z.boolean().default(false),
});

const ActionBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fire'), raidId: z.string().uuid(), at: Coordinate }),
  z.object({
    kind: z.literal('use'),
    raidId: z.string().uuid(),
    weapon: z.string().max(32),
    at: Coordinate.optional(),
    row: z.number().int().min(0).max(9).optional(),
  }),
  z.object({ kind: z.literal('retreat'), raidId: z.string().uuid() }),
]);

const SettleBody = z.object({ raidId: z.string().uuid() });

const MarkReadBody = z.object({ raidIds: z.array(z.string().uuid()).max(64) });

const RevengeBody = z.object({ raidId: z.string().uuid() });

async function verifiedUserId(authorization: string | undefined): Promise<string | null> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return null;
  const verified = await verifyAccessToken(token);
  return verified.ok ? verified.token.userId : null;
}

function levelOf(state: CityState | undefined, id: string): number {
  const buildings = state?.buildings as Record<string, { level?: number }> | undefined;
  return buildings?.[id]?.level ?? 0;
}

/**
 * The player's researched items — part-05 §5, and the answer that replaced
 * DECISIONS.md D23's stand-in.
 *
 * D23 said "a built Naval Academy unlocks all three", because the research
 * queue did not exist yet. It does now (`src/engine/city/research.ts` and
 * migration 0018), so this reads the real per-item list. It is STRICTLY
 * TIGHTER than the stand-in: a level-3 Academy with nothing researched
 * unlocks nothing, where D23 unlocked everything.
 */
function unlocksFor(city: { unlocks?: readonly string[] } | null | undefined): readonly string[] {
  return city?.unlocks ?? [];
}

export function registerRaidRoutes(app: FastifyInstance): void {
  async function handle<T>(
    request: { headers: Record<string, unknown>; body?: unknown },
    reply: {
      code: (n: number) => { send: (body: unknown) => unknown };
      header: (k: string, v: string) => unknown;
    },
    run: (userId: string, body: unknown, now: number) => Promise<Outcome<T>>,
  ): Promise<unknown> {
    const userId = await verifiedUserId(request.headers.authorization as string | undefined);
    if (!userId) return reply.code(401).send({ error: 'valid gameplay session required' });

    reply.header('Cache-Control', 'no-store');
    if (!raidsEnabled()) return reply.code(409).send({ code: 'feature-off' });

    const now = Date.now();
    try {
      const outcome = await run(userId, request.body, now);
      if (!outcome.ok) {
        return reply
          .code(statusFor(outcome.error))
          .send({ code: outcome.error, ...(outcome.detail ? { detail: outcome.detail } : {}) });
      }
      return reply.code(200).send({ ...outcome.body, serverNow: now });
    } catch (error) {
      app.log.error(error, 'raid request failed');
      return reply.code(503).send({ code: 'internal' });
    }
  }

  /** The caller's own city levels — every endpoint needs them. */
  async function levels(userId: string, now: number) {
    const city = await cityRepo().load(userId, now);
    const state = city?.state;
    return {
      state,
      admiraltyLevel: levelOf(state, 'admiralty'),
      coastalCommandLevel: levelOf(state, 'coastal_command'),
      armoryLevel: levelOf(state, 'armory'),
      // Part 10B — the Lighthouse gates which seas a harbour may defend on.
      lighthouseLevel: levelOf(state, 'lighthouse'),
      unlocks: unlocksFor(city),
    };
  }

  // -------------------------------------------------------------------------
  // The harbour (§3). Reading your OWN layout is fine — you drew it.
  // -------------------------------------------------------------------------

  app.get('/raid/harbour', async (request, reply) =>
    handle(request as never, reply as never, async (userId, _body, now) => {
      const me = await levels(userId, now);
      if (!me.state) return { ok: false as const, error: 'no-profile' as const };

      const layout = await ensureHarbour(
        userId,
        {
          admiraltyLevel: me.admiraltyLevel,
          coastalCommandLevel: me.coastalCommandLevel,
          unlocks: me.unlocks,
          lighthouseLevel: me.lighthouseLevel,
        },
        hashSeed(userId),
      );
      if (!layout) return { ok: false as const, error: 'needs-admiralty' as const };
      return { ok: true as const, body: { layout } };
    }),
  );

  app.post('/raid/harbour', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body, now) => {
      const parsed = HarbourBody.safeParse(body);
      if (!parsed.success) return { ok: false as const, error: 'bad-harbour' as const };
      const me = await levels(userId, now);
      return saveHarbour(userId, parsed.data.layout as never, {
        admiraltyLevel: me.admiraltyLevel,
        coastalCommandLevel: me.coastalCommandLevel,
        unlocks: me.unlocks,
        lighthouseLevel: me.lighthouseLevel,
      });
    }),
  );

  // -------------------------------------------------------------------------
  // The search (§5)
  // -------------------------------------------------------------------------

  app.post('/raid/search', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body, now) => {
      const parsed = SearchBody.safeParse(body);
      if (!parsed.success) return { ok: false as const, error: 'not-found' as const };
      const me = await levels(userId, now);
      await sweepRaids(now);
      return searchTargets({
        userId,
        admiraltyLevel: me.admiraltyLevel,
        renown: await renownOf(userId),
        searchesThisSession: parsed.data.searchesThisSession,
      });
    }),
  );

  // -------------------------------------------------------------------------
  // Running the raid (§6)
  // -------------------------------------------------------------------------

  app.post('/raid/open', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body, now) => {
      const parsed = OpenBody.safeParse(body);
      if (!parsed.success) return { ok: false as const, error: 'not-found' as const };
      const me = await levels(userId, now);

      return openRaid({
        attackerId: userId,
        raidId: parsed.data.raidId,
        card: parsed.data.card as TargetCard,
        kit: parsed.data.kit as Record<ArsenalKind, number>,
        armoryLevel: me.armoryLevel,
        admiraltyLevel: me.admiraltyLevel,
        unlocks: me.unlocks,
        renown: await renownOf(userId),
        dropShield: parsed.data.dropShield,
        requestId: parsed.data.requestId,
        now,
      });
    }),
  );

  app.post('/raid/action', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body, now) => {
      const parsed = ActionBody.safeParse(body);
      if (!parsed.success) return { ok: false as const, error: 'not-found' as const };

      const session = getSession(parsed.data.raidId, userId);
      if (!session) return { ok: false as const, error: 'no-session' as const };

      const outcome =
        parsed.data.kind === 'fire'
          ? session.fire(parsed.data.at as Coord, now)
          : parsed.data.kind === 'use'
            ? session.use(parsed.data.weapon as ArsenalKind, {
                ...(parsed.data.at ? { at: parsed.data.at as Coord } : {}),
                ...(parsed.data.row !== undefined ? { row: parsed.data.row } : {}),
              }, now)
            : session.retreat(now);

      // A rejected action still answers with the view: the client's board must
      // stay in step with the server even when it asked for something silly.
      return {
        ok: true as const,
        body: {
          accepted: outcome.ok,
          ...(outcome.error ? { rejected: outcome.error } : {}),
          view: outcome.view,
          events: outcome.events,
          shellDelta: outcome.shellDelta,
          over: session.over,
        },
      };
    }),
  );

  app.post('/raid/settle', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body, now) => {
      const parsed = SettleBody.safeParse(body);
      if (!parsed.success) return { ok: false as const, error: 'not-found' as const };
      return settle(parsed.data.raidId, userId, now);
    }),
  );

  // -------------------------------------------------------------------------
  // The defence log (§4) and the replay (§5)
  // -------------------------------------------------------------------------

  app.get('/raid/log', async (request, reply) =>
    handle(request as never, reply as never, async (userId) => defenceLog(userId)),
  );

  app.post('/raid/log/read', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body) => {
      const parsed = MarkReadBody.safeParse(body);
      if (!parsed.success) return { ok: false as const, error: 'not-found' as const };
      return markDefenceLogRead(userId, parsed.data.raidIds);
    }),
  );

  /**
   * Part 7 §8.6 — claims the free search for one incoming raid. Separate from
   * /raid/open so the claim is atomic and can be refused without having
   * already built a raid around it.
   */
  app.post('/raid/revenge', async (request, reply) =>
    handle(request as never, reply as never, async (userId, body) => {
      const parsed = RevengeBody.safeParse(body);
      if (!parsed.success) return { ok: false as const, error: 'not-found' as const };
      return claimRevenge(userId, parsed.data.raidId);
    }),
  );

  app.get('/raid/replay/:raidId', async (request, reply) =>
    handle(request as never, reply as never, async (userId) => {
      const raidId = (request as { params?: { raidId?: string } }).params?.raidId ?? '';
      if (!raidId) return { ok: false as const, error: 'not-found' as const };
      return raidReplay(raidId, userId);
    }),
  );

  interface StatusBody {
    active: boolean;
    raidId?: string;
    target?: SessionTarget;
    view?: RaidView;
  }

  app.get('/raid/status', async (request, reply) =>
    handle<StatusBody>(request as never, reply as never, async (userId, _body, now) => {
      await sweepRaids(now);
      const session = sessionForAttacker(userId);
      if (!session) return { ok: true as const, body: { active: false } };
      return {
        ok: true as const,
        body: {
          active: true,
          raidId: session.raidId,
          target: session.target,
          view: session.view(now),
        },
      };
    }),
  );
}

/** A user's renown, or 0. Reads through the raid repo's snapshot function. */
async function renownOf(userId: string): Promise<number> {
  const { raidRepo } = await import('./repo');
  const row = await raidRepo().loadDefender(userId);
  return row?.renown ?? 0;
}

/** Stable per-user seed for the generated default harbour (§3). */
export function hashSeed(userId: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}
