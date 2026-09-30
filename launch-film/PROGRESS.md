# Progress

Re-read `BRIEF.md` at the start of every phase.

## Done
- **Setup**: brief saved verbatim; Remotion skills installed and read; ffmpeg, numpy / scipy / soundfile / librosa / pedalboard / pyloudnorm / Pillow; Remotion 4.0.530 project in `launch-film/`.
- **Phase 1**: `ASSET_INVENTORY.md`, `FOOTAGE_LOG.md`, contact sheets (`phase1/`), audio sort, palette, fonts, logo decision.
- **Music**: original score (`audio/score.py`), D minor, 120 BPM, built to the scene grid; librosa grid fit confirms 120.01 BPM / first beat 0.017 s (`tools/beats.py`). Sound design + ducking + pre-master (`audio/mix.py`, `audio/master.py`): 111 cues, frame-accurate on gameplay events.
- **Media prep** (`tools/prep-media.sh`): CFR 30, H.264 CRF 16, 1 s GOP, 10 s frozen tails; wallet address / QR / signatures blurred and frame-gated (verified per frame). Event times re-measured in the prepared files (`tools/measure_events.py`).
- **Build**: all 13 scenes + the component system. Review round 0 (77 half-res stills, `build/sheet_r1_*.jpg`) → fixes: hit timing, economy layout (two-line type), wallet callout, build cards, last-hit framing, title subtitle, radar sweep.
- **Checkpoint pack**: `review/STORYBOARD.md`, npm scripts, `EDIT_NOTES.md`, `tools/render-final.sh` + `tools/report.py`.

## Delivered (2026-09-30)
- `out/EmpireOfBits_LaunchFilm_4K.mp4`: 3840×2160, 30 fps, 1:54.0, H.264 CRF 16, AAC, −14.0 LUFS / −1.6 dBTP (512 MB; too large for git or chat, so it stays in `out/`).
- `out/EmpireOfBits_LaunchFilm_1080p.mp4` (68 MB), also in `deliverables/` on the branch.
- `out/poster.jpg` (4K, the title over the atomic strike), `out/thumbnail_1280x720.jpg`, `out/REPORT.md` (copies in `deliverables/`).
- Quality gate: rounds 0, 1, 2 and the final master check (`REVIEW.md`).
- Music switched at the user's request to the game's own audio (`audio/score_game.py`); all sound design uses game SFX.

## Next
- Hand the 4K over: it needs Git LFS, a split, or a local `npm run final`, since it exceeds GitHub's 100 MB file limit and the 30 MB chat limit.

## Decisions
- **"demo v4" doesn't exist**: re-cut from the raw sources (the demo renders have baked captions).
- **No music supplied** → original score first (§7 option 3); **then, at the user's request, the game's own music** (menu theme stretched to 120 BPM + the battle theme, arranged to the grid, game SFX as the kit).
- **Battle clips are 1280×576** → Real-ESRGAN anime-video 4× plates (5120×2304), so full-bleed framing never upscales them more than 1.25×. Phone recordings (2670×1200) sit at ≤ 1.44× (full width, letterboxed when full-bleed).
- **30 fps**: nothing was captured at a true 60. 120 BPM = 15 frames per beat.
- **Title** typeset from `app.json` in Bitter (no vector logo exists).
- **Privacy**: wallet data blurred at prep; the profile screen (email, Privy ID) is never used.
- **Art**: the store's Purple edition for the fleet lineup and arsenal carousel (high-res; cream + violet ink reads on black).
- **Numbers**: 8 ships (`FLEET_SHIP_COUNT`), lengths 4/3/2/1, 8 arsenal items, 3 colour editions, 6 ranks. All from code.
- **Copy change**: "Gear up." → "Collect every colour." (store editions are collection-only).
- **Cold open 8 s** (brief: 6 s) for reading time; the total is 1:54.
- **Headless Chrome** (preinstalled 1194) has no H.264 WebCodecs path → `<Video>` falls back to `<OffthreadVideo>` automatically. Remotion's own browser download is blocked (403), so the config points at `/opt/pw-browsers`.
- **Whip-pan motion blur**: a horizontal SVG blur driven by pan speed (`@remotion/motion-blur`'s HTML-in-canvas needs Chrome ≥ 149).
