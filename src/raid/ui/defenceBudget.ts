/**
 * The defence editor's budget and caps — part-07 §2, tested by §8.1.
 *
 * Every number here comes from `@engine/raid`. This module does not decide
 * what a mine costs or how many a Coastal Command 3 may have; it turns the
 * engine's tables into the three things the placement screen needs:
 *
 *   - the chip text, "Harbour fuel 74 / 90"
 *   - whether one more of a kind may be bought
 *   - which kinds the shop should offer at all
 *
 * The placement store then enforces it in ONE added guard, so the match path
 * and the harbour path are the same code with a different budget.
 */
import { specFor } from '@engine/arsenal';
import {
  HARBOUR_KINDS,
  RAID_KIT_KINDS,
  harbourCapsFor,
  harbourFuelFor,
  raidFuelFor,
  type HarbourCaps,
} from '@engine/raid';
import type { ArsenalItem, ArsenalKind } from '@engine/types';

export interface DefenceBudget {
  readonly spent: number;
  readonly budget: number;
  readonly remaining: number;
  /** §2.1 — "Harbour fuel 74 / 90". */
  readonly label: string;
}

export function harbourBudget(
  arsenal: readonly ArsenalItem[],
  coastalCommandLevel: number,
): DefenceBudget {
  const budget = harbourFuelFor(coastalCommandLevel);
  const spent = arsenal.reduce((n, item) => n + specFor(item.kind).cost, 0);
  return {
    spent,
    budget,
    remaining: budget - spent,
    label: `Harbour fuel ${spent} / ${budget}`,
  };
}

/** §3 step 1 — the kit's budget is the Armory's raid fuel. */
export function kitBudget(
  kit: Readonly<Partial<Record<ArsenalKind, number>>>,
  armoryLevel: number,
): DefenceBudget {
  const budget = raidFuelFor(armoryLevel);
  let spent = 0;
  for (const [kind, count] of Object.entries(kit)) {
    if ((count ?? 0) > 0) spent += specFor(kind as ArsenalKind).cost * (count ?? 0);
  }
  return { spent, budget, remaining: budget - spent, label: `Raid fuel ${spent} / ${budget}` };
}

/**
 * The per-kind cap for a harbour. `specFor(kind).max` is the MATCH cap and is
 * not the same number — Coastal Command's caps rise with the building, and at
 * level 6 a harbour may hold 8 mines where a match allows 5.
 */
export function harbourCapFor(kind: ArsenalKind, coastalCommandLevel: number): number {
  const caps = harbourCapsFor(coastalCommandLevel);
  const key = kind as keyof HarbourCaps;
  return key in caps ? caps[key] : 0;
}

export function harbourCapTable(
  coastalCommandLevel: number,
): Readonly<Partial<Record<ArsenalKind, number>>> {
  const out: Partial<Record<ArsenalKind, number>> = {};
  for (const kind of HARBOUR_KINDS) out[kind] = harbourCapFor(kind, coastalCommandLevel);
  return out;
}

export interface BuyCheck {
  readonly ok: boolean;
  /** Player-facing, already in the Captain's register. Null when ok. */
  readonly reason: string | null;
}

/**
 * May one more of this kind be bought? The shop asks before it offers, and
 * the store asks again before it commits — same function both times, so the
 * button and the rule can never disagree.
 */
export function canBuyForHarbour(
  arsenal: readonly ArsenalItem[],
  kind: ArsenalKind,
  context: { coastalCommandLevel: number; unlocks: readonly string[] },
): BuyCheck {
  if (!HARBOUR_KINDS.includes(kind)) {
    return { ok: false, reason: `${label(kind)} is not a harbour defence.` };
  }

  const needsResearch = kind === 'sonar_net' || kind === 'decoy';
  if (needsResearch && !context.unlocks.includes(kind)) {
    return { ok: false, reason: `The Academy has not finished the ${label(kind)} yet.` };
  }

  const cap = harbourCapFor(kind, context.coastalCommandLevel);
  const held = arsenal.filter((item) => item.kind === kind).length;
  if (held >= cap) {
    return {
      ok: false,
      reason:
        cap === 0
          ? `Coastal Command cannot supply a ${label(kind)} at this level.`
          : `${cap} ${label(kind)}${cap === 1 ? '' : 's'} is all Coastal Command will spare.`,
    };
  }

  const budget = harbourBudget(arsenal, context.coastalCommandLevel);
  if (specFor(kind).cost > budget.remaining) {
    return { ok: false, reason: 'Not enough harbour fuel.' };
  }

  return { ok: true, reason: null };
}

/** §3 step 1 — offensive kinds only, at match caps, inside the raid fuel. */
export function canBuyForKit(
  kit: Readonly<Partial<Record<ArsenalKind, number>>>,
  kind: ArsenalKind,
  context: { armoryLevel: number; unlocks: readonly string[] },
): BuyCheck {
  if (!RAID_KIT_KINDS.includes(kind)) {
    return { ok: false, reason: `${label(kind)} defends a harbour; it does not raid one.` };
  }

  const needsResearch = kind === 'minesweeper';
  if (needsResearch && !context.unlocks.includes(kind)) {
    return { ok: false, reason: `The Academy has not finished the ${label(kind)} yet.` };
  }

  const held = kit[kind] ?? 0;
  const max = specFor(kind).max;
  if (held >= max) {
    return { ok: false, reason: `${max} is all the Armory will load.` };
  }

  if (specFor(kind).cost > kitBudget(kit, context.armoryLevel).remaining) {
    return { ok: false, reason: 'Not enough raid fuel.' };
  }

  return { ok: true, reason: null };
}

/** Which kinds the shop offers, in the order it offers them. */
export function harbourShopKinds(): readonly ArsenalKind[] {
  return HARBOUR_KINDS;
}

export function kitShopKinds(): readonly ArsenalKind[] {
  return RAID_KIT_KINDS;
}

const NAMES: Partial<Record<ArsenalKind, string>> = {
  mine: 'mine',
  aaGun: 'AA gun',
  radar: 'radar',
  sonar_net: 'sonar net',
  decoy: 'decoy',
  bomber: 'bomber',
  atomicBomber: 'atomic bomber',
  torpedoBomber: 'torpedo bomber',
  doubleTorpedoBomber: 'double torpedo bomber',
  submarine: 'submarine',
  minesweeper: 'minesweeper',
};

function label(kind: ArsenalKind): string {
  return NAMES[kind] ?? String(kind);
}
