/**
 * MATCH SECRECY SWEEP — the structural version of leak.test.ts.
 *
 * leak.test.ts proves ONE thing narrowly: the enemy portion of a `state` and
 * the events a viewer caused never name an un-hit enemy cell. This file walks
 * EVERY message type a client can receive during a real match over the real ws
 * server, and asserts three families of forbidden content:
 *
 *   (a) an un-hit ship cell of the opponent, in BOTH wire forms
 *       (`"r,c"` as a marks key, and `{"r":r,"c":c}` as an object), never
 *       appears in any frame — whole message, not just the enemy portion;
 *   (b) an unexposed decoy stays indistinguishable: hitting one emits exactly
 *       ['HIT'], never lands in `revealedItems`, and its kind string is
 *       accounted for to the character;
 *   (c) an undiscovered arsenal item (an untouched mine) never surfaces its
 *       cell or its kind in the opponent's transcript.
 *
 * The two fleets are laid out in separate row bands with zero ship/halo
 * crossings, so a whole-frame grep cannot false-positive on the viewer's own
 * board. Cells the rules genuinely made public (marks, sinks, auto-reveals)
 * are tracked from the transcript and skipped; a negative control proves the
 * checker can fail.
 */
import { cellsOf, coordKey, halo } from '@engine/board';
import type { ArsenalItem, Coord, Ship } from '@engine/types';
import { validateArsenalPlacement, validateLayout } from '@engine/placement';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectClient,
  installAuthMock,
  installDbMock,
  startTestServer,
  type TestClient,
  type TestServer,
} from '../../src/__tests__/testUtils';

// ---------------------------------------------------------------------------
// The two fleets. A sits in rows 0-4, B in rows 5-9; no ship of one is inside
// the other's halo, so nothing legitimate on a viewer's own board can carry an
// opponent's secret coordinate.
// ---------------------------------------------------------------------------

const SHIPS_A: readonly Ship[] = [
  { id: 'battleship-1', class: 'battleship', len: 4, origin: { r: 0, c: 5 }, orientation: 'v', hits: [] },
  { id: 'cruiser-1', class: 'cruiser', len: 3, origin: { r: 2, c: 2 }, orientation: 'v', hits: [] },
  { id: 'cruiser-2', class: 'cruiser', len: 3, origin: { r: 0, c: 7 }, orientation: 'v', hits: [] },
  { id: 'destroyer-1', class: 'destroyer', len: 2, origin: { r: 2, c: 9 }, orientation: 'v', hits: [] },
  { id: 'destroyer-2', class: 'destroyer', len: 2, origin: { r: 2, c: 0 }, orientation: 'v', hits: [] },
  { id: 'destroyer-3', class: 'destroyer', len: 2, origin: { r: 0, c: 2 }, orientation: 'h', hits: [] },
  { id: 'boat-1', class: 'boat', len: 1, origin: { r: 0, c: 9 }, orientation: 'h', hits: [] },
  { id: 'boat-2', class: 'boat', len: 1, origin: { r: 0, c: 0 }, orientation: 'h', hits: [] },
];

const SHIPS_B: readonly Ship[] = [
  { id: 'battleship-1', class: 'battleship', len: 4, origin: { r: 5, c: 7 }, orientation: 'v', hits: [] },
  { id: 'cruiser-1', class: 'cruiser', len: 3, origin: { r: 6, c: 2 }, orientation: 'v', hits: [] },
  { id: 'cruiser-2', class: 'cruiser', len: 3, origin: { r: 7, c: 9 }, orientation: 'v', hits: [] },
  { id: 'destroyer-1', class: 'destroyer', len: 2, origin: { r: 8, c: 4 }, orientation: 'h', hits: [] },
  { id: 'destroyer-2', class: 'destroyer', len: 2, origin: { r: 6, c: 0 }, orientation: 'v', hits: [] },
  { id: 'destroyer-3', class: 'destroyer', len: 2, origin: { r: 6, c: 4 }, orientation: 'h', hits: [] },
  { id: 'boat-1', class: 'boat', len: 1, origin: { r: 5, c: 9 }, orientation: 'v', hits: [] },
  { id: 'boat-2', class: 'boat', len: 1, origin: { r: 9, c: 0 }, orientation: 'h', hits: [] },
];

/** The defender's decoys: targets the attacker hits and then exposes. */
const DECOY_A: Coord = { r: 5, c: 0 };
const DECOY_B: Coord = { r: 4, c: 0 };

/** The attacker's mines: hidden items that must never surface. */
const MINE_A: Coord = { r: 0, c: 6 };
const MINE_B: Coord = { r: 6, c: 3 };

const ARSENAL_A: readonly ArsenalItem[] = [
  { id: 'decoy-a', kind: 'decoy', at: DECOY_A },
  { id: 'mine-a', kind: 'mine', at: MINE_A },
];
const ARSENAL_B: readonly ArsenalItem[] = [
  { id: 'decoy-b', kind: 'decoy', at: DECOY_B },
  { id: 'mine-b', kind: 'mine', at: MINE_B },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const key = (cell: Coord) => coordKey(cell);
/** Both shapes a coordinate takes on the wire. */
const forms = (cell: Coord): [string, string] => [`"${key(cell)}"`, JSON.stringify(cell)];

function neighbours8(cell: Coord): Coord[] {
  const out: Coord[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const next = { r: cell.r + dr, c: cell.c + dc };
      if (next.r >= 0 && next.r < 10 && next.c >= 0 && next.c < 10) out.push(next);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The checker
// ---------------------------------------------------------------------------

interface Board {
  readonly ships: readonly Ship[];
  readonly items: readonly ArsenalItem[];
  readonly decoy: Coord;
  readonly mine: Coord;
}

const BOARD_A: Board = { ships: SHIPS_A, items: ARSENAL_A, decoy: DECOY_A, mine: MINE_A };
const BOARD_B: Board = { ships: SHIPS_B, items: ARSENAL_B, decoy: DECOY_B, mine: MINE_B };

/** Throws if `json` names `cell` in either wire form. Exported for the negative control. */
function assertCellAbsent(json: string, cell: Coord, where: string): void {
  for (const form of forms(cell)) {
    if (json.includes(form)) {
      throw new Error(`${where}: leaked ${key(cell)} via ${form}`);
    }
  }
}

/** The two players' transcripts and the boards they must not see. */
function sweepTranscripts(
  transcripts: readonly { readonly viewer: string; readonly board: Board; readonly history: readonly Record<string, unknown>[] }[],
): { messagesChecked: number; frameChecks: number } {
  let messagesChecked = 0;
  let frameChecks = 0;

  for (const { viewer, board, history } of transcripts) {
    const opponent = board === BOARD_A ? BOARD_B : BOARD_A;
    // Cells on the OPPONENT's board this viewer legitimately learned.
    const known = new Set<string>();
    // Cells on the viewer's OWN board that can legitimately appear in a frame.
    const own = new Set<string>();
    for (const ship of board.ships) {
      for (const cell of cellsOf(ship)) own.add(key(cell));
      for (const cell of halo(ship)) own.add(key(cell));
    }
    for (const item of board.items) if (item.at) own.add(key(item.at));

    let decoyExposed = false;

    history.forEach((message, index) => {
      messagesChecked++;
      const where = `${viewer} message #${index} (t=${String(message.t)})`;
      const json = JSON.stringify(message);

      if (message.t === 'events' && Array.isArray(message.events)) {
        for (const event of message.events as MatchEvent[]) {
          if (!('playerId' in event)) continue;
          const cells = eventCells(event);
          if (event.playerId === viewer) for (const cell of cells) known.add(key(cell));
          else for (const cell of cells) own.add(key(cell));
          if (event.type === 'DECOY_EXPOSED' && event.playerId === viewer && key(event.at) === key(opponent.decoy)) {
            decoyExposed = true;
            known.add(key(event.at));
          }
        }
      }

      if (message.t === 'state' && message.view && typeof message.view === 'object') {
        const view = message.view as { enemy?: { marks?: Record<string, unknown>; sunkShips?: { cells: Coord[] }[]; revealedItems?: { at: Coord }[] } };
        for (const k of Object.keys(view.enemy?.marks ?? {})) known.add(k);
        for (const sunk of view.enemy?.sunkShips ?? []) for (const cell of sunk.cells) known.add(key(cell));
        for (const item of view.enemy?.revealedItems ?? []) known.add(key(item.at));
      }

      // 1. WHOLE FRAME: no secret opponent ship cell / hidden item cell, in
      //    either wire form, anywhere in the message.
      for (const ship of opponent.ships) {
        for (const cell of cellsOf(ship)) {
          if (known.has(key(cell)) || own.has(key(cell))) continue;
          frameChecks++;
          assertCellAbsent(json, cell, where);
        }
      }
      for (const item of opponent.items) {
        if (!item.at || known.has(key(item.at)) || own.has(key(item.at))) continue;
        frameChecks++;
        assertCellAbsent(json, item.at, where);
      }

      // 2. STRUCTURAL: the masked enemy view may only name cells that the same
      //    frame itself declares public. This needs no transcript replay.
      if (message.t === 'state' && message.view && typeof message.view === 'object') {
        const enemy = (message.view as { enemy: Record<string, any> }).enemy;
        const enemyJson = JSON.stringify(enemy);
        const publicKeys = new Set<string>(Object.keys(enemy.marks ?? {}));
        for (const sunk of enemy.sunkShips ?? []) for (const cell of sunk.cells as Coord[]) publicKeys.add(key(cell));
        for (const item of enemy.revealedItems ?? []) publicKeys.add(key(item.at as Coord));

        for (const ship of opponent.ships) {
          for (const cell of cellsOf(ship)) {
            if (publicKeys.has(key(cell))) continue;
            for (const form of forms(cell)) {
              if (enemyJson.includes(form)) throw new Error(`${where}: enemy view names un-hit ${key(cell)} via ${form}`);
            }
          }
        }
        for (const item of opponent.items) {
          if (!item.at || publicKeys.has(key(item.at))) continue;
          for (const form of forms(item.at)) {
            if (enemyJson.includes(form)) throw new Error(`${where}: enemy view names hidden ${item.kind} at ${key(item.at)}`);
          }
        }

        // revealedItems may only name real items whose cell is already public.
        for (const shown of enemy.revealedItems ?? []) {
          const source = opponent.items.find((i) => i.at && key(i.at) === key(shown.at));
          expect(source, `${where}: revealed a phantom item`).toBeDefined();
          expect(publicKeys.has(key(shown.at)), `${where}: revealed item at a secret cell`).toBe(true);
        }

        // 3. DECOY IDENTITY: the word "decoy" is accounted for to the
        //    character. An unexposed enemy decoy contributes NOTHING; the
        //    viewer's own decoy contributes its kind (once its layout is in);
        //    an exposed one may add a mark value (either board) and a
        //    revealedItems entry.
        const ownBoard = (message.view as { you?: { board?: { arsenal?: { kind: string }[]; marks?: Record<string, string> } } }).you?.board;
        const ownDecoyKinds = (ownBoard?.arsenal ?? []).filter((i) => i.kind === 'decoy').length;
        const ownMineKinds = (ownBoard?.arsenal ?? []).filter((i) => i.kind === 'mine').length;
        const ownMark = ownBoard?.marks?.[key(board.decoy)] === 'decoy' ? 1 : 0;
        const enemyMark = decoyExposed && enemy.marks?.[key(opponent.decoy)] === 'decoy' ? 1 : 0;
        const enemyItem = decoyExposed
          ? (enemy.revealedItems ?? []).filter((i: { kind: string }) => i.kind === 'decoy').length
          : 0;
        const decoys = enemyJson.split('"decoy"').length - 1;
        const inWholeMessage = json.split('"decoy"').length - 1;
        expect(decoys, `${where}: view.enemy decoy mentions`).toBe(enemyMark + enemyItem);
        expect(inWholeMessage, `${where}: whole-message decoy mentions`).toBe(
          ownDecoyKinds + ownMark + enemyMark + enemyItem,
        );

        // 4. UNDISCOVERED ITEM: the untouched mine's kind appears only for the
        //    viewer's own board, and never as an enemy revealed item.
        expect(
          (enemy.revealedItems ?? []).some((i: { kind: string }) => i.kind === 'mine'),
          `${where}: enemy revealed an untouched mine`,
        ).toBe(false);
        const enemyMine = enemyJson.split('"mine"').length - 1;
        const wholeMine = json.split('"mine"').length - 1;
        expect(enemyMine, `${where}: the enemy view names a mine`).toBe(0);
        expect(wholeMine, `${where}: whole-message mine mentions`).toBe(ownMineKinds);
      } else {
        // No other message type may carry a decoy or mine kind at all.
        expect(json.split('"decoy"').length - 1, `${where}: decoy kind in a non-state frame`).toBe(0);
        expect(json.split('"mine"').length - 1, `${where}: mine kind in a non-state frame`).toBe(0);
      }
    });
  }

  return { messagesChecked, frameChecks };
}

/** Every coordinate an event names, whichever field it rides in. */
function eventCells(event: MatchEvent): Coord[] {
  const out: Coord[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.r === 'number' && typeof record.c === 'number') {
      out.push({ r: record.r, c: record.c });
      return;
    }
    for (const entry of Object.values(record)) visit(entry);
  };
  visit(event);
  return out;
}

// ---------------------------------------------------------------------------

describe('match secrecy sweep', () => {
  let server: TestServer;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.SEABATTLE_TURN_TIMEOUT_MS;
    installAuthMock();
    installDbMock();
    server = await startTestServer();
  });

  it('never leaks an un-hit cell, an unexposed decoy or an undiscovered item, across every frame of a full advanced match', async () => {
    expect(validateLayout(SHIPS_A).ok, 'fleet A must be legal').toBe(true);
    expect(validateLayout(SHIPS_B).ok, 'fleet B must be legal').toBe(true);
    for (const [board, ships] of [
      [BOARD_A, SHIPS_A],
      [BOARD_B, SHIPS_B],
    ] as const) {
      for (const item of board.items) {
        expect(validateArsenalPlacement({ ships, arsenal: [], marks: {} }, item).ok, `${item.id} placement`).toBe(true);
      }
    }

    const alice = await connectClient(server.port, 'alice');
    const bob = await connectClient(server.port, 'bob');

    alice.send({ t: 'queue', v: 1, mode: 'advanced' });
    await alice.waitFor((m) => m.t === 'queued');
    bob.send({ t: 'queue', v: 1, mode: 'advanced' });
    await bob.waitFor((m) => m.t === 'queued');
    await alice.waitFor((m) => m.t === 'matched');
    await bob.waitFor((m) => m.t === 'matched');

    alice.send({ t: 'ready', v: 1, layout: { ships: SHIPS_A, arsenal: ARSENAL_A } });
    bob.send({ t: 'ready', v: 1, layout: { ships: SHIPS_B, arsenal: ARSENAL_B } });
    const started = (m: Record<string, unknown>) =>
      m.t === 'events' && Array.isArray(m.events) && (m.events as { type: string }[]).some((e) => e.type === 'MATCH_STARTED');
    await alice.waitFor(started);
    await bob.waitFor(started);

    // Who shoots first is a coin flip. The test works either way.
    const turnMsg = await alice.waitFor((m) => m.t === 'turn');
    const shooter = turnMsg.playerId === 'alice' ? alice : bob;
    const defender = shooter === alice ? bob : alice;
    const shooterBoard = shooter === alice ? BOARD_A : BOARD_B;
    const defenderBoard = defender === alice ? BOARD_A : BOARD_B;
    const defenderShips = defenderBoard.ships;
    const decoy = defenderBoard.decoy;

    // A pong, so `pong` is part of the swept message set.
    defender.send({ t: 'ping', v: 1 });
    await defender.waitFor((m) => m.t === 'pong');

    let seq = 0;
    const act = async (client: TestClient, at: Coord): Promise<Record<string, unknown>[]> => {
      client.send({ t: 'action', v: 1, seq: seq++, action: { type: 'FIRE', at } });
      await sleep(120);
      const msg = await client.waitFor((m) => m.t === 'events');
      return msg.events as Record<string, unknown>[];
    };

    // ---- the decoy hit: exactly one HIT, nothing that could be a tell ----
    const hitEvents = await act(shooter, decoy);
    expect(hitEvents).toEqual([{ type: 'HIT', playerId: shooter.playerId, at: decoy }]);

    // An illegal action produces an `error` frame — sweep it too. The decoy
    // keeps the turn, so the same cell is now resolved and refused.
    shooter.send({ t: 'action', v: 1, seq: seq++, action: { type: 'FIRE', at: decoy } });
    const errorMsg = await shooter.waitFor((m) => m.t === 'error');
    expect(errorMsg.code).toBe('illegal_action');
    await sleep(120);

    // ---- expose the decoy: mark every neighbour, alternately with fillers ----
    const fillerPool = (() => {
      const excluded = new Set<string>();
      for (const ship of [...shooterBoard.ships, ...defenderShips]) for (const cell of cellsOf(ship)) excluded.add(key(cell));
      for (const item of [...shooterBoard.items, ...defenderBoard.items]) if (item.at) excluded.add(key(item.at));
      return [...Array(10).keys()].flatMap((r) => [...Array(10).keys()].map((c) => ({ r, c }))).filter((cell) => !excluded.has(key(cell)));
    })();
    let fillerIndex = 0;
    const filler = (): Coord => fillerPool[fillerIndex++] as Coord;

    for (const neighbour of neighbours8(decoy)) {
      const events = await act(shooter, neighbour);
      expect(events.some((e) => e.type === 'REJECTED'), `neighbour ${key(neighbour)} must resolve`).toBe(false);
      await act(defender, filler()); // hand the turn back
    }

    const exposedState = [...shooter.history()].reverse().find((m) => m.t === 'state') as {
      view: { enemy: { marks: Record<string, string>; revealedItems: { kind: string; at: Coord }[] } };
    };
    expect(exposedState.view.enemy.marks[key(decoy)]).toBe('decoy');
    expect(exposedState.view.enemy.revealedItems.some((i) => i.kind === 'decoy' && key(i.at) === key(decoy))).toBe(true);

    // ---- sink the defender's whole fleet (hits keep the turn) ----
    for (const ship of defenderShips) {
      for (const cell of cellsOf(ship)) {
        const events = await act(shooter, cell);
        expect(events.some((e) => e.type === 'REJECTED'), `${key(cell)} must resolve`).toBe(false);
      }
    }
    await shooter.waitFor((m) => m.t === 'over', 10_000);
    await defender.waitFor((m) => m.t === 'over', 10_000);
    await sleep(200); // let trailing state/turn frames land

    // ---- the sweep ----
    const result = sweepTranscripts([
      { viewer: 'alice', board: BOARD_A, history: alice.history() },
      { viewer: 'bob', board: BOARD_B, history: bob.history() },
    ]);

    // Non-vacuity: the checker really did see the interesting frames.
    const types = new Set([...alice.history(), ...bob.history()].map((m) => m.t));
    for (const required of ['hello:ok', 'queued', 'matched', 'state', 'events', 'turn', 'over', 'error', 'pong']) {
      expect(types.has(required), `the transcript must contain a ${required} frame`).toBe(true);
    }
    expect(result.messagesChecked).toBeGreaterThan(40);
    expect(result.frameChecks).toBeGreaterThan(200);

    alice.close();
    bob.close();
    await server.close();
  }, 60_000);

  it('NEGATIVE CONTROL: the whole-frame checker fails on a tampered frame', async () => {
    // The same assertion the sweep makes, handed a frame that names a secret.
    const secret: Coord = { r: 4, c: 4 };
    expect(() => assertCellAbsent(JSON.stringify({ t: 'over', anything: [secret] }), secret, 'tampered')).toThrow(/leaked 4,4/);
    expect(() => assertCellAbsent(JSON.stringify({ marks: { '4,4': 'hit' } }), secret, 'tampered')).toThrow(/leaked 4,4/);
    // ...and a cell that is not secret is not flagged.
    expect(() => assertCellAbsent(JSON.stringify({ marks: { '4,4': 'hit' } }), { r: 5, c: 5 }, 'tampered')).not.toThrow();
  });
});
