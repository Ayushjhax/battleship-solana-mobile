# Review: quality gate

Method each round: render the whole film at half resolution, export a still every 0.5 s (229 frames), tile them into labelled contact sheets (`tools/sheet.py`: timecode, frame, beat, scene), look at every one, and check the list in BRIEF §9. Round 0 was the 77-still pass before the checkpoint (see PROGRESS.md).

---

## Round 1: stills every 0.5 s (`build/q1_*.jpg`), after the music switch

**Sound.** The music switched to the game's own audio at the user's request: the menu theme (106.6 → 120 BPM, Rubber Band stretch, pitch kept) and the battle theme (already 119.99 BPM), with the game's mine / explosion / splash as the kit, nuke / ship_sink as the hits, reversed nuke as the risers, and a reverb-frozen chord from the theme as the finale's soft tone. The sound-design layer moved to game SFX too (ui_tap ticks, torpedo whooshes, coin_flow sweeps, rank_up shimmer, ship_place carousel clicks, radar_ping sonar and lock-on). Grid check on the new score: 120.00 BPM, phase −7 ms. Section loudness (pre-master, short-term): intro −25, journey −17.5, drop −13.6, montage −13.2, heartbeat −21, victory −14.2, economy −14.8, supercut −12.6 (the peak), finale −27.5. The first pass had the heartbeat and finale too hot (−18 / −23); their layers were cut 6–12 dB.

| # | Where | Finding | Fix |
|---|---|---|---|
| 1 | 0:14.0, 0:18.0, 0:30.0, 0:36.0, 0:42.0, 1:32.0 | **Accidental black on the cut**: the wallet phone, the build screen, the fleet, the carousel, the match screen and the bento all started their entrance *at* the cut from zero opacity. | Entrances start 10–12 frames *before* the cut (they are mid-arrival on frame 0). The first hull and the fleet headline land on beat 0.25; the bento hero tile is already arriving. |
| 2 | 0:22–0:26 | The build macro pushed the floating screen off the right edge (a half-visible device looks like an accident). | The lean is 1.24× (was 1.42×) and stays framed; a gentler fall-off replaces the spotlight vignette. |
| 3 | 1:30.5–1:31.5 | The leaderboard punch scaled the handset from its bottom edge, so the top was cropped and the #1 row drifted. | `PhoneFrame` now scales about its centre (as `FloatingScreen` already did), so the punch lands on the row. |
| 4 | 0:58.0 | The first FX card was blank paper for 4 frames. | Its sprite is already running on the cut. |
| 5 | 0:50.5 | "Aim." depth of field read as a bright spotlight. | A real DOF: the frozen board blurred 14 px and dimmed 28 %, with a sharp copy masked to the target. |
| 6 | 0:52–0:54 | "Hit." sat over a ship on the own board; the shade alone didn't separate it. | The band under battle type is a 18 px backdrop blur + a 90 % → 0 gradient (checked at 4K: `build/bench_frames.jpg`). |
| 7 | Readability (≥ 0.4 s per word + 0.6 s) | "Empire of Bits" 1.73 s (needs 1.8), "Command the sea." 1.63 s (1.8), "Live on the Solana dApp Store." 2.75 s (3.0), the "Mine" callout 0.78 s (1.0). | Title in at beat 3.25, tagline at 7.75 → 1.99 s / 1.83 s. The badge line holds to beat 12 → 3.0 s. The build callouts hold until the cards arrive → 1.23 s. The finale shifts ½ beat: "One more thing." after 0.9 s of silence, lockup at 12.5, the bit at 13.5, the ping at 17.75 (the lockup holds clean 2.1 s), black by 19.25. |
| 8 | Whole film | Checked, no change: every cut lands on a beat (scene starts are whole beats; gameplay events are anchored to beats by measurement), the battle hits on the flash frame (b104 = the game's own white flash), the four biggest hits carry the shake (title, Hit, the last ship, Victory), there is no slow-mo, the wallet data stays blurred in every frame it appears (hero, bento tile), and the runtime is 1:54.0. | — |

4K benchmark (BRIEF §6): 150 frames of the battle at 3840×2160 in 200 s (1.33 s/frame while the upscaler shares the CPU) → about 76 min for the film at 30 fps. 60 fps would double it and the footage isn't 60, so the film stays at 30 fps.

---

## Round 2: a still every 0.5 s from the half-res draft (`out/draft_1080p.mp4` → `build/q2_*.jpg`)

The draft includes every round-1 fix and the game-music soundtrack; it was also mastered and delivered as the 1080p preview.

| # | Where | Finding | Fix |
|---|---|---|---|
| 1 | 0:12.0 | "Empire of Bits" was still fading out (blurred, ghosted) while "Command" rose through it: two lines on screen at once. | The title is gone the frame before the tagline starts (exit at tagline − 13 frames, 12-frame exit). Verified at f355/f360/f362. |
| 2 | 0:30.0 | The fleet cut still opened on a near-black frame (the Battleship's entrance began on the cut). | The Battleship is already arriving on the cut (entrance −12 frames). Verified at f900. |
| 3 | Whole film | Re-checked, no change: no black frames on any cut; the whip-pans read as motion (1:00.0, 1:02.0); Aim/Fire/Hit lands on the flash; the heartbeat thins; half a beat of black before Victory (1:13.75); the leaderboard punch lands on the #1 row; the bento fly-through lands in the battle tile; hard cut to silence at 1:44.0; "One more thing." after 0.9 s of black; the lockup holds 2.1 s, pings, fades to black by 1:53.6 and holds black to 1:54.0. Every line meets ≥ 0.4 s/word + 0.6 s. Runtime 1:54.0. | — |

Loudness of the delivered preview: −13.8 LUFS integrated, −0.9 dBTP, AAC 320 kb/s 48 kHz (two-pass loudnorm on the rendered audio).
