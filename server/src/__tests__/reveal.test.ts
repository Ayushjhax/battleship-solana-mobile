/**
 * The loser's post-match reveal (room.ts settleAndNotify, protocol.ts
 * `over.reveal`), over real sockets:
 *
 *   - the winner's final board goes to the LOSER, in the terminal `over`, and
 *     nowhere else: not to the winner, not in any earlier message;
 *   - it is the winner's actual board (a human's, or the server bot's own);
 *   - settlement still happens exactly once.
 */
import type { Board } from '@engine/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectClient,
  installAuthMock,
  installDbMock,
  KNOWN_LAYOUT,
  readyUpBoth,
  shipCellsOf,
  startTestServer,
  type DbCall,
  type TestClient,
  type TestServer,
} from './testUtils';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Any `reveal` key anywhere in a message, however deep. */
function mentionsReveal(message: unknown): boolean {
  return JSON.stringify(message).includes('"reveal"');
}

function beforeOver(history: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const end = history.findIndex((m) => m.t === 'over');
  return end === -1 ? [...history] : history.slice(0, end);
}

async function setUpMatch(server: TestServer): Promise<[TestClient, TestClient]> {
  const alice = await connectClient(server.port, 'alice');
  const bob = await connectClient(server.port, 'bob');
  alice.send({ t: 'queue', v: 1, mode: 'classic' });
  await alice.waitFor((m) => m.t === 'queued');
  bob.send({ t: 'queue', v: 1, mode: 'classic' });
  await bob.waitFor((m) => m.t === 'queued');
  await alice.waitFor((m) => m.t === 'matched');
  await bob.waitFor((m) => m.t === 'matched');
  await readyUpBoth(alice, bob);
  return [alice, bob];
}

describe('the winner’s board, to the loser, after the end', () => {
  let server: TestServer;
  let dbCalls: DbCall[];

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.SEABATTLE_TURN_TIMEOUT_MS;
    installAuthMock();
    dbCalls = installDbMock().calls;
    server = await startTestServer();
  });
  afterEach(async () => {
    await server.close();
  });

  it('a fleet win: only the loser’s `over` carries it, and it is the winner’s real board', async () => {
    const [alice, bob] = await setUpMatch(server);
    const turn = await alice.waitFor((m) => m.t === 'turn');
    const shooter = turn.playerId === 'alice' ? alice : bob;
    const loser = shooter === alice ? bob : alice;

    await sleep(1100); // the rate limit's window
    let seq = 0;
    for (const at of shipCellsOf(KNOWN_LAYOUT)) {
      shooter.send({ t: 'action', v: 1, seq: seq++, action: { type: 'FIRE', at } });
      await shooter.waitFor((m) => m.t === 'events');
      await sleep(110);
    }
    const winnerOver = await shooter.waitFor((m) => m.t === 'over');
    const loserOver = await loser.waitFor((m) => m.t === 'over');
    await sleep(50);

    expect(winnerOver.winnerId).toBe(shooter.playerId);
    expect(winnerOver).not.toHaveProperty('reveal');

    // The winner was never fired on here: every ship whole, where it was placed.
    const reveal = loserOver.reveal as Board;
    expect(reveal.ships).toEqual(KNOWN_LAYOUT.map((s) => ({ ...s, hits: [] })));
    expect(reveal.arsenal).toEqual([]);
    expect(reveal.marks).toEqual({});

    // Nothing before the end mentions it, on either side.
    for (const client of [alice, bob]) {
      expect(beforeOver(client.history()).some(mentionsReveal)).toBe(false);
    }
    // …and settlement still ran exactly once.
    expect(dbCalls.filter((c) => c.fn === 'applyMatchResult')).toHaveLength(1);

    alice.close();
    bob.close();
  });

  it('a resignation: the resigner sees the winner’s board, damage and all', async () => {
    const [alice, bob] = await setUpMatch(server);
    const turn = await alice.waitFor((m) => m.t === 'turn');
    await sleep(1100);
    // Bob lands one hit on Alice… or Alice on Bob — whoever holds the turn
    // fires at (0,0), a battleship cell on both boards.
    const first = turn.playerId === 'alice' ? alice : bob;
    first.send({ t: 'action', v: 1, seq: 1, action: { type: 'FIRE', at: { r: 0, c: 0 } } });
    await first.waitFor((m) => m.t === 'events');
    await sleep(110);

    alice.send({ t: 'resign', v: 1 });
    const aliceOver = await alice.waitFor((m) => m.t === 'over');
    const bobOver = await bob.waitFor((m) => m.t === 'over');

    expect(aliceOver.winnerId).toBe('bob');
    expect(bobOver).not.toHaveProperty('reveal');
    const reveal = aliceOver.reveal as Board;
    const battleship = reveal.ships.find((s) => s.id === 'battleship-1');
    // Bob's board shows Alice's shot only if Alice was the one who fired.
    expect(battleship?.hits).toEqual(first === alice ? [{ r: 0, c: 0 }] : []);
    expect(reveal.ships).toHaveLength(KNOWN_LAYOUT.length);

    alice.close();
    bob.close();
  });
});

describe('the server bot’s board, when the bot wins', () => {
  let server: TestServer;

  beforeEach(async () => {
    vi.resetModules();
    process.env.SEABATTLE_BOT_AFTER_MS = '40';
    process.env.SEABATTLE_SWEEP_INTERVAL_MS = '20';
    process.env.SEABATTLE_BOT_LAYOUT_DELAY_MS = '10';
    installAuthMock();
    installDbMock();
    server = await startTestServer();
  });
  afterEach(async () => {
    delete process.env.SEABATTLE_BOT_AFTER_MS;
    delete process.env.SEABATTLE_SWEEP_INTERVAL_MS;
    delete process.env.SEABATTLE_BOT_LAYOUT_DELAY_MS;
    await server.close();
  });

  it('is the bot’s actual layout, straight from the room', async () => {
    const human = await connectClient(server.port, 'carol');
    human.send({ t: 'queue', v: 1, mode: 'classic' });
    const matched = await human.waitFor((m) => m.t === 'matched', 5000);
    human.send({ t: 'ready', v: 1, layout: { ships: KNOWN_LAYOUT, arsenal: [] } });
    await human.waitFor((m) => m.t === 'events' && JSON.stringify(m).includes('MATCH_STARTED'), 5000);

    const { rooms } = await import('../room');
    const room = rooms.get(matched.matchId as string);
    const botBoard = room?.state.players.find((p) => p.id !== 'carol')?.board;
    expect(botBoard?.ships.length).toBeGreaterThan(0);

    await sleep(1100);
    human.send({ t: 'resign', v: 1 });
    const over = await human.waitFor((m) => m.t === 'over', 5000);
    expect(over.winnerId).not.toBe('carol');
    expect((over.reveal as Board).ships).toEqual(botBoard?.ships);

    human.close();
  });
});
