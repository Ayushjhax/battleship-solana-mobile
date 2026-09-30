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

## Round 2 — draft 2, first full mix (`npm run score`)

Mix reviewed on `build/audio/soundtrack_spectrogram.png` + the cue sheet (`build/audio/cues.txt`): digital silence under
FIRE. except the one click (19.47 s); the drop on f591; the stop before VICTORY; the breath before the swarm; peaks
VICTORY −9.6 > drop −10.2 > hook −10.4 > landing −10.7 LUFS momentary, the end calm (−13.8). Draft −14.1 LUFS.

- **Sync**: the defence speed ramp had moved the AA gun; `shot_fire` 51.85 → 51.47, `plane_down` 52.3 → 51.95,
  the "Shot down!" stamp 53.75 → 53.3 (derived from the ramp: source 0.71 s lands on beat 51.47).
- **Split screen**: the hit was on row A, under the top letterbox bar — camera reframed to y 120 so the fireball sits
  mid-frame beside the Hunter's reaction.
- **SUNK.**: camera lifted onto the wreck; the card moved lower-left so it no longer covers the ship.
- Sheet 0 showed a black cell at 3.75 s: checked frame by frame — a seek artefact of the sheet, the video is correct.

## Round 3 — draft 3

All seven tests pass: hook (fireball f0, card by 0.47 s), sound-off story, phone (every card + end card legible at
640×360), rhythm (cuts on burned-in beats; silence, drop and landing on their hits), cast (4 different people, whole
faces, one grade), honesty (only the game's names/numbers; no quotes; wager line cropped out of CLIMB.), finale (end
card complete from 42.2 s, held 2.8 s to the last frame, 45.0 s). No further fixes → final render.

## Round 4 — client notes

- Sting line "AN EMPIRE OF BITS ORIGINAL" → "EMPIRE OF BITS".
- 0:27–0:28 broke the flow (dim + one-beat silence, then a jump to the track's second drop). Now drop 1 runs unbroken
  from beat 46 through the battle, VICTORY and the economy; the dim is gone. Re-rendered: −13.8 LUFS, −1.2 dBTP, 45.0 s.
