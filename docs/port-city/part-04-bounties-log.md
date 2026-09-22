# Part 4 — Bounty Board and Captain's Log

**Depends on:** Parts 1–2 · **Flag:** `portCity.bounties` · **Surface:** the Harbour Master's Office, a match-event evaluator on the server, one season job

Contracts turn the arsenal into a reason to play differently, and the Log turns a month of
play into a visible line of ink stamps.

---

## 1. The Bounty Board

- **3 daily** contracts (reset 00:00 UTC) and **3 weekly** (reset Monday 00:00 UTC).
  The Harbour Master's Office level adds a slot: L1 → 3 daily, L2 → 4, L3 → 5.
- One **free reroll** per day; more cost 10 gems. Rerolling draws from the same tier and
  never returns the same contract twice in a day.
- A contract is a row on a pinned paper note: title, progress bar drawn as ink ticks,
  reward chips. Completing it stamps the note and the claim button appears (claim is a tap
  — never auto-claim, the stamp is the payoff).
- Rewards by tier: easy 150 coins / 200 steel / 60 ink; medium 350 / 500 / 120; hard
  700 / 1,200 / 250 plus 5–15 gems. Weeklies pay roughly 4× a daily.

### Contract catalogue (v1 — at least 30, data-driven)

Battle: win N matches · win N online matches · sink N battleships · sink a ship with a
torpedo · sink 2 ships with one Atomic Bomber · sink N ships with the submarine · shoot
down N aircraft with your AA guns · down 2 planes with the same gun in one match · have
N of your mines stop an enemy turn · win with 4 or more ships still afloat · land a run
of 5 hits in one turn · win a match without buying any arsenal · beat the AI on Hard ·
use the radar and hit a ship inside that 3×3 on your next shot.

City: collect N steel · finish N upgrades · reach Admiralty N · collect the Scrapyard
N times.

Raids (only offered once `portCity.raids` is on for that player): earn N stars · take
N steel from raids · defend successfully (a raid ends under 2★) · 3★ a harbour.

Each contract is `{ id, tier, title, metric, target, scope: 'daily'|'weekly', requires?: flag }`.
`metric` is evaluated **only on the server**, from the match event log for online matches
and from the reported result for offline ones, in the same transaction that credits
points, coins and salvage. The client never reports progress; it renders what it is told.

Hot-seat and offline matches count toward contracts only under the same daily cap as
salvage (`economy.offlineRewardCap`, default 10).

## 2. The Captain's Log (season pass)

- A season is **28 days**. 30 pages. Ink (XP) per page: **600**.
- Ink comes from: a played match +20, a win +40 more, a daily contract +60/120/250 by
  tier, a weekly ×4, a raid with ≥1★ +30, a successful defence +30, a daily puzzle +50.
- Free track: coins, steel, gems (5–20), a cosmetic at pages 10, 20 and 30.
  Premium track (**500 gems**, or real money once IAP exists): a cosmetic set, roughly
  3× the resources, one extra daily reroll per day, and a season ink bonus of +10%.
- Buying the premium track retroactively unlocks every page already earned.
- The Log is drawn as a leather logbook: a page per tier, each with a stamp box. Claim by
  tapping the stamp; unclaimed rewards are auto-claimed by a job 24 h after the season ends.
- Pacing check: an active player (5 matches/day, all dailies, most weeklies) earns roughly
  850 ink/day → ~24,000 in a season → all 30 pages by about day 21. A casual player
  (2 matches/day, some dailies) lands around page 14. Tune `inkPerPage` first, never the
  rewards, if this drifts.

## 3. Data model and API

```
contracts:  user_id, slot, contract_id, progress, target, state(active|done|claimed), issued_at, expires_at
season:     id, starts_at, ends_at, catalogue_version
season_progress: user_id, season_id, ink, premium(bool), claimed_pages int[]
```

`GET /bounties` · `POST /bounties/claim {slot}` · `POST /bounties/reroll {slot}` ·
`GET /log` · `POST /log/claim {page}` · `POST /log/premium {requestId}`.

All claims are idempotent and ledgered. Progress is never accepted from the client.

## 4. Edge cases

| Case | Behaviour |
| --- | --- |
| A contract completes mid-match | It is credited at settlement, not mid-match; the Result screen shows "Contract complete" |
| A daily rolls over while the player is in a match | The match settles against the contract set that was active when it **started** |
| Season ends with unclaimed pages | Auto-claimed by the job; a mail-style ink note tells the player |
| Premium bought on the last day | Retroactive unlock still applies |
| A raid contract is drawn for a player whose raids flag is off | Never drawn — `requires` is checked at issue time |

## 5. Tests

1. Each metric: a crafted match event log advances exactly the right contracts, and a
   match that does not qualify advances none.
2. Reset boundaries at 23:59:59 and 00:00:00 UTC, including a player in a different
   timezone, and a leap-second-ish clock jump.
3. Reroll: one free per day, then gems; the rerolled contract is never the same one.
4. Claim is idempotent; double claim credits once.
5. The 11th offline match of the day advances no contracts and no ink but still pays coins.
6. Season rollover: progress archived, ink reset, auto-claim job pays every unclaimed page
   exactly once (run it twice in the test).
7. Ink pacing test: a simulated active player finishes 30 pages between day 18 and 24; a
   casual player lands between page 10 and 18. This test locks the pacing target, so if
   someone changes a reward it fails loudly.

**Manual QA:** complete a daily on a real device and watch the stamp; reroll; buy the
premium track with gems and confirm the retroactive unlock.

## 6. Acceptance criteria

1. Contracts issue, progress, claim and reset correctly, server-side only.
2. Every metric in the catalogue has a test and can never be advanced by a client claim.
3. The Log paces to the targets above, and unclaimed rewards are never lost.
