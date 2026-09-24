/**
 * The six plot states — part-02 §3. Pure, so the whole state machine is
 * testable without a renderer (this repo has none in its test setup).
 *
 *   locked      the Admiralty is not high enough yet
 *   empty       buildable, level 0
 *   building    level 0 with a job running   (the pen is drawing it)
 *   built       level >= 1, nothing to do
 *   upgrading   level >= 1 with a job running (scaffold over the old tier)
 *   ready       level >= 1 with something to collect  -> TAP COLLECTS
 *
 * `ready` deliberately outranks `built`: §3 says a ready plot collects on tap
 * rather than opening the sheet, so the bubble is the whole interaction.
 */
import {
  CITY_CATALOGUE,
  maxLevel,
  nextLevelSpec,
  scrapDisplaySlots,
  type BuildingId,
  type CityState,
  type ShipClassName,
} from '@engine/city';

import type { CitySnapshot } from '../types';

export type PlotState = 'locked' | 'empty' | 'building' | 'built' | 'upgrading' | 'ready';

export interface PlotView {
  readonly id: BuildingId;
  readonly state: PlotState;
  readonly level: number;
  /** Level being built, when a job is running. */
  readonly toLevel: number | null;
  /** 0..1 through the current job; 0 when idle. */
  readonly progress: number;
  /** Seconds left, clamped at 0 (§6 — never a negative timer). */
  readonly secondsLeft: number;
  /** True once endsAt has passed but the server has not settled it yet. */
  readonly finishing: boolean;
  /** What is waiting to be collected; 0 unless `ready`. */
  readonly collectAmount: number;
  readonly collectResource: 'coins' | 'steel' | null;
  /** Scrapyard only: the classes of the ships this salvage came from (§6). */
  readonly wrecks: readonly ShipClassName[];
  /** For the locked ribbon: "Admiralty 3". */
  readonly requiredAdmiralty: number | null;
  readonly atMaxLevel: boolean;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * What a plot looks like right now. `now` is SERVER time — the caller adds the
 * store's offset, so a wrong device clock can never change a state.
 */
export function plotStateFor(
  snapshot: CitySnapshot | null,
  id: BuildingId,
  now: number,
): PlotView {
  const spec = CITY_CATALOGUE[id];
  const empty: PlotView = {
    id,
    state: 'locked',
    level: 0,
    toLevel: null,
    progress: 0,
    secondsLeft: 0,
    finishing: false,
    collectAmount: 0,
    collectResource: null,
    wrecks: [],
    requiredAdmiralty: null,
    atMaxLevel: false,
  };
  if (!snapshot) return empty;

  const city: CityState = snapshot.city;
  const building = city.buildings[id];
  if (!building) return empty;

  const level = building.level;
  const job = building.upgrading;
  const atMaxLevel = level >= maxLevel(id);

  // Timers first, so every branch reports them consistently.
  const remainingMs = job ? job.endsAt - now : 0;
  const secondsLeft = job ? Math.max(0, Math.ceil(remainingMs / 1000)) : 0;
  const finishing = job !== undefined && remainingMs <= 0;
  const progress = job
    ? job.endsAt > job.startedAt
      ? clamp01((now - job.startedAt) / (job.endsAt - job.startedAt))
      : 1
    : 0;

  if (job) {
    return {
      ...empty,
      state: level === 0 ? 'building' : 'upgrading',
      level,
      toLevel: job.toLevel,
      progress,
      secondsLeft,
      finishing,
      atMaxLevel,
    };
  }

  if (level > 0) {
    const stored = building.stored;
    const pile = id === 'scrapyard' ? city.scrapPile : 0;
    const amount = spec.kind === 'producer' ? stored : pile;
    if (amount > 0) {
      return {
        ...empty,
        state: 'ready',
        level,
        collectAmount: amount,
        collectResource: id === 'scrapyard' ? 'steel' : (spec.produces ?? 'coins'),
        wrecks:
          id === 'scrapyard'
            ? (city.scrapWrecks ?? []).slice(0, scrapDisplaySlots(level))
            : [],
        atMaxLevel,
      };
    }
    return { ...empty, state: 'built', level, atMaxLevel };
  }

  // Level 0: buildable, or locked behind the Admiralty.
  const next = nextLevelSpec(city, id);
  const required = next?.reqAdmiralty ?? 0;
  if (required > city.buildings.admiralty.level) {
    return { ...empty, state: 'locked', requiredAdmiralty: required };
  }
  return { ...empty, state: 'empty', requiredAdmiralty: required };
}

/** Which tier of art a level draws — part-02 §4: T1 1-2, T2 3-4, T3 5-6, T4 7-8. */
export function tierForLevel(level: number): 1 | 2 | 3 | 4 {
  if (level <= 2) return 1;
  if (level <= 4) return 2;
  if (level <= 6) return 3;
  return 4;
}

/** An accessible label — §10: "Fish Market, level 2, collect 148 coins". */
export function plotLabel(view: PlotView): string {
  const name = CITY_CATALOGUE[view.id].name;
  switch (view.state) {
    case 'locked':
      return `${name}, locked, needs Admiralty ${view.requiredAdmiralty ?? '?'}`;
    case 'empty':
      return `${name}, empty plot, tap to build`;
    case 'building':
      return `${name}, under construction, ${view.secondsLeft} seconds left`;
    case 'upgrading':
      return `${name}, level ${view.level}, upgrading to ${view.toLevel}, ${view.secondsLeft} seconds left`;
    case 'ready':
      return `${name}, level ${view.level}, collect ${view.collectAmount} ${view.collectResource}`;
    case 'built':
      return `${name}, level ${view.level}`;
  }
}
