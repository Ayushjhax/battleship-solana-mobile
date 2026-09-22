# The three-minute demo

One phone in your hand, a second phone on the table, the APK on a USB stick in your
pocket. Assume the venue wifi is hostile: everything below works with the phone in
airplane mode except the two multiplayer beats, which run over **mobile data**, not wifi.

## Before you walk on

- **Both phones**: APK installed from the stick (`adb install` or the file manager), opened
  once, tutorial finished once, name and avatar set. Battery > 60 %. Do-not-disturb on.
  Mobile data on, wifi **off**. Brightness up.
- **Seed your profile** so the menu and ladder aren't empty. On the phone: menu → tap the
  version number bottom-right five times → the demo menu shows your user id. On the laptop,
  from `server/`: `npm run seed:demo -- <that id>`. It writes a crew of eight named captains,
  twelve finished matches, and puts you at Chief Ship Petty Officer with a half-full bar.
  Idempotent; run it again after a rehearsal.
- **The set-piece rig**: `Scripted match` in the demo menu starts an advanced match against
  Berhan on easy with fixed boards. You know the enemy board: battleship on **B2–B5**, AA gun
  under **row E**, destroyer on **H2–H3**, boat at **J10**. Your kit: two bombers, a torpedo
  bomber, an AA gun at E9, a mine at H8.
- **Second device warmed up**: open the app, go to *Play online*, place a fleet, stop on the
  placement screen. When you reach 1:35 the operator taps *Deploy* and the queue pairs
  instantly. (If no second device: the queue pairs you with Berhan after 45 s — too long on
  stage — so use *Scripted match* instead and say "the AI".)
- **Rehearse twice on the real hardware** (checklist below). The second run is the one that
  counts: the first run finds the wifi prompt, the low-battery pop-up, the phone in the wrong
  orientation.

If anything on the network side stalls: demo menu → **Offline: ON**. Every network path in
the app then answers "offline" at once, nothing spins, and the whole script still works with
*Scripted match* standing in for the second device.

## The script

| Time | Screen | Do | Say |
|---|---|---|---|
| **0:00** | Boot | Cold start (swipe the app away first). The sheet drops, the pen writes the logo, the Captain looks up. | **Nothing.** Let it land. |
| **0:20** | Menu | Point at the rank badge (Chief Ship Petty Officer, the bar) and at "*N* sailors online" under *Play online*. | "Everything's drawn in ballpoint on graph paper. That badge is a real rank from a real ladder, and those are real people in the lobby right now." |
| **0:35** | Tutorial | *How to play*. Let the Captain do the first three beats — the board, a shot, a hit — then **Skip** (top right). | "The tutorial rides on the real game screens; it can't drift from the game." |
| **1:05** | Placement | Drag one ship (it snaps, the pen scratches), rotate it with a tap, open the shop and buy an **AA gun**, drop it on your board. | "Drag feel is the whole placement screen: engine validation runs per candidate cell, so the ghost is red before your finger lifts. That AA gun matters in a minute." |
| **1:35** | Battle | *Play online* — the second device is already waiting, the arena ribbon drops. Fire twice (a miss, a hit), take a hit, then sink one ship. | "Server-authoritative. My phone never holds the enemy board; a rolled-back hit is worse than a 200 ms wait, so the shell flies now and the verdict comes from the server." |
| **2:15** | Battle | **The set piece.** Arsenal tab → bomber → drop it on row E. It flies into the AA gun and spirals down. | **Do not talk over it.** Wait for the splash. Then: "That's what the gun was for." |
| **2:45** | Result → Leaderboard | Finish the fleet (or *Force a win* from the demo menu if time is short). Laurels, coins fly, the bar fills, **rank-up**: shield inks over, the name types on. Then *Menu* → *Leaderboard*: your row bracketed in red. | "Win, coins, rank — all settled in one transaction on the server." |
| **3:00** | Leaderboard | Stop. | "Next: tournaments, fleet skins, and the port city you saw on the map." |

Pace: the timings are where each beat *starts*. If you are behind at 2:15, skip the second
shot at 1:35 and skip the leaderboard; never skip the plane.

## The demo menu (five taps on the version number)

| Button | What it does |
|---|---|
| Force a win | The result screen as a victory, +25 / +50 shown, nothing written anywhere. |
| Force a rank-up | Same, with totals that cross the next threshold: the full rank-up beat. |
| Scripted match | The rigged AI match above. |
| Offline: on / off | Hard offline. Persists across restarts — **turn it off after the demo**. |
| Jump to … | Any screen, including a loss result and the searching screen. |

Nothing in the demo menu touches the profile or the server; the forced results are
parameters to the result screen.

## Final checklist

- [ ] APK installs clean on a device that has never seen the app (`adb install app.apk` on a
      phone with no prior install — no "app not installed", boot to menu, no red box)
- [ ] Airplane mode gives a full match with no errors (*Play offline* → placement → a match to
      the result screen → menu; then the same with **Offline: ON** from the demo menu and wifi
      on, which is the hostile-wifi case)
- [ ] Two devices complete an online match over **mobile data**, not just wifi (queue, arena
      reveal, a full game, both result screens, both rows on the leaderboard)
- [ ] Tutorial completes and cannot soft-lock (play it through; then on a beat, tap the wrong
      thing five times and wait — the watchdog re-prompts; then Skip mid-beat)
- [ ] No secret keys in the bundle: `npm run check:bundle` exits 0 (it exports the Android
      bundle and scans it for the server secret by value and by shape)
- [ ] Attribution screen present if required by your asset licences (Settings → Credits lists
      Rough.js and Bitter; add a line for every CC-BY asset you dropped in, see
      docs/assets.md §7)
- [ ] You have rehearsed the 3-minute script twice on the real hardware

What the laptop can verify has been verified (secrets scan, the rig, the settlement, the
ladder). The four device lines are yours: they need the phones.
