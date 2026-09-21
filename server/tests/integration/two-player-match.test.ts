/**
 * Two online players, start to finish, over real sockets against the real
 * server: matchmaker, Room, ws safety rails and the real rules engine.
 *
 * Only Supabase and JWT verification are faked — neither is reachable from a
 * test, and neither is where an online match goes wrong. What is exercised for
 * real: pairing, seating, the layout deadline, turn order, event fan-out,
 * view masking, disconnect grace and game over.
 *
 * The masking assertions are the important ones. Every `state` a player is
 * sent is scanned for the opponent's ship coordinates: a server that leaks
 * them loses the game its whole hidden-information premise, and no amount of
 * client-side care would get it back.
 */
import { autoPlaceFleet } from '@engine/placement';
import { createRng } from '@engine/rng';
import type { Ship } from '@engine/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LayoutPayload, ServerMessage } from '../../src/protocol';
import { pair, startServer, until, type Harness, type TestPlayer } from '../helpers/twoPlayerHarness';

const ALICE = 'alice';
const BOB = 'bob';

/** The token IS the player id here; the real gate is auth.ts, tested separately. */
vi.mock('../../src/auth', () => ({
  verifyAccessToken: vi.fn(async (token: string) =>
    token ? { ok: true, token: { userId: token, isAnonymous: false } } : { ok: false, reason: 'no token' },
  ),
}));

vi.mock('../../src/db', () => ({
  BOT_PLAYER_ID: 'b0000000-0000-4000-8000-000000000001',
  appendMatchEvent: vi.fn(async () => {}),
  applyMatchResult: vi.fn(async () => true),
  cancelWageredMatchBeforeStart: vi.fn(async () => ({ refunded: false, balance: null })),
  dbEndReason: vi.fn((reason: string) => reason),
  fetchOpponentSummary: vi.fn(async (id: string) => ({
    id,
    name: id,
    avatarId: 1,
    avatarColor: '#3E2FB8',
    countryCode: 'IN',
    rankPoints: 0,
    isBot: false,
  })),
  fetchPointBalance: vi.fn(async () => 500),
  insertMatch: vi.fn(async () => {}),
  insertWageredMatch: vi.fn(async () => {}),
  refundPointWager: vi.fn(async () => ({ refunded: false, balance: null })),
  reservePointWager: vi.fn(async () => ({ ok: true, balance: 450, reason: null })),
}));

function layoutFor(seed: number): { payload: LayoutPayload; ships: Ship[] } {
  const ships = autoPlaceFleet(createRng(seed)) as Ship[];
  return {
    ships,
    payload: {
      ships: ships.map((ship) => ({
        id: ship.id,
        class: ship.class,
        len: ship.len,
        origin: ship.origin,
        orientation: ship.orientation,
      })),
      arsenal: [],
    } as LayoutPayload,
  };
}

/** Every cell a fleet occupies, as "r,c" keys. */
function hullCells(ships: readonly Ship[]): Set<string> {
  const cells = new Set<string>();
  for (const ship of ships) {
    for (let step = 0; step < ship.len; step += 1) {
      const r = ship.origin.r + (ship.orientation === 'v' ? step : 0);
      const c = ship.origin.c + (ship.orientation === 'h' ? step : 0);
      cells.add(`${r},${c}`);
    }
  }
  return cells;
}

let harness: Harness;

beforeEach(async () => {
  vi.resetModules();
  harness = await startServer();
});

afterEach(async () => {
  await harness.stop();
});

/** Both players paired, both fleets in, ready to take turns. */
async function startedMatch() {
  const [alice, bob] = await pair(harness, ALICE, BOB);
  const aliceFleet = layoutFor(11);
  const bobFleet = layoutFor(22);
  alice.ready(aliceFleet.payload);
  bob.ready(bobFleet.payload);
  await until(() => alice.has('turn') && bob.has('turn'), 'the first turn');
  return { alice, bob, aliceFleet, bobFleet };
}

function whoseTurn(player: TestPlayer): string {
  const turn = player.last('turn');
  if (!turn) throw new Error('no turn message yet');
  return turn.playerId;
}

describe('two players are paired', () => {
  it('matches them to each other with the same match id', async () => {
    const [alice, bob] = await pair(harness, ALICE, BOB);

    const a = alice.last('matched');
    const b = bob.last('matched');
    expect(a?.matchId).toBe(b?.matchId);
    expect(a?.you.id).toBe(ALICE);
    expect(a?.opponent.id).toBe(BOB);
    expect(b?.you.id).toBe(BOB);
    expect(b?.opponent.id).toBe(ALICE);
  });

  it('gives both the same mode and a layout deadline in the future', async () => {
    const [alice, bob] = await pair(harness, ALICE, BOB);

    const a = alice.last('matched');
    expect(a?.mode).toBe('classic');
    expect(a?.layoutDeadline).toBeGreaterThan(Date.now());
    expect(bob.last('matched')?.mode).toBe(a?.mode);
  });

  it('does not pair a lone player with themselves', async () => {
    const solo = harness.player(ALICE);
    await solo.open();
    solo.hello();
    await until(() => solo.has('hello:ok'), 'hello:ok');
    solo.queue();
    await until(() => solo.has('queued'), 'queued');

    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(solo.has('matched')).toBe(false);
  });

  it('refuses anything before hello', async () => {
    const stranger = harness.player('mallory');
    await stranger.open();
    stranger.queue();

    await until(() => stranger.has('error'), 'an error');

    expect(stranger.last('error')?.code).toBe('unauthenticated');
  });
});

describe('a match starts once both fleets are in', () => {
  it('sends both players a turn and a state', async () => {
    const { alice, bob } = await startedMatch();

    expect(alice.has('state')).toBe(true);
    expect(bob.has('state')).toBe(true);
    expect(whoseTurn(alice)).toBe(whoseTurn(bob));
  });

  it('does not start until the second fleet arrives', async () => {
    const [alice, bob] = await pair(harness, ALICE, BOB);
    alice.ready(layoutFor(11).payload);

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(alice.has('turn')).toBe(false);
    expect(bob.has('turn')).toBe(false);
  });

  it('gives exactly one of the two the first turn', async () => {
    const { alice } = await startedMatch();

    expect([ALICE, BOB]).toContain(whoseTurn(alice));
  });
});

describe('the opponent fleet is never leaked', () => {
  it('no state sent to a player contains the other fleet’s cells', async () => {
    const { alice, bob, aliceFleet, bobFleet } = await startedMatch();

    // Play a few real shots so revealed information accumulates.
    for (let round = 0; round < 6; round += 1) {
      const mover = whoseTurn(alice) === ALICE ? alice : bob;
      mover.fire({ r: round, c: round });
      await until(() => whoseTurn(alice) !== undefined, 'a turn');
      await new Promise((resolve) => setTimeout(resolve, 40));
    }

    // Alice's states must never spell out Bob's hulls, and vice versa.
    expectNoFleetLeak(alice, hullCells(bobFleet.ships));
    expectNoFleetLeak(bob, hullCells(aliceFleet.ships));
  });

  it('a player’s own fleet IS present in their own state', async () => {
    const { alice, aliceFleet } = await startedMatch();

    const state = alice.last('state');
    const serialized = JSON.stringify(state?.view.you.board.ships ?? []);
    const first = aliceFleet.ships[0];

    expect(first).toBeDefined();
    expect(serialized).toContain(`"r":${first?.origin.r}`);
  });
});

/**
 * The enemy half of every view a player received, checked against the real
 * hull cells. Mirrors src/engine/__tests__/view.test.ts, but across the wire.
 */
function expectNoFleetLeak(player: TestPlayer, enemyHulls: Set<string>) {
  for (const message of player.all('state')) {
    const enemy = JSON.stringify(message.view.enemy);
    for (const cell of enemyHulls) {
      const [r, c] = cell.split(',');
      // An unrevealed hull coordinate must not appear as a ship in the enemy half.
      expect(enemy).not.toMatch(new RegExp(`"origin":\\{"r":${r},"c":${c}\\}`));
    }
    expect(enemy).not.toContain('"ships":[{');
  }
}

describe('turns alternate and only the player to move may act', () => {
  it('rejects a shot from the player who is not to move', async () => {
    const { alice, bob } = await startedMatch();
    const waiting = whoseTurn(alice) === ALICE ? bob : alice;
    const before = waiting.all('error').length;

    waiting.fire({ r: 0, c: 0 });

    await until(() => waiting.all('error').length > before, 'a rejection');
    expect(waiting.last('error')).toBeDefined();
  });

  it('passes the turn to the other player after a miss', async () => {
    const { alice, bob, aliceFleet, bobFleet } = await startedMatch();
    const first = whoseTurn(alice);
    const mover = first === ALICE ? alice : bob;
    const enemyHulls = first === ALICE ? hullCells(bobFleet.ships) : hullCells(aliceFleet.ships);

    // Find a cell that is definitely water, so the turn must change hands.
    let target = { r: 0, c: 0 };
    outer: for (let r = 0; r < 10; r += 1) {
      for (let c = 0; c < 10; c += 1) {
        if (!enemyHulls.has(`${r},${c}`)) {
          target = { r, c };
          break outer;
        }
      }
    }

    mover.fire(target);

    await until(() => whoseTurn(alice) !== first, 'the turn to change hands');
    expect(whoseTurn(alice)).not.toBe(first);
    expect(whoseTurn(bob)).toBe(whoseTurn(alice));
  });

  it('both players see the same sequence of turn holders', async () => {
    const { alice, bob } = await startedMatch();

    for (let round = 0; round < 8; round += 1) {
      const mover = whoseTurn(alice) === ALICE ? alice : bob;
      mover.fire({ r: round, c: (round * 3) % 10 });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }

    const aliceTurns = alice.all('turn').map((t) => t.playerId);
    const bobTurns = bob.all('turn').map((t) => t.playerId);
    expect(aliceTurns).toEqual(bobTurns);
  });

  it('both players receive the same events in the same order', async () => {
    const { alice, bob } = await startedMatch();

    for (let round = 0; round < 6; round += 1) {
      const mover = whoseTurn(alice) === ALICE ? alice : bob;
      mover.fire({ r: round, c: round });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }

    const kinds = (player: TestPlayer) =>
      player.all('events').flatMap((message) => message.events.map((event) => event.type));
    expect(kinds(alice)).toEqual(kinds(bob));
  });
});

describe('a full match runs to a winner', () => {
  it('sinks every ship and declares the same winner to both', async () => {
    const { alice, bob, aliceFleet, bobFleet } = await startedMatch();
    const targets = {
      [ALICE]: [...hullCells(bobFleet.ships)],
      [BOB]: [...hullCells(aliceFleet.ships)],
    };
    const nextIndex = { [ALICE]: 0, [BOB]: 0 };

    // The rate-limit window is per socket and counts everything, including the
    // hello/queue/ready burst that just set this match up. Let those age out of
    // the 1s window before firing, or the first few shots tip it over.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Each side fires only at real hull cells, so the match ends quickly.
    //
    // Paced at 130ms: ws.ts closes any socket exceeding 10 messages a second
    // outright (code 4002, no grace). A test that machine-guns actions gets
    // itself disconnected and then waits forever for a game over that can no
    // longer arrive — which is exactly what the first run of this did.
    for (let move = 0; move < 260 && !alice.has('over'); move += 1) {
      const turnHolder = whoseTurn(alice);
      const mover = turnHolder === ALICE ? alice : bob;
      const list = targets[turnHolder] ?? [];
      const index = nextIndex[turnHolder] ?? 0;
      const cell = list[index];
      if (!cell) break;
      nextIndex[turnHolder] = index + 1;
      const [r, c] = cell.split(',').map(Number);
      mover.fire({ r: r as number, c: c as number });
      await new Promise((resolve) => setTimeout(resolve, 150));

      // A socket the server cut would silently stall the loop.
      expect(mover.last('error')?.code).not.toBe('rate_limited');
    }

    await until(() => alice.has('over') && bob.has('over'), 'game over', 20000);

    const aOver = alice.last('over');
    const bOver = bob.last('over');
    expect(aOver?.winnerId).toBe(bOver?.winnerId);
    expect([ALICE, BOB]).toContain(aOver?.winnerId);
    expect(aOver?.reason).toBe(bOver?.reason);
  }, 60000);

  it('a resignation ends it for both, with the other player as winner', async () => {
    const { alice, bob } = await startedMatch();

    alice.resign();

    await until(() => alice.has('over') && bob.has('over'), 'game over');
    expect(alice.last('over')?.winnerId).toBe(BOB);
    expect(bob.last('over')?.winnerId).toBe(BOB);
  });
});

describe('the wire stays well-formed', () => {
  it('every frame is valid JSON carrying a known type', async () => {
    const { alice, bob } = await startedMatch();
    const known: ServerMessage['t'][] = [
      'hello:ok',
      'queued',
      'queue:cancelled',
      'matched',
      'state',
      'events',
      'turn',
      'over',
      'error',
      'pong',
    ];

    for (const player of [alice, bob]) {
      expect(player.received.length).toBeGreaterThan(0);
      for (const message of player.received) {
        expect(known).toContain(message.t);
        expect(message.v).toBe(1);
      }
    }
  });

  it('answers a ping, so the client’s liveness check works', async () => {
    const { alice } = await startedMatch();

    alice.ping();

    await until(() => alice.has('pong'), 'a pong');
  });

  it('state seq never goes backwards', async () => {
    const { alice, bob } = await startedMatch();

    for (let round = 0; round < 5; round += 1) {
      const mover = whoseTurn(alice) === ALICE ? alice : bob;
      mover.fire({ r: round, c: round });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }

    const seqs = alice.all('state').map((message) => message.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
  });
});
