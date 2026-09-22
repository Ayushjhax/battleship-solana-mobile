# Part 7 — Harbour raids: the client

**Depends on:** Parts 6 and 2 · **Flag:** `portCity.raids` · **Surface:** four screens, all built from parts that already exist (placement, battle board, result)

Reuse, do not rebuild. The defence editor is the placement screen with a different budget.
The raid screen is the battle screen with one board and a shell counter instead of a timer
triangle.

---

## 1. Your harbour (`app/harbour.tsx`)

Reached by tapping the `<name>'s harbour` nameplate in the city.

- The board, drawn as your own sea with your ships and defences visible.
- Header: **Renown**, shield timer if any, Coastal Command level and harbour fuel used.
- Buttons: **Edit defences**, **Defence log** (badge when unread), **Raid a harbour**.
- If the harbour has never been edited, a Captain line: "The dockyard laid this out for
  you. Move it before somebody learns it."

## 2. The defence editor

The placement screen with three differences, and no forked code:

1. The budget chip says **Harbour fuel 74 / 90** instead of the 260 match fuel.
2. The shop only offers own-board items, with the Coastal Command caps.
3. The button says **Save harbour**, and saving validates server-side (`invalid-layout`
   errors map to Captain lines).

Shuffle and Reset work as they do today. Leaving with unsaved changes asks first. While a
raid on you is running, the editor is read-only with an ink banner: "Under attack — you
can change this when they are done."

## 3. Raiding

**Step 1 — the kit.** The same shop panel, offensive items only, budget = Armory raid
fuel. "Sail" is disabled until the kit is legal (it may be empty — a raid with no kit is
allowed and cheaper).

**Step 2 — the search.** A pen draws a course across a small chart, 1.2 s, then the
**target card**: name, avatar, flag, Admiralty level, renown, loot chips (coins, steel),
renown offer (+18 / −12), and for a cove a black-flag ribbon reading "Pirate cove — no
renown". Buttons: **Next (12 coins)** and **Raid**. Never show the layout.

**Step 3 — the raid.** One enemy board, centred and larger than in a match:

- Top left: shells as a row of ink shell icons plus the number. A hit makes the spent
  shell fly back into the row (+1 pop, 220 ms). A mine takes three with a red flash.
- Top centre: three empty star outlines that ink in as they are earned, and the
  destruction percentage rolling beneath.
- Top right: the raid clock (4:00) and the loot tally, which climbs as destruction does.
- The red **Arsenal** tab, as in a match, listing the kit.
- **Retreat** at the bottom right, with a confirm ("Keep what you have earned?").
- Every animation from §13.2 is reused unchanged; tapping skips ahead, as in a match.
- When the last ship goes down: full-board flourish, "Harbour cleared", 900 ms hold.

**Step 4 — the result.** The stars stamp in one by one, loot flies into the HUD counters,
the renown bar moves, and the buttons are **Replay**, **Raid again** and **Back to city**.

## 4. Defence log

A list of ink notes, newest first: attacker card, when, stars, destruction, what they took,
renown change, and **Replay** / **Revenge** (revenge is free and skips the search cost).
Unread entries are dog-eared. Keep the last 30.

A raid that took ≥ 2★ while the player was away also shows a one-time card on the menu:
"Your harbour was raided. Two stars, 340 steel gone." with a Revenge button.

## 5. Replay viewer

- Plays the stored actions through the engine at the original pace, with **Play/Pause**,
  **1× / 2× / 4×**, a scrub bar ticked per action, and a shell/star strip that updates.
- The defender's view shows their full board from the start (they own it); the attacker's
  view reveals the full layout at the end.
- Skipping and scrubbing must never desync: rebuild the state from action 0 to the target
  index rather than trying to rewind.

## 6. Notifications and badges

In-app only for v1: the city plot badge, the menu dot, the defence-log dog ears. Push
notifications are explicitly out of scope until someone owns the permission prompt.

## 7. First raid (a taught one)

The first raid a player ever runs is forced to a **scripted pirate cove** with a fixed
seed, 3 mines and 1 AA gun, and the Captain talks over four beats: shells and the refund,
the mine penalty, the arsenal tab, the stars. It is winnable at 3★ with reasonable play,
and it pays a fixed 300 steel. It never runs twice.

## 8. Tests

1. Defence editor: budget maths, caps, invalid save maps to copy, read-only while under
   attack, unsaved-changes guard.
2. Shell HUD: refund animation fires on hit, not on miss; the number always equals the
   server's value (never a local guess); a mine shows −3.
3. Stars and destruction render from the server payload only.
4. Retreat mid-raid settles and shows the result; backgrounding the app for 90 s settles
   the raid and the client shows the outcome on return rather than a dead screen.
5. Replay: scrubbing to any index reproduces the same board as playing straight through;
   an unavailable replay shows a note instead of crashing.
6. Revenge skips the search cost exactly once per incoming raid.
7. The first-raid script runs once, is skippable, and pays only once.

**Manual QA on a device:** whole loop twice (cove and human), with the app backgrounded
once mid-raid, once on a 3G-shaped connection, and once with the flag off to confirm the
harbour nameplate reverts to the old stats card.

## 9. Acceptance criteria

1. The full loop — edit, kit, search, raid, settle, log, replay, revenge — works on a
   phone in landscape, built from the existing screens.
2. Nothing in the UI reveals anything the server did not send.
3. A raid never ends without a result the player can see.
