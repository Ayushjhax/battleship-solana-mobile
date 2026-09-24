/**
 * The Captain's tour — part-02 §7. The data half, kept pure so the six beats
 * and the "runs once, can be skipped, can be replayed" rules are testable
 * without a renderer.
 *
 * Same shape as the battle tutorial's script.ts: beats as data, a requirement
 * per beat, and a wrong tap NUDGES rather than failing.
 */
import type { BuildingId } from '@engine/city';

export type TourRequirement =
  | { readonly kind: 'tap-plot'; readonly buildingId: BuildingId }
  | { readonly kind: 'collect'; readonly buildingId: BuildingId }
  | { readonly kind: 'build'; readonly buildingId: BuildingId }
  | { readonly kind: 'acknowledge' };

export interface TourBeat {
  readonly id: string;
  readonly say: string;
  /** The plot the spotlight follows, by id — never a hardcoded coordinate. */
  readonly spotlight?: BuildingId;
  readonly require: TourRequirement;
  /** Shown when the player taps the wrong thing. */
  readonly nudge?: string;
}

export const TOUR_BEATS: readonly TourBeat[] = [
  {
    id: 'welcome',
    say: 'Welcome to your port, captain. Everything here is paid for with what you sink.',
    require: { kind: 'acknowledge' },
  },
  {
    id: 'scrapyard',
    say: 'That is the salvage from your last battles. Take it.',
    spotlight: 'scrapyard',
    require: { kind: 'collect', buildingId: 'scrapyard' },
    nudge: 'The Scrapyard, captain — the pile with the bubble over it.',
  },
  {
    id: 'currencies',
    say: 'Steel builds. Coins buy. Spend both.',
    require: { kind: 'acknowledge' },
  },
  {
    id: 'fish-market',
    say: 'Put the market up. It pays while you are away.',
    spotlight: 'fish_market',
    require: { kind: 'build', buildingId: 'fish_market' },
    nudge: 'The empty plot on the quay. Tap it and press Build.',
  },
  {
    id: 'workers',
    say: 'Our dock workers draw fast when the job is small. Big jobs take hours.',
    require: { kind: 'acknowledge' },
  },
  {
    id: 'admiralty',
    say: 'Raise the Admiralty and the rest of the city follows.',
    spotlight: 'admiralty',
    require: { kind: 'acknowledge' },
  },
];

export const TOUR_LENGTH = TOUR_BEATS.length;

/** Does this action satisfy the beat the player is on? */
export function beatSatisfied(
  beat: TourBeat,
  action: { kind: 'tap-plot' | 'collect' | 'build' | 'acknowledge'; buildingId?: BuildingId },
): boolean {
  const requirement = beat.require;
  if (requirement.kind === 'acknowledge') return action.kind === 'acknowledge';
  if (action.kind !== requirement.kind) return false;
  return action.buildingId === requirement.buildingId;
}

/**
 * The next index, or TOUR_LENGTH when the tour is over. Never goes backwards
 * and never sticks: §7's "wrong taps get a nudge, never a failure".
 */
export function advance(index: number): number {
  return Math.min(TOUR_LENGTH, index + 1);
}

export function isFinished(index: number): boolean {
  return index >= TOUR_LENGTH;
}
