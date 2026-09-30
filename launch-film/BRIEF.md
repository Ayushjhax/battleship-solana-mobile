# Empire of Bits — 45-Second Launch Trailer
### Production brief for Claude Code

You are the director, editor, motion designer and sound designer of a 45-second launch trailer for our Solana game in this repo (the Empire of Bits battleship game). The style is Netflix-trailer energy with Apple precision: fast, loud and cinematic, then a calm, perfect landing. It has to stop a thumb mid-scroll in the first second and stay in people's heads after the last.

I'm explicitly asking you to render and export the final MP4. Review your own work through rendered stills and drafts.

## The idea: the players are the empire
Empire of Bits: every bit is a player. We cast real players (the photos and GIFs I've added) as the stars of a blockbuster and cut them against our fastest, hardest-hitting gameplay. The finale pays it off. Hundreds of player photos swarm in and build the Empire of Bits logo, bit by bit. One bit stays empty and glowing: the viewer's spot. Then the Solana dApp Store and "Your move."

Campaign continuity with our 2-minute film: the glowing pixel ("the bit"), the sonar ping, "Your move." and the Solana dApp Store ending.

## Order of work
Setup → inventory + cast the players → storyboard + music/beat grid → style frames → animatic → full build + sound → quality gate (3 rounds) → final render, master, deliver.

Push the storyboard, style frames and animatic to `review/` as you go so I can peek. Don't wait for me.

## 0 · Setup
1. Save this brief to `BRIEF.md` in the project. Re-read it at every phase and keep `PROGRESS.md` current.
2. If `launch-film/` (our 2-minute film) exists, add this as a new composition, `Trailer45`, in that Remotion project and reuse its components, fonts, palette, grain and sounds. Otherwise create `launch-film/` fresh. Never modify the game's files.
3. Install Remotion's agent skills: `npx -y skills add remotion-dev/skills -g -a claude-code -y`. Then read `~/.claude/skills/remotion-best-practices/SKILL.md` and the references it routes to before coding.
4. Tools:
   - ffmpeg/ffprobe. Install if missing; the fallback is pip `imageio-ffmpeg`, because Remotion's bundled ffmpeg lacks filters like `tile` and `select`.
   - Python with `numpy`, `soundfile`, `librosa` and `pedalboard`.
   - `opencv-python-headless<5` for face detection. OpenCV 5 dropped the bundled Haar face cascade; YuNet via `cv2.FaceDetectorYN` also works.
5. Use subagents for parallel work (casting, sound) when it saves time. Commit source at every phase.

## 1 · Spec
- 1920×1080, 16:9. Runtime **45 s** (40–50 s allowed, hard cap 50 s).
- 30 fps, or 60 if the gameplay was captured at 60.
- **Frame 0 is never black.** It's the autoplay thumbnail, so the very first frame is already mid-explosion.
- It has to work with the sound off (X, Telegram, store listings): the story reads from picture and text alone, and the sound is what makes it a banger.
- No voiceover.

## 2 · Source material
Find the exact paths yourself.
- `demo-asset(s)/users/`: player photos and GIFs. **The cast.**
- `battleship-demo-video/`: "Empire of Bits demo v4" 4K. Our best gameplay. The hook shot and the battle come from here first.
- `demo-asset/material/`: MP4s for build your base, buy points, sell points, leaderboard, matchmaking, store, wallet profile.
- `public/`: fleet, arsenals, defence, ports, fonts, the victory video, game audio/SFX, more footage.
- The "Live on Solana dApp Store" image, for the final frame.
- `assets/`: logos (prefer SVG), brand files, extras.
- The game's code and config: the source of truth for every name and number.
- Music: a track in `demo-asset/music/` if I've added one.

## 3 · Cast the players (`users/`)
- Look at every file (for GIFs, a contact sheet of frames). Classify each: face photo, avatar/PFP, reaction GIF, event/community photo, gameplay GIF, other.
- Rate each 1–5 on sharpness, emotion/energy, lighting, how clearly the face is visible, and brand fit. Record picks and roles in `CAST.md`:
  - **Hero cast (4):** the best portraits or PFPs, for the character cards in the hook.
  - **Reactions (3–4):** the most expressive reaction GIFs or photos, for facecams in the battle.
  - **Celebration (4–8):** the victory grid.
  - **Everyone usable:** the logo swarm.
- Skip anything blurry, tiny, badly compressed or off-brand, anything showing personal info (wallet addresses, emails, phone numbers), and anything where someone appears to be a minor.
- **Face-aware crops:** detect faces and center crops on them. Never crop through a face. Lightly even out exposure and white balance, then give everyone the same grade and grain so the cast looks like one film.
- **GIFs:** convert to constant-frame-rate MP4 (H.264, yuv420p, even dimensions) and loop them. Never show one above ~1.5× its native size. They're facecam-size, not full-screen.
- **Respect the people:**
  - No crosshairs, damage, explosions or warping on anyone's face.
  - Never put words in their mouths: no invented quotes or testimonials.
  - Use names or handles only if they're in the filenames or a list I've provided.
- If there are fewer than ~40 usable images, fill the swarm with in-game art (ships, weapons, ports) tinted to the palette. Players come first.

## 4 · Style: Netflix energy, Apple precision
Borrow the craft, never the brand. No Netflix or Apple names, logos, fonts, intro animations or sounds, and nothing that imitates a known sonic logo.
1. **Trailer grammar.** Cold open on action → cast intros → brand sting → escalating text cards cut on hits → silence → the drop → a quiet, perfect landing.
2. **Two voices of type.**
   - **Trailer cards:** a heavy condensed display face in ALL CAPS (`@fontsource/anton` or `@fontsource/bebas-neue`, whichever pairs better with the game's font), 150–190px, tight leading.
   - **Apple voice:** Inter Tight (`@fontsource-variable/inter-tight`), sentence case, used only at the end for "Your move." Going from loud caps to one quiet sentence is the tonal landing.
   - Use the game's own font only for the logo and in-game names. Load every font locally.
3. **Cards.** Max 3 words, in off-white `#F5F5F7` or the game's accent on black. They slam in on the beat: scale 1.12→1.00 in 5 frames with a 2-frame blur and a sub hit. Standalone text cards stay on screen for at least 2 beats. Labels over pictures (cast cards, "HIT.") can be 1 beat.
4. **Cuts.**
   - Every cut lands on a beat or an impact frame.
   - Flash frames (1–2 frames of white or accent) only on the biggest hits.
   - **Signature transition, the grid wipe:** the frame splits into the game's grid and the cells flip one by one, like shots landing, to reveal the next shot. Use it 3 times at most.
   - Whip-pans get `@remotion/motion-blur` on those few frames only.
5. **Cinema mode.** 2.39:1 letterbox bars slide in at "FIRE." and stay through the battle. They pull back as the finale begins, so the frame literally opens up for the logo.
6. **Impact.** A 3–5-frame zoom punch (1.00→1.08), bloom on explosions, and micro-shake on only the 3 biggest hits. Use slow-mo only from 60 fps sources. Otherwise freeze-frame and push in.
7. **Apple craft everywhere.**
   - Nothing linear: entrances use `cubic-bezier(0.16, 1, 0.3, 1)`, moves use `cubic-bezier(0.65, 0, 0.35, 1)`.
   - Every shot drifts (push 1.00→1.05).
   - UI shots that aren't full-bleed float as glass screens: rounded corners, a 1px highlight, a soft shadow.
   - Portrait footage goes in a generic phone frame, never an iPhone.
8. **Finish.** 2% grain (pre-generated tiles; it also kills banding), a soft vignette, gentle halation on highlights and deep blacks. Only the game's palette plus one accent.
9. **Copy.** Positive and confident, no negative framing. No invented stats or claims, and no financial promises.

## 5 · Beat sheet (120 BPM grid, 1 beat = 0.5 s)
Refine it to the footage and the music, but keep the hook, the silence before the drop and the finale.

| # | Time | Beats | Section | Picture | Text | Sound |
|---|---|---|---|---|---|---|
| 1 | 0:00.0–0:00.5 | 1 | **HOOK** | Frame 0 is the single biggest explosion, full-bleed, already mid-blast, with a zoom punch. | — | Hit + sub boom from frame 0 |
| 2 | 0:00.5–0:02.5 | 4 | Cast cards | 4 hero players, one per beat. Each is a freeze-frame with a slight push and a label slamming in lower-left over a thin accent rule. A killer reaction GIF can take the first slot. | "THE ADMIRAL." "THE TACTICIAN." "THE HUNTER." "THE CAPTAIN." | A stab per card |
| 3 | 0:02.5–0:03.5 | 2 | The claim | Black. Two lines, one per beat. | "REAL PLAYERS." / "REAL BATTLES." | Riser |
| 4 | 0:03.5–0:05.0 | 3 | Brand sting | A single glowing pixel appears (ping), then bursts (BOOM) into one thin line of small caps. | "AN EMPIRE OF BITS ORIGINAL" | Sonic logo |
| 5 | 0:05.0–0:09.0 | 8 | Build | Card, then 3 fast cuts of base building with defence and port art snapping in. | "BUILD YOUR BASE." | Pulse starts |
| 6 | 0:09.0–0:12.5 | 7 | Fleet | Card, then fleet art whips into an Apple-style lineup on eighth notes, names beneath. | "ASSEMBLE YOUR FLEET." | Whooshes on 8ths |
| 7 | 0:12.5–0:15.5 | 6 | Arsenal | Card, then weapons snap through a 3D carousel. The strongest lands center, glowing. | "LOAD YOUR ARSENAL." | Metallic ticks, rising |
| 8 | 0:15.5–0:18.0 | 5 | Rival | Matchmaking punches into "match found" as a player's facecam slides in, locked in. | "FIND YOUR RIVAL." | Sonar ping → lock-on |
| 9 | 0:18.0–0:19.5 | 3 | Silence | Everything stops. Letterbox slides in. Black, with one word dead center. | "FIRE." | ~1 s of silence, then one click |
| 10 | 0:19.5–0:29.5 | 20 | **THE DROP** | Battle montage cut on beats and impacts, with speed ramps and grid wipes. 3–4 facecam reactions pop in (rounded, bottom corner) synced to hits. One split-screen: the hit left, the reaction right. | Micro-cards on the 2 biggest hits: "HIT." and "SUNK." (only if the game has sinking) | Full energy, game SFX on every impact |
| 11 | 0:29.5–0:32.5 | 6 | Victory | The victory video center-frame; the celebration players fill a bento grid around it. | "VICTORY." | Biggest hit of the film |
| 12 | 0:32.5–0:36.5 | 8 | Economy | Four cards, 2 beats each, each paired with a flash of its UI clip. | "BUY POINTS." "SELL POINTS." "GEAR UP." "CLIMB." | Rhythmic stabs |
| 13 | 0:36.5–0:37.0 | 1 | Breath | Hard cut to black and silence. The letterbox pulls back. | — | Silence |
| 14 | 0:37.0–0:40.5 | 7 | **The swarm** | Player tiles (mostly photos, up to ~12 live GIF tiles) fly in from a 3D wall and build the Empire of Bits logo bit by bit. Tiles are duotoned in brand color so the shape reads instantly at phone size. One slot stays empty and glowing: the pixel. A light sweep crosses as it locks. | — | Swelling riser → hit on the landing |
| 15 | 0:40.5–0:42.5 | 4 | Live | The logo eases up; the Solana dApp Store image rises into place beneath it. | — | Warm pad, soft hit |
| 16 | 0:42.5–0:45.0 | 5 | Your move | "Your move." fades in between them in Inter Tight. The glowing empty bit pings once. **Hold the full end card to the last frame** (logo + dApp Store + "Your move."), with no fade to black. | "Your move." | Sonic logo: ping → BOOM, tail rings out |

Total: 45.0 s.

## 6 · Sound
- **Music, in order of preference:**
  1. A track I've added in `demo-asset/music/`. Edit it on bar lines with short crossfades so the silence sits at 0:18, the drop hits at 0:19.5 and it resolves by 0:45. If the track's own drop is stronger, re-grid the timeline to it instead (staying within 40–50 s).
  2. The game's own soundtrack, if a piece has a real build and drop.
  3. An original trailer-hybrid score you compose in Python (numpy + pedalboard) at 120 BPM in a minor key: pulse, stabs, noise risers, "braams", and the game's own cannon, explosion and sonar SFX as percussion. Minimal and huge, not busy.
- Detect BPM and downbeats with librosa and write them into `timeline.ts`.
- **Sonic logo** (our own signature): a clean sonar ping (a ~1.5 kHz blip with an echo tail and a slight pitch drop), then a BOOM (sub drop 60→35 Hz, a low-passed noise impact and a short tonal hit in the track's key), ~1.5 s total. Use it at the sting and at the very end, and export it on its own as `sonic-logo.wav`.
- **Sound design:** every visual event has a sound. A stab for every card, a whoosh for every whip, frame-accurate game SFX for every hit, facecam pops as soft UI ticks.
- **Mix and master:** duck the music 3–6 dB under the key hits and let nothing clip. After the render, run a two-pass ffmpeg `loudnorm` to −14 LUFS integrated / −1 dBTP, then remux with `-c:v copy` as AAC 320k, 48 kHz stereo. Measure to confirm.

## 7 · Tech
- **Remotion 4.** Use `<Video>` from `@remotion/media` (it falls back to `<OffthreadVideo>` for unsupported codecs), plus `@remotion/transitions` and `@remotion/motion-blur`. Convert GIFs to MP4 rather than using `@remotion/gif`.
- **Everything I might tweak lives in config:**
  - `copy.ts`: every string, including the four cast labels.
  - `cast.ts`: which image plays which role.
  - `timeline.ts`: BPM, offset, each section's length in beats and clip in/out points. Frames are derived, so a new song means new BPM and offset only.
- **Randomness:** the swarm must be deterministic. Use Remotion's `random(seed)`, never `Math.random()`.
- **Media prep:** transcode only the segments you use (plus handles) to constant frame rate at the project fps, H.264 yuv420p, CRF 16–18, with a keyframe every second. Downscale 4K sources to 1080p with lanczos. Mute clip audio by default.
- **Browser:** if Remotion can't download its headless browser, pass `--browser-executable` pointing to a preinstalled one, e.g. `/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell` if it exists. If CSS 3D or filters render wrong, try `--gl=angle` or `--gl=swangle`.
- **Rendering:** final `--codec=h264 --crf=16 --color-space=bt709`; drafts `--scale=0.5`. Run renders in the background with a log and poll.

## 8 · Quality gate: 3 rounds before the final
Each round: render a draft, export a still every 0.25 s into contact sheets, look at all of them, write the critique and fixes into `REVIEW.md`, fix, and repeat.
- **Hook test:** would frames 0, 0.5 s and 1 s stop you scrolling? Frame 0 is mid-explosion, not black, and text is on screen by 0.5 s.
- **Sound-off test:** the story reads from picture and text alone.
- **Phone test:** render a 640×360 copy and check that every card and the end card are readable at that size.
- **Rhythm:** every cut and card lands on a beat. The silence before "FIRE." holds, the drop hits, and the swarm lands on a hit.
- **Cast:** every face is well-cropped, flattering and graded to match. No one repeats in a hero role.
- **Honesty:** every name and number exists in the game, and no one is quoted.
- **Finale:** the last frame is a clean end card (logo, dApp Store image, "Your move.") held for at least 1.5 s. Runtime is 40–50 s.

## 9 · Deliverables
- `out/EmpireOfBits_Trailer45_1080p.mp4`: 1920×1080, H.264, AAC 320k.
- `out/poster.jpg` (1920×1080) and `out/thumbnail_1280x720.jpg`, using the best hook frame.
- `out/sonic-logo.wav`.
- `CAST.md` and `EDIT_NOTES.md` explaining how to swap photos, labels, copy and music, and how to re-render with one command.
- An ffprobe + loudness report proving the runtime is ≤ 50 s and confirming 1080p, fps and −14 LUFS.

Get the video to me. If you have a file download/send tool, use it. Otherwise commit the MP4 to the branch (it'll be well under 100 MB) and tell me the path.

Fast, but never rushed. Every frame earns its place. Make it undeniable.
