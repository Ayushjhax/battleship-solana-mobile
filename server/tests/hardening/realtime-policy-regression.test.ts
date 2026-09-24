/**
 * Hardening regression — Part 8's fleet realtime policies must not make
 * `realtime.messages` unusable for every authenticated player.
 *
 * The bug: `0017_fleets.sql` added two permissive RLS policies on
 * `realtime.messages` whose expressions read `public.fleet_member`, while the
 * same migration REVOKED all privileges on that table from `authenticated`.
 * Postgres checks relation privileges for a policy expression while PLANNING
 * the query, regardless of whether that policy's branch would match — so from
 * 0017 onward every authenticated INSERT or SELECT on realtime.messages failed
 * with `permission denied for table fleet_member`. That is not just fleet
 * broadcasts: lobby presence and match emotes share the table, so every
 * realtime channel was dead. `verify-offline.mjs` reproduces it at
 * "user A can join lobby:classic presence".
 *
 * The fix (migration 0026) moves the membership probe into a SECURITY DEFINER
 * function, so the policy never needs a grant on the server-only table.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedProfile, startTestDb, type TestDb } from '../helpers/pgliteDb';

const A = 'a1111111-1111-4111-8111-111111111111';
const B = 'b1111111-1111-4111-8111-111111111111';
const FLEET = 'f1111111-1111-4111-8111-111111111111';

let t: TestDb;
let matchId = '';

beforeAll(async () => {
  // Two passes: the same idempotency discipline the other DB tests use.
  t = await startTestDb(2);
  await seedProfile(t, A);
  await seedProfile(t, B);
  // The match topic policy needs a real match row naming A as a player; the
  // server creates these, so the fixture does too.
  const match = await t.one<{ id: string }>(
    `insert into public.matches (mode, player_a, player_b, seed)
     values ('classic', $1, $2, 42) returning id`,
    [A, B],
  );
  matchId = match.id;
});

afterAll(async () => {
  await t.close();
});

async function asAuthenticated<T>(
  userId: string,
  topic: string,
  run: () => Promise<T>,
): Promise<T> {
  return t.asUser(userId, async () => {
    await t.query(`select set_config('realtime.topic', $1, false)`, [topic]);
    return run();
  });
}

describe('realtime policies after the fleet migration', () => {
  it('an authenticated player can join lobby presence', async () => {
    const rows = await asAuthenticated(A, 'lobby:classic', () =>
      t.query<{ id: number }>(
        `insert into realtime.messages (topic, extension, payload)
         values ('lobby:classic', 'presence', '{}') returning id`,
      ),
    );
    expect(rows).toHaveLength(1);
  });

  it('an authenticated player can send and read a match emote', async () => {
    const inserted = await asAuthenticated(A, `match:${matchId}`, () =>
      t.query<{ id: number }>(
        `insert into realtime.messages (topic, extension, payload)
         values ($1, 'broadcast', '{"emote":1}') returning id`,
        [`match:${matchId}`],
      ),
    );
    expect(inserted).toHaveLength(1);
    const visible = await asAuthenticated(A, `match:${matchId}`, () =>
      t.query<{ n: number }>(
        `select count(*)::int as n from realtime.messages where topic = $1`,
        [`match:${matchId}`],
      ),
    );
    expect(visible[0]?.n).toBe(1);
  });

  it('a non-member is refused a fleet broadcast by RLS, not by a broken grant', async () => {
    let message = '';
    try {
      await asAuthenticated(A, `fleet:${FLEET}`, () =>
        t.query(
          `insert into realtime.messages (topic, extension, payload)
           values ('fleet:${FLEET}', 'broadcast', '{"emote":1}')`,
        ),
      );
    } catch (error) {
      message = String((error as { message?: string }).message ?? error);
    }
    expect(message).not.toBe(''); // it was refused
    // The refusal must be the RLS policy saying no — NOT "permission denied
    // for table fleet_member", which is the bug this file guards.
    expect(message).not.toContain('fleet_member');
    expect(message.toLowerCase()).toContain('row-level security');
  });
});
