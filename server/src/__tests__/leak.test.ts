/**
 * THE critical property (docs/brief.md 4.1): a client never receives an enemy
 * ship position it hasn't earned. This drives a full match over real sockets
 * and, for every message either player received, asserts the ENEMY-facing
 * portion of that message — `view.enemy` on a `state`, and any event
 * attributed to the viewer's own actions on an `events` message, which is
 * exactly the data projectView() derives about the opponent's board —
 * mentions no still-secret opponent ship coordinate.
 *
 * Scoping to "the enemy portion" matters: a player's OWN board (their ships,
 * their board's halo reveals from the opponent's shots) is fully and
 * legitimately visible in every message, and on a shared reference fleet a
 * defender's own halo cell can numerically coincide with an attacker's ship
 * cell elsewhere. A raw whole-message string search can't tell those apart;
 * checking only the part of the message that actually describes the
 * opponent's board can.
 */
import type { Coord, MatchEvent } from '@engine/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectClient,
  installAuthMock,
  installDbMock,
  KNOWN_LAYOUT,
  readyUpBoth,
  shipCellsOf,
  startTestServer,
  type TestClient,
  type TestServer,
} from './testUtils';

const SHIP_CELLS = shipCellsOf(KNOWN_LAYOUT); // both boards use the same fleet
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function coordNeedles(cell: Coord): [string, string] {
  return [`"${cell.r},${cell.c}"`, JSON.stringify(cell)];
}

/** The part of `message` that describes the OPPONENT's board, from `viewer`'s side. */
function enemyPortion(message: Record<string, unknown>, viewer: string): unknown {
  if (message.t === 'state') return (message.view as { enemy?: unknown } | undefined)?.enemy;
  if (message.t === 'events') {
    return (message.events as MatchEvent[]).filter((e) => 'playerId' in e && e.playerId === viewer);
  }
  return undefined;
}

/** Cells `event` makes newly public to `viewer` about the OPPONENT's board. */
function revealsToViewer(event: MatchEvent, viewer: string): Coord[] {
  if (!('playerId' in event) || event.playerId !== viewer) return [];
  switch (event.type) {
    case 'HIT':
    case 'MINE_TRIGGERED':
    case 'ITEM_HIT':
      return [event.at];
    case 'SUNK':
    case 'AUTO_REVEAL':
      return [...event.cells];
    case 'AIRCRAFT_DOWNED':
      return [event.gunAt];
    default:
      return [];
  }
}

/**
 * Replays one player's full transcript in arrival order, maintaining what
 * they have legitimately learned about the opponent's board so far, and
 * fails the moment the enemy-facing part of a message mentions a coordinate
 * not yet in that set.
 */
function assertNoLeak(viewer: string, transcript: readonly Record<string, unknown>[], allShipCells: readonly Coord[]): void {
  const known = new Set<string>();

  transcript.forEach((message, index) => {
    if (message.t === 'events') {
      for (const event of message.events as MatchEvent[]) {
        for (const cell of revealsToViewer(event, viewer)) known.add(`${cell.r},${cell.c}`);
      }
    }

    const stillSecret = allShipCells.filter((cell) => !known.has(`${cell.r},${cell.c}`));
    if (stillSecret.length === 0) return;

    const portion = enemyPortion(message, viewer);
    if (portion === undefined) return;
    const json = JSON.stringify(portion);

    for (const cell of stillSecret) {
      for (const needle of coordNeedles(cell)) {
        if (json.includes(needle)) {
          throw new Error(
            `LEAK: message #${index} (t=${String(message.t)}) sent to ${viewer} exposes still-secret ` +
              `cell ${JSON.stringify(cell)} in its enemy-facing data via ${needle}\n${json}`,
          );
        }
      }
    }
  });
}

describe('the leak test', () => {
  let server: TestServer;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.SEABATTLE_TURN_TIMEOUT_MS;
    installAuthMock();
    installDbMock();
    server = await startTestServer();
  });

  it('never exposes an un-hit enemy ship coordinate to either player, across a full match', async () => {
    const alice = await connectClient(server.port, 'alice');
    const bob = await connectClient(server.port, 'bob');
    alice.send({ t: 'queue', v: 1, mode: 'classic' });
    await alice.waitFor((m) => m.t === 'queued');
    bob.send({ t: 'queue', v: 1, mode: 'classic' });
    await bob.waitFor((m) => m.t === 'queued');
    await alice.waitFor((m) => m.t === 'matched');
    await bob.waitFor((m) => m.t === 'matched');
    await readyUpBoth(alice, bob);

    const turnMsg = await alice.waitFor((m) => m.t === 'turn');
    const shooter = turnMsg.playerId === 'alice' ? alice : bob;
    const other = shooter === alice ? bob : alice;

    await sleep(1100); // let hello/queue/ready age out of the rate-limit window
    let seq = 0;
    for (const at of SHIP_CELLS) {
      shooter.send({ t: 'action', v: 1, seq: seq++, action: { type: 'FIRE', at } });
      const events = (await shooter.waitFor((m) => m.t === 'events')).events as { type: string }[];
      expect(events.some((e) => e.type === 'REJECTED')).toBe(false);
      await sleep(110);
    }
    await shooter.waitFor((m) => m.t === 'over');
    await other.waitFor((m) => m.t === 'over');
    await sleep(50); // let any trailing broadcasts (e.g. a final `state`) land

    expect(() => assertNoLeak('alice', alice.history(), SHIP_CELLS)).not.toThrow();
    expect(() => assertNoLeak('bob', bob.history(), SHIP_CELLS)).not.toThrow();

    // Sanity check on the checker itself: the winner, by the end of a full
    // sink, has legitimately learned every one of the 20 ship cells (plus
    // AUTO_REVEAL halo cells, which also count) — otherwise an empty `known`
    // set would make the assertions above trivially pass no matter what the
    // messages actually contained.
    const winnerKnown = new Set<string>();
    for (const message of shooter.history()) {
      if (message.t !== 'events') continue;
      for (const event of message.events as MatchEvent[]) {
        for (const cell of revealsToViewer(event, shooter.playerId)) winnerKnown.add(`${cell.r},${cell.c}`);
      }
    }
    for (const cell of SHIP_CELLS) expect(winnerKnown.has(`${cell.r},${cell.c}`)).toBe(true);

    alice.close();
    bob.close();
    await server.close();
  });
});
