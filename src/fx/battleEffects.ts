/**
 * Binds each event to its animation, sound and haptic — the "animate" half
 * of the EventPlayer. What each one plays (FX_ART strips unless noted):
 *
 *   SHOT_FIRED        the shell arcs to the target, 340 ms
 *   MISS              a water splash; sfx/splash, Light
 *   HIT               a fire explosion, then smoke rising off it; sfx/explosion,
 *                     Medium, the boards shake
 *   SUNK              a big ink blast over the ship and smoke; sfx/ship_sink, Heavy
 *   AUTO_REVEAL       halo cells hatch in a 40 ms stagger radiating outward
 *   MINE_TRIGGERED    the mine blinks and blows; red flash, sfx/mine, Heavy;
 *                     the next turn flip snaps
 *   ITEM_HIT          an ink burst over the item
 *   TURN_CHANGED      the triangle flips, 180 ms
 *   GAME_OVER         hold 900 ms, then hand over to the result screen
 *
 *   AIRCRAFT_LAUNCHED the plane flies in level along the target row(s) with
 *                     its shadow on the water, at PLANE_SPEED, and opens its
 *                     bay exactly over the drop point: the torpedo's is the
 *                     board's near edge, a bomb's is its target cell. The
 *                     effect waits until the plane is there, so what follows
 *                     (TORPEDO_TRAVEL, BOMB_DROPPED) starts under the plane.
 *                     Torpedo runs go column 1 -> 10 as the rule does, so a
 *                     torpedo bomber always flies left to right; bombers
 *                     come from the attacker's side.
 *   AIRCRAFT_DOWNED   the AA gun fires (turret strip at the gun), flak bursts
 *                     round the plane, it blows and goes down in a spin with
 *                     smoke, into the sea
 *   BOMB_DROPPED      the bomb falls away from the eye onto its cell (the
 *                     bomb strip backwards); the impact is the HIT/MISS after
 *   NUKE_FLASH        white flash, the mushroom and its smoke, a heavy shake
 *   SUBMARINE_SURFACED the submarine rises (its strip backwards); it dives
 *                     again when the attack is over
 *   TORPEDO_TRAVEL    the torpedo runs its path with a wake
 *   RADAR_RESULT      the scope sweeps over the 3x3 and reports the count
 *
 * Every wait goes through player.wait(), so a skip tap cuts all of it short;
 * the timed visuals remove themselves (fxStore).
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
import { useFx, type SpriteKind } from './fxStore';

export const SHELL_MS = 340;
export const REVEAL_STAGGER_MS = 40;
export const TURN_FLIP_MS = 180;
export const MATCH_OVER_HOLD_MS = 900;
/** Level flight, canvas units per ms. */
export const PLANE_SPEED = 0.46;
/** How far before the board a plane comes in, and past it that it leaves. */
const APPROACH = 130;
const EXIT = 100;
/** The bay opens this long before the drop point is reached. */
const BAY_LEAD_MS = 130;
export const BOMB_FALL_MS = 260;
/** Bombs of one stick leave the bay this far apart. */
export const BOMB_STAGGER_MS = 70;
export const TORPEDO_CELL_MS = 75;
export const RADAR_SWEEP_MS = 900;
export const RADAR_RESULT_MS = 1900;

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

/** Each impact's look: strip, size (canvas units), length, and whether smoke follows. */
const IMPACT: Record<'hit' | 'miss' | 'mine' | 'item', { kind: SpriteKind; width: number; ms: number; anchorY?: number }> = {
  hit: { kind: 'explosionFire', width: 54, ms: 560 },
  miss: { kind: 'splash', width: 44, ms: 520, anchorY: 0.62 },
  mine: { kind: 'mine', width: 54, ms: 700 },
  item: { kind: 'explosionInk', width: 46, ms: 520 },
};

export function createBattleEffects(deps: BattleEffectDeps): EventEffects {
  const origins = boardOrigins(deps.boardTop);
  const mine = (actorId: string) => actorId === deps.me();
  /** The board the actor is attacking. */
  const targetBoard = (actorId: string): BoardOrigin => (mine(actorId) ? origins.enemy : origins.own);
  /** Where a cell of the board the actor is attacking sits on the canvas. */
  const targetCentre = (actorId: string, at: Coord): Point => cellCentre(at, targetBoard(actorId));
  const shooterCentre = (actorId: string): Point => centreOf(mine(actorId) ? origins.own : origins.enemy);

  let lastSunkCentre: Coord | null = null;
  let aircraftId: number | null = null;
  let submarineAt: Point | null = null;
  let torpedoTracksLeft = 0;
  let bombCells = new Set<string>();
  let nukeCells = new Set<string>();

  const clearAttack = () => {
    useFx.getState().clearAttack();
    aircraftId = null;
    submarineAt = null;
    torpedoTracksLeft = 0;
    bombCells = new Set();
    nukeCells = new Set();
  };

  /** The impact's sprite (and, for a hit, the smoke that rises after it). */
  const impact = (at: Point, kind: keyof typeof IMPACT, scale = 1) => {
    const look = IMPACT[kind];
    const fx = useFx.getState();
    fx.addSprite({ kind: look.kind, at, width: look.width * scale, durationMs: look.ms, anchorY: look.anchorY });
    if (kind === 'hit') {
      fx.addSprite({ kind: 'smoke', at: { x: at.x + 2, y: at.y - 4 }, width: 38 * scale, durationMs: 1100, delayMs: 300, rise: 16 });
    }
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
    const centre = targetCentre(actorId, at);
    useFx.getState().removeBombAt(key);
    // Under the mushroom a miss is only churned water; a hit still burns.
    if (isNuke) {
      if (kind !== 'miss') impact(centre, kind === 'mine' ? 'mine' : 'hit', 0.8);
    } else {
      impact(centre, kind);
    }
    if (kind === 'hit') {
      useFx.getState().shake(isNuke ? 1 : 0.8);
      haptic('hit');
    }
    await player.wait(isNuke ? 70 : 90);
    const active = isNuke ? nukeCells : bombCells;
    active.delete(key);
    if (active.size === 0) {
      await player.wait(isNuke ? 700 : 420);
      clearAttack();
    }
    return true;
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
          impact(targetCentre(event.playerId, event.at), 'miss');
          await player.wait(260);
          return;

        case 'HIT':
          if (await arsenalImpact(player, event.playerId, event.at, 'hit')) return;
          playSfx('explosion');
          haptic('hit');
          useFx.getState().shake();
          impact(targetCentre(event.playerId, event.at), 'hit');
          await player.wait(330);
          return;

        case 'SUNK': {
          // The wreck redraws on commit; hold so the blast reads before the halo hatches.
          const cells = event.cells;
          const first = cells[0];
          const last = cells[cells.length - 1];
          lastSunkCentre =
            first && last ? { r: (first.r + last.r) / 2, c: (first.c + last.c) / 2 } : null;
          if (lastSunkCentre) {
            const board = targetBoard(event.playerId);
            const centre = {
              x: board.x + (lastSunkCentre.c + 0.5) * CELL,
              y: board.y + (lastSunkCentre.r + 0.5) * CELL,
            };
            const fx = useFx.getState();
            fx.addSprite({ kind: 'explosionInk', at: centre, width: 40 + cells.length * 10, durationMs: 640 });
            fx.addSprite({ kind: 'smoke', at: centre, width: 34 + cells.length * 6, durationMs: 1300, delayMs: 260, rise: 20 });
          }
          deps.commit(event);
          playSfx('shipSink');
          haptic('sink');
          await player.wait(440);
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
          impact(targetCentre(event.playerId, event.at), 'mine');
          await player.wait(340);
          return;

        case 'ITEM_HIT':
          if (await arsenalImpact(player, event.playerId, event.at, 'hit')) return;
          playSfx('explosion');
          haptic('hit');
          impact(targetCentre(event.playerId, event.at), 'item');
          await player.wait(280);
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
          const board = targetBoard(event.playerId);
          const torpedo = event.kind === 'torpedoBomber' || event.kind === 'doubleTorpedoBomber';
          // Torpedoes run column 1 -> 10, so their plane does too; bombers
          // come in from the attacker's side of the sheet.
          const dir = torpedo || mine(event.playerId) ? 1 : -1;
          const row = event.rows.reduce((sum, value) => sum + value, 0) / event.rows.length;
          const y = board.y + (row + 0.5) * CELL;
          const near = dir > 0 ? board.x : board.x + BOARD_SIZE;
          const far = dir > 0 ? board.x + BOARD_SIZE : board.x;
          const startX = near - dir * APPROACH;
          const endX = far + dir * EXIT;
          // Where the plane's work is done: the gun that downs it, the near
          // edge for a torpedo, the target cell for a bomb.
          const markX = event.interceptAt
            ? targetCentre(event.playerId, event.interceptAt).x
            : torpedo
              ? near - dir * 6
              : event.at
                ? targetCentre(event.playerId, event.at).x
                : near;
          const durationMs = Math.abs(endX - startX) / PLANE_SPEED;
          const markMs = Math.abs(markX - startX) / PLANE_SPEED;
          aircraftId = useFx.getState().addAircraft({
            kind: event.kind,
            from: { x: startX, y },
            to: { x: endX, y },
            durationMs,
            dropAtMs: event.interceptAt ? undefined : Math.max(0, markMs - BAY_LEAD_MS),
          });
          torpedoTracksLeft = event.kind === 'doubleTorpedoBomber' ? 2 : 1;
          playSfx('planeFlyby');
          await player.wait(markMs);
          if (torpedo && !event.interceptAt) {
            // The torpedo hits the water at the edge before it runs.
            for (const r of event.rows) {
              useFx.getState().addSprite({
                kind: 'splash',
                at: { x: near - dir * 4, y: board.y + (r + 0.5) * CELL },
                width: 30,
                durationMs: 460,
                anchorY: 0.62,
              });
            }
            await player.wait(90);
          }
          return;
        }

        case 'AIRCRAFT_DOWNED': {
          const gun = targetCentre(event.playerId, event.gunAt);
          const fx = useFx.getState();
          fx.addSprite({ kind: 'turret', at: gun, width: 36, durationMs: 620, anchorY: 0.72 });
          playSfx('planeDown');
          await player.wait(170);
          if (aircraftId !== null) useFx.getState().downAircraft(aircraftId);
          haptic('hit');
          await player.wait(620);
          deps.commit(event);
          useFx.getState().addStamp({ at: gun, text: 'Shot down!', tone: 'red' }, 1300);
          await player.wait(480);
          clearAttack();
          return;
        }

        case 'BOMB_DROPPED': {
          const at = targetCentre(event.playerId, event.at);
          const key = coordKey(event.at);
          useFx.getState().addBomb({ key, kind: event.kind, at, durationMs: BOMB_FALL_MS });
          if (event.resolves) bombCells.add(key);
          playSfx('bombDrop');
          const last = event.index === event.total - 1;
          // The stick leaves the bay in quick succession; the impacts start
          // once the last bomb is down.
          await player.wait(last ? BOMB_FALL_MS : BOMB_STAGGER_MS);
          if (last && event.kind === 'bomber' && bombCells.size === 0) {
            await player.wait(380);
            clearAttack();
          }
          return;
        }

        case 'NUKE_FLASH': {
          bombCells = new Set();
          nukeCells = new Set(event.resolvedCells.map(coordKey));
          const target = targetBoard(event.playerId);
          const at = targetCentre(event.playerId, event.at);
          const fx = useFx.getState();
          fx.removeBombAt(coordKey(event.at));
          fx.whiteFlash(target);
          fx.shake(2.2);
          fx.addSprite({ kind: 'explosionAtomic', at, width: 118, durationMs: 1150, anchorY: 0.62 });
          fx.addSprite({ kind: 'smokeAtomic', at, width: 124, durationMs: 1700, delayMs: 850, anchorY: 0.66, rise: 14 });
          playSfx('nuke');
          haptic('mine');
          await player.wait(260);
          if (nukeCells.size === 0) {
            await player.wait(900);
            clearAttack();
          }
          return;
        }

        case 'SUBMARINE_SURFACED': {
          submarineAt = targetCentre(event.playerId, event.at);
          useFx.getState().addSubmarine({ at: submarineAt });
          torpedoTracksLeft = 2;
          playSfx('subSurface');
          await player.wait(440);
          return;
        }

        case 'TORPEDO_TRAVEL': {
          const travelled = event.path.map((cell) => targetCentre(event.playerId, cell));
          const board = targetBoard(event.playerId);
          // A plane's torpedo enters from the board's near edge; the
          // submarine's leaves its bow or stern.
          const first = event.path[0];
          const start: Point | null = submarineAt
            ? submarineAt
            : first
              ? { x: board.x - 4, y: board.y + (first.r + 0.5) * CELL }
              : null;
          const path = start ? [start, ...travelled] : travelled;
          const durationMs = Math.max(TORPEDO_CELL_MS * 2, path.length * TORPEDO_CELL_MS);
          const id = useFx.getState().addTorpedo({ path, durationMs });
          playSfx('torpedo');
          await player.wait(durationMs);
          useFx.getState().removeTorpedo(id);
          const end = path[path.length - 1];
          if (end && event.hitAt === null) {
            // Ran off the grid: it spends itself in a small plume.
            useFx.getState().addSprite({ kind: 'splash', at: end, width: 26, durationMs: 420, anchorY: 0.62 });
          }
          torpedoTracksLeft = Math.max(0, torpedoTracksLeft - 1);
          if (torpedoTracksLeft === 0) {
            await player.wait(submarineAt === null ? 240 : 200);
            clearAttack();
          }
          return;
        }

        case 'RADAR_RESULT': {
          const cells = atomicFootprint(event.at);
          const origin = targetBoard(event.playerId);
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
            durationMs: RADAR_SWEEP_MS + RADAR_RESULT_MS,
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
