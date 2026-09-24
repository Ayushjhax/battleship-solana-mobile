/**
 * The Port Gazette's headline templates — part-09 §1, tested by §5.5.
 *
 * "**Headline generation is templates, not prose generation.** About 40
 *  templates, each with a trigger and a score; the highest-scoring event of
 *  the day becomes the headline, the next two become sub-stories."
 *
 * TWO RULES THIS FILE KEEPS, both from §1:
 *
 * 1. "Templates are localisable strings with named slots, **never
 *    concatenated sentences**." So a template is one string with `{slots}` in
 *    it. There is no `a + ' ' + b` anywhere, and a test greps for one — a
 *    concatenated sentence cannot be translated, because word order differs.
 *
 * 2. "Names are already 1-14 characters and profanity-filtered at creation,
 *    so **no new moderation surface**." A slot takes a name the game already
 *    accepted; nothing here can introduce free text.
 */

/** Everything a template may ask about the player's last 24 hours (§1). */
export interface DaySummary {
  readonly name: string;
  // ---- matches ----
  readonly matchesPlayed: number;
  readonly matchesWon: number;
  readonly onlineWon: number;
  readonly bestWinStreak: number;
  readonly shipsSunk: number;
  readonly battleshipsSunk: number;
  readonly planesDownedByOneGun: number;
  readonly atomicMultiKill: number;
  /** The row letter the atomic landed on, for §1's worked example. */
  readonly atomicRow: string | null;
  readonly longestHitRun: number;
  readonly wonWithShipsAfloat: number;
  readonly rankedUp: string | null;
  readonly beatHardAi: boolean;
  // ---- raids ----
  readonly raidsRun: number;
  readonly raidStars: number;
  readonly bestRaidStars: number;
  readonly bestRaidTarget: string | null;
  readonly raidSteel: number;
  readonly defendedAt: number | null;
  readonly defendedAgainst: string | null;
  readonly raidedBy: string | null;
  readonly raidedForSteel: number;
  // ---- city ----
  readonly upgradesFinished: number;
  readonly admiraltyLevel: number;
  readonly admiraltyUp: boolean;
  readonly steelCollected: number;
  readonly scrapCollected: number;
  readonly buildingFinished: string | null;
  readonly researchFinished: string | null;
  // ---- contracts and log ----
  readonly contractsClaimed: number;
  readonly weeklyClaimed: number;
  readonly inkEarned: number;
  readonly logPage: number;
  // ---- fleet ----
  readonly fleetName: string | null;
  readonly donationsGiven: number;
  readonly warResult: 'won' | 'lost' | 'draw' | null;
  readonly warOpponent: string | null;
  readonly warStars: number;
  // ---- puzzle ----
  readonly puzzleShots: number | null;
  readonly puzzleBeatPar: boolean;
  readonly puzzleStreak: number;
  // ---- voyages ----
  readonly voyagesReturned: number;
  readonly voyageCoins: number;
  readonly pirateWins: number;
  // ---- global feed (§1) ----
  readonly topCaptain: string | null;
  readonly biggestRaidBy: string | null;
  readonly biggestRaidSteel: number;
  readonly fleetWarWinner: string | null;
}

export type SlotValues = Readonly<Record<string, string | number>>;

export interface Template {
  readonly id: string;
  /** §1's score. The highest scoring match becomes the headline. */
  readonly score: number;
  /** One localisable string with named slots. NEVER built by concatenation. */
  readonly text: string;
  /** Does this day contain the event? */
  readonly trigger: (day: DaySummary) => boolean;
  /** The values for this template's slots. */
  readonly slots: (day: DaySummary) => SlotValues;
  /** Which section it can appear in. */
  readonly kind: 'story' | 'tip' | 'weather';
}

const t = (
  id: string,
  score: number,
  text: string,
  trigger: (day: DaySummary) => boolean,
  slots: (day: DaySummary) => SlotValues = () => ({}),
  kind: Template['kind'] = 'story',
): Template => ({ id, score, text, trigger, slots, kind });

const name = (day: DaySummary) => ({ name: day.name });

// ---------------------------------------------------------------------------
// The catalogue — §1's examples, plus the rest of the ~40
// ---------------------------------------------------------------------------

export const TEMPLATES: readonly Template[] = [
  // ---- §1's six worked examples, at §1's scores ------------------------
  t(
    'rank-up',
    90,
    '{name} made {rank}',
    (d) => d.rankedUp !== null,
    (d) => ({ name: d.name, rank: d.rankedUp ?? '' }),
  ),
  t(
    'raid-three-star',
    85,
    "{name} clears {defender}'s harbour",
    (d) => d.bestRaidStars >= 3 && d.bestRaidTarget !== null,
    (d) => ({ name: d.name, defender: d.bestRaidTarget ?? '' }),
  ),
  t(
    'atomic-multi',
    80,
    'Atomic strike! {k} ships lost in one blast off {rowLetter}',
    // Both halves, because §1's text names the row and a template must never
    // render with an empty slot (§5.5).
    (d) => d.atomicMultiKill >= 2 && d.atomicRow !== null,
    (d) => ({ k: d.atomicMultiKill, rowLetter: d.atomicRow ?? '' }),
  ),
  t(
    'defended',
    75,
    "Harbour holds: {raider}'s raid stopped at {pct}%",
    (d) => d.defendedAt !== null && d.defendedAgainst !== null,
    (d) => ({ raider: d.defendedAgainst ?? '', pct: Math.round((d.defendedAt ?? 0) * 100) }),
  ),
  t(
    'gun-triple',
    70,
    '{name} downs {n} bombers with a single gun!',
    (d) => d.planesDownedByOneGun >= 3,
    (d) => ({ name: d.name, n: d.planesDownedByOneGun }),
  ),
  /** §1's fallback, score 0, no trigger — it ALWAYS matches. */
  t('quiet', 0, 'Quiet week on the water', () => true),

  // ---- battle ----------------------------------------------------------
  t('war-won', 88, '{fleet} takes the war from {opponent}, {stars} stars to spare',
    (d) => d.warResult === 'won' && d.fleetName !== null,
    (d) => ({ fleet: d.fleetName ?? '', opponent: d.warOpponent ?? '', stars: d.warStars })),
  t('beat-hard', 68, '{name} sees off the Hard captain',
    (d) => d.beatHardAi, name),
  t('win-streak', 66, '{name} takes {n} in a row',
    (d) => d.bestWinStreak >= 3, (d) => ({ name: d.name, n: d.bestWinStreak })),
  t('flagship-hunter', 64, '{n} flagships sent down in one day',
    (d) => d.battleshipsSunk >= 3, (d) => ({ n: d.battleshipsSunk })),
  t('run-of-hits', 62, 'A run of {n} straight hits off the north channel',
    (d) => d.longestHitRun >= 5, (d) => ({ n: d.longestHitRun })),
  t('untouched-win', 60, '{name} wins without losing a ship',
    (d) => d.wonWithShipsAfloat >= 8, name),
  t('near-untouched', 52, '{name} comes home with {n} still afloat',
    (d) => d.wonWithShipsAfloat >= 4, (d) => ({ name: d.name, n: d.wonWithShipsAfloat })),
  t('busy-day', 40, '{n} battles fought before supper',
    (d) => d.matchesPlayed >= 8, (d) => ({ n: d.matchesPlayed })),
  t('online-wins', 58, '{n} victories at sea today',
    (d) => d.onlineWon >= 3, (d) => ({ n: d.onlineWon })),
  t('ships-sunk', 36, '{n} hulls on the bottom',
    (d) => d.shipsSunk >= 10, (d) => ({ n: d.shipsSunk })),
  t('one-win', 30, '{name} takes the day',
    (d) => d.matchesWon >= 1, name),

  // ---- raids -----------------------------------------------------------
  t('raid-haul', 74, '{n} steel carried off in a single day',
    (d) => d.raidSteel >= 2_000, (d) => ({ n: d.raidSteel })),
  t('raid-stars', 69, '{n} stars taken from the harbours',
    (d) => d.raidStars >= 9, (d) => ({ n: d.raidStars })),
  t('raided-badly', 67, '{raider} makes off with {n} steel',
    (d) => d.raidedBy !== null && d.raidedForSteel >= 500,
    (d) => ({ raider: d.raidedBy ?? '', n: d.raidedForSteel })),
  t('raids-run', 44, '{n} harbours visited, not one invited',
    (d) => d.raidsRun >= 4, (d) => ({ n: d.raidsRun })),
  t('two-star', 56, '{name} takes two stars off {defender}',
    (d) => d.bestRaidStars === 2 && d.bestRaidTarget !== null,
    (d) => ({ name: d.name, defender: d.bestRaidTarget ?? '' })),

  // ---- city ------------------------------------------------------------
  t('admiralty-up', 82, 'The Admiralty rises to {level}',
    (d) => d.admiraltyUp, (d) => ({ level: d.admiraltyLevel })),
  t('research-done', 72, 'The Academy signs off the {item}',
    (d) => d.researchFinished !== null, (d) => ({ item: d.researchFinished ?? '' })),
  t('building-done', 54, 'The {building} opens its doors',
    (d) => d.buildingFinished !== null, (d) => ({ building: d.buildingFinished ?? '' })),
  t('upgrades', 42, '{n} upgrades finished in a day',
    (d) => d.upgradesFinished >= 3, (d) => ({ n: d.upgradesFinished })),
  t('steel-haul', 34, '{n} steel through the foundry',
    (d) => d.steelCollected >= 5_000, (d) => ({ n: d.steelCollected })),
  t('scrapyard', 26, 'The Scrapyard cleared {n} times',
    (d) => d.scrapCollected >= 3, (d) => ({ n: d.scrapCollected })),

  // ---- contracts and the Log -------------------------------------------
  t('weekly-done', 63, 'A weekly contract signed off',
    (d) => d.weeklyClaimed >= 1),
  t('contracts', 46, '{n} contracts settled at the Harbour Master',
    (d) => d.contractsClaimed >= 3, (d) => ({ n: d.contractsClaimed })),
  t('log-page', 38, "The Captain's Log reaches page {page}",
    (d) => d.logPage >= 10, (d) => ({ page: d.logPage })),
  t('ink', 24, '{n} ink laid down today',
    (d) => d.inkEarned >= 500, (d) => ({ n: d.inkEarned })),

  // ---- puzzle ----------------------------------------------------------
  t('puzzle-admiral', 86, "An Admiral's round: {n} shots on the back page",
    (d) => d.puzzleShots !== null && d.puzzleShots < 46, (d) => ({ n: d.puzzleShots ?? 0 })),
  t('puzzle-par', 65, 'Under par on the back page — {n} shots',
    (d) => d.puzzleBeatPar && d.puzzleShots !== null, (d) => ({ n: d.puzzleShots ?? 0 })),
  t('puzzle-streak', 57, '{n} days running on the back page',
    (d) => d.puzzleStreak >= 7, (d) => ({ n: d.puzzleStreak })),
  t('puzzle-done', 28, 'The back page solved in {n}',
    (d) => d.puzzleShots !== null, (d) => ({ n: d.puzzleShots ?? 0 })),

  // ---- fleet -----------------------------------------------------------
  t('war-lost', 61, '{fleet} comes off worse against {opponent}',
    (d) => d.warResult === 'lost' && d.fleetName !== null,
    (d) => ({ fleet: d.fleetName ?? '', opponent: d.warOpponent ?? '' })),
  t('war-draw', 50, '{fleet} and {opponent} fight to a standstill',
    (d) => d.warResult === 'draw' && d.fleetName !== null,
    (d) => ({ fleet: d.fleetName ?? '', opponent: d.warOpponent ?? '' })),
  t('generous', 48, '{name} fills {n} requests for the fleet',
    (d) => d.donationsGiven >= 3, (d) => ({ name: d.name, n: d.donationsGiven })),

  // ---- voyages ---------------------------------------------------------
  t('pirates-beaten', 59, 'Pirates seen off {n} times on the trade routes',
    (d) => d.pirateWins >= 2, (d) => ({ n: d.pirateWins })),
  t('voyage-haul', 43, '{n} coins home from the trade routes',
    (d) => d.voyageCoins >= 2_000, (d) => ({ n: d.voyageCoins })),
  t('voyages', 22, '{n} merchantmen safely docked',
    (d) => d.voyagesReturned >= 2, (d) => ({ n: d.voyagesReturned })),

  // ---- the global feed (§1) --------------------------------------------
  t('top-captain', 20, '{captain} still holds the top of the ladder',
    (d) => d.topCaptain !== null, (d) => ({ captain: d.topCaptain ?? '' })),
  t('biggest-raid', 18, "The day's biggest haul: {raider} takes {n} steel",
    (d) => d.biggestRaidBy !== null && d.biggestRaidSteel > 0,
    (d) => ({ raider: d.biggestRaidBy ?? '', n: d.biggestRaidSteel })),
  t('fleet-war-news', 16, '{fleet} wins its war',
    (d) => d.fleetWarWinner !== null, (d) => ({ fleet: d.fleetWarWinner ?? '' })),
];

// ---------------------------------------------------------------------------
// Captain's corner (§1 — "a rotating tactical tip")
// ---------------------------------------------------------------------------

export const TIPS: readonly string[] = [
  'A ship is never alone. Find one cell, work the four around it.',
  'Mines earn their keep in the corners, where nobody aims first.',
  'A decoy is worth four shells if you put it where a ship would be.',
  'Keep one bomber back. A raid with no shells left is not over.',
  'The no-touch rule works for you too: a sunk ship clears its own halo.',
  'Sonar nets stop submarines and nothing else. Buy them for a reason.',
  'Raid at the top of the hour, when the collectors are full.',
  'Two stars is a good raid. Three is a lucky one.',
  'Shield time is worth more than the steel it saved you.',
  'Fill a fleetmate’s request before you post your own.',
  'A war harbour is not your home harbour. Move something.',
  'The back page rewards patience, not speed.',
  'Parity: after a miss, skip a cell. Ships are two long at least.',
  'Collect before you sleep. A full Fish Market earns nothing.',
];

export function tipFor(date: string): string {
  let h = 0;
  for (let i = 0; i < date.length; i++) h = (h * 31 + date.charCodeAt(i)) >>> 0;
  return TIPS[h % TIPS.length]!;
}

// ---------------------------------------------------------------------------
// The weather box (§1 — "nautical flavour, decorative")
// ---------------------------------------------------------------------------

export const WEATHER: readonly string[] = [
  'Fair, with a following sea.',
  'Fog on the bar until noon.',
  'A stiff westerly. Reef early.',
  'Flat calm. Row if you must.',
  'Squalls after dark.',
  'Clear and cold; good visibility.',
  'Heavy swell from the north.',
  'Rain, then more rain.',
];

export function weatherFor(date: string): string {
  let h = 7;
  for (let i = 0; i < date.length; i++) h = (h * 37 + date.charCodeAt(i)) >>> 0;
  return WEATHER[h % WEATHER.length]!;
}
