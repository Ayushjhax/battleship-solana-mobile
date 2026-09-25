/**
 * Transient visuals in flight — shells, sprite effects, aircraft, bombs,
 * torpedoes, the submarine, the radar, the crosshair, the flashes and the
 * camera-shake nonce. The battle effects push into it; FxLayer renders it.
 *
 * Two lifetimes:
 *   - timed pieces (sprite effects, aircraft, bombs, stamps) carry their own
 *     length and remove themselves when it runs out, so an explosion can
 *     keep smoking over the mark it left while the next event already plays
 *     — and a skip never strands one on screen;
 *   - the attack's set pieces (torpedoes, radar) live until the effect that
 *     added them removes them or `clearAttack` ends the attack. The
 *     submarine is told to dive rather than vanish.
 * `clear()` (the screen unmounting) drops everything, timers and all.
 */
import type { ArsenalKind, Coord } from '@engine/types';
import { create } from 'zustand';

import type { Point } from '@/board/layout';

export interface Shell {
  readonly id: number;
  readonly from: Point;
  readonly to: Point;
  readonly durationMs: number;
}

/** Which FX_ART strip a sprite effect plays. */
export type SpriteKind =
  | 'explosionInk'
  | 'explosionFire'
  | 'explosionAtomic'
  | 'explosionPuff'
  | 'mine'
  | 'smoke'
  | 'smokeAtomic'
  | 'turret'
  | 'splash';

/** One run of a strip at a point: an explosion, a splash, smoke, the AA gun firing. */
export interface SpriteFx {
  readonly id: number;
  readonly kind: SpriteKind;
  readonly at: Point;
  /** A cell's width in canvas units. */
  readonly width: number;
  readonly durationMs: number;
  readonly delayMs?: number;
  /** Where in the cell `at` falls, top 0 to bottom 1. */
  readonly anchorY?: number;
  /** Drift upward this far while it plays (smoke rising). */
  readonly rise?: number;
}

export type AircraftKind = Extract<
  ArsenalKind,
  'torpedoBomber' | 'doubleTorpedoBomber' | 'bomber' | 'atomicBomber'
>;

export interface Aircraft {
  readonly id: number;
  readonly kind: AircraftKind;
  /** The plane's centre, start and end of a straight, level run. */
  readonly from: Point;
  readonly to: Point;
  readonly durationMs: number;
  /** When, into the run, the bay opens and the load falls away. */
  readonly dropAtMs?: number;
  /** Shot down: it stops where it is and goes down in a spin. */
  readonly downed?: boolean;
}

/**
 * A bomb falling onto a cell. It falls for `durationMs`, then waits small
 * on the water until its impact is shown (`removeBombAt`) — impacts play in
 * order after the whole stick has dropped, and a sinking in between holds
 * the rest, so the fall can never be timed to land exactly on its impact.
 */
export interface Bomb {
  readonly id: number;
  /** The target cell's coordKey. */
  readonly key: string;
  readonly kind: 'bomber' | 'atomicBomber';
  readonly at: Point;
  readonly durationMs: number;
}

export interface TorpedoTrack {
  readonly id: number;
  readonly path: readonly Point[];
  readonly durationMs: number;
}

export interface SubmarineFx {
  readonly id: number;
  readonly at: Point;
  /** The attack is over: it goes back under. */
  readonly diving?: boolean;
}

export interface RadarFx {
  readonly id: number;
  readonly at: Point;
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly count: number;
  readonly durationMs: number;
}

/** A stamped word over the board ("Shot down!", "AA gun revealed"). */
export interface StampFx {
  readonly id: number;
  readonly at: Point;
  readonly text: string;
  readonly tone: 'red' | 'green';
}

export interface Crosshair {
  readonly at: Coord;
  /** Canvas point of the cell centre. */
  readonly centre: Point;
}

interface FxData {
  shells: readonly Shell[];
  sprites: readonly SpriteFx[];
  aircraft: readonly Aircraft[];
  bombs: readonly Bomb[];
  torpedoes: readonly TorpedoTrack[];
  submarines: readonly SubmarineFx[];
  radars: readonly RadarFx[];
  stamps: readonly StampFx[];
  crosshair: Crosshair | null;
  /** Online only: our shell has landed but the server hasn't said hit or miss yet. */
  pendingShot: Crosshair | null;
  flashNonce: number;
  whiteFlashNonce: number;
  whiteFlashAt: Point | null;
  shakeNonce: number;
  /** How hard the last shake was: 1 a hit, more for the atomic bomb. */
  shakeStrength: number;
}

interface FxActions {
  addShell: (shell: Omit<Shell, 'id'>) => number;
  removeShell: (id: number) => void;
  /** Plays once and removes itself after its delay and length. */
  addSprite: (sprite: Omit<SpriteFx, 'id'>) => number;
  /** Removes itself when the run (or, once downed, the fall) is over. */
  addAircraft: (aircraft: Omit<Aircraft, 'id'>) => number;
  downAircraft: (id: number) => void;
  addBomb: (bomb: Omit<Bomb, 'id'>) => number;
  removeBombAt: (key: string) => void;
  addTorpedo: (torpedo: Omit<TorpedoTrack, 'id'>) => number;
  removeTorpedo: (id: number) => void;
  addSubmarine: (submarine: Omit<SubmarineFx, 'id'>) => number;
  addRadar: (radar: Omit<RadarFx, 'id'>) => number;
  removeRadar: (id: number) => void;
  addStamp: (stamp: Omit<StampFx, 'id'>, ms: number) => number;
  setCrosshair: (crosshair: Crosshair | null) => void;
  setPendingShot: (pendingShot: Crosshair | null) => void;
  flash: () => void;
  whiteFlash: (at: Point) => void;
  shake: (strength?: number) => void;
  clearAttack: () => void;
  clear: () => void;
}

/** How long a downed plane takes to fall, and a diving submarine to go under. */
export const CRASH_MS = 900;
export const DIVE_MS = 520;

let nextId = 1;
/** Every pending self-removal, so clear() can cancel them. */
const timers = new Set<ReturnType<typeof setTimeout>>();
const aircraftTimers = new Map<number, ReturnType<typeof setTimeout>>();

function later(ms: number, run: () => void): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    timers.delete(timer);
    run();
  }, ms);
  timers.add(timer);
  return timer;
}

export const useFx = create<FxData & FxActions>((set, get) => ({
  shells: [],
  sprites: [],
  aircraft: [],
  bombs: [],
  torpedoes: [],
  submarines: [],
  radars: [],
  stamps: [],
  crosshair: null,
  pendingShot: null,
  flashNonce: 0,
  whiteFlashNonce: 0,
  whiteFlashAt: null,
  shakeNonce: 0,
  shakeStrength: 1,
  addShell: (shell) => {
    const id = nextId++;
    set((s) => ({ shells: [...s.shells, { ...shell, id }] }));
    return id;
  },
  removeShell: (id) => set((s) => ({ shells: s.shells.filter((x) => x.id !== id) })),
  addSprite: (sprite) => {
    const id = nextId++;
    set((s) => ({ sprites: [...s.sprites, { ...sprite, id }] }));
    later((sprite.delayMs ?? 0) + sprite.durationMs + 60, () =>
      set((s) => ({ sprites: s.sprites.filter((x) => x.id !== id) })),
    );
    return id;
  },
  addAircraft: (aircraft) => {
    const id = nextId++;
    set((s) => ({ aircraft: [...s.aircraft, { ...aircraft, id }] }));
    aircraftTimers.set(
      id,
      later(aircraft.durationMs + 80, () => {
        aircraftTimers.delete(id);
        set((s) => ({ aircraft: s.aircraft.filter((x) => x.id !== id) }));
      }),
    );
    return id;
  },
  downAircraft: (id) => {
    if (!get().aircraft.some((a) => a.id === id)) return;
    set((s) => ({ aircraft: s.aircraft.map((a) => (a.id === id ? { ...a, downed: true } : a)) }));
    const pending = aircraftTimers.get(id);
    if (pending) {
      clearTimeout(pending);
      timers.delete(pending);
    }
    aircraftTimers.set(
      id,
      later(CRASH_MS + 700, () => {
        aircraftTimers.delete(id);
        set((s) => ({ aircraft: s.aircraft.filter((x) => x.id !== id) }));
      }),
    );
  },
  addBomb: (bomb) => {
    const id = nextId++;
    set((s) => ({ bombs: [...s.bombs, { ...bomb, id }] }));
    // A backstop only: the impact (or the end of the attack) removes it first.
    later(bomb.durationMs + 2600, () => set((s) => ({ bombs: s.bombs.filter((x) => x.id !== id) })));
    return id;
  },
  removeBombAt: (key) => set((s) => ({ bombs: s.bombs.filter((x) => x.key !== key) })),
  addTorpedo: (torpedo) => {
    const id = nextId++;
    set((s) => ({ torpedoes: [...s.torpedoes, { ...torpedo, id }] }));
    return id;
  },
  removeTorpedo: (id) =>
    set((s) => ({ torpedoes: s.torpedoes.filter((torpedo) => torpedo.id !== id) })),
  addSubmarine: (submarine) => {
    const id = nextId++;
    set((s) => ({ submarines: [...s.submarines, { ...submarine, id }] }));
    return id;
  },
  addRadar: (radar) => {
    const id = nextId++;
    set((s) => ({ radars: [...s.radars, { ...radar, id }] }));
    return id;
  },
  removeRadar: (id) => set((s) => ({ radars: s.radars.filter((radar) => radar.id !== id) })),
  addStamp: (stamp, ms) => {
    const id = nextId++;
    set((s) => ({ stamps: [...s.stamps, { ...stamp, id }] }));
    later(ms, () => set((s) => ({ stamps: s.stamps.filter((x) => x.id !== id) })));
    return id;
  },
  setCrosshair: (crosshair) => set({ crosshair }),
  setPendingShot: (pendingShot) => set({ pendingShot }),
  flash: () => set((s) => ({ flashNonce: s.flashNonce + 1 })),
  whiteFlash: (at) => set((s) => ({ whiteFlashNonce: s.whiteFlashNonce + 1, whiteFlashAt: at })),
  shake: (strength = 1) => set((s) => ({ shakeNonce: s.shakeNonce + 1, shakeStrength: strength })),
  clearAttack: () => {
    const diving = get().submarines.filter((sub) => !sub.diving);
    set((s) => ({
      bombs: [],
      torpedoes: [],
      radars: [],
      submarines: s.submarines.map((sub) => ({ ...sub, diving: true })),
    }));
    if (diving.length > 0) {
      const ids = new Set(diving.map((sub) => sub.id));
      later(DIVE_MS + 60, () =>
        set((s) => ({ submarines: s.submarines.filter((sub) => !ids.has(sub.id)) })),
      );
    }
  },
  clear: () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    aircraftTimers.clear();
    set({
      shells: [],
      sprites: [],
      aircraft: [],
      bombs: [],
      torpedoes: [],
      submarines: [],
      radars: [],
      stamps: [],
      crosshair: null,
      pendingShot: null,
    });
  },
}));
