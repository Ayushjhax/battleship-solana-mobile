# Raid calibration — THIS implementation (1500 raids per row)

> Fleet: 8 ships / 18 cells (src/engine/fleet.ts). The reference used 10 ships / 20 cells.

## A. Shots needed to clear an undefended harbour

| Raider | median shots | mean shots | mean misses |
| --- | --- | --- | --- |
| normal | 56 | 55.7 | 37.7 |
| hard | 56 | 55.7 | 37.7 |

## B. Star distribution by shell budget (Normal raider, Armory 3 kit)

| Defence | shells | 0★ | 1★ | 2★ | 3★ | mean destruction |
| --- | --- | --- | --- | --- | --- | --- |
| none | 24 | 2% | 5% | 71% | 22% | 85% |
| none | 28 | 0% | 2% | 60% | 37% | 92% |
| none | 30 | 0% | 1% | 52% | 46% | 94% |
| none | 34 | 0% | 0% | 37% | 63% | 97% |
| none | 40 | 0% | 0% | 15% | 85% | 99% |
| CC1 basic (3 mines, 1 gun) | 24 | 6% | 9% | 73% | 12% | 77% |
| CC1 basic (3 mines, 1 gun) | 28 | 3% | 4% | 68% | 25% | 86% |
| CC1 basic (3 mines, 1 gun) | 30 | 1% | 3% | 63% | 33% | 89% |
| CC1 basic (3 mines, 1 gun) | 34 | 0% | 1% | 51% | 47% | 94% |
| CC1 basic (3 mines, 1 gun) | 40 | 0% | 0% | 31% | 69% | 98% |
| CC3 basic (5 mines, 2 guns) | 24 | 8% | 12% | 73% | 7% | 71% |
| CC3 basic (5 mines, 2 guns) | 28 | 4% | 6% | 72% | 18% | 81% |
| CC3 basic (5 mines, 2 guns) | 30 | 2% | 5% | 69% | 24% | 85% |
| CC3 basic (5 mines, 2 guns) | 34 | 1% | 2% | 60% | 37% | 91% |
| CC3 basic (5 mines, 2 guns) | 40 | 0% | 0% | 40% | 60% | 96% |
| CC3 researched (5 mines, 2 guns, 2 decoys, 2 nets) | 24 | 11% | 13% | 70% | 5% | 68% |
| CC3 researched (5 mines, 2 guns, 2 decoys, 2 nets) | 28 | 5% | 8% | 73% | 14% | 78% |
| CC3 researched (5 mines, 2 guns, 2 decoys, 2 nets) | 30 | 3% | 5% | 72% | 19% | 83% |
| CC3 researched (5 mines, 2 guns, 2 decoys, 2 nets) | 34 | 1% | 2% | 62% | 34% | 89% |
| CC3 researched (5 mines, 2 guns, 2 decoys, 2 nets) | 40 | 0% | 0% | 39% | 61% | 96% |
| CC6 researched (8 mines, 4 guns, 3 decoys, 3 nets) | 24 | 18% | 17% | 61% | 4% | 61% |
| CC6 researched (8 mines, 4 guns, 3 decoys, 3 nets) | 28 | 10% | 13% | 68% | 9% | 71% |
| CC6 researched (8 mines, 4 guns, 3 decoys, 3 nets) | 30 | 7% | 10% | 69% | 13% | 75% |
| CC6 researched (8 mines, 4 guns, 3 decoys, 3 nets) | 34 | 3% | 6% | 68% | 23% | 83% |
| CC6 researched (8 mines, 4 guns, 3 decoys, 3 nets) | 40 | 0% | 3% | 52% | 45% | 92% |

## C. Star distribution by kit at 30 shells

| Defence | kit | raider | 0★ | 1★ | 2★ | 3★ | mean destruction |
| --- | --- | --- | --- | --- | --- | --- | --- |
| none | no kit | normal | 2% | 6% | 74% | 19% | 83% |
| none | no kit | hard | 2% | 6% | 74% | 19% | 83% |
| none | Armory 1 (40) | normal | 1% | 5% | 70% | 24% | 86% |
| none | Armory 1 (40) | hard | 1% | 5% | 70% | 24% | 86% |
| none | Armory 3 (80) | normal | 0% | 1% | 52% | 47% | 94% |
| none | Armory 3 (80) | hard | 0% | 1% | 52% | 47% | 94% |
| none | Armory 5 (120) | normal | 0% | 0% | 43% | 56% | 96% |
| none | Armory 5 (120) | hard | 0% | 0% | 43% | 56% | 96% |
| CC1 basic (3 mines, 1 gun) | no kit | normal | 4% | 8% | 73% | 15% | 78% |
| CC1 basic (3 mines, 1 gun) | no kit | hard | 4% | 8% | 73% | 15% | 78% |
| CC1 basic (3 mines, 1 gun) | Armory 1 (40) | normal | 3% | 8% | 70% | 19% | 82% |
| CC1 basic (3 mines, 1 gun) | Armory 1 (40) | hard | 3% | 8% | 70% | 19% | 82% |
| CC1 basic (3 mines, 1 gun) | Armory 3 (80) | normal | 1% | 3% | 63% | 33% | 89% |
| CC1 basic (3 mines, 1 gun) | Armory 3 (80) | hard | 1% | 3% | 63% | 33% | 89% |
| CC1 basic (3 mines, 1 gun) | Armory 5 (120) | normal | 0% | 3% | 57% | 40% | 92% |
| CC1 basic (3 mines, 1 gun) | Armory 5 (120) | hard | 0% | 3% | 57% | 40% | 92% |
| CC3 basic (5 mines, 2 guns) | no kit | normal | 6% | 9% | 72% | 13% | 76% |
| CC3 basic (5 mines, 2 guns) | no kit | hard | 6% | 9% | 72% | 13% | 76% |
| CC3 basic (5 mines, 2 guns) | Armory 1 (40) | normal | 4% | 9% | 69% | 18% | 80% |
| CC3 basic (5 mines, 2 guns) | Armory 1 (40) | hard | 4% | 9% | 69% | 18% | 80% |
| CC3 basic (5 mines, 2 guns) | Armory 3 (80) | normal | 2% | 5% | 69% | 23% | 85% |
| CC3 basic (5 mines, 2 guns) | Armory 3 (80) | hard | 2% | 5% | 69% | 23% | 85% |
| CC3 basic (5 mines, 2 guns) | Armory 5 (120) | normal | 1% | 4% | 65% | 30% | 88% |
| CC3 basic (5 mines, 2 guns) | Armory 5 (120) | hard | 1% | 4% | 65% | 30% | 88% |
| CC3 researched (5 mines, 2 guns, 2 decoys, 2 nets) | no kit | normal | 7% | 10% | 70% | 13% | 74% |
| CC3 researched (5 mines, 2 guns, 2 decoys, 2 nets) | no kit | hard | 7% | 9% | 71% | 13% | 76% |
| CC3 researched (5 mines, 2 guns, 2 decoys, 2 nets) | Armory 1 (40) | normal | 5% | 10% | 69% | 16% | 78% |
| CC3 researched (5 mines, 2 guns, 2 decoys, 2 nets) | Armory 1 (40) | hard | 4% | 10% | 69% | 17% | 79% |
| CC3 researched (5 mines, 2 guns, 2 decoys, 2 nets) | Armory 3 (80) | normal | 4% | 6% | 70% | 20% | 82% |
| CC3 researched (5 mines, 2 guns, 2 decoys, 2 nets) | Armory 3 (80) | hard | 3% | 5% | 69% | 22% | 83% |
| CC3 researched (5 mines, 2 guns, 2 decoys, 2 nets) | Armory 5 (120) | normal | 2% | 4% | 67% | 27% | 86% |
| CC3 researched (5 mines, 2 guns, 2 decoys, 2 nets) | Armory 5 (120) | hard | 1% | 4% | 66% | 28% | 86% |
| CC6 researched (8 mines, 4 guns, 3 decoys, 3 nets) | no kit | normal | 9% | 13% | 70% | 8% | 71% |
| CC6 researched (8 mines, 4 guns, 3 decoys, 3 nets) | no kit | hard | 8% | 12% | 71% | 9% | 72% |
| CC6 researched (8 mines, 4 guns, 3 decoys, 3 nets) | Armory 1 (40) | normal | 7% | 12% | 70% | 11% | 74% |
| CC6 researched (8 mines, 4 guns, 3 decoys, 3 nets) | Armory 1 (40) | hard | 6% | 10% | 71% | 12% | 75% |
| CC6 researched (8 mines, 4 guns, 3 decoys, 3 nets) | Armory 3 (80) | normal | 6% | 10% | 70% | 14% | 76% |
| CC6 researched (8 mines, 4 guns, 3 decoys, 3 nets) | Armory 3 (80) | hard | 5% | 9% | 71% | 15% | 78% |
| CC6 researched (8 mines, 4 guns, 3 decoys, 3 nets) | Armory 5 (120) | normal | 5% | 8% | 72% | 16% | 79% |
| CC6 researched (8 mines, 4 guns, 3 decoys, 3 nets) | Armory 5 (120) | hard | 4% | 8% | 70% | 18% | 80% |

## D. What each defence item is worth (Normal raider, Armory 3 kit, 30 shells)

| Harbour | mean destruction | 3★ rate |
| --- | --- | --- |
| bare fleet | 94% | 46% |
| +3 mines | 91% | 35% |
| +5 mines | 88% | 30% |
| +8 mines | 85% | 23% |
| +1 gun | 92% | 39% |
| +3 guns | 91% | 34% |
| +2 decoys | 92% | 42% |
| +3 decoys | 91% | 39% |
| +2 nets | 95% | 49% |
| 5 mines + 2 guns + 2 decoys | 80% | 20% |
