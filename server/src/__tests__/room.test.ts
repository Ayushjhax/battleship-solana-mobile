/**
 * Drives real sockets through a real server (auth + db mocked — see
 * testUtils.ts) covering every scenario room.ts and ws.ts promise:
 * a complete match, a turn timeout that forfeits, a disconnect that resumes
 * on reconnect, and an illegal action that is rejected without being applied
 * (five of them closing the socket, the cheating signal).
 *
 * Timers are shrunk per test via env vars room.ts/matchmaker.ts read once at
 * import time (see server/src/env.ts), so each test calls `vi.resetModules()`
 * and re-mocks before its own fresh dynamic import.
 */
import type { Coord } from '@engine/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectClient,
  installAuthMock,
  installDbMock,
  KNOWN_LAYOUT,
  type DbCall,
  readyUpBoth,
  reconnectClient,
  shipCellsOf,
  startTestServer,
  type TestClient,
  type TestServer,
} from './testUtils';

const OPPONENT_CELLS = shipCellsOf(KNOWN_LAYOUT);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whoever's turn it is fires straight through every known ship cell — every
 * shot a guaranteed hit, so the turn never passes until the fleet is sunk. */
async function playToVictory(
  alice: TestClient,
  bob: TestClient,
  cells: readonly Coord[] = OPPONENT_CELLS,
  startSeq = 0,
): Promise<Record<string, unknown>> {
  const turnMsg = await alice.waitFor((m) => m.t === 'turn');
  const shooterId = turnMsg.playerId as string;
  const shooter = shooterId === alice.playerId ? alice : bob;
  const other = shooter === alice ? bob : alice;

  // hello/queue/ready already count toward the shooter's 10 msg/s window
  // (the rate limit is on ALL inbound messages, correctly) — let those age
  // out before firing, so pacing shots at ~9/s doesn't trip on old traffic.
  await sleep(1100);

  // Paced well under the server's 10 msg/s rate limit — see ws.ts. A human
  // clicking through 20 shots wouldn't hit it either; a script firing them
  // back-to-back over a few milliseconds each legitimately would.
  let seq = startSeq;
  for (const at of cells) {
    shooter.send({ t: 'action', v: 1, seq: seq++, action: { type: 'FIRE', at } });
    const events = (await shooter.waitFor((m) => m.t === 'events')).events as { type: string }[];
    if (events.some((e) => e.type === 'REJECTED')) throw new Error(`unexpected rejection: ${JSON.stringify(events)}`);
    await sleep(110);
  }
  const over = await shooter.waitFor((m) => m.t === 'over');
  await other.waitFor((m) => m.t === 'over');
  return over;
}

async function setUpMatch(server: TestServer, a = 'alice', b = 'bob'): Promise<[TestClient, TestClient, string]> {
  const alice = await connectClient(server.port, a);
  const bob = await connectClient(server.port, b);
  alice.send({ t: 'queue', v: 1, mode: 'classic' });
  await alice.waitFor((m) => m.t === 'queued');
  bob.send({ t: 'queue', v: 1, mode: 'classic' });
  await bob.waitFor((m) => m.t === 'queued');
  const matched = await alice.waitFor((m) => m.t === 'matched');
  await bob.waitFor((m) => m.t === 'matched');
  await readyUpBoth(alice, bob);
  return [alice, bob, matched.matchId as string];
}

describe('a complete match', () => {
  let server: TestServer;
  let dbCalls: DbCall[];

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.SEABATTLE_TURN_TIMEOUT_MS;
    delete process.env.SEABATTLE_DISCONNECT_GRACE_MS;
    installAuthMock();
    dbCalls = installDbMock().calls;
    server = await startTestServer();
  });

  it('plays from queue to game over with no desync', async () => {
    const [alice, bob, matchId] = await setUpMatch(server);
    const over = await playToVictory(alice, bob);

    expect(over.reason).toBe('fleet');
    expect(['alice', 'bob']).toContain(over.winnerId);
    expect(over.rewards).toEqual({ points: 25, coins: 50 });

    // Settled once, in one transaction, with the engine's reward table.
    const settled = dbCalls.filter((c) => c.fn === 'applyMatchResult');
    expect(settled).toHaveLength(1);
    expect(settled[0]?.args).toEqual([
      matchId,
      over.winnerId,
      'victory',
      { win: { points: 25, coins: 50 }, loss: { points: 5, coins: 10 } },
    ]);

    const { rooms } = await import('../room');
    expect(rooms.size).toBe(0); // the room cleans itself up on finish

    alice.close();
    bob.close();
    await server.close();
  });

  it('rejects a shot out of turn without applying it, and a repeat shot', async () => {
    const [alice, bob] = await setUpMatch(server);
    const turnMsg = await alice.waitFor((m) => m.t === 'turn');
    const shooter = turnMsg.playerId === 'alice' ? alice : bob;
    const bystander = shooter === alice ? bob : alice;

    bystander.send({ t: 'action', v: 1, seq: 0, action: { type: 'FIRE', at: { r: 9, c: 9 } } });
    const err = await bystander.waitFor((m) => m.t === 'error');
    expect(err.code).toBe('illegal_action');

    // The legitimate shooter can still act normally afterwards — state was untouched.
    const firstCell = OPPONENT_CELLS[0]!;
    shooter.send({ t: 'action', v: 1, seq: 0, action: { type: 'FIRE', at: firstCell } });
    const hitEvents = await shooter.waitFor((m) => m.t === 'events');
    expect((hitEvents.events as { type: string }[])[0]?.type).toBe('HIT');

    // Firing the same cell again is illegal too (already shot).
    shooter.send({ t: 'action', v: 1, seq: 1, action: { type: 'FIRE', at: firstCell } });
    const err2 = await shooter.waitFor((m) => m.t === 'error');
    expect(err2.code).toBe('illegal_action');

    alice.close();
    bob.close();
    await server.close();
  });

  it('disconnects the socket after five illegal messages — the cheating signal', async () => {
    const [alice, bob] = await setUpMatch(server);
    const turnMsg = await alice.waitFor((m) => m.t === 'turn');
    const bystander = turnMsg.playerId === 'alice' ? bob : alice;

    const closed = new Promise<void>((resolve) => bystander.raw().once('close', resolve));
    for (let i = 0; i < 5; i++) {
      bystander.send({ t: 'action', v: 1, seq: i, action: { type: 'FIRE', at: { r: 9, c: 9 } } });
    }
    await closed;
    expect(bystander.raw().readyState).not.toBe(bystander.raw().OPEN);

    alice.close();
    bob.close();
    await server.close();
  });
});

describe('pre-game wager cancellation', () => {
  it('refunds both holds and removes a matched room before either fleet is ready', async () => {
    vi.resetModules();
    installAuthMock();
    const dbCalls = installDbMock().calls;
    const server = await startTestServer();
    const alice = await connectClient(server.port, 'alice');
    const bob = await connectClient(server.port, 'bob');

    alice.send({
      t: 'queue',
      v: 1,
      mode: 'classic',
      wagered: true,
      opponent: 'player',
      wagerRequestId: '11111111-1111-4111-8111-111111111111',
    });
    await alice.waitFor((message) => message.t === 'queued');
    bob.send({
      t: 'queue',
      v: 1,
      mode: 'classic',
      wagered: true,
      opponent: 'player',
      wagerRequestId: '22222222-2222-4222-8222-222222222222',
    });
    await bob.waitFor((message) => message.t === 'queued');
    await alice.waitFor((message) => message.t === 'matched');
    await bob.waitFor((message) => message.t === 'matched');

    alice.send({ t: 'cancelQueue', v: 1 });
    const mine = await alice.waitFor((message) => message.t === 'queue:cancelled');
    const theirs = await bob.waitFor((message) => message.t === 'queue:cancelled');

    expect(mine).toMatchObject({ refunded: true, reason: 'cancelled', pointBalance: 100 });
    expect(theirs).toMatchObject({ refunded: true, reason: 'opponent_cancelled', pointBalance: 100 });
    expect(dbCalls.filter((call) => call.fn === 'cancelWageredMatchBeforeStart')).toHaveLength(1);
    const { rooms } = await import('../room');
    expect(rooms.size).toBe(0);

    alice.close();
    bob.close();
    await server.close();
  });
});

describe('a wagered match played to the end', () => {
  it('tells the winner they won 100 and the loser they lost their stake', async () => {
    vi.resetModules();
    delete process.env.SEABATTLE_TURN_TIMEOUT_MS;
    installAuthMock();
    const dbCalls = installDbMock().calls;
    const server = await startTestServer();
    const alice = await connectClient(server.port, 'alice');
    const bob = await connectClient(server.port, 'bob');

    alice.send({
      t: 'queue',
      v: 1,
      mode: 'classic',
      wagered: true,
      opponent: 'player',
      wagerRequestId: '11111111-1111-4111-8111-111111111111',
    });
    await alice.waitFor((m) => m.t === 'queued');
    bob.send({
      t: 'queue',
      v: 1,
      mode: 'classic',
      wagered: true,
      opponent: 'player',
      wagerRequestId: '22222222-2222-4222-8222-222222222222',
    });
    await bob.waitFor((m) => m.t === 'queued');

    // Both sides are told this is a 50-point wager before they place.
    const matched = await alice.waitFor((m) => m.t === 'matched');
    const theirMatched = await bob.waitFor((m) => m.t === 'matched');
    expect(matched).toMatchObject({ wagered: true, wagerStake: 50 });
    expect(theirMatched).toMatchObject({ wagered: true, wagerStake: 50 });

    await readyUpBoth(alice, bob);
    await playToVictory(alice, bob);

    // Each client's own `over` frame: same winner, opposite verdicts.
    const overs = await Promise.all([
      alice.waitFor((m) => m.t === 'over', 100).catch(() => null),
      bob.waitFor((m) => m.t === 'over', 100).catch(() => null),
    ]);
    const seen = [
      (overs[0] ?? alice.history().find((m) => m.t === 'over')) as Record<string, unknown>,
      (overs[1] ?? bob.history().find((m) => m.t === 'over')) as Record<string, unknown>,
    ];
    const winnerId = seen[0]?.winnerId as string;
    expect(['alice', 'bob']).toContain(winnerId);
    expect(seen[1]?.winnerId).toBe(winnerId);

    for (const [index, name] of ['alice', 'bob'].entries()) {
      const over = seen[index] as Record<string, unknown>;
      const won = name === winnerId;
      // 50 in, 100 back on a win for a net +50; nothing back on a loss.
      expect(over.wager).toEqual({ stake: 50, prize: won ? 100 : 0, balance: 100 });
      expect(over.rewards).toEqual(won ? { points: 25, coins: 50 } : { points: 5, coins: 10 });
    }

    // One settlement, one transaction — the pot cannot be paid twice.
    expect(dbCalls.filter((call) => call.fn === 'applyMatchResult')).toHaveLength(1);

    alice.close();
    bob.close();
    await server.close();
  }, 30000);
});

describe('turn timeout', () => {
  let server: TestServer;

  beforeEach(async () => {
    vi.resetModules();
    process.env.SEABATTLE_TURN_TIMEOUT_MS = '60';
    installAuthMock();
    installDbMock();
    server = await startTestServer();
  });

  it('two consecutive silent turns forfeit the match', async () => {
    const [alice, bob] = await setUpMatch(server);

    // Neither player ever fires: X times out, turn passes to Y, Y times out
    // (Y's own first, streak resets X's to zero for a moment — no, X hasn't
    // acted either, so X's NEXT timeout is X's second in a row) -> forfeit.
    const timeouts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const msg = await alice.waitFor((m) => m.t === 'events' || m.t === 'over', 2000);
      if (msg.t === 'over') {
        expect(msg.reason).toBe('forfeit');
        expect(['alice', 'bob']).toContain(msg.winnerId);
        alice.close();
        bob.close();
        await server.close();
        return;
      }
      const events = msg.events as { type: string; consecutive?: number }[];
      for (const e of events) if (e.type === 'TIMEOUT') timeouts.push(e.consecutive ?? 0);
    }
    throw new Error(`match never forfeited; saw timeouts: ${timeouts.join(',')}`);
  });

});

describe('disconnect and reconnect', () => {
  let server: TestServer;

  beforeEach(async () => {
    vi.resetModules();
    process.env.SEABATTLE_DISCONNECT_GRACE_MS = '400';
    delete process.env.SEABATTLE_TURN_TIMEOUT_MS;
    installAuthMock();
    installDbMock();
    server = await startTestServer();
  });

  it('resumes with correct state when the reconnect lands inside the grace period', async () => {
    const [alice, bob, matchId] = await setUpMatch(server);
    const turnMsg = await alice.waitFor((m) => m.t === 'turn');
    const shooter = turnMsg.playerId === 'alice' ? alice : bob;
    const shooterId = shooter.playerId;

    // One confirmed hit before the "crash", so we can assert it survived.
    const firstCell = OPPONENT_CELLS[0]!;
    shooter.send({ t: 'action', v: 1, seq: 0, action: { type: 'FIRE', at: firstCell } });
    await shooter.waitFor((m) => m.t === 'events');

    const other = shooter === alice ? bob : alice;
    // Kill the shooter's socket mid-match.
    shooter.raw().terminate();
    await other.waitFor((m) => m.t === 'state' && m.opponentDisconnected === true, 2000);

    // Reconnect well inside the 400ms grace period.
    const resumed = await reconnectClient(server.port, shooterId, matchId);
    const state = await resumed.waitFor((m) => m.t === 'state');
    const view = state.view as { enemy: { marks: Record<string, string> } };
    expect(view.enemy.marks[`${firstCell.r},${firstCell.c}`]).toBe('hit'); // the pre-crash shot survived
    expect(state.opponentDisconnected).toBeUndefined();

    // The room is still alive and playable — finish it off. Cell 0 and seq 0
    // are already spent from the pre-crash shot; pick up where they left off.
    const over = await playToVictory(resumed, other, OPPONENT_CELLS.slice(1), 1);
    expect(over.reason).toBe('fleet');

    resumed.close();
    other.close();
    await server.close();
  });

  it('awards the win to the other player if nobody reconnects before the grace period ends', async () => {
    const [alice, bob] = await setUpMatch(server);
    const turnMsg = await alice.waitFor((m) => m.t === 'turn');
    const shooter = turnMsg.playerId === 'alice' ? alice : bob;
    const other = shooter === alice ? bob : alice;

    shooter.raw().terminate();
    const over = await other.waitFor((m) => m.t === 'over', 3000);
    expect(over.winnerId).toBe(other.playerId);
    expect(over.reason).toBe('resign'); // the engine's vocabulary; the DB row says 'disconnect'

    other.close();
    await server.close();
  });
});
