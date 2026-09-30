# REVIEW — Trailer45 quality gate

Each round: render a draft (`npm run draft`), `python3 scripts/review.py out/draft.mp4 build/qaN` (a still every
0.25 s with time/frame/beat burned in, a 640×360 phone copy and a phone check of every card), look at every
sheet, write the critique here, fix, repeat.

## Round 1 — the animatic (draft 1, `review/animatic.mp4`)

| Test | Result |
|---|---|
| Hook | Frame 0 = the Atomic Bomb fireball, full bleed, violet-darkened paper around it, zoom punch. 0.25 s: mushroom cloud rising. 0.5 s: THE ADMIRAL. already on screen (card lands f14 = 0.47 s). Stops the thumb. ✅ |
| Sound-off | Reads as: explosion → four real people → REAL PLAYERS / REAL BATTLES → brand → build, fleet, arsenal, rival → FIRE. → battle with HIT./SUNK. → VICTORY. → economy → players become the logo → dApp Store, Your move. ✅ |
| Phone (640×360) | Every card readable; end card readable. The sting line (44 px, tracked) was the weakest. ⚠️ |
| Rhythm | Cuts and cards on beats (burned-in beat numbers). Silence 43–46 holds with FIRE.; drop at f591; swarm lands f1170 on beat 91. ✅ |
| Cast | Four different people in the hero cards, faces whole, one grade. ✅ |
| Honesty | Names are the game's (fleet: engine; weapons: arsenal catalog; ranks: engine). No quotes. ✅ — but CLIMB showed the result screen's wager line. ⚠️ |
| Finale | End card (logo + "Your move." + dApp Store) complete from ~42.2 s to 45.0 s. ✅ |

Fixes made:
1. **Claim**: line 1 now lifts *before* line 2 slams (they overlapped for 3 frames at 3.0 s).
2. **Sting**: the line 44 → 54 px for the phone test.
3. **CLIMB.**: its own wide glass framing only the rank row (Chief Ship Petty Officer, bar 125 → 145/2000); no
   wager line, no coins, no buttons.
4. **Economy glass**: enters from 35 % opacity so no card frame is empty.
5. **"Your move."** 80 → 92 px.
