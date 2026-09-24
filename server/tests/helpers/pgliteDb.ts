/**
 * A real Postgres, in-process, with every migration applied.
 *
 * PGlite runs the actual SQL, so these tests prove the things a hand-written
 * fake cannot: transaction atomicity, the optimistic version check, the RLS
 * guard trigger, and two writers racing.
 *
 * The auth/realtime stubs mirror the ones inlined at the top of
 * supabase/verify-offline.mjs. They are duplicated rather than shared because
 * that file is a standalone verification script with no exports; if the real
 * Supabase surface those stubs stand in for ever changes, BOTH move.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));

/** The parts of auth.* and realtime.* the migrations touch. */
const SUPABASE_STUBS = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key, instance_id uuid, aud text, role text, email text,
    is_anonymous boolean not null default false,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid $$;
  create schema realtime;
  create table realtime.messages (
    id bigserial primary key, topic text not null, extension text not null,
    payload jsonb, inserted_at timestamptz default now()
  );
  alter table realtime.messages enable row level security;
  create function realtime.topic() returns text language sql stable as $$
    select current_setting('realtime.topic', true) $$;
  grant usage on schema public, auth, realtime to anon, authenticated, service_role;
  grant select, insert on realtime.messages to authenticated;
  grant usage, select on all sequences in schema realtime to authenticated;
`;

export interface TestDb {
  readonly db: PGlite;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T>;
  /** Runs statements as an end user, so the RLS guard trigger applies. */
  asUser<T>(userId: string, run: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Boots a database with every migration applied `passes` times. Two passes is
 * the idempotency check part-01 §8.2.16 asks for.
 */
export async function startTestDb(passes = 1): Promise<TestDb> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);

  for (let pass = 0; pass < passes; pass++) {
    for (const file of migrationFiles()) {
      await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
    }
  }

  const query = async <T>(sql: string, params?: unknown[]): Promise<T[]> =>
    (await db.query(sql, params)).rows as T[];

  return {
    db,
    query,
    async one<T>(sql: string, params?: unknown[]): Promise<T> {
      const rows = await query<T>(sql, params);
      const row = rows[0];
      if (row === undefined) throw new Error(`expected a row from: ${sql}`);
      return row;
    },
    /**
     * Session-level, NOT `set local`. `set local` only lives inside an explicit
     * transaction block, and PGlite autocommits each statement — so a `set
     * local role` is gone before the next query runs, auth.uid() comes back
     * null, RLS matches no rows, and an UPDATE that should have been rejected
     * quietly returns zero rows instead. That reads as a passing guard test
     * while the guard was never reached.
     */
    async asUser<T>(userId: string, run: () => Promise<T>): Promise<T> {
      await db.query(`select set_config('request.jwt.claims', $1, false)`, [
        JSON.stringify({ sub: userId, role: 'authenticated' }),
      ]);
      await db.exec(`set role authenticated;`);
      try {
        return await run();
      } finally {
        await db.exec(`reset role;`);
        await db.query(`select set_config('request.jwt.claims', '', false)`);
      }
    },
    close: () => db.close(),
  };
}

/** Creates an auth user, which the 0001 trigger turns into a profile. */
export async function seedProfile(
  t: TestDb,
  id: string,
  patch: { rankPoints?: number; coins?: number; steel?: number; gems?: number } = {},
): Promise<void> {
  await t.query(`insert into auth.users (id, email) values ($1, null)`, [id]);
  await t.query(
    `update public.profiles
        set rank_points = $2, coins = $3, steel = $4, gems = $5
      where id = $1`,
    [id, patch.rankPoints ?? 0, patch.coins ?? 0, patch.steel ?? 0, patch.gems ?? 10],
  );
}
