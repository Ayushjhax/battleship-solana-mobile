// Part 9: what is a fair "par" for the daily puzzle (sink the hidden fleet in
// as few shots as possible)? Run: npm run sim:puzzle

import { chooseMove, maskedView } from '../src/ai.js';
import { randomLayout, rng } from '../src/random.js';
import { fireShell, startRaid, RAID } from '../src/raid.js';

const N = Number(process.env.N ?? 2000);

function shotsToClear(seed: number, difficulty: 'easy' | 'normal' | 'hard') {
  const s = startRaid(randomLayout(seed), {}, 0, { ...RAID, shells: 999, timeLimitMs: Number.MAX_SAFE_INTEGER });
  const rand = rng(seed * 7919);
  let n = 0;
  while (!s.over && n < 200) {
    const move = chooseMove(maskedView(s.board), { difficulty, rand });
    if (move.type !== 'shot') break;
    fireShell(s, move.cell);
    n++;
  }
  return n;
}

const p = (xs: number[], q: number) => xs[Math.min(xs.length - 1, Math.floor(q * xs.length))];

console.log(`# Daily puzzle par (${N} boards per row)\n`);
console.log('| Solver | best 10% | best 25% | median | worst 25% | worst |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const difficulty of ['easy', 'normal', 'hard'] as const) {
  const xs = Array.from({ length: N }, (_, i) => shotsToClear(30_000 + i, difficulty)).sort((a, b) => a - b);
  console.log(
    `| ${difficulty} | ${p(xs, 0.1)} | ${p(xs, 0.25)} | ${p(xs, 0.5)} | ${p(xs, 0.75)} | ${xs[xs.length - 1]} |`,
  );
}
console.log(
  '\nThe fleet holds 20 cells, so 20 of every solve are hits; everything above that is search.',
);
