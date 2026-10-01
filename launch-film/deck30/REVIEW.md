# REVIEW — Deck30 quality gate

Each round: render a half-res draft (`npm run deck30:draft`), `npm run deck30:review -- <draft> build/deck30/qaN`
(a still every 0.25 s with time / frame / beat burned in, the same sheets with the blacks lifted to ~10 % for the
projector test, a 640×360 phone copy + a phone check of every card, and a sound check: loudness + spectrogram with the
sections and cues overlaid, silence / clipping / transient measurements), look at every sheet, write the critique
here, fix, repeat.

## Round 1 — the animatic (`deck30/review/animatic.mp4`)

Drop plates were still Lanczos stand-ins (the Real-ESRGAN upscale was running).

### Wow audit

| # | Wow | At | Score | Notes |
|---|---|---|---|---|
| 1 | The poster comes alive | 0:00.43 | 4 | The unfreeze is clean (same prepared clip, zero jump); flash, punch, shake, soft shockwave ring, fireball → mushroom. The logo's bits fly off small and low: the blast reads, the bits don't. **Redesign:** a third of the bits are blown at the camera (they swell up to 5×) and every bit draws a light trail. |
| 2 | The bit becomes the logo | 0:05.57 | 4 | Black, the ping, the BOOM on the −16 hit, the bits lock, the sweep: right shape, but the rush is a soft converge. **Redesign:** the bits stream home with light trails, a warp-speed burst into the logo. |
| 3 | The flip | 0:07.29 | 4 | Flips land face-on on 17/19/21/23 with motion blur; ships and weapons rise out of the glass; the base's pieces snap around it. The landings are soft. **Redesign:** every landing gets a 4-frame punch and a specular glint across the glass. |
| 4 | FIRE in target locks | 0:10.71 | 5 | Bold ink pixels on the game's two boards, brackets at 8ths → 16ths → 32nds, the letterbox, the silent hang, the period on the downbeat. |
| 5 | The drop | 0:12.43 | 4 | The period's bloom into the game's own white flash is the best cut in the film; HIT., the burst, "Shot down!", the split, SUNK., the suck-out all land. The last ship's explosion is small (60 px at native). Kept: it IS the last ship; the freeze, bloom and SUNK. carry it. Fixed below: the split's HUD. |
| 6 | VICTORY as a window | 0:19.29 | 5 | Bright sea-and-ship art inside crisp glyphs, hairline edges, the sweep, the fly through a true counter hole into the leaderboard tile. |
| 7 | One becomes all | 0:23.57 | 4 | Divisions read; the sculpt into a blocky EMPIRE OF BITS and the crisp lock work. The divisions are polite and the wall sits still. **Redesign:** every new tile flashes as it divides off, a light sweep crosses the 256 wall, and the whole wall pushes in to arrive exactly on the lock. |
| — | Landing | 0:27.86 | 5 | The trailer's end card, held 3.0 s (from 0:27.0) to the last frame. |

Longest stretch without a wow or a big hit: < 2 s everywhere (strobe hits every 0.43 s, the BOOM 5.6, flips every
0.86 s from 7.3, FIRE 10.7, the drop's hits 12.4–17.1, VICTORY 19.3, the fly 20.6, the bento ticks to 22.1, the
punch 23.1, the divisions 23.6–24.4, the lock 26.1, the ping 27.9).

### Tests

| Test | Result |
|---|---|
| Slide test | Frame 0: the fireball, deep ink edges, an anamorphic streak, the lockup — a finished poster. Last frame: the trailer's end card. ✅ |
| Sound-off | build → fleet → arsenal → rival → (FIRE) → battle → win → economy → players → live: every step has its card or label. ✅ |
| Projector (+10 % blacks) | Every card, the logo and the key action still read. ✅ |
| Phone (640×360) | Every card and the end card read; the bento labels (46 px) were the smallest. ⚠️ |
| Sound | **The render was 42.7 ms late.** Remotion's AAC carries 2048 samples of encoder priming without an edit list; the silence measured −39 dBFS rms (the music's tail sliding in) and every transient was +47–57 ms. ❌ |
| Rhythm | Cuts and cards on the burned-in beats; anchors on downbeats (f13, f167, f373, f579, f784, f836). ✅ |
| Cast | Faces whole; one grade. **The VS screen showed "Ayush 1175 pts / Saad 1125 pts" next to the rival's facecam** (found on the style frames). ❌ The split screen showed the enemy HUD ("Saad 1115") beside the Hunter. ❌ |
| Honesty | Names from the game's code; no quotes; leaderboard names/points and the wallet address blurred at prep. ✅ |
| Runtime | 900 frames = 30.0 s; end card held 3.0 s. ✅ |

### Fixes made

1. **Audio sync:** `scripts/deck30/render.mjs` now renders picture only (`--muted`) and muxes the score WAV with
   ffmpeg (proper priming). Re-measured: 0 samples offset (cross-correlation 0.9998), silence −99 dBFS rms, every
   transient within half a frame of its hit.
2. **No names next to people:** the VS clip is frozen at 3.07 s (the plates arrive at 3.12); the split's camera stays
   low enough that the HUD sits behind the top bar. The rival's tile was recut to his profile + the game on his phone.
3. Wows 1, 2, 3, 7 redesigned as above (light trails and camera-bound bits in `BitShatter`; landing punch + glint in
   `FlipScreen`; division flashes, a wall sweep and a push-to-lock in `Mosaic`/`Finale`).
4. The strobe's battle hits re-picked for impact: the white flash, "Shot down!", the 3×3 burst, the fireball forming
   and the mushroom (both from the 4× poster plate), the plane hit.
5. Bento labels 46 → 58 px.
6. Wrong-frame scare at 3.75 s checked frame by frame: it is the intended hard cut to black (frame 116).
