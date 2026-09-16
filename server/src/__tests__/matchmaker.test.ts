/**
 * Matchmaking under load, over real sockets.
 *
 * The properties that matter when a crowd hits "Play online" at once: every
 * player is seated exactly once, nobody is seated twice, nobody is seated
 * against themselves, and an odd player waits rather than being double-booked.
 * The pairing pass removes both entries synchronously and is non-reentrant per
 * queue, which is what makes those hold while a room build is awaiting.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectClient,
  type DbCall,
  installAuthMock,
  installDbMock,
  startTestServer,
  type TestClient,
  type TestServer,
} from './testUtils';

interface Seated {
  readonly playerId: string;
  readonly matchId: string;
  readonly opponentId: string;
}

/** Connects `count` players and has them all queue without awaiting between. */
async function stampede(server: TestServer, count: number, prefix = 'p'): Promise<TestClient[]> {
  const clients = await Promise.all(
    Array.from({ length: count }, (_, i) => connectClient(server.port, `${prefix}${i}`)),
  );
  // No await between sends: every `queue` lands before any of them resolves,
  // which is the interleaving a real crowd produces.
  for (const client of clients) client.send({ t: 'queue', v: 1, mode: 'classic' });
  return clients;
}

async function seatOf(client: TestClient, timeoutMs: number): Promise<Seated | null> {
  try {
    const matched = await client.waitFor((m) => m.t === 'matched', timeoutMs);
    return {
      playerId: client.playerId,
      matchId: matched.matchId as string,
      opponentId: (matched.opponent as { id: string }).id,
    };
  } catch {
    return null;
  }
}

function assertWellFormed(seats: readonly Seated[]): void {
  const byMatch = new Map<string, Seated[]>();
  for (const seat of seats) {
    // Nobody plays themselves.
    expect(seat.opponentId).not.toBe(seat.playerId);
    byMatch.set(seat.matchId, [...(byMatch.get(seat.matchId) ?? []), seat]);
  }
  for (const [matchId, pair] of byMatch) {
    // Exactly two seats per match — never three players sharing one room.
    expect(`${matchId}:${pair.length}`).toBe(`${matchId}:2`);
    const [a, b] = pair as [Seated, Seated];
    expect(a.opponentId).toBe(b.playerId);
    expect(b.opponentId).toBe(a.playerId);
  }
  // Every player appears once across all matches.
  expect(new Set(seats.map((s) => s.playerId)).size).toBe(seats.length);
}

/** Connects one player and puts them in line with the options they chose. */
async function queueUp(
  server: TestServer,
  playerId: string,
  options: { wagered?: boolean; mode?: 'classic' | 'advanced' } = {},
): Promise<TestClient> {
  const client = await connectClient(server.port, playerId);
  const wagered = options.wagered ?? false;
  client.send({
    t: 'queue',
    v: 1,
    mode: options.mode ?? 'classic',
    wagered,
    opponent: 'player',
    ...(wagered ? { wagerRequestId: randomUUID() } : {}),
  });
  return client;
}

describe('matchmaking under concurrency', () => {
  let dbCalls: DbCall[];

  beforeEach(() => {
    vi.resetModules();
    installAuthMock();
    dbCalls = installDbMock().calls;
  });

  it('seats ten simultaneous players as five clean matches', async () => {
    const server = await startTestServer();
    const clients = await stampede(server, 10);

    const seats = (await Promise.all(clients.map((c) => seatOf(c, 8000)))).filter(
      (s): s is Seated => s !== null,
    );

    expect(seats).toHaveLength(10);
    expect(new Set(seats.map((s) => s.matchId)).size).toBe(5);
    assertWellFormed(seats);

    for (const client of clients) client.close();
    await server.close();
  }, 20000);

  it('leaves exactly one of eleven waiting instead of double-booking anyone', async () => {
    const server = await startTestServer();
    const clients = await stampede(server, 11);

    const results = await Promise.all(clients.map((c) => seatOf(c, 4000)));
    const seats = results.filter((s): s is Seated => s !== null);

    // Five pairs seated; the eleventh stays in line for a real opponent.
    expect(seats).toHaveLength(10);
    expect(results.filter((s) => s === null)).toHaveLength(1);
    expect(new Set(seats.map((s) => s.matchId)).size).toBe(5);
    assertWellFormed(seats);

    for (const client of clients) client.close();
    await server.close();
  }, 20000);

  it('refuses a second queue for an account already in line', async () => {
    const server = await startTestServer();
    const first = await connectClient(server.port, 'twice');
    const second = await connectClient(server.port, 'twice');

    // Two sockets for one account, queueing in the same tick: without the
    // in-flight guard both could clear the "already queued" check while the
    // profile read was still pending, and be seated against each other.
    first.send({ t: 'queue', v: 1, mode: 'classic' });
    second.send({ t: 'queue', v: 1, mode: 'classic' });

    const outcomes = await Promise.all([
      first.waitFor((m) => m.t === 'queued' || m.t === 'error', 5000),
      second.waitFor((m) => m.t === 'queued' || m.t === 'error', 5000),
    ]);
    const queued = outcomes.filter((m) => m.t === 'queued');
    const refused = outcomes.filter((m) => m.t === 'error');

    expect(queued).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.code).toBe('already_queued');
    // And no match was conjured out of the one account.
    await expect(first.waitFor((m) => m.t === 'matched', 600)).rejects.toThrow();

    first.close();
    second.close();
    await server.close();
  }, 20000);

  it('never seats a wagered captain against an unwagered one', async () => {
    const server = await startTestServer();
    const staked = await queueUp(server, 'staked', { wagered: true });
    const free = await queueUp(server, 'free', { wagered: false });

    // Both are in line, in the same ruleset, at the same rank — the only thing
    // keeping them apart is the wager, and it has to be enough.
    await staked.waitFor((m) => m.t === 'queued', 5000);
    await free.waitFor((m) => m.t === 'queued', 5000);
    await expect(staked.waitFor((m) => m.t === 'matched', 1500)).rejects.toThrow();
    expect(free.history().some((m) => m.t === 'matched')).toBe(false);

    staked.close();
    free.close();
    await server.close();
  }, 20000);

  it('seats wagered captains with each other, as a wagered match', async () => {
    const server = await startTestServer();
    const a = await queueUp(server, 'stake-a', { wagered: true });
    const b = await queueUp(server, 'stake-b', { wagered: true });

    const matched = await a.waitFor((m) => m.t === 'matched', 8000);
    await b.waitFor((m) => m.t === 'matched', 8000);
    expect(matched).toMatchObject({ wagered: true, wagerStake: 50 });

    // The room was created through the wagered path, with both holds.
    expect(dbCalls.filter((c) => c.fn === 'insertMatch')).toHaveLength(0);
    const wagered = dbCalls.filter((c) => c.fn === 'insertWageredMatch');
    expect(wagered).toHaveLength(1);
    expect(wagered[0]?.args[1]).toMatchObject({ profileId: 'stake-a' });
    expect(wagered[0]?.args[2]).toMatchObject({ profileId: 'stake-b' });

    a.close();
    b.close();
    await server.close();
  }, 20000);

  it('seats unwagered captains with each other, as a plain match', async () => {
    const server = await startTestServer();
    const a = await queueUp(server, 'plain-a', { wagered: false });
    const b = await queueUp(server, 'plain-b', { wagered: false });

    const matched = await a.waitFor((m) => m.t === 'matched', 8000);
    await b.waitFor((m) => m.t === 'matched', 8000);
    expect(matched).toMatchObject({ wagered: false, wagerStake: 0 });
    expect(dbCalls.filter((c) => c.fn === 'insertWageredMatch')).toHaveLength(0);
    expect(dbCalls.filter((c) => c.fn === 'insertMatch')).toHaveLength(1);

    a.close();
    b.close();
    await server.close();
  }, 20000);

  it('keeps the rulesets apart on the same axis', async () => {
    const server = await startTestServer();
    const classic = await queueUp(server, 'classic-only', { mode: 'classic' });
    const advanced = await queueUp(server, 'advanced-only', { mode: 'advanced' });

    await classic.waitFor((m) => m.t === 'queued', 5000);
    await advanced.waitFor((m) => m.t === 'queued', 5000);
    await expect(classic.waitFor((m) => m.t === 'matched', 1500)).rejects.toThrow();
    expect(advanced.history().some((m) => m.t === 'matched')).toBe(false);

    classic.close();
    advanced.close();
    await server.close();
  }, 20000);

  it('splits a mixed crowd into wagered and unwagered matches, never across', async () => {
    const server = await startTestServer();
    const staked = await Promise.all(
      [0, 1, 2].map((n) => queueUp(server, `w${n}`, { wagered: true })),
    );
    const free = await Promise.all(
      [0, 1, 2].map((n) => queueUp(server, `n${n}`, { wagered: false })),
    );
    const all = [...staked, ...free];
    const isStaked = (playerId: string) => playerId.startsWith('w');

    const seats = (
      await Promise.all(
        all.map(async (client) => {
          try {
            const m = await client.waitFor((msg) => msg.t === 'matched', 4000);
            return {
              playerId: client.playerId,
              matchId: m.matchId as string,
              opponentId: (m.opponent as { id: string }).id,
              wagered: m.wagered as boolean,
            };
          } catch {
            return null;
          }
        }),
      )
    ).filter((s): s is NonNullable<typeof s> => s !== null);

    // Three of each means one pair per side, and one of each left in line.
    expect(seats).toHaveLength(4);
    expect(new Set(seats.map((s) => s.matchId)).size).toBe(2);
    for (const seat of seats) {
      expect(isStaked(seat.opponentId)).toBe(isStaked(seat.playerId));
      expect(seat.wagered).toBe(isStaked(seat.playerId));
    }
    expect(seats.filter((s) => s.wagered)).toHaveLength(2);
    expect(seats.filter((s) => !s.wagered)).toHaveLength(2);

    for (const client of all) client.close();
    await server.close();
  }, 25000);

  it('does not strand a player who leaves while their queue is being processed', async () => {
    const server = await startTestServer();
    const leaver = await connectClient(server.port, 'leaver');
    leaver.send({ t: 'queue', v: 1, mode: 'classic' });
    leaver.close();
    // The close cleanup and the enqueue race; whichever order they land in,
    // the queue must not keep a dead socket that a later player pairs with.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const survivor = await connectClient(server.port, 'survivor');
    survivor.send({ t: 'queue', v: 1, mode: 'classic' });
    await survivor.waitFor((m) => m.t === 'queued', 5000);
    await expect(survivor.waitFor((m) => m.t === 'matched', 800)).rejects.toThrow();

    survivor.close();
    await server.close();
  }, 20000);
});
