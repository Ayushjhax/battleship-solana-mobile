# Part 8 — Fleets and fleet wars

**Depends on:** Parts 6–7 · **Flag:** `portCity.fleets` · **Surface:** Fleet Hall, a social service, a weekly scheduler

Raids give the game a reason to open at 3 a.m. Fleets give it a reason to stay.

---

## 1. Fleets

- Built at the **Fleet Hall** (Admiralty 4). Creating one costs 500 coins.
- Name (3–16 chars), description (up to 120), emblem (12 ink badges × 10 tints), join
  policy (open / by request / closed), minimum renown.
- Up to **30** captains. Roles: **Admiral** (one), **Commodore**, **Officer**, **Sailor**.

| Action | Admiral | Commodore | Officer | Sailor |
| --- | --- | --- | --- | --- |
| Accept or reject requests | ✓ | ✓ | ✓ | |
| Kick a lower role | ✓ | ✓ | | |
| Promote / demote below own role | ✓ | ✓ | | |
| Start a war | ✓ | ✓ | | |
| Edit the fleet | ✓ | | | |
| Donate and request | ✓ | ✓ | ✓ | ✓ |

- Leaving is always allowed. An Admiral who leaves passes the flag to the highest-ranked
  active member; if the fleet empties it is archived.

## 2. Talking

**Quick chat and stickers only in v1.** The game has no OS keyboard by design (the ink
keyboard exists for 14-character names), and free text means moderation, reporting and a
minor-safety burden nobody has scoped. So:

- ~24 quick phrases in four groups: greetings ("Fair winds."), requests ("I need a
  bomber."), tactics ("Raid them at dawn."), praise ("Good hunting!").
- The existing 8 emote stickers, plus fleet-only ones unlocked by Fleet Hall level.
- Rate limit 1 message / 2 s, 30 / minute. Messages last 7 days.
- Free text stays behind a `fleets.freeText` flag, default off, and does not ship until
  moderation, muting and reporting are designed.

## 3. Donations

- A member posts a **request** for one offensive item ("Bomber"), once every 30 minutes.
- Any member fills it by **commissioning** the item with coins: `fuel × 6` coins
  (a bomber = 180). The item lands in the requester's **reinforcement slot**.
- Reinforcements are usable **only in raids and wars**, never in a ranked match — that is
  the ranked integrity rule, and there is a test for it.
- Reinforcement capacity = Fleet Hall value (20 / 30 / 40 / 50 / 60 fuel-worth).
- The donor earns **fleet merit** (a visible counter) and 50 steel. Merit orders the
  roster and gates nothing — it is a reputation, not a currency.

## 4. Fleet wars

- The Admiral or a Commodore starts a search. War sizes: 5v5, 10v10, 15v15, taken from
  members who opted in. Matchmaking pairs fleets by **average renown of the opted-in
  members**, widening every 30 s, and gives up after 30 minutes with a friendly message.
- **Preparation day: 22 hours.** Each member sets a **war harbour** (separate from their
  home harbour; defaults to a copy of it, editable). Both war maps are visible — names,
  Admiralty levels, renown, nothing about layouts.
- **Battle day: 24 hours.** Each member gets **2 raids** against enemy war harbours, using
  their normal Armory raid fuel plus any reinforcements. War raids take **no loot** and
  move **no renown**.
- Scoring, exactly like the game everyone already understands: each enemy harbour counts
  the **best stars anyone achieved against it**. Ties break on total destruction, then on
  the earlier finish.
- Rewards: the winning fleet gets a war chest (steel and coins scaled by war size and
  stars, plus 10 gems each); the loser gets a third. Every participant who used both
  raids gets a participation bonus. A member who used none gets nothing and is marked in
  the war log.
- The war log keeps the last 10 wars, with every raid's replay for 14 days.

## 5. Visits, friendly raids and the Flag Hall

- Tap a captain anywhere (leaderboard, fleet roster, defence log) → **visit their city**:
  a read-only render of their buildings, levels, renown and equipped cosmetics. No loot,
  no renown, no timers.
- **Friendly raid**: raid a fleetmate's harbour for practice. No loot, no renown, no
  shield, no lock, unlimited, and it always shows the full result. This is how a fleet
  tests each other's defences, and it is the single best teaching tool in the feature.
- **The Flag Hall**, inside the Admiralty: every country whose captain you have beaten in
  a ranked online match or a raid hangs its flag. A counter ("37 / 250") and a wall that
  fills up. This finally gives the country field a purpose, so this part also ships the
  **country picker** that Appendix C says is missing: an ink list, alphabetical, with a
  letter index down the side and no OS keyboard.

## 6. Data model and API

```
fleet:        id, name, description, emblem, policy, min_renown, created_at, archived
fleet_member: fleet_id, user_id, role, joined_at, merit
fleet_request:fleet_id, user_id, at, state
fleet_message:fleet_id, user_id, kind(phrase|sticker), code, at
donation:     fleet_id, requester_id, item, donor_id|null, at, consumed_at
war:          id, fleet_a, fleet_b, size, prep_ends_at, battle_ends_at, state, stars_a, stars_b
war_member:   war_id, user_id, harbour(json), raids_used
war_raid:     war_id, raid_id, target_user_id, stars, destruction
flags:        user_id, country_code, first_at
```

Endpoints under `/fleet/*` and `/war/*`, all server-validated, all idempotent. Realtime:
reuse the channel the emote system already uses, one topic per fleet.

The war scheduler is the only cron in this package: it moves wars prep → battle → ended,
settles rewards, and must be **idempotent and restart-safe** (a crashed worker must not
pay twice). Use a state machine with a `settled_at` marker rather than a timer in memory.

## 7. Tests

1. Roles: every permission in the table, and the Admiral-leaves succession.
2. Donations: capacity, the 30-minute request cooldown, the commission price, and a test
   that a reinforcement **cannot** be used in a ranked match.
3. War matchmaking: only opted-in members count; sizes; widening; the give-up path.
4. War scoring: best-stars-per-target, both tiebreaks, and a member who never attacks.
5. Scheduler: run the transition job twice → rewards paid once; kill it mid-settlement and
   re-run → still once.
6. Friendly raids: no loot, no renown, no shield, no lock, and they never appear in the
   defence log.
7. Flag Hall: a beaten captain's flag is recorded once; the picker writes the profile and
   the leaderboard shows it.
8. Quick chat: rate limits, 7-day expiry, and no path exists for free text while the flag
   is off.

**Manual QA:** run a 5v5 war across two devices with the clock shortened by config; donate
and use a reinforcement in a raid; try to use it in a ranked match and confirm it is absent.

## 8. Acceptance criteria

1. A player can create or join a fleet, talk in quick chat, donate, and fight a war whose
   result settles exactly once.
2. Nothing a fleet gives a player can enter a ranked match.
3. The country picker ships and the Flag Hall fills.
