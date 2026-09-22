# Every Port City number on one page

Generated from `reference/src/city.ts` and `reference/src/resolve.ts` by
`reference/sim/tables.ts`. **Do not hand-edit.** Change the catalogue, re-run, and the
implementation test that pins the catalogue checksum will tell you what moved.

## Buildings

### Admiralty

| Level | Steel | Coins | Build time | Needs Admiralty | tier |
| --- | --- | --- | --- | --- | --- |
| 1 | — | — | — | 0 | — |
| 2 | 300 | 100 | 2 min | 1 | — |
| 3 | 900 | 300 | 30 min | 2 | — |
| 4 | 3,000 | 1,000 | 3 h | 3 | — |
| 5 | 9,000 | 3,000 | 10 h | 4 | — |
| 6 | 22,000 | 7,000 | 20 h | 5 | — |
| 7 | 50,000 | 15,000 | 1 d 12 h | 6 | — |
| 8 | 110,000 | 32,000 | 3 d | 7 | — |

### Scrapyard

| Level | Steel | Coins | Build time | Needs Admiralty | salvage bonus % |
| --- | --- | --- | --- | --- | --- |
| 1 | — | — | — | 0 | 0 |
| 2 | 600 | 150 | 30 min | 2 | 5 |
| 3 | 2,000 | 500 | 2 h | 3 | 10 |
| 4 | 6,000 | 1,500 | 8 h | 4 | 15 |
| 5 | 15,000 | 4,000 | 16 h | 5 | 20 |
| 6 | 35,000 | 9,000 | 1 d | 6 | 25 |

### Fish Market

| Level | Steel | Coins | Build time | Needs Admiralty | coins per hour (cap 12 h) |
| --- | --- | --- | --- | --- | --- |
| 1 | 150 | 0 | 1 min | 1 | 12 |
| 2 | 500 | 100 | 15 min | 2 | 18 |
| 3 | 1,400 | 350 | 1 h | 3 | 26 |
| 4 | 3,500 | 900 | 4 h | 4 | 38 |
| 5 | 8,000 | 2,200 | 9 h | 5 | 54 |
| 6 | 18,000 | 5,000 | 18 h | 6 | 74 |
| 7 | 38,000 | 10,000 | 1 d 8 h | 7 | 98 |
| 8 | 75,000 | 20,000 | 2 d | 8 | 128 |

### Foundry

| Level | Steel | Coins | Build time | Needs Admiralty | steel per hour (cap 12 h) |
| --- | --- | --- | --- | --- | --- |
| 1 | 150 | 0 | 2 min | 2 | 20 |
| 2 | 700 | 150 | 20 min | 2 | 30 |
| 3 | 1,800 | 400 | 1 h 30 min | 3 | 44 |
| 4 | 4,500 | 1,000 | 5 h | 4 | 62 |
| 5 | 10,000 | 2,400 | 11 h | 5 | 86 |
| 6 | 22,000 | 5,500 | 20 h | 6 | 118 |
| 7 | 45,000 | 11,000 | 1 d 12 h | 7 | 158 |
| 8 | 88,000 | 22,000 | 2 d 12 h | 8 | 206 |

### Shipyard — flag `portCity.cosmetics`

| Level | Steel | Coins | Build time | Needs Admiralty | tier |
| --- | --- | --- | --- | --- | --- |
| 1 | 300 | 200 | 10 min | 1 | 1 |
| 2 | 1,500 | 800 | 2 h | 3 | 2 |
| 3 | 6,000 | 3,000 | 10 h | 5 | 3 |
| 4 | 20,000 | 9,000 | 1 d | 7 | 4 |

### Stationer's Shop — flag `portCity.cosmetics`

| Level | Steel | Coins | Build time | Needs Admiralty | tier |
| --- | --- | --- | --- | --- | --- |
| 1 | 400 | 250 | 15 min | 2 | 1 |
| 2 | 1,800 | 900 | 3 h | 4 | 2 |
| 3 | 7,000 | 3,500 | 12 h | 6 | 3 |
| 4 | 22,000 | 10,000 | 1 d | 8 | 4 |

### Harbour Master's Office — flag `portCity.bounties`

| Level | Steel | Coins | Build time | Needs Admiralty | tier |
| --- | --- | --- | --- | --- | --- |
| 1 | 250 | 100 | 5 min | 1 | 3 |
| 2 | 2,000 | 700 | 4 h | 3 | 4 |
| 3 | 9,000 | 3,500 | 16 h | 5 | 5 |

### Naval Academy — flag `portCity.academy`

| Level | Steel | Coins | Build time | Needs Admiralty | tier |
| --- | --- | --- | --- | --- | --- |
| 1 | 2,500 | 800 | 2 h | 3 | 1 |
| 2 | 6,000 | 2,000 | 8 h | 4 | 2 |
| 3 | 14,000 | 5,000 | 20 h | 5 | 3 |
| 4 | 32,000 | 12,000 | 1 d 12 h | 6 | 4 |
| 5 | 70,000 | 25,000 | 2 d 12 h | 7 | 5 |

### Coastal Command — flag `portCity.raids`

| Level | Steel | Coins | Build time | Needs Admiralty | harbour fuel |
| --- | --- | --- | --- | --- | --- |
| 1 | 2,000 | 600 | 1 h | 3 | 50 |
| 2 | 5,000 | 1,600 | 6 h | 4 | 70 |
| 3 | 12,000 | 4,000 | 14 h | 5 | 90 |
| 4 | 28,000 | 9,000 | 1 d | 6 | 110 |
| 5 | 60,000 | 18,000 | 2 d | 7 | 130 |
| 6 | 120,000 | 36,000 | 3 d | 8 | 150 |

### Armory — flag `portCity.raids`

| Level | Steel | Coins | Build time | Needs Admiralty | raid fuel |
| --- | --- | --- | --- | --- | --- |
| 1 | 1,800 | 600 | 1 h | 3 | 40 |
| 2 | 4,500 | 1,500 | 6 h | 4 | 60 |
| 3 | 11,000 | 3,800 | 14 h | 5 | 80 |
| 4 | 26,000 | 8,500 | 1 d | 6 | 100 |
| 5 | 55,000 | 17,000 | 2 d | 7 | 120 |

### Fleet Hall — flag `portCity.fleets`

| Level | Steel | Coins | Build time | Needs Admiralty | reinforcement fuel |
| --- | --- | --- | --- | --- | --- |
| 1 | 5,000 | 2,000 | 4 h | 4 | 20 |
| 2 | 12,000 | 5,000 | 12 h | 5 | 30 |
| 3 | 28,000 | 11,000 | 1 d | 6 | 40 |
| 4 | 60,000 | 22,000 | 2 d | 7 | 50 |
| 5 | 120,000 | 45,000 | 3 d | 8 | 60 |

### Newsstand — flag `portCity.gazette`

| Level | Steel | Coins | Build time | Needs Admiralty | tier |
| --- | --- | --- | --- | --- | --- |
| 1 | 500 | 200 | 20 min | 2 | 1 |
| 2 | 3,000 | 1,200 | 6 h | 4 | 2 |
| 3 | 12,000 | 5,000 | 18 h | 6 | 3 |

### Trade Docks — flag `portCity.voyages`

| Level | Steel | Coins | Build time | Needs Admiralty | tier |
| --- | --- | --- | --- | --- | --- |
| 1 | 4,000 | 1,500 | 3 h | 4 | 1 |
| 2 | 14,000 | 5,000 | 16 h | 6 | 2 |
| 3 | 40,000 | 15,000 | 2 d | 8 | 3 |

### Officers' Club — flag `portCity.captains`

| Level | Steel | Coins | Build time | Needs Admiralty | tier |
| --- | --- | --- | --- | --- | --- |
| 1 | 10,000 | 4,000 | 10 h | 5 | 1 |
| 2 | 26,000 | 10,000 | 1 d | 6 | 2 |
| 3 | 60,000 | 24,000 | 2 d | 7 | 3 |

### Lighthouse — flag `portCity.seas`

| Level | Steel | Coins | Build time | Needs Admiralty | tier |
| --- | --- | --- | --- | --- | --- |
| 1 | 9,000 | 3,500 | 8 h | 5 | 1 |
| 2 | 22,000 | 8,000 | 20 h | 6 | 2 |
| 3 | 48,000 | 18,000 | 2 d | 7 | 3 |
| 4 | 100,000 | 38,000 | 3 d | 8 | 4 |

## Dock workers

| Worker | Cost | Needs Admiralty |
| --- | --- | --- |
| 1st and 2nd | free | — |
| 3rd | 100 gems | 3 |
| 4th | 250 gems | 5 |

## Finishing a job early

`gems = ceil(2 × sqrt(seconds remaining / 60))`, and the last minute is free.

| Time left | Gems |
| --- | --- |
| 1 min | 0 |
| 5 min | 5 |
| 15 min | 8 |
| 1 h | 16 |
| 4 h | 31 |
| 12 h | 54 |
| 1 d | 76 |
| 2 d | 108 |
| 3 d | 132 |

Cancelling a job hands back half the steel and half the coins and frees the worker.

## Salvage

5 steel per cell of every enemy ship you sank, times the Scrapyard bonus.

| Sunk | Steel (Scrapyard 1) | Scrapyard 3 | Scrapyard 6 |
| --- | --- | --- | --- |
| one boat | 5 | 5 | 6 |
| one destroyer | 10 | 11 | 12 |
| one cruiser | 15 | 16 | 18 |
| the battleship | 20 | 22 | 25 |
| a whole fleet (a win) | 100 | 110 | 125 |
| an average loss (6 ships) | 60 | 66 | 75 |

Starting grant for an existing profile: 400 steel, 50 gems.

## Arsenal prices (fuel)

| Item | Fuel | Cap | New? |
| --- | --- | --- | --- |
| torpedo | 20 | 2 |  |
| double torpedo | 35 | 2 |  |
| bomber | 30 | 2 |  |
| atomic | 60 | 1 |  |
| submarine | 10 | 1 |  |
| radar | 15 | 1 |  |
| minesweeper | 15 | 1 | Part 5 |
| aa gun | 10 | 3 |  |
| mine | 5 | 5 |  |
| sonar net | 10 | 2 | Part 5 |
| decoy | 5 | 3 | Part 5 |

Everything at its cap now costs **360 fuel** against the 260 budget (it was 310 before Part 5), so the shelf keeps getting harder to choose from.

## Raids

| Setting | Value |
| --- | --- |
| Shells per raid | 30 |
| A hit | the shell is handed back |
| A mine | the shell, plus 2 more |
| Raid clock | 4 minutes |
| Stars | one for the battleship, one at 50% destruction, one at 100% |
| Destruction | enemy ship cells hit ÷ 20 |
| Wallet loot rate | 10% of the unprotected balance |
| Collector and scrap-pile loot rate | 50% |
| Star bonus (paid by the Admiralty, not the defender) | 0★ 0, 1★ 40, 2★ 120, 3★ 300 steel |

| Defender Admiralty | Vault protects (coins / steel) | One raid can take at most |
| --- | --- | --- |
| 1 | 500 / 1,000 | 100 coins, 200 steel |
| 2 | 800 / 1,600 | 150 coins, 300 steel |
| 3 | 1,200 / 2,500 | 250 coins, 500 steel |
| 4 | 2,500 / 5,000 | 450 coins, 900 steel |
| 5 | 6,000 / 12,000 | 850 coins, 1,700 steel |
| 6 | 12,000 / 25,000 | 1,600 coins, 3,200 steel |
| 7 | 25,000 / 50,000 | 2,800 coins, 5,600 steel |
| 8 | 50,000 / 100,000 | 4,500 coins, 9,000 steel |

| Renown example (attacker → defender) | 1★ | 2★ | 3★ | 0★ |
| --- | --- | --- | --- | --- |
| 100 raids 100 | 7 | 13 | 20 | -14 |
| 100 raids 400 | 13 | 27 | 40 | -4 |
| 400 raids 100 | 2 | 3 | 5 | -30 |
| 800 raids 820 | 7 | 15 | 22 | -13 |

| Destruction taken | Shield |
| --- | --- |
| under 40% | none |
| 40–69% | 6 h |
| 70–99% | 10 h |
| 100% | 14 h |

