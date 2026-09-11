/**
 * Transient visuals in flight — shells, bursts, the mine flash, the crosshair,
 * the camera shake nonce. The battle effects push into it; FxLayer renders it;
 * each visual removes itself when its animation ends (or when skipped).
 */
import type { ArsenalKind, Coord } from '@engine/types';
import { create } from 'zustand';

import type { Point } from '@/board/layout';

export type BurstKind = 'hit' | 'miss' | 'mine';

export interface Shell {
  readonly id: number;
  readonly from: Point;
  readonly to: Point;
  readonly durationMs: number;
}

export interface Burst {
  readonly id: number;
  readonly at: Point;
  readonly kind: BurstKind;
}

export interface Aircraft {
  readonly id: number;
  readonly kind: Extract<
    ArsenalKind,
    'torpedoBomber' | 'doubleTorpedoBomber' | 'bomber' | 'atomicBomber'
  >;
  readonly from: Point;
  readonly to: Point;
  readonly durationMs: number;
  readonly downedAt?: Point;
}

export interface Bomb {
  readonly id: number;
  readonly kind: 'bomber' | 'atomicBomber';
  readonly from: Point;
  readonly to: Point;
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
}

export interface RadarFx {
  readonly id: number;
  readonly at: Point;
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly count: number;
  readonly durationMs: number;
}

export interface InterceptFx {
  readonly id: number;
  readonly at: Point;
  readonly revealed: boolean;
}

export interface Crosshair {
  readonly at: Coord;
  /** Canvas point of the cell centre. */
  readonly centre: Point;
}

interface FxData {
  shells: readonly Shell[];
  bursts: readonly Burst[];
  aircraft: readonly Aircraft[];
  bombs: readonly Bomb[];
  torpedoes: readonly TorpedoTrack[];
  submarines: readonly SubmarineFx[];
  radars: readonly RadarFx[];
  intercepts: readonly InterceptFx[];
  crosshair: Crosshair | null;
  flashNonce: number;
  whiteFlashNonce: number;
  whiteFlashAt: Point | null;
  shakeNonce: number;
}

interface FxActions {
  addShell: (shell: Omit<Shell, 'id'>) => number;
  removeShell: (id: number) => void;
  addBurst: (burst: Omit<Burst, 'id'>) => number;
  removeBurst: (id: number) => void;
  addAircraft: (aircraft: Omit<Aircraft, 'id'>) => number;
  downAircraft: (id: number, at: Point) => void;
  removeAircraft: (id: number) => void;
  addBomb: (bomb: Omit<Bomb, 'id'>) => number;
  removeBomb: (id: number) => void;
  addTorpedo: (torpedo: Omit<TorpedoTrack, 'id'>) => number;
  removeTorpedo: (id: number) => void;
  addSubmarine: (submarine: Omit<SubmarineFx, 'id'>) => number;
  removeSubmarine: (id: number) => void;
  addRadar: (radar: Omit<RadarFx, 'id'>) => number;
  removeRadar: (id: number) => void;
  addIntercept: (intercept: Omit<InterceptFx, 'id'>) => number;
  revealIntercept: (id: number) => void;
  removeIntercept: (id: number) => void;
  setCrosshair: (crosshair: Crosshair | null) => void;
  flash: () => void;
  whiteFlash: (at: Point) => void;
  shake: () => void;
  clearAttack: () => void;
  clear: () => void;
}

let nextId = 1;

export const useFx = create<FxData & FxActions>((set) => ({
  shells: [],
  bursts: [],
  aircraft: [],
  bombs: [],
  torpedoes: [],
  submarines: [],
  radars: [],
  intercepts: [],
  crosshair: null,
  flashNonce: 0,
  whiteFlashNonce: 0,
  whiteFlashAt: null,
  shakeNonce: 0,
  addShell: (shell) => {
    const id = nextId++;
    set((s) => ({ shells: [...s.shells, { ...shell, id }] }));
    return id;
  },
  removeShell: (id) => set((s) => ({ shells: s.shells.filter((x) => x.id !== id) })),
  addBurst: (burst) => {
    const id = nextId++;
    set((s) => ({ bursts: [...s.bursts, { ...burst, id }] }));
    return id;
  },
  removeBurst: (id) => set((s) => ({ bursts: s.bursts.filter((x) => x.id !== id) })),
  addAircraft: (aircraft) => {
    const id = nextId++;
    set((s) => ({ aircraft: [...s.aircraft, { ...aircraft, id }] }));
    return id;
  },
  downAircraft: (id, at) =>
    set((s) => ({
      aircraft: s.aircraft.map((aircraft) =>
        aircraft.id === id ? { ...aircraft, downedAt: at } : aircraft,
      ),
    })),
  removeAircraft: (id) =>
    set((s) => ({ aircraft: s.aircraft.filter((aircraft) => aircraft.id !== id) })),
  addBomb: (bomb) => {
    const id = nextId++;
    set((s) => ({ bombs: [...s.bombs, { ...bomb, id }] }));
    return id;
  },
  removeBomb: (id) => set((s) => ({ bombs: s.bombs.filter((bomb) => bomb.id !== id) })),
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
  removeSubmarine: (id) =>
    set((s) => ({ submarines: s.submarines.filter((submarine) => submarine.id !== id) })),
  addRadar: (radar) => {
    const id = nextId++;
    set((s) => ({ radars: [...s.radars, { ...radar, id }] }));
    return id;
  },
  removeRadar: (id) => set((s) => ({ radars: s.radars.filter((radar) => radar.id !== id) })),
  addIntercept: (intercept) => {
    const id = nextId++;
    set((s) => ({ intercepts: [...s.intercepts, { ...intercept, id }] }));
    return id;
  },
  revealIntercept: (id) =>
    set((s) => ({
      intercepts: s.intercepts.map((intercept) =>
        intercept.id === id ? { ...intercept, revealed: true } : intercept,
      ),
    })),
  removeIntercept: (id) =>
    set((s) => ({ intercepts: s.intercepts.filter((intercept) => intercept.id !== id) })),
  setCrosshair: (crosshair) => set({ crosshair }),
  flash: () => set((s) => ({ flashNonce: s.flashNonce + 1 })),
  whiteFlash: (at) => set((s) => ({ whiteFlashNonce: s.whiteFlashNonce + 1, whiteFlashAt: at })),
  shake: () => set((s) => ({ shakeNonce: s.shakeNonce + 1 })),
  clearAttack: () =>
    set({ aircraft: [], bombs: [], torpedoes: [], submarines: [], radars: [], intercepts: [] }),
  clear: () =>
    set({
      shells: [],
      bursts: [],
      aircraft: [],
      bombs: [],
      torpedoes: [],
      submarines: [],
      radars: [],
      intercepts: [],
      crosshair: null,
    }),
}));
