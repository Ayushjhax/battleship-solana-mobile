# Empire of Bits — 30-Second Deck Film
Production brief for Claude Code

You are the director, editor, motion designer and sound designer of a 30-second film for our pitch deck, made from our Solana game in this repo (the Empire of Bits battleship game). It's the third film in the campaign, after the 2-minute launch film and the 45-second trailer: same world, same song, same drop, new tricks.

The bar: the trailer's Netflix energy with Apple keynote polish, compressed into 30 seconds, with a wow every few seconds. Investors, partners and players will watch it in a meeting room, on a laptop, or muted inside a shared deck. Every one of them should say "wow" more than once. When in doubt, cut.

I'm explicitly asking you to render and export the final MP4s. Review your own work through rendered stills and drafts.

## The idea: the slide that explodes

In a deck, a video sits on its slide as a still until it plays, and it freezes on its last frame when it ends. So this film's first and last frames are designed as slides.

- Frame 0 is a poster: the biggest explosion in our footage, frozen at its peak, graded like a film poster, with the Empire of Bits logo. It looks like a finished static slide.
- The moment it plays, time cracks back on. The explosion detonates, and its shockwave blows the logo apart into bits.
- From there it's one escalating idea: one bit becomes an empire. The bit becomes the logo, then a base, a fleet, a battle, a victory, and finally hundreds of real players. They sculpt themselves into the Empire of Bits logo, with one bit left empty: yours.
- It lands on the trailer's end card: the logo, the "Live on Solana dApp Store" image and "Your move." That frame is the slide the video freezes on.

Campaign continuity: the trailer's music, drop and sonic logo, the glowing bit, the sonar ping, the letterbox, the two voices of type, "Your move." and the dApp Store end card. Reuse our best footage, but no sequence should feel like a recut of the trailer.

## Order of work

Setup → reuse and extend the inventory → music edit + beat grid → storyboard → style frames of the seven wows → animatic → full build + sound → quality gate (3 rounds) → final render, master, deliver.

Put these in launch-film/deck30/review/ and push them as you go so I can peek: STORYBOARD.md (the shot list with source clips and timestamps), the style frames (1920×1080 JPG) and a 960×540 animatic with the music. Don't wait for me.

## 0 · Setup

1. Save this brief verbatim to launch-film/deck30/BRIEF.md. Re-read it at the start of every phase. Keep launch-film/deck30/PROGRESS.md current (done / next / decisions) so the work survives a restart.
2. Find the trailer's project. If launch-film/ or its Trailer45 composition isn't on this branch, look on every branch (`git fetch --all`, `git log --all -- launch-film`) and bring it in. If you can't find the trailer's project or its music anywhere, stop and tell me before composing anything. This film must use the same song.
3. Add this film as a new composition, Deck30, in that Remotion project. Reuse its components, fonts, palette, grain, cast picks, logs, sounds and config pattern. Don't break LaunchFilm or Trailer45; render a few frames of each at the end to confirm. Never modify the game's files.
4. This is probably a fresh container. Run `npm ci`. Git-ignored media may be missing, so rebuild it with the existing prep scripts.
5. If Remotion's agent skills are missing, install them: `npx -y skills add remotion-dev/skills -g -a claude-code -y`. Then read ~/.claude/skills/remotion-best-practices/SKILL.md and the references it routes to before coding.
6. Tools:
   - ffmpeg/ffprobe. The fallback is pip imageio-ffmpeg, because Remotion's bundled ffmpeg lacks filters like tile and select.
   - Python with numpy, soundfile, librosa, pedalboard and matplotlib.
   - opencv-python-headless<5 for face-aware crops.
7. Use subagents for parallel work (music edit, sound design, mosaic tiles) when it saves time. Commit source at the end of every phase.

## 1 · Spec

- 1920×1080, 16:9. Runtime ~30 s (28–32 s allowed, hard cap 32 s). Same frame rate as the trailer.
- Frame 0 is the poster: never black, no fade-in, finished as a still.
- The last frame is the end card, held at least 1.5 s, with no fade to black.
- It works with the sound off, because decks are often watched muted: picture and text alone tell the story. With sound, it's a banger.
- No voiceover.
- At least 60% of the runtime is real gameplay or in-game art.
- All text stays inside the 90% title-safe area, because slide apps and projectors crop edges.

## 2 · Source material

Start from what the trailer work already produced: ASSET_INVENTORY.md, FOOTAGE_LOG.md, CAST.md, the cast config and the transcode scripts. Re-check anything you plan to use with contact sheets, and extend the logs where you need more. Find exact paths yourself.

- battleship-demo-video/: "Empire of Bits demo v4" 4K, our best gameplay. The poster, the hook and the battle come from here first.
- demo-asset(s)/users/: player photos and GIFs, for the strobe, the facecams and the mosaic.
- demo-asset/material/: build your base, buy points, sell points, leaderboard, matchmaking, store, wallet profile.
- public/: fleet, arsenals, defence, ports, fonts, the victory video, game audio/SFX, more footage.
- The "Live on Solana dApp Store" image, and assets/ for logos (prefer SVG) and brand files.
- The game's code and config: the source of truth for every name and number.

## 3 · Seven wows and a landing

These are the film. Make a style frame of each before building anything, and protect them through every edit.
- Each one lands with picture, sound and type in sync.
- There's never more than ~4 s without a wow or a big hit.
- If one doesn't work in the animatic, replace it with something better, not something safer.

1. The poster comes alive (0:00.5). The frozen slide detonates: time resumes on the hit, a 2-frame flash, a zoom punch, and the logo blows apart into bits along the shockwave.
2. The bit becomes the logo (0:03.5). Black. One glowing bit pings, then BOOMs, and the scattered bits rush back and lock into the logo under a light sweep. This is the sonic logo.
3. The flip (0:06.5). One floating glass screen flips on every second beat through the game: base → fleet → arsenal → rival. Ships and weapons break the frame, rising out of the glass to hover in front of it.
4. FIRE, written in target locks (0:10.5). On the game's board grid, lock-ons land faster and faster (8ths → 16ths → 32nds) and spell FIRE in pixels. Then total silence, with the word hanging without its period. The period is the bit, and it lands on the downbeat.
5. The drop (0:12.5). The trailer's drop, cut to our hardest-hitting battle footage in letterbox, with player facecams reacting on the hits.
6. VICTORY as a window (0:20.5). Giant letters with the victory video playing inside them and a light sweep. Then the camera flies through the O and out into the game's economy.
7. One becomes all (0:24.5). A single bit divides 1 → 4 → 16 → 64 → 256 on the beat, each tile a real player or a real battle. Then the mosaic sculpts itself into the Empire of Bits logo, with one bit left empty and glowing.

The landing (0:28.5): the trailer's end card, exactly. The empty bit pings once and the sonic logo rings out.

## 4 · Style

Same system as the trailer. Where this list and the trailer's code disagree, match the trailer unless this brief says otherwise.

1. Two voices of type.
   - Trailer cards use the trailer's heavy condensed display face: ALL CAPS, max 3 words.
   - Inter Tight in sentence case is only for "Your move."
   - The game's own font is only for the logo and in-game names.
   - Every font loads locally.
2. Cards.
   - They slam in on the beat: scale 1.12→1.00 in 5 frames, a 2-frame blur, a sub hit.
   - Off-white #F5F5F7 or the game's accent.
   - Standalone cards hold at least 2 beats; labels over pictures can be 1 beat.
   - Text never sits on busy footage without dimming or blurring the plate.
3. Cuts land on beats or impact frames. Flash frames only on the biggest hits. Use the grid wipe at most twice. Whip-pans and flips get @remotion/motion-blur on those frames only.
4. Cinema mode. The 2.39:1 letterbox slides in as FIRE begins and holds through the battle and VICTORY. It pulls back as we fly through the O, so the frame opens up into the economy.
5. Impact. A 3–5-frame zoom punch (1.00→1.08), bloom on explosions, and micro-shake on only the 3 biggest hits. Slow-mo only from 60 fps sources; otherwise freeze-frame and push in.
6. Apple craft.
   - Nothing linear: entrances use cubic-bezier(0.16, 1, 0.3, 1), moves use cubic-bezier(0.65, 0, 0.35, 1). No bounce.
   - Every shot drifts (push 1.00→1.05).
   - UI floats as glass screens: rounded corners, a 1px highlight, a soft shadow.
   - Portrait footage goes in a generic phone frame, never an iPhone.
   - Nothing above ~1.5× its native size.
7. Finish. 2% grain, a soft vignette, gentle halation and deep blacks. Only the game's palette plus one accent. Keep enough shadow detail to survive a projector (§8).
8. The players.
   - Face-aware crops, never through a face, one shared grade.
   - Spread the cast: outside the mosaic, nobody appears more than twice.
   - No crosshairs, damage, explosions or warping on anyone's face.
   - No quotes or testimonials.
   - Names or handles only if they're in the filenames or a list I've provided.
   - Never imply that a specific player holds a rank, a score or a result.
9. Copy. Positive, confident, declarative. No invented stats or claims, and no financial promises. Every name and number exists in the game.
10. Borrow the craft, never the brand: no Netflix or Apple names, logos, fonts, intros or sounds.

## 5 · Beat sheet

The grid is 120 BPM (1 beat = 0.5 s) with a one-beat pickup: the poster holds for the pickup, and the music's first downbeat is the ALIVE hit at 0:00.5. Re-grid to the music's real tempo.

These land on downbeats: ALIVE, the logo BOOM, the drop, VICTORY, the logo lock and the final ping. Every other cut lands on a beat. ★ marks a wow.

| # | Time | Beats | Section | Picture | Text | Sound |
|---|---|---|---|---|---|---|
| 1 | 0:00.0–0:00.5 | 1 | Poster | Frame 0: the biggest explosion frozen at its peak, graded like a poster, with the logo lockup small and confident. A barely-there push. | Logo | A breath in: a reversed explosion tail swelling into the hit |
| 2 | 0:00.5–0:01.0 | 1 | ★1 Alive | Time cracks back on: a 2-frame flash, a zoom punch, the explosion plays on, and the logo blows apart into bits. | — | The hit: game explosion + sub boom |
| 3 | 0:01.0–0:03.5 | 5 | Real | Strobe on 8ths: a player's face, then a battle hit, alternating. No face shorter than 6 frames. | "REAL PLAYERS." "REAL BATTLES." | A stab per card, ticks on the 8ths |
| 4 | 0:03.5–0:06.5 | 6 | ★2 The bit | Hard cut to black. The bit fades up and pings. On the downbeat (0:04.5) it BOOMs, and the scattered bits rush back into the logo under a light sweep. At 0:06.0 the logo collapses back into the bit, which unfolds into a glass screen. | Logo | Sonic logo: ping → BOOM |
| 5 | 0:06.5–0:10.5 | 8 | ★3 The flip | The screen flips, landing face-on exactly on every second beat. Base building, with defence and port art snapping around the edges → the fleet rising out of the glass into a lineup, names beneath → weapons rising into a carousel, the strongest centered and glowing → matchmaking: a radar sweep, a punch into "match found", and a player facecam sliding in, locked. | "BUILD YOUR BASE." "ASSEMBLE YOUR FLEET." "LOAD YOUR ARSENAL." "FIND YOUR RIVAL." | The pulse; a whoosh and a glassy tick per flip; metallic ticks |
| 6 | 0:10.5–0:12.0 | 3 | ★4 FIRE | One last flip: the back of the screen is the game's board grid, and we push into it as the letterbox slides in. Lock-on brackets snap onto cells, faster and faster, and the lit cells spell FIRE in pixels. Faint board coordinates run along the edges if the game uses them. | "FIRE" | Rising digital ticks, accelerating |
| 7 | 0:12.0–0:12.5 | 1 | Silence | Everything stops. The word hangs, with no period. | — | Total silence |
| 8 | 0:12.5–0:20.5 | 16 | ★5 The drop | a) 0:12.5: the period (the bit) slams in and detonates. A 2-frame white flash blooms out of it, and we hard-cut to the best full-bleed hit with a zoom punch. b) 0:13.5: beat-cut impacts with speed ramps; 2–3 facecams pop in on hits (rounded, bottom corner). c) 0:16.5: a split screen, the hit on the left and a reaction on the right; one grid wipe. d) 0:18.5: escalate to the last ship going down, with a freeze-frame and push on the biggest explosion. The final beat sucks out. | "HIT." on the biggest hit; "SUNK." on the last (only if the game has sinking) | The trailer's drop, untouched except the suck-out; game SFX on every hit |
| 9 | 0:20.5–0:22.5 | 4 | ★6 Victory | Hard cut on the downbeat to "VICTORY." filling ~85% of the width, with the victory video playing inside the letters. A light sweep crosses. On beat 4 the camera flies through the O as the letterbox pulls back. | "VICTORY." | The biggest hit of the film; a whoosh opening up through the O |
| 10 | 0:22.5–0:24.5 | 4 | Economy | Out of the O into an Apple-style bento: 4–5 glass tiles (buy points, sell points, store, leaderboard, wallet), each playing its UI clip, snapping in on 8ths with labels. On beat 4 the camera flies into the leaderboard tile and punches into the #1 row, keeping names and addresses soft. | Tile labels: "BUY POINTS" "SELL POINTS" "STORE" "LEADERBOARD" | A soft tick per tile; a whoosh in |
| 11 | 0:24.5–0:27.0 | 5 | ★7 One becomes all | The #1 row's highlight collapses into the bit. It divides on 8ths, 1 → 4 → 16 → 64 → 256, every tile a real player (a few live GIFs) or a real battle, the gutters shrinking as it multiplies. On the downbeat (0:26.5) the mosaic sculpts itself: tiles outside the logo's silhouette fall away, the rest duotone and lock into the logo, and the crisp vector logo resolves through them. One bit stays empty and glowing. | — | A riser that steps up a note with each division; a hit on the lock |
| 12 | 0:27.0–0:28.5 | 3 | Live | The logo eases up and the Solana dApp Store image rises beneath it. At 0:28.0 "Your move." fades in between them. | "Your move." | Warm pad, a soft tick |
| 13 | 0:28.5–0:30.5 | 4 | Landing | On the downbeat the empty bit pings once. Hold the full end card (logo, dApp Store image, "Your move.") to the last frame. No fade. | — | Sonic logo: ping → BOOM, the tail rings out |

Total: 30.5 s.

## 6 · Sound: same song, same drop

1. Find exactly what the trailer used: check its PROGRESS.md, EDIT_NOTES.md, timeline config, audio scripts and stems.
   - If it's the score you composed in Python, re-render it from its script with this film's arrangement: the same key, BPM, instruments, patches, seeds and sonic logo. It's the same song, cut to fit.
   - If it's a track file, edit it on bar lines with 10–30 ms equal-power crossfades.
   - Never use the trailer's final mix as the music bed. Its SFX are baked in.
2. Arrangement: pickup swell → ALIVE hit → stabs → sonic logo → pulse and whooshes → accelerating ticks → total silence → the drop → suck-out → the biggest hit → bento ticks → a stepped riser → the lock hit → warm pad → ping → BOOM → the tail rings out on the final frame.
3. The drop is the first 16 beats of the trailer's drop, untouched except for the suck-out on its last beat. It's the moment people remember.
4. Detect BPM and downbeats with librosa and write them into the Deck30 timeline config.
5. Every visual event has a sound:
   - a granular glass sweep when the logo shatters
   - a whoosh and a glassy tick for every flip
   - a rising digital tick for every lock-on
   - a soft tick for every facecam and tile
   - a pitched step for every division
   - frame-accurate game SFX on every hit
6. Mix and master.
   - Duck the music 3–6 dB under key hits, and let nothing clip.
   - After the render, run a two-pass ffmpeg loudnorm to −14 LUFS integrated / −1 dBTP. Remux with -c:v copy as AAC 320k, 48 kHz stereo. Measure to confirm.
   - Export the music edit on its own as deck30-music.wav.

## 7 · Tech

- Deck30 lives in the existing Remotion project, with its version and conventions. Use <Video> from @remotion/media (it falls back to <OffthreadVideo>), plus @remotion/transitions and @remotion/motion-blur. GIFs become CFR MP4s, not @remotion/gif.
- Everything I might tweak lives in config, following the trailer's pattern:
  - Deck30 copy: every string.
  - Cast: who plays which role, plus the mosaic pool.
  - Timeline: BPM, offset, section lengths in beats, clip in/out points. Frames are derived, so a new song means a new BPM and offset only.
- New reusable components: PosterFreeze, BitShatter (logo ⇄ bits, both directions), FlipScreen, LockOnGrid (pixel-font words on the game's board), TypeWindow (footage inside letters, with a fly-through of a counter), BitMitosis and MosaicLogo.
- Craft notes:
  - Take the poster still from the same transcoded clip the ALIVE shot plays from, so the unfreeze has zero jump.
  - TypeWindow uses real glyph outlines (an SVG clipPath with the text, or opentype.js paths). That keeps the letters crisp and makes the O's counter a true hole that reveals the next scene.
  - Keep "VICTORY." readable: bright footage inside, a hairline highlight on the edges. If the victory video has baked-in text, use a stretch without it.
  - Draw the bits and the mosaic on <canvas>. Preload tiles into an atlas, and never put the same image next to itself.
  - Everything is deterministic: use Remotion's random(seed), never Math.random().
- Media prep: transcode only the segments you use (plus handles) to CFR at the project fps: H.264 yuv420p, CRF 16–18, a keyframe every second, lanczos downscale from 4K. Mute clip audio by default.
- Browser: if Remotion can't download its headless browser, pass --browser-executable pointing to a preinstalled one, e.g. /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell. If CSS 3D or filters render wrong, try --gl=angle or --gl=swangle.
- Rendering: final --codec=h264 --crf=16 --color-space=bt709; drafts --scale=0.5. Run renders in the background with a log and poll.
- Deck encode: from the mastered file, make a deck version of 25 MB or less.
  - Two-pass H.264, High profile, level 4.1 (4.2 at 60 fps), yuv420p, AAC 320k.
  - If the grain blocks up or the blacks band, allow up to 35 MB rather than lose quality.
  - Both the master and the deck file get -movflags +faststart.

## 8 · Quality gate: 3 rounds before the final

Each round: render a half-res draft, export a still every 0.25 s into contact sheets, and look at every one. Write the critique and fixes into launch-film/deck30/REVIEW.md, fix, and repeat.

- Wow audit: score each of the seven wows 1–5 with its timestamp. Anything under 5 gets redesigned, not polished. No stretch is longer than ~4 s without a wow or a big hit.
- Slide test: frame 0 and the last frame, viewed as stills, each look like a finished slide.
- Sound-off test: picture and text alone tell the loop: build → fleet → arsenal → rival → battle → win → economy → players → live.
- Projector test: lift the blacks to ~10% on the contact sheets. Every card and the key action still read.
- Phone test: render a 640×360 copy. Every card and the end card read.
- Sound check: plot loudness over time and a spectrogram, with the cut list overlaid. The silence is true silence, every hit has a transient on its frame, and nothing clips.
- Rhythm: every cut and card lands on a beat, and the anchors land on downbeats. The silence holds, and the drop hits.
- Cast: every face is well cropped, flattering and graded to match. Nobody appears to hold a rank or a result.
- Honesty: every name and number exists in the game, and no one is quoted. No wallet addresses or personal info are readable.
- Runtime is 28–32 s, and the end card holds at least 1.5 s.
- The last cut: name the weakest second of the film, then cut it or fix it.

## 9 · Deliverables

In launch-film/out/deck30/:
- EmpireOfBits_Deck30_1080p.mp4: the master. 1920×1080, H.264, AAC 320k, −14 LUFS.
- EmpireOfBits_Deck30_1080p_deck.mp4: 25 MB or less, for Keynote, PowerPoint, Google Slides and Pitch.
- poster_frame0.png and endcard.png: exactly the first and last frames, so the slide looks the same before and after playback. Plus thumbnail_1280x720.jpg.
- deck30-music.wav.
- A Deck30 section in EDIT_NOTES.md covering:
  - how to swap players, copy, timing and music
  - the one command to re-render
  - how to embed it. Keynote and PowerPoint: insert the deck MP4 and set it to play automatically or on click, with no loop. Google Slides: upload it to Drive, insert it from Drive and set playback to automatic.
- An ffprobe + loudness report proving the runtime is 32 s or less, and confirming 1080p, fps, file sizes and −14 LUFS.

Get the videos to me. If you have a file download or send tool, use it. Otherwise, commit the deliverables to the branch and tell me the paths. Use git add -f if out/ is ignored, and commit the master only if it's under 100 MB.

Thirty seconds. Seven wows. Every frame earns its place. Make the room lean in.
