// Prints every tuned number in the package straight from the reference
// catalogue, so the docs and the rules can never disagree.

import {
  BuildingId,
  CATALOGUE,
  LOOT_CAP,
  STAR_BONUS,
  STARTING_GRANT,
  VAULT_PROTECTION,
  WALLET_LOOT_RATE,
  WORKER_GEM_COST,
  WORKER_ADMIRALTY_REQ,
  STORE_LOOT_RATE,
  renownDelta,
  salvageFor,
  speedUpGems,
} from '../src/city.js';
import { CAP, FUEL } from '../src/resolve.js';
import { RAID } from '../src/raid.js';

const out: string[] = [];
const P = (s = '') => out.push(s);

const dur = (m: number) => {
  if (m === 0) return 'instant';
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
  const d = Math.floor(m / 1440);
  const h = Math.round((m - d * 1440) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
};
const n = (x: number) => x.toLocaleString('en-US');

P('# Every Port City number on one page');
P();
P('Generated from `reference/src/city.ts` and `reference/src/resolve.ts` by');
P('`reference/sim/tables.ts`. **Do not hand-edit.** Change the catalogue, re-run, and the');
P('implementation test that pins the catalogue checksum will tell you what moved.');
P();

P('## Buildings');
P();
for (const id of Object.keys(CATALOGUE) as BuildingId[]) {
  const b = CATALOGUE[id];
  const effect =
    b.kind === 'producer'
      ? `${b.produces} per hour (cap ${b.capacityHours} h)`
      : id === 'scrapyard'
        ? 'salvage bonus %'
        : id === 'coastal_command'
          ? 'harbour fuel'
          : id === 'armory'
            ? 'raid fuel'
            : id === 'fleet_hall'
              ? 'reinforcement fuel'
              : 'tier';
  P(`### ${b.name}${b.feature ? ` — flag \`portCity.${b.feature}\`` : ''}`);
  P();
  P(`| Level | Steel | Coins | Build time | Needs Admiralty | ${effect} |`);
  P('| --- | --- | --- | --- | --- | --- |');
  b.levels.forEach((l, i) => {
    const lvl = i + 1;
    const cost = lvl === 1 && b.kind === 'core' ? 'starts built' : `${n(l.steel)}`;
    P(
      `| ${lvl} | ${lvl === 1 && b.kind === 'core' ? '—' : cost} | ${lvl === 1 && b.kind === 'core' ? '—' : n(l.coins)} | ${lvl === 1 && b.kind === 'core' ? '—' : dur(l.minutes)} | ${l.reqAdmiralty} | ${l.value ?? '—'} |`,
    );
  });
  P();
}

P('## Dock workers');
P();
P('| Worker | Cost | Needs Admiralty |');
P('| --- | --- | --- |');
P('| 1st and 2nd | free | — |');
for (let i = 2; i < WORKER_GEM_COST.length; i++)
  P(`| ${i + 1}${i === 2 ? 'rd' : 'th'} | ${WORKER_GEM_COST[i]} gems | ${WORKER_ADMIRALTY_REQ[i]} |`);
P();

P('## Finishing a job early');
P();
P('`gems = ceil(2 × sqrt(seconds remaining / 60))`, and the last minute is free.');
P();
P('| Time left | Gems |');
P('| --- | --- |');
for (const s of [60, 300, 900, 3600, 4 * 3600, 12 * 3600, 24 * 3600, 48 * 3600, 72 * 3600])
  P(`| ${dur(s / 60)} | ${speedUpGems(s)} |`);
P();
P('Cancelling a job hands back half the steel and half the coins and frees the worker.');
P();

P('## Salvage');
P();
P('5 steel per cell of every enemy ship you sank, times the Scrapyard bonus.');
P();
P('| Sunk | Steel (Scrapyard 1) | Scrapyard 3 | Scrapyard 6 |');
P('| --- | --- | --- | --- |');
for (const [label, lens] of [
  ['one boat', [1]],
  ['one destroyer', [2]],
  ['one cruiser', [3]],
  ['the battleship', [4]],
  ['a whole fleet (a win)', [4, 3, 3, 2, 2, 2, 1, 1, 1, 1]],
  ['an average loss (6 ships)', [3, 3, 2, 2, 1, 1]],
] as [string, number[]][])
  P(`| ${label} | ${salvageFor(lens, 1)} | ${salvageFor(lens, 3)} | ${salvageFor(lens, 6)} |`);
P();
P(`Starting grant for an existing profile: ${STARTING_GRANT.steel} steel, ${STARTING_GRANT.gems} gems.`);
P();

P('## Arsenal prices (fuel)');
P();
P('| Item | Fuel | Cap | New? |');
P('| --- | --- | --- | --- |');
const NEW = new Set(['sonar_net', 'decoy', 'minesweeper']);
for (const k of Object.keys(FUEL))
  P(`| ${k.replace(/_/g, ' ')} | ${FUEL[k as keyof typeof FUEL]} | ${CAP[k] ?? '—'} | ${NEW.has(k) ? 'Part 5' : ''} |`);
P();
const fullSet = Object.keys(FUEL).reduce((sum, k) => sum + FUEL[k as keyof typeof FUEL] * (CAP[k] ?? 0), 0);
P(`Everything at its cap now costs **${fullSet} fuel** against the 260 budget (it was 310 before Part 5), so the shelf keeps getting harder to choose from.`);
P();

P('## Raids');
P();
P('| Setting | Value |');
P('| --- | --- |');
P(`| Shells per raid | ${RAID.shells} |`);
P('| A hit | the shell is handed back |');
P(`| A mine | the shell, plus ${RAID.minePenalty} more |`);
P(`| Raid clock | ${RAID.timeLimitMs / 60000} minutes |`);
P('| Stars | one for the battleship, one at 50% destruction, one at 100% |');
P('| Destruction | enemy ship cells hit ÷ 20 |');
P(`| Wallet loot rate | ${WALLET_LOOT_RATE * 100}% of the unprotected balance |`);
P(`| Collector and scrap-pile loot rate | ${STORE_LOOT_RATE * 100}% |`);
P(`| Star bonus (paid by the Admiralty, not the defender) | ${STAR_BONUS.map((s, i) => `${i}★ ${s}`).join(', ')} steel |`);
P();
P('| Defender Admiralty | Vault protects (coins / steel) | One raid can take at most |');
P('| --- | --- | --- |');
for (let a = 1; a <= 8; a++)
  P(
    `| ${a} | ${n(VAULT_PROTECTION[a].coins)} / ${n(VAULT_PROTECTION[a].steel)} | ${n(LOOT_CAP[a].coins)} coins, ${n(LOOT_CAP[a].steel)} steel |`,
  );
P();
P('| Renown example (attacker → defender) | 1★ | 2★ | 3★ | 0★ |');
P('| --- | --- | --- | --- | --- |');
for (const [a, d] of [
  [100, 100],
  [100, 400],
  [400, 100],
  [800, 820],
] as [number, number][])
  P(
    `| ${a} raids ${d} | ${renownDelta(a, d, 1).attacker} | ${renownDelta(a, d, 2).attacker} | ${renownDelta(a, d, 3).attacker} | ${renownDelta(a, d, 0).attacker} |`,
  );
P();
P('| Destruction taken | Shield |');
P('| --- | --- |');
P('| under 40% | none |');
P('| 40–69% | 6 h |');
P('| 70–99% | 10 h |');
P('| 100% | 14 h |');
P();

console.log(out.join('\n'));
