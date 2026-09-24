/**
 * RAID SECRECY SWEEP — the real `/raid` HTTP routes over PGlite.
 *
 * Walks every response a raid client or defender can receive — search, open,
 * status, action, settle, replay, log, log/read, revenge, harbour — and after
 * EVERY action asserts the harbour layout cannot be reconstructed:
 *
 *   - no `layout` / `ships` / `arsenal` / `origin` / `orientation` field before
 *     the raid is over (settle's `reveal` and the post-raid replay are the
 *     documented exceptions, and are asserted to actually arrive);
 *   - no un-marked ship cell, in either wire form;
 *   - an unexposed decoy stays a plain HIT: never in `revealedItems`, and the
 *     word "decoy" is accounted for by its public marks only once exposed;
 *   - an untouched item's cell and kind never surface;
 *   - the defender's own GET /raid/harbour DOES carry their layout — the one
 *     documented exception, asserted so the rule is not vacuous.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { cellsOf, coordKey } from '@engine/board';
import { newCity } from '@engine/city';
import { autoPlaceFleet, validateArsenalPlacement } from '@engine/placement';
import { createRng } from '@engine/rng';
import {
  generateDefaultHarbour,
  validateHarbour,
  type HarbourLayout,
} from '@engine/raid';
import type { Coord, Marks } from '@engine/types';

vi.mock('../../src/auth', () => ({
  verifyAccessToken: vi.fn(async (token: string) => ({
    ok: true as const,
    token: { userId: token, isAnonymous: false },
  })),
}));

import { app } from '../../src/index';
import { __setCityRepoForTests, type CityRepo } from '../../src/city/repo';
import {
  __setRaidRepoForTests,
  fromSnapshotRow,
  toLogRow,
  toReplayRow,
  type RaidRepo,
} from '../../src/raid/repo';
import { __resetSessionsForTests } from '../../src/raid/session';
import { seedProfile, startTestDb, type TestDb } from '../helpers/pgliteDb';

const A = '11111111-1111-4111-8111-111111111111';
const D = '22222222-2222-4222-8222-222222222222';

const CONTEXT = {
  admiraltyLevel: 5,
  coastalCommandLevel: 5,
  unlocks: ['sonar_net', 'decoy', 'minesweeper'],
  lighthouseLevel: 5,
};

const uuid = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const key = (c: Coord) => coordKey(c);
const forms = (c: Coord): [string, string] => [`"${key(c)}"`, JSON.stringify(c)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A legal harbour with BOTH a decoy and a mine. `generateDefaultHarbour` only
 * generates mines and AA guns, and the decoy is the item this sweep is about.
 */
function harbourWithDecoy(): HarbourLayout {
  const ships = autoPlaceFleet(createRng(7));
  const arsenal: { id: string; kind: string; at: Coord }[] = [];
  for (const kind of ['decoy', 'mine'] as const) {
    for (let r = 0; r < 10 && !arsenal.some((i) => i.kind === kind); r++) {
      for (let c = 0; c < 10; c++) {
        const item = { id: `${kind}-1`, kind, at: { r, c } };
        if (validateArsenalPlacement({ ships, arsenal: arsenal as never, marks: {} }, item as never).ok) {
          arsenal.push(item);
          break;
        }
      }
    }
  }
  const layout: HarbourLayout = { ships, arsenal: arsenal as HarbourLayout['arsenal'] };
  const check = validateHarbour(layout, CONTEXT);
  if (!check.ok) throw new Error(`test harbour is not legal: ${check.error}`);
  return layout;
}

let t: TestDb;
let raidSeq = 0;

// ---------------------------------------------------------------------------
// The production SQL, behind the repo seam.
// ---------------------------------------------------------------------------

function pgliteRepo(db: TestDb): RaidRepo {
  const one = async <T>(sql: string, params: unknown[]): Promise<T> => {
    const rows = await db.query<Record<string, T>>(sql, params);
    return Object.values(rows[0] ?? {})[0] as T;
  };
  return {
    async loadHarbour(userId) {
      const rows = await db.query<{ layout: HarbourLayout; fuel_used: number; valid: boolean }>(
        `select layout, fuel_used, valid from public.harbour where user_id = $1`,
        [userId],
      );
      const row = rows[0];
      return row ? { layout: row.layout, fuelUsed: row.fuel_used, valid: row.valid } : null;
    },
    async saveHarbour(userId, layout, fuelUsed) {
      await db.query(`select public.harbour_save($1, $2, $3)`, [userId, JSON.stringify(layout), fuelUsed]);
    },
    async loadDefender(userId) {
      const rows = await db.query<Parameters<typeof fromSnapshotRow>[1]>(
        `select * from public.raid_defender_snapshot($1)`,
        [userId],
      );
      const row = rows[0];
      return row ? fromSnapshotRow(userId, row) : null;
    },
    async search(p) {
      const rows = await db.query<Record<string, unknown>>(
        `select * from public.raid_search($1, $2, $3, $4, $5, $6)`,
        [p.userId, p.renown, p.window, p.minAdmiralty, p.repeatHours, p.limit],
      );
      return rows.map((row) => ({
        userId: String(row.user_id),
        name: String(row.name),
        avatarId: Number(row.avatar_id),
        avatarColor: String(row.avatar_color),
        countryCode: row.country_code === null ? null : String(row.country_code),
        admiraltyLevel: Number(row.admiralty_level),
        renown: Number(row.renown),
      }));
    },
    async open(p) {
      const value = await one<string>(
        `select public.raid_open($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13::jsonb) as raid_open`,
        [
          p.raidId, p.attackerId, p.defenderId, p.coveSeed, p.costCoins, p.lockMinutes, p.dropShield,
          JSON.stringify(p.layout), JSON.stringify(p.kit), JSON.stringify(p.config),
          p.engineVersion, p.requestId ?? null, JSON.stringify(p.response ?? {}),
        ],
      );
      return value as never;
    },
    async settle(p) {
      const result = await one<{ applied: boolean; reason?: string; takenCoins: number; takenSteel: number }>(
        `select public.settle_raid($1,$2::smallint,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb) as settle_raid`,
        [
          p.raidId, p.stars, p.destruction, p.shellsLeft, p.endReason, p.earnedCoins, p.earnedSteel,
          JSON.stringify(p.drain), p.walletCoins, p.walletSteel, p.renownAttacker, p.renownDefender,
          p.shieldHours, JSON.stringify(p.actions), JSON.stringify(p.results),
        ],
      );
      return {
        applied: result.applied === true,
        ...(result.reason ? { reason: result.reason } : {}),
        takenCoins: result.takenCoins ?? 0,
        takenSteel: result.takenSteel ?? 0,
      };
    },
    async lookupRequest(userId, requestId) {
      const rows = await db.query<{ response: unknown }>(
        `select response from public.city_request_log where user_id = $1 and request_id = $2`,
        [userId, requestId],
      );
      return rows[0]?.response ?? null;
    },
    async sweep() {
      await db.query(`select public.raid_sweep_expired()`);
    },
    async defenceLog(userId, limit) {
      const rows = await db.query<Record<string, never>>(`select * from public.raid_defence_log($1, $2)`, [userId, limit]);
      return rows.map(toLogRow);
    },
    async markLogRead(userId, raidIds) {
      if (raidIds.length === 0) return 0;
      return Number(await one(`select public.raid_log_mark_read($1, $2) as r`, [userId, raidIds]) ?? 0);
    },
    async claimRevenge(userId, raidId) {
      return (await one(`select public.raid_claim_revenge($1, $2) as r`, [userId, raidId])) === true;
    },
    async loadReplay(raidId, userId) {
      const rows = await db.query<Record<string, never>>(`select * from public.raid_replay($1, $2)`, [raidId, userId]);
      const row = rows[0];
      return row ? toReplayRow(row) : null;
    },
  };
}

/** The city repo the raid routes read levels from; only `load` is used. */
function cityRepo(): CityRepo {
  return {
    async load() {
      return {
        state: {
          version: 1,
          buildings: {
            admiralty: { level: 5 },
            coastal_command: { level: 5 },
            armory: { level: 5 },
            lighthouse: { level: 5 },
          },
        } as never,
        version: 1,
        cityVersion: 1,
        coins: 5_000,
        steel: 5_000,
        gems: 10,
        rankPoints: 0,
        unlocks: CONTEXT.unlocks,
      };
    },
    async apply() {
      return null;
    },
    async lookupRequest() {
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

interface ViewLike {
  readonly marks: Marks;
  readonly sunkShips?: readonly { cells: readonly Coord[] }[];
  readonly revealedItems?: readonly { kind: string; at: Coord }[];
}

/** Fails if the payload's view names any cell the raider has not earned. */
function sweepView(json: string, layout: HarbourLayout, where: string): void {
  const view = JSON.parse(json) as ViewLike;
  const publicKeys = new Set<string>(Object.keys(view.marks ?? {}));
  for (const sunk of view.sunkShips ?? []) for (const cell of sunk.cells) publicKeys.add(key(cell));
  for (const item of view.revealedItems ?? []) publicKeys.add(key(item.at));

  for (const ship of layout.ships) {
    for (const cell of cellsOf(ship)) {
      if (publicKeys.has(key(cell))) continue;
      for (const form of forms(cell)) {
        if (json.includes(form)) throw new Error(`${where}: leaked un-hit ship cell ${key(cell)} via ${form}`);
      }
    }
  }

  for (const item of layout.arsenal) {
    if (!item.at) continue;
    const revealed = item.revealed === true || item.destroyed === true;
    if (revealed || publicKeys.has(key(item.at))) continue;
    for (const form of forms(item.at)) {
      if (json.includes(form)) throw new Error(`${where}: leaked hidden ${item.kind} at ${key(item.at)} via ${form}`);
    }
  }

  // The decoy kind is accounted for to the character: a public 'decoy' mark
  // plus that decoy's revealedItems entry, nothing else.
  const exposed = layout.arsenal.filter((i) => i.kind === 'decoy' && i.revealed === true && i.at);
  const expected =
    Object.values(view.marks ?? {}).filter((m) => m === 'decoy').length +
    (view.revealedItems ?? []).filter((i) => i.kind === 'decoy').length;
  const mentions = json.split('"decoy"').length - 1;
  if (mentions !== expected) {
    throw new Error(`${where}: "decoy" mentioned ${mentions}x, ${expected} accounted for by ${exposed.length} exposed`);
  }
}

/** Whole-payload checks: no layout-shaped field, no secret cell anywhere. */
function sweepRaidResponse(
  payload: unknown,
  layout: HarbourLayout,
  where: string,
  options: { allowLayout?: boolean } = {},
): void {
  const json = JSON.stringify(payload);
  const view = (payload as { view?: ViewLike }).view;

  if (!options.allowLayout) {
    for (const forbidden of ['"layout"', '"ships"', '"origin"', '"orientation"', '"arsenal"']) {
      if (json.includes(forbidden)) throw new Error(`${where}: a layout-shaped field (${forbidden}) reached the wire`);
    }

    // Public knowledge this same payload admits to; everything else must be
    // absent from the WHOLE frame, not just `view`.
    const publicKeys = new Set<string>(view ? Object.keys(view.marks ?? {}) : []);
    for (const sunk of view?.sunkShips ?? []) for (const cell of sunk.cells) publicKeys.add(key(cell));
    for (const item of view?.revealedItems ?? []) publicKeys.add(key(item.at));

    for (const ship of layout.ships) {
      for (const cell of cellsOf(ship)) {
        if (publicKeys.has(key(cell))) continue;
        for (const form of forms(cell)) {
          if (json.includes(form)) throw new Error(`${where}: leaked an un-hit cell ${key(cell)} via ${form}`);
        }
      }
    }
    for (const item of layout.arsenal) {
      if (!item.at) continue;
      if (item.revealed === true || item.destroyed === true || publicKeys.has(key(item.at))) continue;
      for (const form of forms(item.at)) {
        if (json.includes(form)) throw new Error(`${where}: leaked hidden ${item.kind} at ${key(item.at)} via ${form}`);
      }
    }
  } else if (view) {
    sweepView(JSON.stringify(view), layout, `${where} (view)`);
    return;
  }

  if (view) sweepView(JSON.stringify(view), layout, where);
}

// ---------------------------------------------------------------------------

async function http(method: 'GET' | 'POST', url: string, userId: string, body?: unknown) {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { payload: body }),
  });
}

beforeAll(async () => {
  t = await startTestDb(1);
  await app.ready();
}, 180_000);

afterAll(async () => {
  __setRaidRepoForTests(null);
  __setCityRepoForTests(null);
  await t?.close();
  await app.close();
});

beforeEach(async () => {
  process.env.PORT_CITY_RAIDS = '1';
  // Test-only tuning: enough shells for every path, and a rate limit that does
  // not turn a fast test into a reject-streak. The rules under test are
  // unchanged.
  process.env.RAID_SHELLS = '200';
  process.env.RAID_ACTIONS_PER_SECOND = '50';
  __setRaidRepoForTests(pgliteRepo(t));
  __setCityRepoForTests(cityRepo());
  __resetSessionsForTests();
  raidSeq = 0;

  await t.query(`delete from public.raid_lock`);
  await t.query(`delete from public.raid_log`);
  await t.query(`delete from public.raid`);
  await t.query(`delete from public.shield`);
  await t.query(`delete from public.renown`);
  await t.query(`delete from public.harbour`);
  await t.query(`delete from public.city`);
  await t.query(`delete from public.economy_ledger`);
  await t.query(`delete from public.city_request_log`);
  await t.query(`delete from public.profiles where id = any($1)`, [[A, D]]);
  await t.query(`delete from auth.users where id = any($1)`, [[A, D]]);
  await seedProfile(t, A, { coins: 5_000, steel: 5_000, rankPoints: 1_200 });
  await seedProfile(t, D, { coins: 5_000, steel: 5_000, rankPoints: 900 });
  // The SQL (`raid_search`, `raid_defender_snapshot`) reads public.city
  // directly, so the city rows must exist even though the routes read levels
  // through the injected repo.
  await seedCityRow(A);
  await seedCityRow(D);
  await t.query(
    `insert into public.renown (user_id, value, best) values ($1, 800, 800), ($2, 800, 800)`,
    [A, D],
  );
});

async function seedCityRow(userId: string): Promise<void> {
  const state = newCity(0) as unknown as Record<string, unknown>;
  const buildings = state.buildings as Record<string, Record<string, unknown>>;
  for (const id of ['admiralty', 'coastal_command', 'armory', 'lighthouse']) {
    buildings[id] = { ...(buildings[id] ?? {}), level: 5 };
  }
  await t.query(
    `insert into public.city (user_id, state) values ($1, $2)
       on conflict (user_id) do update set state = excluded.state, version = public.city.version + 1`,
    [userId, JSON.stringify(state)],
  );
}

afterEach(() => {
  delete process.env.PORT_CITY_RAIDS;
  delete process.env.RAID_SHELLS;
  delete process.env.RAID_ACTIONS_PER_SECOND;
  __resetSessionsForTests();
});

describe('raid secrecy sweep', () => {
  it('never lets the harbour out of search/open/action/status before it is over', async () => {
    const layout = harbourWithDecoy();
    expect(layout.arsenal.some((i) => i.kind === 'decoy'), 'the fuzz needs a decoy').toBe(true);
    expect(layout.arsenal.some((i) => i.kind === 'mine'), 'the fuzz needs a mine').toBe(true);

    // The defender saves (and may read) their own harbour: the one exception.
    const saved = await http('POST', '/raid/harbour', D, { layout });
    expect(saved.statusCode).toBe(200);
    const own = await http('GET', '/raid/harbour', D);
    expect(own.statusCode).toBe(200);
    expect(JSON.stringify(own.json())).toContain('"ships"'); // the documented exception

    // The attacker's own GET returns their own generated harbour — asserted to
    // be a different fleet from the defender's, so it is not a disguised leak.
    const mine = await http('GET', '/raid/harbour', A);
    expect(mine.statusCode).toBe(200);
    expect(JSON.stringify(mine.json().layout?.ships)).not.toBe(JSON.stringify(layout.ships));
    sweepRaidResponse(mine.json(), layout, 'attacker GET /raid/harbour', { allowLayout: true });

    // Search: a card, never a board.
    const searched = await http('POST', '/raid/search', A, { requestId: uuid(1), searchesThisSession: 0 });
    expect(searched.statusCode).toBe(200);
    const card = searched.json().card as { kind: string; userId: string | null };
    expect(card.kind).toBe('player');
    expect(card.userId).toBe(D);
    sweepRaidResponse(searched.json(), layout, 'search');

    const raidId = uuid(++raidSeq);
    const opened = await http('POST', '/raid/open', A, {
      requestId: uuid(100 + raidSeq),
      raidId,
      card: {
        ...card,
        coveSeed: null,
        name: 'Defender',
        avatarId: 0,
        avatarColor: 'violet',
        countryCode: null,
        admiraltyLevel: 5,
        renown: 800,
        loot: { coins: 0, steel: 0 },
        renownOffer: { best: 1, worst: -1 },
        costCoins: 50,
      },
      kit: {},
      dropShield: false,
    });
    expect(opened.statusCode).toBe(200);
    sweepRaidResponse(opened.json(), layout, 'open');

    const status = await http('GET', '/raid/status', A);
    expect(status.statusCode).toBe(200);
    expect(status.json().active).toBe(true);
    sweepRaidResponse(status.json(), layout, 'status');

    const replayWhileRunning = await http('GET', `/raid/replay/${raidId}`, A);
    expect(replayWhileRunning.statusCode).toBe(409);
    sweepRaidResponse(replayWhileRunning.json(), layout, 'replay while running');

    const firedCells = new Set<string>();
    const act = async (body: unknown, expected: (json: Record<string, any>) => boolean, where: string) => {
      await sleep(30); // well inside the raised test limit
      const response = await http('POST', '/raid/action', A, body);
      expect(response.statusCode, `${where} status`).toBe(200);
      const json = response.json();
      expect(expected(json), `${where} expectation: ${response.body}`).toBe(true);
      sweepRaidResponse(json, layout, where);
      const target = (body as { kind?: string; at?: Coord }).at;
      if ((body as { kind?: string }).kind === 'fire' && target && json.accepted === true) {
        firedCells.add(key(target));
      }
      return json;
    };

    // 1. A hit on the decoy is a plain HIT — nothing that could be a tell, and
    //    it must not be in revealedItems while unexposed. (Exposure itself is
    //    fuzzed in src/engine/raid/__tests__/secrecy.test.ts; here we keep it
    //    unexposed so the hidden-item assertion covers the whole run.)
    const decoy = layout.arsenal.find((i) => i.kind === 'decoy')!;
    const after = await act(
      { kind: 'fire', raidId, at: decoy.at },
      (json) => json.accepted === true,
      'fire at the decoy',
    );
    expect((after.events as { type: string }[]).map((e) => e.type)).toEqual(['HIT']);
    expect(after.view.marks[key(decoy.at!) ]).toBe('hit');
    expect(
      (after.view.revealedItems as { at: Coord }[]).some((i) => key(i.at) === key(decoy.at!)),
      'an unexposed decoy must not be in revealedItems',
    ).toBe(false);
    expect(
      Object.values(after.view.marks as Marks).filter((m) => m === 'decoy'),
      'a hit-but-unexposed decoy must not be marked as itself',
    ).toEqual([]);

    // 2. One illegal action still answers a masked view.
    const firstShip = cellsOf(layout.ships[0]!)[0]!;
    await act({ kind: 'fire', raidId, at: firstShip }, (json) => json.accepted === true, 'first ship cell');
    await act(
      { kind: 'fire', raidId, at: firstShip },
      (json) => json.accepted === false && json.rejected === 'illegal-cell',
      'repeat fire',
    );

    // 3. Clear the harbour, sweeping after every single shell. The mines are
    //    never fired at: they must stay undiscovered throughout.
    let lastAction: Record<string, any> = {};
    for (const ship of layout.ships) {
      for (const cell of cellsOf(ship)) {
        if (firedCells.has(key(cell))) continue;
        lastAction = await act({ kind: 'fire', raidId, at: cell }, (json) => json.accepted === true, `fire ${key(cell)}`);
      }
    }
    // The last shell cleared the harbour; `over` rides the action response.
    expect(lastAction.view.over).toBe(true);

    // 4. Settle: the full layout may finally appear — but the `view` in the
    //    same response must still hide every un-hit cell. (No /raid/status call
    //    first: its sweeper would settle opportunistically and drop the
    //    session, and we want to sweep settle itself.)
    const settled = await http('POST', '/raid/settle', A, { raidId });
    expect(settled.statusCode).toBe(200);
    const settledJson = settled.json();
    expect(settledJson.reveal?.ships?.length).toBe(layout.ships.length);
    sweepView(JSON.stringify(settledJson.view), layout, 'settle view');
    expect(JSON.stringify(settledJson).includes('"layout"')).toBe(false);

    // 5. The replay now carries the layout (it is over), and it has no second
    //    copy of the un-hit cells outside that reveal.
    const replay = await http('GET', `/raid/replay/${raidId}`, A);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().layout?.ships?.length).toBe(layout.ships.length);
    expect(replay.json().view).toBeUndefined();

    // 6. The defender's side: log, log/read, revenge — no layout anywhere.
    const log = await http('GET', '/raid/log', D);
    expect(log.statusCode).toBe(200);
    sweepRaidResponse(log.json(), layout, 'defence log');
    const read = await http('POST', '/raid/log/read', D, { raidIds: [raidId] });
    expect(read.statusCode).toBe(200);
    sweepRaidResponse(read.json(), layout, 'log read');
    const revenge = await http('POST', '/raid/revenge', D, { raidId });
    expect(revenge.statusCode).toBe(200);
    sweepRaidResponse(revenge.json(), layout, 'revenge');

    // 7. After settling, the attacker has no live session.
    const afterSettle = await http('GET', '/raid/status', A);
    expect(afterSettle.json()).toMatchObject({ active: false });
  }, 120_000);

  it('NEGATIVE CONTROL: the sweep fails on a tampered raid payload', () => {
    const layout = generateDefaultHarbour(1, CONTEXT);
    const hidden = cellsOf(layout.ships[0]!)[0]!;
    const fake = { view: { marks: {}, sunkShips: [{ id: 'x', class: 'boat', cells: [hidden] }] } };
    // A sunk ship's cells are public by construction, so this is NOT a leak...
    expect(() => sweepView(JSON.stringify(fake.view), layout, 'tampered')).not.toThrow();
    // ...but a bare layout field, or a secret cell outside the masked view, is.
    expect(() => sweepRaidResponse({ layout }, layout, 'tampered')).toThrow(/layout-shaped/);
    expect(() => sweepRaidResponse({ view: { marks: {} } }, layout, 'tampered')).not.toThrow();
    expect(() =>
      sweepRaidResponse({ view: { marks: {} }, anything: [hidden] }, layout, 'tampered'),
    ).toThrow(/leaked an un-hit cell/);
  });
});
