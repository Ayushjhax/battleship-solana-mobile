# Empire of Bits — Launch Film
### Production brief for Claude Code

You are the director, motion designer, editor, sound designer and render engineer for the launch film of our Solana game in this repo (the Empire of Bits battleship game).

The bar is an Apple keynote product film: precise, restrained, confident, one unforgettable moment after another. If Steve Jobs watched it, he wouldn't ask for a single change. Simplicity is the ultimate sophistication. When in doubt, cut.

I'm explicitly asking you to render and export final MP4s. I have no live Studio preview in this environment, so review your own work through rendered stills and draft videos.

## Order of work
Setup → Phase 1 (inventory, watch everything) → storyboard + music/beat grid + style frames + animatic → **checkpoint** → full build + sound design → quality gate (at least 2 rounds) → final render, master, deliver.

## 0 · Setup
1. Save this brief verbatim to `launch-film/BRIEF.md`. Re-read it at the start of every phase. Keep `launch-film/PROGRESS.md` current (done / next / decisions) so the work survives a restart.
2. Work only inside `launch-film/`. Read and copy from the game's files; never modify them.
3. Install Remotion's agent skills: `npx -y skills add remotion-dev/skills -g -a claude-code -y`. Then read `~/.claude/skills/remotion-best-practices/SKILL.md` and the references it routes to (create, markup, embedding videos, render) before writing code.
4. Tools: ffmpeg/ffprobe (install if missing; fallback is the static binary from pip `imageio-ffmpeg`, because Remotion's bundled `npx remotion ffmpeg` lacks filters like `tile` and `select`), plus Python with `numpy`, `soundfile`, `librosa`, `pedalboard`.
5. Use subagents for parallel work (footage logging, audio) when it saves time. Commit source at the end of every phase.

## 1 · The film
- Runtime **1:45–1:55**. Hard cap 1:59.
- 16:9. Master 3840×2160, plus a 1920×1080 web version. Frame rate per §6.
- **Gameplay first:** about 60% of the runtime is real gameplay or in-game art (battle, base building, fleet, arsenal, victory). Wallet, matchmaking, points, store and leaderboard are fast, rhythmic beats, never slow walkthroughs.
- No voiceover. Music, sound design and kinetic typography carry it.
- Arc: silence → reveal → the player's journey → a battle that hits like a drop → victory → a rhythmic run through the economy → recap → "One more thing." → Live on the Solana dApp Store.

## 2 · Source material
Names are how I remember them. Find the exact paths yourself.
- `demo-asset/material/`: MP4s for build your base, buy points, sell points, leaderboard, matchmaking, store, wallet profile.
- `battleship-demo-video/`: "Empire of Bits demo v4" 4K (~15 s). Our best-looking footage. Use its strongest moments for the title and the battle.
- `public/`: fleet, arsenals, defence, ports, fonts, the victory video, all game audio/SFX, more footage.
- The "Live on Solana dApp Store" image: the hero of the final shot.
- `assets/`: logos, brand files, everything else.
- The game's code and config: the source of truth for the title, ship/weapon/defence names and any numbers.
- Music: a track in `demo-asset/music/` if I've added one.

## 3 · Phase 1: inventory and watch everything
- ffprobe every media file into `ASSET_INVENTORY.md` (path, duration, resolution, fps, CFR/VFR, codec, audio, orientation).
- Watch the footage. For every clip, make contact sheets (1 frame/s, tiled) plus scene-change frames, and look at them. Log hero moments with timestamps and a 1–5 rating in `FOOTAGE_LOG.md`: hits, explosions, sinkings, victory, satisfying UI moments, clean readable states. Flag what's unusable: loading spinners, cursor jitter, debug UI, baked-in titles, readable third-party wallet addresses.
- Sort the audio: music vs SFX (cannon, explosion, splash, sonar, UI, victory), with durations and loudness.
- Sample the game's real palette (5–6 hex values) from the UI. Identify its display font in `public/fonts`. Prefer a vector (SVG) logo.

## 4 · Creative direction: what would Apple do?
Take inspiration from Apple's craft, but never use Apple's assets, logos, fonts or music.
1. **One idea per shot.** Max 6 words on screen. Short declarative lines with periods. Sentence case.
2. **Negative space.** Pure black is home. The game's palette is the only color, with one accent from the UI for glows, sweeps and callouts.
3. **Type.** Inter Tight for headlines (SemiBold–Bold, tracking −0.02 to −0.04em, line-height ~1.0), Inter for labels. Use the game's display font only for the game title and in-game names. No SF Pro (it's licensed only for Apple-platform mockups). Load fonts locally (`@fontsource-variable/inter-tight`, `@fontsource-variable/inter`, or `public/fonts` via `@remotion/fonts`) so nothing depends on the network at render time. Sizes at 4K: hero 260–340px, headline 160–200px, sub 72–96px, labels 44–56px. Keep 5% title-safe margins.
4. **Motion.** Nothing linear, ever. Entrances use `cubic-bezier(0.16, 1, 0.3, 1)` over 0.6–0.9 s. Camera moves use `cubic-bezier(0.65, 0, 0.35, 1)`. Springs have no bounce. Exits run ~30% faster than entrances. Text comes in per word: masked rise + blur 16px→0 + fade, 2–4 frame stagger.
5. **The camera never stops.** Every shot drifts, with push-ins (1.00→1.06) and gentle parallax. Holds are rare and deliberate: the Apple pause before a big reveal.
6. **Footage presentation.**
   - Landscape gameplay floats as a glass screen on black: rounded corners, 1px inner highlight, layered soft shadow, faint floor reflection. It enters on a 3D tilt (rotateX 10–18°) and settles flat. Go full-bleed only for impact moments.
   - Portrait/mobile footage sits in a generic, logo-free phone frame. Never an iPhone: we ship on the Solana dApp Store.
   - Never show a clip above ~1.5× its native size. Frame soft sources smaller instead of blowing them up.
   - Macro moments: punch into UI details with a depth-of-field feel (surroundings blurred and dimmed).
   - Apple-style callouts: a thin line, a dot, a small label naming a real UI element.
7. **Signature motif: the bit.** The film opens on a single glowing pixel in darkness. It breathes, then pings like sonar, and its rings reveal a faint grid and the world. The pixel is the period in "…a single bit." It returns at the end as the period in "Your move." and pings once before black. Sonar rings and the grid connect the scenes.
8. **Transitions.** Hard cuts on the beat, match cuts, mask wipes, zoom-throughs (fly into a UI element and it becomes the next scene), and a few whip-pans with motion blur (`@remotion/motion-blur` only on those frames, because it's expensive). No glitch spam, lens-flare spam, stock wipes or shaking everything.
9. **Impact language (battle only).** A 3–5-frame zoom punch (1.00→1.08), a 2-frame 15% white flash, bloom on explosions, and micro-shake on only the 3–4 biggest hits. Use slow-mo only where the source has the frames (a 60 fps source at 0.5× in a 30 fps timeline). Otherwise use a freeze-frame + push-in instead of choppy slow-mo.
10. **Finish.** 1.5–2.5% film grain (pre-generated tileable noise frames, cycled; it also kills banding on black gradients), a soft vignette, deep blacks, a slight contrast lift. Consistency beats variety.
11. **Copy.** Positive, confident, declarative. No negative framing. No invented stats or claims: every name and number must exist in the code or the footage. No financial promises ("earn", "profit", "returns").

## 5 · Storyboard: starting point
Refine it after watching the footage, and snap every cut to the music's beat grid. Keep the arc, the bookend and the gameplay share.

| # | Time | Section | Picture | Copy (edit to fit) | Sound |
|---|---|---|---|---|---|
| 1 | 0:00–0:06 | Cold open | Black. One pixel fades up, breathes, pings. Rings expand and a faint grid draws in. Two or three 3-frame flashes of battle between the words. | "Every empire" … "starts with a single bit." | Near-silence, low drone, sonar ping on the pulse |
| 2 | 0:06–0:13 | Title | Hard cut on a hit to the best 4K demo shot, full-bleed, slow push. It dims and the logo resolves with a mask reveal and light sweep. | [Logo / game title] · "Command the sea." | First big hit, then the beat enters |
| 3 | 0:13–0:17 | Wallet | Wallet/profile clip on the floating screen as the tilt settles. | "Connect. You're in." | UI ticks |
| 4 | 0:17–0:28 | Build your base | Base-building footage. Defence and port art fly in as floating cards with callouts. | "Build your base." → "Position is everything." | Game build SFX |
| 5 | 0:28–0:35 | Meet the fleet | Apple lineup: fleet art in a row on black, glossy-floor reflections, slow lateral dolly, names beneath. Add a stat slam ("{N} ships.") only if the config confirms N. | "Meet the fleet." | A whoosh per ship |
| 6 | 0:35–0:41 | Arsenal | Weapons on a smooth 3D carousel. The most powerful ends centered and glowing. | "An arsenal for every strategy." | Metallic ticks |
| 7 | 0:41–0:45 | Matchmaking | Radar sweep over matchmaking footage, then a punch into "match found". | "Find your rival." | Sonar ping → lock-on |
| 8 | 0:45–1:12 | **Battle (hero)** | a) 0:45 full-bleed establishing shot, callouts on both boards. b) 0:49 "Aim." "Fire." "Hit.", each word on the exact frame of its action. c) 0:55 beat-cut montage of the best impacts with speed ramps and weapon-name labels. d) 1:06 the sound thins to a heartbeat and sonar, and the last ship goes down. | "Aim." "Fire." "Hit." … "Every move matters." | The drop, with game SFX layered into the music |
| 9 | 1:12–1:18 | Victory | Half a beat of silence, then the victory video full-bleed. | "Victory." (huge, light sweep) | The biggest hit of the film |
| 10 | 1:18–1:30 | Rhythm run | 4 × 3 s: word slams on one side, clip on the other, cut exactly on the beat. Buy points, sell points, store, leaderboard (end by punching into the #1 row). | "Buy points." "Sell points." "Gear up." "Climb the ranks." | Energy rising |
| 11 | 1:30–1:35 | Bento recap | Apple bento grid of 8–10 rounded tiles, each playing a mini-clip or asset with a label, staggered in on beats. The camera flies into the battle tile. | Tile labels only | Riser |
| 12 | 1:35–1:42 | Supercut | 12–14 one-beat cuts of the best moments, ending on the biggest explosion. | — | Peak → hard cut to silence |
| 13 | 1:42–1:54 | Finale | Black and silence. "One more thing." (small, white) → the "Live on Solana dApp Store" image reveals as the hero with a light sweep → logo + "Your move." (the period is the pixel) → hold ≥ 2 s → it pings once → black. | "One more thing." · "Your move." | Silence → single soft tone → final ping and tail |

Total: 1:54.

## 6 · Tech
- **Remotion 4** (React + TypeScript) in `launch-film/`. Bring in footage with `<Video>` from `@remotion/media` (it falls back to `<OffthreadVideo>` on unsupported codecs). Use `@remotion/transitions` where it helps.
- One composition, `LaunchFilm`, built from scene components. Everything I might tweak lives in two files:
  - `src/config/copy.ts` holds every on-screen string.
  - `src/config/timeline.ts` holds the BPM, beat offset, each scene's start and length in beats, and clip in/out points. Frames are derived from these, so a new song means changing only the BPM and offset.
- Reusable components: `KineticText`, `MaskReveal`, `LightSweep`, `FloatingScreen`, `PhoneFrame`, `Callout`, `ZoomPunch`, `SpeedRamp`, `SonarPing`, `GridField`, `Lineup`, `BentoGrid`, `Grain`, `Vignette`.
- **Media prep:** transcode only the segments you use (plus 1 s handles) into `launch-film/public/media/` at a constant frame rate matching the project, H.264 yuv420p, CRF 16–18, with a keyframe every second. This fixes VFR stutter and speeds up seeking. Mute clip audio by default.
- **Browser:** if Remotion can't download its headless browser (sandboxed network), pass `--browser-executable` pointing to a preinstalled one, e.g. `/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell` if it exists. If CSS 3D or filters render wrong headlessly, try `--gl=angle` or `--gl=swangle`.
- **Frame rate:** benchmark a 5-second 4K render of the heaviest scene. Go 60 fps only if the gameplay was captured at 60 and the full render projects under ~90 minutes. Otherwise use 30.
- **Long renders:** never block on them. Run them in the background with a log and poll. If a render is unstable, render in `--frames` chunks with `--muted`, join them with ffmpeg (`-c copy`), and mux the mastered audio.
- **Flags:** final `--codec=h264 --crf=16 --color-space=bt709`. Drafts `--scale=0.25` or `--scale=0.5`. Make the 1080p version by downscaling the 4K master (lanczos, CRF 18).
- **Git:** ignore `launch-film/public/media/` and `launch-film/out/` (GitHub rejects files over 100 MB).

## 7 · Sound: half the film
- **Music, in order of preference:**
  1. A track I've added in `demo-asset/music/`.
  2. The game's own soundtrack, if a piece has a real build and drop.
  3. An original score you compose in Python (numpy + pedalboard): ~120 BPM, minor key, a sub-bass pulse, a filtered-saw pad, synthesized impacts and "braams", and noise risers into the title and the battle. As the signature, use the game's own cannon, explosion and sonar SFX as percussion. Minimal and powerful, not busy.
- Detect BPM and downbeats with librosa and write them into `timeline.ts`. Shape the edit around the track's sections: intro → build → drop (battle) → break (victory) → final push → silence → ending.
- **Sound design:** every visual event has a sound. Soft ticks for text, airy whooshes for moves, sub drops for reveals, frame-accurate game SFX on every gameplay hit.
- **Mix and master:** duck the music 3–6 dB under key SFX and let nothing clip. After the render, extract the audio, run a two-pass ffmpeg `loudnorm` to −14 LUFS integrated / −1 dBTP, and remux with `-c:v copy` as AAC 320k, 48 kHz stereo. Measure to confirm.

## 8 · Checkpoint (the only one)
After Phase 1, the storyboard and look development, stop and put these in `launch-film/review/`:
- `STORYBOARD.md`: the final shot list with source clips and timestamps.
- 6 style frames (4K JPG): cold open, title, floating screen, fleet lineup, battle hit, finale.
- A 960×540 animatic of the whole film with the music: real footage and correct timing (type animation can be rough).

Commit and push them so I can view them on GitHub, then wait for my go.

## 9 · Quality gate: review like an Apple creative director
Before the final render, render a half-res draft and export a still every 0.5 s into contact sheets. Look at every one, write the critique and fixes in `REVIEW.md`, fix them, and repeat at least twice. Check:
- **Every frame is intentional.** No dead frames, accidental black, spinners, cursor jitter or cuts mid-action.
- **Every line is readable.** It stays on screen ≥ 0.4 s per word + 0.6 s and never sits over busy UI (dim or blur the plate).
- **One system.** The same easing family, type scale, corner radius, shadow and positions throughout.
- **Rhythm.** Every cut and word lands on a beat. The battle hits like a drop. The silence before "One more thing." lands.
- **Clarity.** With the sound off, a stranger understands the loop: build → fleet → arsenal → match → battle → win → points → store → leaderboard.
- **Honesty.** Every name and number exists in the game. No third-party wallet addresses are readable.
- **Runtime** is 1:45–1:55, and the final frame is clean and holds.

## 10 · Deliverables
- `launch-film/out/EmpireOfBits_LaunchFilm_4K.mp4`: 3840×2160, H.264, AAC 320k.
- `launch-film/out/EmpireOfBits_LaunchFilm_1080p.mp4`: the web/social version.
- `launch-film/out/poster.jpg` (4K) and `thumbnail_1280x720.jpg`.
- Clean Remotion source plus `EDIT_NOTES.md` explaining how to change copy, timing and music, and how to re-render with one command.
- An ffprobe + loudness report proving the runtime is under 2:00 and confirming resolution, fps and −14 LUFS.

Get the videos to me. If you have a file download/send tool, use it. Otherwise attach them to a GitHub pre-release on this repo (`gh release create`). If neither works, commit a 1080p version of 95 MB or less to the branch.

Quality over speed. Take the time it needs. Make it undeniable.
