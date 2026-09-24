/**
 * Advances the on-screen view by one event. The battle screen renders from
 * this, never from MatchState, so what the player sees is exactly what the
 * timeline has played so far. Pure and idempotent: replaying an event that is
 * already reflected changes nothing.
 *
 * Events name the ACTOR (`playerId`) and cells on the OTHER board:
 *   actor === viewer  -> the enemy board (view.enemy)
 *   otherwise         -> the viewer's own board (view.you.board)
 */
import { coordKey } from '@engine/board';
import type { ArsenalItem, CellState, Coord, PlayerView, Ship } from '@engine/types';

import type { PlayEvent } from './EventPlayer';

function withEnemyMark(view: PlayerView, at: Coord, state: CellState): PlayerView {
  const key = coordKey(at);
  if (view.enemy.marks[key] === state) return view;
  return { ...view, enemy: { ...view.enemy, marks: { ...view.enemy.marks, [key]: state } } };
}

function withOwnMark(view: PlayerView, at: Coord, state: CellState): PlayerView {
  const key = coordKey(at);
  if (view.you.board.marks[key] === state) return view;
  return {
    ...view,
    you: {
      ...view.you,
      board: { ...view.you.board, marks: { ...view.you.board.marks, [key]: state } },
    },
  };
}

function withOwnShips(view: PlayerView, ships: readonly Ship[]): PlayerView {
  return { ...view, you: { ...view.you, board: { ...view.you.board, ships } } };
}

function withOwnArsenal(view: PlayerView, arsenal: readonly ArsenalItem[]): PlayerView {
  return { ...view, you: { ...view.you, board: { ...view.you.board, arsenal } } };
}

function hitOwnShip(view: PlayerView, at: Coord): PlayerView {
  const ships = view.you.board.ships.map((ship) => {
    const cells = Array.from({ length: ship.len }, (_, i) =>
      ship.orientation === 'h'
        ? { r: ship.origin.r, c: ship.origin.c + i }
        : { r: ship.origin.r + i, c: ship.origin.c },
    );
    if (!cells.some((cell) => cell.r === at.r && cell.c === at.c)) return ship;
    if (ship.hits.some((hit) => hit.r === at.r && hit.c === at.c)) return ship;
    return { ...ship, hits: [...ship.hits, at] };
  });
  return withOwnShips(view, ships);
}

/** One revealed halo cell — the stagger commits these one at a time. */
export function applyReveal(view: PlayerView, actorId: string, cell: Coord): PlayerView {
  const mine = actorId === view.you.id;
  return mine ? withEnemyMark(view, cell, 'revealed') : withOwnMark(view, cell, 'revealed');
}

export function applyEvent(view: PlayerView, event: PlayEvent): PlayerView {
  const me = view.you.id;
  switch (event.type) {
    case 'SHOT_FIRED':
    case 'REJECTED':
    case 'LAYOUT_ACCEPTED':
    case 'AIRCRAFT_LAUNCHED':
    case 'BOMB_DROPPED':
    case 'TORPEDO_TRAVEL':
    case 'TORPEDO_RUN':
    case 'SUBMARINE_SURFACED':
    case 'NUKE_FLASH':
    case 'RADAR_RESULT':
    case 'TIMEOUT':
    case 'RESIGNED':
    // Part 10A — the captain's own event; the view carries the ability state.
    case 'CAPTAIN_ABILITY':
      return view;

    case 'MATCH_STARTED':
      return { ...view, phase: 'playing', turn: event.turn };

    case 'HIT':
      return event.playerId === me
        ? withEnemyMark(view, event.at, 'hit')
        : hitOwnShip(withOwnMark(view, event.at, 'hit'), event.at);

    case 'MISS':
      return event.playerId === me
        ? withEnemyMark(view, event.at, 'miss')
        : withOwnMark(view, event.at, 'miss');

    case 'SUNK': {
      let next = view;
      for (const cell of event.cells) {
        next =
          event.playerId === me
            ? withEnemyMark(next, cell, 'sunk')
            : withOwnMark(next, cell, 'sunk');
      }
      if (event.playerId === me) {
        if (next.enemy.sunkShips.some((s) => s.id === event.shipId)) return next;
        return {
          ...next,
          enemy: {
            ...next.enemy,
            sunkShips: [
              ...next.enemy.sunkShips,
              { id: event.shipId, class: event.shipClass, cells: event.cells },
            ],
            shipsRemaining: Math.max(0, next.enemy.shipsRemaining - 1),
          },
        };
      }
      return withOwnShips(
        next,
        next.you.board.ships.map((ship) =>
          ship.id === event.shipId ? { ...ship, hits: [...event.cells] } : ship,
        ),
      );
    }

    case 'AUTO_REVEAL': {
      let next = view;
      for (const cell of event.cells) next = applyReveal(next, event.playerId, cell);
      return next;
    }

    case 'MINE_TRIGGERED': {
      if (event.playerId === me) return withEnemyMark(view, event.at, 'mine');
      const marked = withOwnMark(view, event.at, 'mine');
      return withOwnArsenal(
        marked,
        marked.you.board.arsenal.map((item) =>
          item.at && item.at.r === event.at.r && item.at.c === event.at.c
            ? { ...item, used: true, revealed: true }
            : item,
        ),
      );
    }

    case 'ITEM_HIT': {
      if (event.playerId === me) {
        // Part 10A — a damaged gun is NOT resolved: the cell stays shootable
        // and the attacker must come back for the second hit.
        if (event.damaged === true) {
          if (
            view.enemy.revealedItems.some(
              (i) => i.at.r === event.at.r && i.at.c === event.at.c,
            )
          )
            return view;
          return {
            ...view,
            enemy: {
              ...view.enemy,
              revealedItems: [
                ...view.enemy.revealedItems,
                { kind: event.kind, at: event.at, destroyed: false, damaged: true },
              ],
            },
          };
        }
        const marked = withEnemyMark(view, event.at, 'revealed');
        if (marked.enemy.revealedItems.some((i) => i.at.r === event.at.r && i.at.c === event.at.c))
          return marked;
        return {
          ...marked,
          enemy: {
            ...marked.enemy,
            revealedItems: [
              ...marked.enemy.revealedItems,
              { kind: event.kind, at: event.at, destroyed: true },
            ],
          },
        };
      }
      if (event.damaged === true) {
        return withOwnArsenal(
          view,
          view.you.board.arsenal.map((item) =>
            item.at && item.at.r === event.at.r && item.at.c === event.at.c
              ? { ...item, damaged: true, revealed: true }
              : item,
          ),
        );
      }
      const marked = withOwnMark(view, event.at, 'revealed');
      return withOwnArsenal(
        marked,
        marked.you.board.arsenal.map((item) =>
          item.at && item.at.r === event.at.r && item.at.c === event.at.c
            ? { ...item, destroyed: true, revealed: true }
            : item,
        ),
      );
    }

    case 'AIRCRAFT_DOWNED': {
      if (event.playerId !== me) return view; // their plane, my gun — nothing new to me
      if (
        view.enemy.revealedItems.some((i) => i.at.r === event.gunAt.r && i.at.c === event.gunAt.c)
      )
        return view;
      return {
        ...view,
        enemy: {
          ...view.enemy,
          revealedItems: [
            ...view.enemy.revealedItems,
            { kind: 'aaGun', at: event.gunAt, destroyed: false },
          ],
        },
      };
    }

    case 'ARSENAL_USED':
      if (event.playerId !== me) return view;
      return withOwnArsenal(
        view,
        view.you.board.arsenal.map((item) =>
          item.id === event.itemId ? { ...item, used: true } : item,
        ),
      );

    case 'TURN_CHANGED':
      return view.turn === event.turn ? view : { ...view, turn: event.turn };

    case 'GAME_OVER':
      return { ...view, phase: 'over', winner: event.winner };

    default:
      // A new event kind nobody taught this function about: leave the board as it is.
      return view;
  }
}
