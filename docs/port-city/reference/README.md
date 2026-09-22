# Reference implementation

A working, tested model of every **new** rule in this package, plus enough of the existing
rules to test them against. It is not production code and it does not depend on the app —
it is an executable specification you can run, read and argue with.

```bash
cd docs/port-city/reference
npm install
npm test          # 80 tests
npm run sim:raid      # the shell-budget calibration behind Part 6
npm run sim:economy   # the pacing behind Part 1's costs
npm run sim:puzzle    # the par behind Part 9's daily puzzle
```

The saved output of those three simulations is in `out/`. `sim/tables.ts` is what generates
`../NUMBERS.md`, so changing a number in `src/city.ts` and re-running it keeps the docs
honest:

```bash
npx tsx sim/tables.ts > ../NUMBERS.md
```

## What is in here

| File | What it models |
| --- | --- |
| `src/grid.ts` | cells, the fleet, the no-touch halo, layout validation (including the decoy's special rule), marks |
| `src/random.ts` | seeded RNG, Shuffle, random legal layouts with items |
| `src/resolve.ts` | shot resolution, every arsenal item, AA and sonar interception, fuel and cap tables |
| `src/ai.ts` | the masked-view hunt/target AI used to calibrate the raid budget |
| `src/raid.ts` | the raid session: shells, refunds, the mine penalty, stars, end conditions |
| `src/city.ts` | the building catalogue, timers, production, salvage, loot, renown, shields |
| `test/resolve.test.ts` | 26 golden tests for the **existing** rules, as documented |
| `test/new-items.test.ts` | 16 tests for the sonar net, decoy buoy and minesweeper |
| `test/raid.test.ts` | 17 tests for the raid rules |
| `test/city.test.ts` | 21 tests for the economy, including a 2,000-step random-walk invariant test |

## How to treat it

- For a **new** rule, this code and the part documents are the spec. Port the behaviour and
  the test scenarios into the real engine.
- For an **existing** rule, the shipped engine wins. If the two disagree, that is a finding:
  write it in `progress/DECISIONS.md` and check `../CORRECTIONS.md`, which already lists the
  disagreements found while writing this.
- Do not vendor this into the app. The structures here are shaped for clarity, not for the
  repo's existing types.
