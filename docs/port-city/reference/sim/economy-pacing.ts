// Pacing check for Part 1: how long does an Admiralty level take?
// Run: npm run sim:economy

import {
  BuildingId,
  CATALOGUE,
  CityState,
  LOOT_CAP,
  collect,
  collectScrap,
  creditSalvage,
  freeWorkers,
  newCity,
  settle,
  startUpgrade,
} from '../src/city.js';

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;

type Profile = {
  name: string;
  matchesPerDay: number;
  winRate: number;
  sessions: number[]; // hours of the day the player opens the app
  raidsPerDay: number;
  workers: number;
};

// Everything the player wants, cheapest-first inside each tier.
const PRIORITY: BuildingId[] = [
  'admiralty',
  'foundry',
  'fish_market',
  'scrapyard',
  'harbour_office',
  'coastal_command',
  'armory',
  'naval_academy',
  'shipyard',
  'stationery',
  'newsstand',
  'fleet_hall',
  'trade_docks',
  'officers_club',
  'lighthouse',
];

function trySpend(s: CityState, now: number) {
  for (let guard = 0; guard < 20 && freeWorkers(s) > 0; guard++) {
    let started = false;
    for (const id of PRIORITY) {
      if (startUpgrade(s, id, now) === null) {
        started = true;
        break;
      }
    }
    if (!started) break;
  }
}

function play(profile: Profile, days: number) {
  const s = newCity(T0, 300);
  s.workers = profile.workers;
  const reached: Record<number, number> = { 1: 0 };
  const log: string[] = [];

  for (let day = 0; day < days; day++) {
    for (const hour of profile.sessions) {
      const now = T0 + day * DAY + hour * 3_600_000;
      settle(s, now);

      const matches = profile.matchesPerDay / profile.sessions.length;
      for (let m = 0; m < matches; m++) {
        const win = Math.random() < profile.winRate;
        // A win always clears the enemy fleet; an average loss sinks about 12 cells.
        const sunk = win ? [4, 3, 3, 2, 2, 2, 1, 1, 1, 1] : [3, 3, 2, 2, 1, 1];
        creditSalvage(s, sunk, now);
        s.coins += win ? 50 : 10;
      }

      if (s.buildings.coastal_command.level > 0) {
        const a = s.buildings.admiralty.level;
        const raids = profile.raidsPerDay / profile.sessions.length;
        s.steel += Math.round(raids * (120 + 0.35 * LOOT_CAP[a].steel));
        s.coins += Math.round(raids * 0.35 * LOOT_CAP[a].coins);
      }

      collect(s, 'fish_market', now);
      collect(s, 'foundry', now);
      collectScrap(s, now);
      trySpend(s, now);

      const level = s.buildings.admiralty.level;
      if (reached[level] === undefined) {
        reached[level] = day + hour / 24;
        log.push(`Admiralty ${level} on day ${(day + hour / 24).toFixed(1)}`);
      }
    }
  }
  settle(s, T0 + days * DAY);
  return { state: s, reached, log };
}

const PROFILES: Profile[] = [
  { name: 'hardcore (10 matches/day, 3 sessions, 8 raids)', matchesPerDay: 10, winRate: 0.55, sessions: [8, 13, 21], raidsPerDay: 8, workers: 3 },
  { name: 'active (5 matches/day, 2 sessions, 4 raids)', matchesPerDay: 5, winRate: 0.5, sessions: [9, 20], raidsPerDay: 4, workers: 2 },
  { name: 'casual (2 matches/day, 1 session, 1 raid)', matchesPerDay: 2, winRate: 0.45, sessions: [20], raidsPerDay: 1, workers: 2 },
  { name: 'battles only, never raids', matchesPerDay: 5, winRate: 0.5, sessions: [9, 20], raidsPerDay: 0, workers: 2 },
];

const DAYS = Number(process.env.DAYS ?? 120);
console.log(`# Port City pacing (${DAYS} simulated days)\n`);
console.log('| Profile | A2 | A3 | A4 | A5 | A6 | A7 | A8 | buildings at day ' + DAYS + ' |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const profile of PROFILES) {
  const runs = Array.from({ length: 12 }, () => play(profile, DAYS));
  const day = (lvl: number) => {
    const hits = runs.map((r) => r.reached[lvl]).filter((x) => x !== undefined) as number[];
    if (hits.length < runs.length / 2) return '—';
    return (hits.reduce((a, b) => a + b, 0) / hits.length).toFixed(1);
  };
  const built = runs[0].state;
  const summary = (Object.keys(CATALOGUE) as BuildingId[])
    .filter((id) => built.buildings[id].level > 0)
    .map((id) => `${id.replace(/_/g, ' ')} ${built.buildings[id].level}`)
    .join(', ');
  console.log(
    `| ${profile.name} | ${day(2)} | ${day(3)} | ${day(4)} | ${day(5)} | ${day(6)} | ${day(7)} | ${day(8)} | ${summary} |`,
  );
}

console.log('\n## Daily income at each Admiralty level (active profile)\n');
console.log('| Admiralty | battles (steel/day) | collectors (steel/day) | collectors (coins/day) | raids (steel/day) |');
console.log('| --- | --- | --- | --- | --- |');
for (const a of [1, 3, 5, 7]) {
  const foundry = CATALOGUE.foundry.levels[Math.min(a, 8) - 1].value ?? 0;
  const market = CATALOGUE.fish_market.levels[Math.min(a, 8) - 1].value ?? 0;
  console.log(
    `| ${a} | ${5 * 80} | ${Math.round(foundry * 12)} | ${Math.round(market * 12)} | ${Math.round(4 * (120 + 0.35 * LOOT_CAP[a].steel))} |`,
  );
}
