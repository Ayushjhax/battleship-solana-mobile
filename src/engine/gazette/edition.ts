/**
 * Assembling one edition — part-09 §1, tested by §5.5.
 *
 * "one big headline, two or three sub-stories, 'Captain's corner' (a rotating
 *  tactical tip), a weather box (nautical flavour, decorative), and the back
 *  page — the daily puzzle."
 *
 * The whole generator is: run every template's trigger over the day, sort by
 * score, take the top one as the headline and the next two as sub-stories.
 * That is §1's rule verbatim, and it is deterministic — §5.5's "the edition is
 * stable for the whole day" falls out of it, given the same summary.
 */
import { TEMPLATES, tipFor, weatherFor, type DaySummary, type SlotValues, type Template } from './templates';
import type { SeaId } from '../terrain';

export interface Story {
  readonly templateId: string;
  readonly score: number;
  /** The rendered line, slots filled. */
  readonly text: string;
}

export interface Edition {
  readonly date: string;
  readonly masthead: string;
  readonly price: string;
  readonly headline: Story;
  readonly subStories: readonly Story[];
  readonly tip: string;
  readonly weather: string;
  /** §1 — "the back page — the daily puzzle." */
  readonly puzzleNumber: number;
  /**
   * Part 10B — the season's sea, announced here so ranked players know the
   * water before they place. Null while the seas flag is off.
   */
  readonly seasonSea: { id: SeaId; name: string } | null;
}

export const MASTHEAD = 'THE PORT GAZETTE';
/** §1 — "a joke price". */
export const PRICE = 'One coin';

/**
 * Fills a template's slots.
 *
 * §1 — "Templates are localisable strings with named slots, **never
 * concatenated sentences**." So this is a substitution over ONE string. A
 * missing slot renders as an empty string rather than the literal `{name}`,
 * because a player seeing braces is worse than a player seeing a gap — but
 * §5.5 asserts no template ever reaches that path.
 */
export function render(text: string, slots: SlotValues): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = slots[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

/** Every slot name a template's text asks for. */
export function slotsIn(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
}

/** The templates that fire for this day, best first. */
export function matching(day: DaySummary): Template[] {
  return TEMPLATES.filter((template) => {
    try {
      return template.trigger(day);
    } catch {
      // A template that throws is a bug, but it must not take the paper down.
      return false;
    }
  }).sort((a, b) => (b.score === a.score ? (a.id < b.id ? -1 : 1) : b.score - a.score));
}

function toStory(template: Template, day: DaySummary): Story {
  return {
    templateId: template.id,
    score: template.score,
    text: render(template.text, template.slots(day)),
  };
}

/**
 * §1 — "the highest-scoring event of the day becomes the headline, the next
 * two become sub-stories."
 *
 * The quiet-day template has score 0 and always triggers, so `matching()` is
 * never empty and §5.5's "never an empty page" is structural rather than a
 * special case.
 */
export function buildEdition(
  day: DaySummary,
  date: string,
  puzzleNo: number,
  seasonSea: { id: SeaId; name: string } | null = null,
): Edition {
  const stories = matching(day);
  const headline = stories[0]!; // `quiet` guarantees at least one
  const subStories = stories.slice(1, 4).map((template) => toStory(template, day));

  return {
    date,
    masthead: MASTHEAD,
    price: PRICE,
    headline: toStory(headline, day),
    subStories,
    tip: tipFor(date),
    weather: weatherFor(date),
    puzzleNumber: puzzleNo,
    seasonSea,
  };
}

/** A day on which nothing at all happened — the shape §5.5 asks about. */
export function quietDay(name: string): DaySummary {
  return {
    name,
    matchesPlayed: 0,
    matchesWon: 0,
    onlineWon: 0,
    bestWinStreak: 0,
    shipsSunk: 0,
    battleshipsSunk: 0,
    planesDownedByOneGun: 0,
    atomicMultiKill: 0,
    atomicRow: null,
    longestHitRun: 0,
    wonWithShipsAfloat: 0,
    rankedUp: null,
    beatHardAi: false,
    raidsRun: 0,
    raidStars: 0,
    bestRaidStars: 0,
    bestRaidTarget: null,
    raidSteel: 0,
    defendedAt: null,
    defendedAgainst: null,
    raidedBy: null,
    raidedForSteel: 0,
    upgradesFinished: 0,
    admiraltyLevel: 0,
    admiraltyUp: false,
    steelCollected: 0,
    scrapCollected: 0,
    buildingFinished: null,
    researchFinished: null,
    contractsClaimed: 0,
    weeklyClaimed: 0,
    inkEarned: 0,
    logPage: 0,
    fleetName: null,
    donationsGiven: 0,
    warResult: null,
    warOpponent: null,
    warStars: 0,
    puzzleShots: null,
    puzzleBeatPar: false,
    puzzleStreak: 0,
    voyagesReturned: 0,
    voyageCoins: 0,
    pirateWins: 0,
    topCaptain: null,
    biggestRaidBy: null,
    biggestRaidSteel: 0,
    fleetWarWinner: null,
  };
}
