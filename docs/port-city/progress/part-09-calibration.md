# Part 9 — puzzle calibration (measured output)

Raw output of `npx tsx scripts/puzzle-calibration.ts 2000`, run 2026-09-24 against this
repo's engine and AI. Interpreted in `part-09-report.md` §1.

The reference's figures, for comparison (`reference/out/puzzle.md`, **20-cell** fleet):
best 10% = 47, best 25% = 52, median = 57.

```
Puzzle calibration — 2000 boards per difficulty
This fleet: 8 ships / 18 cells
Reference:  10 ships / 20 cells   (reference/out/puzzle.md)
Shipping par 52, Admiral's round under 46

| difficulty | best 10% | best 25% | median | worst 25% | worst 10% | mean | failed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| easy | 48 | 53 | 58 | 64 | 68 | 58.1 | 0 |
| normal | 45 | 50 | 56 | 62 | 67 | 56.0 | 0 |
| hard | 45 | 50 | 56 | 62 | 67 | 56.0 | 0 |

| difficulty | beat par 52 | Admiral’s round (<46) |
| --- | --- | --- |
| easy | 20.4% | 5.7% |
| normal | 32.4% | 11.5% |
| hard | 32.4% | 11.5% |

§2 intends par to be the BEST QUARTILE (25%) and an Admiral’s round the best 10%.
Median normal solve: 56 shots = 18 hits + 38 search.
```
