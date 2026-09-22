// Monte-Carlo calibration for Part 6: how many shells should a raid start with?
// The raider is the masked-view AI from src/ai.ts (Normal = the online bot's
// level, Hard = the deduction-using AI). Run: npm run sim:raid

import { chooseMove, maskedView } from '../src/ai.js';
import { ItemKind } from '../src/grid.js';
import { randomLayout, rng } from '../src/random.js';
import { RAID, RaidState, fireShell, kitLeft, raidScore, startRaid, useKit, end } from '../src/raid.js';
import { Weapon } from '../src/resolve.js';

type Defence = { name: string; counts: Partial<Record<ItemKind, number>> };
type Kit = { name: string; kit: Partial<Record<Weapon, number>> };

const DEFENCES: Defence[] = [
  { name: 'none', counts: {} },
  { name: 'CC1 basic (3 mines, 1 gun)', counts: { mine: 3, aa_gun: 1 } },
  { name: 'CC3 basic (5 mines, 2 guns)', counts: { mine: 5, aa_gun: 2 } },
  { name: 'CC3 researched (5 mines, 2 guns, 2 decoys, 2 nets)', counts: { mine: 5, aa_gun: 2, decoy: 2, sonar_net: 2 } },
  { name: 'CC6 researched (8 mines, 4 guns, 3 decoys, 3 nets)', counts: { mine: 8, aa_gun: 4, decoy: 3, sonar_net: 3 } },
];

const KITS: Kit[] = [
  { name: 'no kit', kit: {} },
  { name: 'Armory 1 (40)', kit: { bomber: 1, submarine: 1 } },
  { name: 'Armory 3 (80)', kit: { atomic: 1, torpedo: 1 } },
  { name: 'Armory 5 (120)', kit: { atomic: 1, double_torpedo: 1, radar: 1, submarine: 1 } },
];

function runRaid(seed: number, defence: Defence, kit: Kit, shells: number, difficulty: 'normal' | 'hard') {
  const layout = randomLayout(seed, defence.counts);
  const s: RaidState = startRaid(layout, { ...kit.kit }, 0, { ...RAID, shells, timeLimitMs: Number.MAX_SAFE_INTEGER });
  const rand = rng(seed ^ 0x9e3779b9);
  let guard = 0;
  while (!s.over && guard++ < 400) {
    const move = chooseMove(maskedView(s.board), { difficulty, kit: s.kit, rand });
    if (move.type === 'none') {
      end(s, 'retreat');
      break;
    }
    if (move.type === 'weapon') {
      const r = useKit(s, move.weapon, move.target);
      if (r.error) s.kit[move.weapon] = 0;
      continue;
    }
    if (s.shells <= 0) {
      if (kitLeft(s) === 0) end(s, 'out_of_shells');
      else {
        // shells gone but a plane is left: fly it, otherwise stop
        const w = (Object.keys(s.kit) as Weapon[]).find((k) => (s.kit[k] ?? 0) > 0)!;
        useKit(s, w, move.cell);
      }
      continue;
    }
    fireShell(s, move.cell);
  }
  const score = raidScore(s);
  return { ...score, shellsLeft: s.shells, reason: s.endReason };
}

function pct(n: number, total: number) {
  return `${((100 * n) / total).toFixed(0)}%`;
}

const N = Number(process.env.N ?? 1500);
const lines: string[] = [];

lines.push('## A. Shots needed to clear an undefended harbour\n');
lines.push('| Raider | median shots | mean shots | mean misses |');
lines.push('| --- | --- | --- | --- |');
for (const difficulty of ['normal', 'hard'] as const) {
  const shots: number[] = [];
  const misses: number[] = [];
  for (let i = 0; i < N; i++) {
    const s = startRaid(randomLayout(1000 + i), {}, 0, { ...RAID, shells: 999, timeLimitMs: Number.MAX_SAFE_INTEGER });
    const rand = rng(i);
    let n = 0;
    while (!s.over && n < 200) {
      const move = chooseMove(maskedView(s.board), { difficulty, rand });
      if (move.type !== 'shot') break;
      fireShell(s, move.cell);
      n++;
    }
    shots.push(n);
    misses.push(999 - s.shells);
  }
  shots.sort((a, b) => a - b);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  lines.push(
    `| ${difficulty} | ${shots[Math.floor(shots.length / 2)]} | ${mean(shots).toFixed(1)} | ${mean(misses).toFixed(1)} |`,
  );
}

lines.push('\n## B. Star distribution by shell budget (Normal raider, Armory 3 kit)\n');
lines.push('| Defence | shells | 0★ | 1★ | 2★ | 3★ | mean destruction |');
lines.push('| --- | --- | --- | --- | --- | --- | --- |');
for (const defence of DEFENCES) {
  for (const shells of [24, 28, 30, 34, 40]) {
    const stars = [0, 0, 0, 0];
    let destruction = 0;
    for (let i = 0; i < N; i++) {
      const r = runRaid(5000 + i, defence, KITS[2], shells, 'normal');
      stars[r.stars]++;
      destruction += r.destruction;
    }
    lines.push(
      `| ${defence.name} | ${shells} | ${pct(stars[0], N)} | ${pct(stars[1], N)} | ${pct(stars[2], N)} | ${pct(stars[3], N)} | ${((100 * destruction) / N).toFixed(0)}% |`,
    );
  }
}

lines.push('\n## C. Star distribution by kit at 30 shells\n');
lines.push('| Defence | kit | raider | 0★ | 1★ | 2★ | 3★ | mean destruction |');
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const defence of DEFENCES) {
  for (const kit of KITS) {
    for (const difficulty of ['normal', 'hard'] as const) {
      const stars = [0, 0, 0, 0];
      let destruction = 0;
      for (let i = 0; i < N; i++) {
        const r = runRaid(9000 + i, defence, kit, 30, difficulty);
        stars[r.stars]++;
        destruction += r.destruction;
      }
      lines.push(
        `| ${defence.name} | ${kit.name} | ${difficulty} | ${pct(stars[0], N)} | ${pct(stars[1], N)} | ${pct(stars[2], N)} | ${pct(stars[3], N)} | ${((100 * destruction) / N).toFixed(0)}% |`,
      );
    }
  }
}

lines.push('\n## D. What each defence item is worth (Normal raider, Armory 3 kit, 30 shells)\n');
lines.push('| Harbour | mean destruction | 3★ rate |');
lines.push('| --- | --- | --- |');
const marginal: [string, Partial<Record<ItemKind, number>>][] = [
  ['bare fleet', {}],
  ['+3 mines', { mine: 3 }],
  ['+5 mines', { mine: 5 }],
  ['+8 mines', { mine: 8 }],
  ['+1 gun', { aa_gun: 1 }],
  ['+3 guns', { aa_gun: 3 }],
  ['+2 decoys', { decoy: 2 }],
  ['+3 decoys', { decoy: 3 }],
  ['+2 nets', { sonar_net: 2 }],
  ['5 mines + 2 guns + 2 decoys', { mine: 5, aa_gun: 2, decoy: 2 }],
];
for (const [name, counts] of marginal) {
  let destruction = 0;
  let three = 0;
  for (let i = 0; i < N; i++) {
    const r = runRaid(20000 + i, { name, counts }, KITS[2], 30, 'normal');
    destruction += r.destruction;
    if (r.stars === 3) three++;
  }
  lines.push(`| ${name} | ${((100 * destruction) / N).toFixed(0)}% | ${pct(three, N)} |`);
}

console.log(`# Raid calibration (${N} raids per row)\n`);
console.log(lines.join('\n'));
