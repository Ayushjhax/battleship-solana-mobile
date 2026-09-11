/**
 * Binds each event to its animation, sound and haptic — the "animate" half
 * of the EventPlayer. Timings are the spec's:
 *
 *   SHOT_FIRED      shell arcs to the target, 340 ms
 *   MISS            ink splash, sfx/splash, Light
 *   HIT             explosion, sfx/explosion, Medium, 6 px shake on the boards
 *   SUNK            wreck redraw, sfx/ship_sink, Heavy
 *   AUTO_REVEAL     halo cells hatch in a 40 ms stagger radiating outward
 *   MINE_TRIGGERED  red flash, sfx/mine, Heavy; the next turn flip snaps
 *   TURN_CHANGED    the triangle flips, 180 ms
 *   GAME_OVER       hold 900 ms, then hand over to the result screen
 *
 * Every wait goes through player.wait(), so a skip tap cuts all of it short
 * and the visuals in flight remove themselves.
 */
import type { Coord } from '@engine/types';

import { haptic } from '@/audio/haptics';
import { playSfx } from '@/audio/sfx';
import { BOARD_SIZE, boardOrigins, cellCentre, type BoardOrigin, type Point } from '@/board/layout';
import type { EventEffects, EventPlayer, PlayEvent } from './EventPlayer';
import { useFx } from './fxStore';

export const SHELL_MS = 340;
export const REVEAL_STAGGER_MS = 40;
export const TURN_FLIP_MS = 180;
export const MATCH_OVER_HOLD_MS = 900;

export interface BattleEffectDeps {
  /** The viewer's player id at the time of the event. */
  me: () => string;
  boardTop: number;
  commit: (event: PlayEvent) => void;
  commitReveal: (actorId: string, cell: Coord) => void;
  /** Called after the GAME_OVER hold. */
  onMatchOver: () => void;
}

function centreOf(origin: BoardOrigin): Point {
  return { x: origin.x + BOARD_SIZE / 2, y: origin.y + BOARD_SIZE / 2 };
}

export function createBattleEffects(deps: BattleEffectDeps): EventEffects {
  const origins = boardOrigins(deps.boardTop);
  /** Where a cell of the board the actor is attacking sits on the canvas. */
  const targetCentre = (actorId: string, at: Coord): Point =>
    cellCentre(at, actorId === deps.me() ? origins.enemy : origins.own);
  const shooterCentre = (actorId: string): Point =>
    centreOf(actorId === deps.me() ? origins.own : origins.enemy);

  let lastSunkCentre: Coord | null = null;

  const burst = async (
    player: EventPlayer,
    at: Point,
    kind: 'hit' | 'miss' | 'mine',
    ms: number,
  ) => {
    const fx = useFx.getState();
    const id = fx.addBurst({ at, kind });
    await player.wait(ms);
    useFx.getState().removeBurst(id);
  };

  return {
    commit: deps.commit,

    async animate(event, player) {
      switch (event.type) {
        case 'SHOT_FIRED': {
          const fx = useFx.getState();
          const id = fx.addShell({
            from: shooterCentre(event.playerId),
            to: targetCentre(event.playerId, event.at),
            durationMs: SHELL_MS,
          });
          await player.wait(SHELL_MS);
          useFx.getState().removeShell(id);
          return;
        }

        case 'MISS':
          playSfx('splash');
          haptic('light');
          await burst(player, targetCentre(event.playerId, event.at), 'miss', 260);
          return;

        case 'HIT':
          playSfx('explosion');
          haptic('medium');
          useFx.getState().shake();
          await burst(player, targetCentre(event.playerId, event.at), 'hit', 320);
          return;

        case 'SUNK': {
          // The wreck redraws on commit; hold so the smoke reads before the halo hatches.
          const cells = event.cells;
          const first = cells[0];
          const last = cells[cells.length - 1];
          lastSunkCentre =
            first && last ? { r: (first.r + last.r) / 2, c: (first.c + last.c) / 2 } : null;
          deps.commit(event);
          playSfx('shipSink');
          haptic('heavy');
          await player.wait(420);
          return;
        }

        case 'AUTO_REVEAL': {
          const centre = lastSunkCentre;
          const ordered = [...event.cells].sort((a, b) => {
            if (!centre) return 0;
            const da = Math.hypot(a.r - centre.r, a.c - centre.c);
            const db = Math.hypot(b.r - centre.r, b.c - centre.c);
            return da - db;
          });
          for (const cell of ordered) {
            deps.commitReveal(event.playerId, cell);
            await player.wait(REVEAL_STAGGER_MS);
          }
          return;
        }

        case 'MINE_TRIGGERED':
          playSfx('mine');
          haptic('heavy');
          useFx.getState().flash();
          await burst(player, targetCentre(event.playerId, event.at), 'mine', 300);
          return;

        case 'ITEM_HIT':
          playSfx('explosion');
          haptic('medium');
          await burst(player, targetCentre(event.playerId, event.at), 'hit', 260);
          return;

        case 'TURN_CHANGED':
          // Commit first so the triangle's own 180 ms flip is what we wait on.
          deps.commit(event);
          await player.wait(TURN_FLIP_MS);
          return;

        case 'GAME_OVER':
          deps.commit(event);
          playSfx(event.winner === deps.me() ? 'victory' : 'defeat');
          await player.wait(MATCH_OVER_HOLD_MS);
          deps.onMatchOver();
          return;

        case 'AIRCRAFT_DOWNED':
          playSfx('planeDown');
          haptic('medium');
          await player.wait(500);
          return;

        case 'TORPEDO_RUN':
          // TODO(P08): the torpedo track animation.
          await player.wait(200);
          return;

        case 'ARSENAL_USED':
        case 'RADAR_RESULT':
          // TODO(P08): plane crossings and the radar readout.
          await player.wait(120);
          return;

        default:
          return;
      }
    },
  };
}
