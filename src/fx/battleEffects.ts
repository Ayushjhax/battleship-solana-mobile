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
import { atomicFootprint } from '@engine/arsenal';
import { coordKey } from '@engine/board';
import type { Coord } from '@engine/types';

import { haptic } from '@/audio/haptics';
import { playSfx } from '@/audio/sfx';
import {
  BOARD_SIZE,
  CELL,
  boardOrigins,
  cellCentre,
  type BoardOrigin,
  type Point,
} from '@/board/layout';
import type { EventEffects, EventPlayer, PlayEvent } from './EventPlayer';
import { useFx } from './fxStore';

export const SHELL_MS = 340;
export const REVEAL_STAGGER_MS = 40;
export const TURN_FLIP_MS = 180;
export const MATCH_OVER_HOLD_MS = 900;
export const AIRCRAFT_RUN_MS = 1400;
export const BOMB_STAGGER_MS = 120;
export const TORPEDO_CELL_MS = 80;
export const RADAR_SWEEP_MS = 520;
export const RADAR_RESULT_MS = 2500;

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
  let aircraftId: number | null = null;
  let submarineId: number | null = null;
  let submarineAt: Point | null = null;
  let torpedoTracksLeft = 0;
  let bombCells = new Set<string>();
  let nukeCells = new Set<string>();

  const clearAttack = () => {
    useFx.getState().clearAttack();
    aircraftId = null;
    submarineId = null;
    submarineAt = null;
    torpedoTracksLeft = 0;
    bombCells = new Set();
    nukeCells = new Set();
  };

  const arsenalImpact = async (
    player: EventPlayer,
    actorId: string,
    at: Coord,
    kind: 'hit' | 'miss' | 'mine',
  ): Promise<boolean> => {
    const key = coordKey(at);
    const isNuke = nukeCells.has(key);
    const isBomb = bombCells.has(key);
    if (!isNuke && !isBomb) return false;
    const fx = useFx.getState();
    const id = fx.addBurst({ at: targetCentre(actorId, at), kind });
    await player.wait(isNuke ? 60 : 80);
    useFx.getState().removeBurst(id);
    const active = isNuke ? nukeCells : bombCells;
    active.delete(key);
    if (active.size === 0) {
      await player.wait(isNuke ? 400 : 380);
      clearAttack();
    }
    return true;
  };

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
          playSfx('shotFire');
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
          if (await arsenalImpact(player, event.playerId, event.at, 'miss')) return;
          playSfx('splash');
          haptic('miss');
          await burst(player, targetCentre(event.playerId, event.at), 'miss', 260);
          return;

        case 'HIT':
          if (await arsenalImpact(player, event.playerId, event.at, 'hit')) return;
          playSfx('explosion');
          haptic('hit');
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
          haptic('sink');
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
          haptic('mine');
          useFx.getState().flash();
          if (await arsenalImpact(player, event.playerId, event.at, 'mine')) return;
          await burst(player, targetCentre(event.playerId, event.at), 'mine', 300);
          return;

        case 'ITEM_HIT':
          if (await arsenalImpact(player, event.playerId, event.at, 'hit')) return;
          playSfx('explosion');
          haptic('hit');
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

        case 'AIRCRAFT_LAUNCHED': {
          const origin = event.playerId === deps.me() ? origins.enemy : origins.own;
          const direction = event.playerId === deps.me() ? 1 : -1;
          const row = event.rows.reduce((sum, value) => sum + value, 0) / event.rows.length;
          const y = origin.y + (row + 0.5) * CELL;
          const durationMs = event.interceptAt ? 420 : AIRCRAFT_RUN_MS;
          aircraftId = useFx.getState().addAircraft({
            kind: event.kind,
            from: { x: direction > 0 ? origins.own.x + BOARD_SIZE - 8 : origins.enemy.x + 8, y },
            to: event.interceptAt
              ? targetCentre(event.playerId, event.interceptAt)
              : { x: direction > 0 ? origins.enemy.x + BOARD_SIZE + 54 : origins.own.x - 54, y },
            durationMs,
          });
          torpedoTracksLeft = event.kind === 'doubleTorpedoBomber' ? 2 : 1;
          playSfx('planeFlyby');
          await player.wait(event.interceptAt ? durationMs : 420);
          return;
        }

        case 'AIRCRAFT_DOWNED': {
          const at = targetCentre(event.playerId, event.gunAt);
          const fx = useFx.getState();
          if (aircraftId !== null) fx.downAircraft(aircraftId, at);
          const interceptId = fx.addIntercept({ at, revealed: false });
          playSfx('planeDown');
          await player.wait(760);
          deps.commit(event);
          useFx.getState().revealIntercept(interceptId);
          await player.wait(400);
          clearAttack();
          return;
        }

        case 'BOMB_DROPPED': {
          const to = targetCentre(event.playerId, event.at);
          const direction = event.playerId === deps.me() ? 1 : -1;
          useFx.getState().addBomb({
            kind: event.kind,
            from: { x: to.x - direction * 34, y: to.y - 52 },
            to,
            durationMs: 300,
          });
          if (event.resolves) bombCells.add(coordKey(event.at));
          playSfx('bombDrop');
          await player.wait(event.kind === 'atomicBomber' ? 300 : BOMB_STAGGER_MS);
          if (event.index === event.total - 1 && bombCells.size === 0 && event.kind === 'bomber') {
            await player.wait(380);
            clearAttack();
          }
          return;
        }

        case 'NUKE_FLASH': {
          bombCells = new Set();
          nukeCells = new Set(event.resolvedCells.map(coordKey));
          const target = event.playerId === deps.me() ? origins.enemy : origins.own;
          useFx.getState().whiteFlash(target);
          playSfx('nuke');
          await player.wait(90);
          if (nukeCells.size === 0) {
            await player.wait(400);
            clearAttack();
          }
          return;
        }

        case 'SUBMARINE_SURFACED': {
          submarineAt = targetCentre(event.playerId, event.at);
          submarineId = useFx.getState().addSubmarine({ at: submarineAt });
          torpedoTracksLeft = 2;
          playSfx('subSurface');
          await player.wait(250);
          return;
        }

        case 'TORPEDO_TRAVEL': {
          const travelled = event.path.map((cell) => targetCentre(event.playerId, cell));
          const path = submarineAt ? [submarineAt, ...travelled] : travelled;
          const durationMs = Math.max(TORPEDO_CELL_MS, path.length * TORPEDO_CELL_MS);
          const id = useFx.getState().addTorpedo({ path, durationMs });
          playSfx('torpedo');
          await player.wait(durationMs);
          useFx.getState().removeTorpedo(id);
          torpedoTracksLeft = Math.max(0, torpedoTracksLeft - 1);
          if (torpedoTracksLeft === 0) {
            await player.wait(submarineId === null ? 220 : 180);
            clearAttack();
          }
          return;
        }

        case 'RADAR_RESULT': {
          const cells = atomicFootprint(event.at);
          const origin = event.playerId === deps.me() ? origins.enemy : origins.own;
          const minR = Math.min(...cells.map((cell) => cell.r));
          const maxR = Math.max(...cells.map((cell) => cell.r));
          const minC = Math.min(...cells.map((cell) => cell.c));
          const maxC = Math.max(...cells.map((cell) => cell.c));
          const id = useFx.getState().addRadar({
            at: targetCentre(event.playerId, event.at),
            box: {
              x: origin.x + minC * CELL,
              y: origin.y + minR * CELL,
              w: (maxC - minC + 1) * CELL,
              h: (maxR - minR + 1) * CELL,
            },
            count: event.count,
            durationMs: RADAR_RESULT_MS,
          });
          playSfx('radarPing');
          await player.wait(RADAR_SWEEP_MS + RADAR_RESULT_MS);
          useFx.getState().removeRadar(id);
          return;
        }

        case 'TORPEDO_RUN':
        case 'ARSENAL_USED':
          return;

        default:
          return;
      }
    },
  };
}
