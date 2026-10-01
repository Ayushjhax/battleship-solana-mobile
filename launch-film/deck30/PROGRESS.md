# PROGRESS — Deck30

Re-read `deck30/BRIEF.md` at the start of every phase. Deck30 is a composition in the trailer's Remotion
project (`launch-film/`, Remotion 4.0.530, 30 fps). Source code: `src/deck30/`, scripts: `scripts/deck30/`,
review pack: `deck30/review/`, deliverables: `out/deck30/`.

| Phase | State | Notes |
|---|---|---|
| 0 · Setup | done | Brief saved verbatim. Trailer project found on this branch; its two later revisions (`optimistic-bell-b1ef0j`) merged in. `npm ci`, Python stack (numpy, soundfile, librosa, pedalboard, matplotlib, opencv 4.14 + YuNet, pillow-heif), Remotion skills installed and read. Git-ignored `build/` rebuilt (faces, graded cast). |
| 1 · Inventory | in progress | Contact sheets in `build/deck30/contact/`. Logs: `deck30/FOOTAGE_LOG.md`, `deck30/CAST.md`. |
| 2 · Music + grid | next | |
| 3 · Storyboard | | |
| 4 · Style frames | | |
| 5 · Animatic | | |
| 6 · Full build + sound | | |
| 7 · Quality gate ×3 | | |
| 8 · Final + deliver | | |

## Decisions

- **The 2-minute LaunchFilm is not in this project.** It lives only on branch `claude/loving-goodall-g4rfgh`, as a
  separate Remotion project in its own `launch-film/` (same folder name, different `Root.tsx`, `package.json`,
  `src/` layout). The trailer was built in parallel without it. Merging the two would mean rewriting one of them, so
  LaunchFilm stays untouched on its branch; Deck30 reuses its logs (`ASSET_INVENTORY.md`, `FOOTAGE_LOG.md`, read via
  `git show`) and its upscaling approach. Nothing in this branch can break it.
- **Same song:** the trailer's music is a track file, `demo-assets/music/Music.mp3` (140 BPM, A minor), edited on
  the beat grid by `scripts/score.py`, with designed sounds synthesised on top. Deck30 edits the same track on bar
  lines (10–30 ms equal-power crossfades) and reuses `score.py`'s sound design. Never the trailer's final mix.
- **Grid: 140 BPM, not 120.** librosa: 139.7 BPM; the per-beat low-band map locks on the kick at track beats 0, −8,
  −16, −24, −32, +156 at exactly 140. The brief's 61 beats at 120 would be 26 s at 140, so every section was
  re-gridded to **70 beats = 30.0 s** with a one-beat pickup (film beat 1 = the first downbeat; downbeats are film
  beats 1 + 4k). All six anchors (ALIVE 1, BOOM 13, drop 29, VICTORY 45, lock 61, final ping 65) are downbeats.
- **"demo v4" doesn't exist.** The newest demo cut is `battleship-demo-video/out/empire-of-bits-demo-v2-4k.mp4`, a
  3× Lanczos upscale of the three raw battle recordings with baked captions on every gameplay frame. As the trailer
  and the 2-minute film did, Deck30 cuts from the raw recordings (`demo-assets/{arsenal-attack,base-attack,defense}.mp4`).
- **The 1.5× rule vs 1280×576 gameplay:** Real-ESRGAN (realesr-animevideov3) plates, 2× for the battle and 4× for the
  poster's fireball (`scripts/deck30/upscale.sh`), so pushes stay at ≤ ~1.5× of the plate. In letterbox the
  recording at 1.5× native fills the 2.39:1 band exactly.
- **No vector logo exists** (`assets/` has only `ink/brand/logo.png`, 733×129). Deck30 uses the trailer's @3x logo
  mask, as its end card does.
- **The victory video** = the game's result screen at the end of `base-attack.mp4` (4.93–6.57 s); its banner and
  panel carry text, so inside VICTORY. the camera holds on the art (sea, ships, lighthouse) away from the panel.
- **Cast:** the trailer's grade (`scripts/cast.py`, `build/cast/graded/`) is shared; Deck30 crops from it.
