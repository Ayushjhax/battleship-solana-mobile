# PROGRESS — Trailer45

Re-read `BRIEF.md` at every phase.

| Phase | State | Notes |
|---|---|---|
| 0 · Setup | done | `launch-film/` created fresh (no 2-minute film existed; `demo-assets/battleship-demo-video` is the 15 s demo and stays untouched). Remotion 4.0.530, skills installed, ffmpeg 6.1 + ImageMagick + Python (numpy, librosa, pedalboard, opencv 4.14/YuNet). |
| 1 · Inventory + cast | done | 11 photos + 4 GIFs reviewed; 2 GIFs off-brand, 1 excluded (possible minor). `CAST.md`, `src/trailer45/cast.ts`, `npm run cast`. |
| 2 · Storyboard + beat grid | done | `review/storyboard.md` + `.jpg`; track is 140 BPM → 105 beats = 45.0 s. `src/trailer45/timeline.ts`. |
| 3 · Style frames | done | `review/style-frames/` + `style-frames.jpg`: every section built for real in Remotion (render with the local Chromium 141; remotion.media is blocked). |
| 4 · Animatic | done | `review/animatic.mp4` |
| 5 · Full build + sound | done | `npm run score` (subagent-built score, −14 LUFS) |
| 6 · Quality gate ×3 | done | `REVIEW.md` |
| 7 · Final render, master, deliver | done | `out/EmpireOfBits_Trailer45_1080p.mp4`, `out/REPORT.md` |
