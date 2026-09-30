# Edit notes

Remotion 4.0.530 · React 19 · TypeScript. One composition, **`LaunchFilm`**: 3840×2160, 30 fps, 3420 frames (1:54.0).

## One-command builds

```bash
npm install
npm run assets     # stage game art + fonts into public/, prepare media (CFR 30, H.264, blurs)
npm run audio      # timeline → score (Python) → beat detection → sound design + mix
npm run final      # 4K render → two-pass loudnorm → 4K + 1080p MP4s, poster, thumbnail, report
```

Cheaper passes while editing:

```bash
npm run studio                                   # live preview
npm run stills -- build/stills 0.5 240 1560 3330  # any frames (or ranges a-b/step) as JPGs
npm run animatic                                 # 960×540 with sound, ~16 min
npm run draft                                    # 1920×1080 draft
```

Python needs `numpy scipy soundfile librosa pedalboard pyloudnorm pillow`. ffmpeg must be on PATH.
The Real-ESRGAN plates (`tools/upscale.sh`, `tools/upscale-fx.sh`) take hours on CPU. Without them, `prep-media.sh` builds Lanczos stand-ins with identical timing.

## Change the copy
Every on-screen string is in **`src/config/copy.ts`**. `\n` breaks a line. Keep the rules at the top of that file: six words max, periods, sentence case, and names and numbers only from the game's code. The two lines that end on the bit (`coldOpen.line2`, `finale.yourMove`) have no period on purpose, because the glowing pixel is the period. Their positions are measured from the text, so edit freely.

## Change the timing
Everything is in **`src/config/timeline.ts`**, in beats:
- `SCENES`: each scene's `start` (absolute beat) and length in `beats`. The film's duration is derived from the last scene.
- Per-scene blocks (`COLD_OPEN`, `TITLE`, … `FINALE`): when each word, callout and move lands, in beats relative to the scene.
- `EVENTS`: moments inside the recordings in **source seconds**, measured by `tools/measure_events.py`. `anchored(clip, event, onBeat, at, beats)` builds a shot whose source event lands exactly on a beat. Move the beat and the in-point follows.
- `SFX_CUES`: the sound design, in beats. Gameplay cues are derived from the shots, so they stay frame-accurate.

After a timing change: `npm run mix` (re-places the SFX on the new beats), then render.

## Change the music
1. Put the track in `public/audio/` and set `MUSIC_FILE` in `timeline.ts`.
2. `python3 tools/beats.py public/audio/your-track.wav` prints `bpm` and `beatOffset` (seconds to the first beat) into `build/beats.json`.
3. Set `BPM` and `BEAT_OFFSET` in `timeline.ts`. Every cut, word and cue moves with them.
4. `npm run mix` lays the sound design over the new track and ducks it 3–6 dB under the key SFX. Skip `audio/score.py`, which composes the original score.

The original score (`audio/score.py`) is built to the scene grid: D minor, 120 BPM, sections keyed to the scene starts. The game's `mine`, `explosion` and `splash` sounds are layered into the kick, snare and hats. If you move scenes, `npm run audio` re-composes it to the new grid.

## Where things live
| Path | What |
|---|---|
| `src/LaunchFilm.tsx` | the film: scenes on the grid, finish (vignette, grain, contrast), soundtrack |
| `src/scenes/*.tsx` | one file per section (ColdOpen … Finale) |
| `src/components/` | `KineticText`, `MaskReveal` + `LightSweep` (Reveal.tsx), `FloatingScreen`, `PhoneFrame`, `Callout`, `ZoomPunch` (Impact.tsx), `SpeedRamp` + `Footage` + `Freeze`, `SonarPing`, `GridField`, `Bit`, `Framed`, `ArtCard`, `FxSprite`, `Grain` + `Vignette` (Finish.tsx), `Drift` + `Plate` (Camera.tsx), `WeaponLabel` |
| `src/scenes/Fleet.tsx` / `Bento.tsx` | the lineup and the bento grid (`Lineup` / `BentoGrid` in the brief) |
| `src/theme.ts` | colour, type scale, easing, radius, shadow: the one system |
| `audio/` | `score.py` (music), `mix.py` (sound design + ducking), `master.py` (pre-master limiter), `synth.py` |
| `tools/` | media prep, ESRGAN upscales, event measurement, stills, contact sheets, final render, report |
| `public/media/` | prepared clips (gitignored, rebuilt by `npm run assets`) |

## Notes
- The sandbox's headless Chrome has no H.264 WebCodecs path, so `@remotion/media`'s `<Video>` falls back to `<OffthreadVideo>` (logged). Output is identical, just slower.
- Freeze frames are `<Video playbackRate={0.0001}>` on the exact frame (see `Freeze` in `Footage.tsx`).
- All wallet addresses, the QR code and transaction signatures are blurred in `public/media/wallet.mp4` at prep time (`tools/prep-media.sh`), frame-gated to the tab that shows them.
