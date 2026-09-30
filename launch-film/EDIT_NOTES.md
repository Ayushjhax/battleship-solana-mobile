# EDIT NOTES — Trailer45

The 45-second launch trailer is the `Trailer45` composition in this Remotion project (`launch-film/`).
Everything you're likely to tweak is data in three files; frames are derived from beats.

```
src/trailer45/copy.ts      every string on screen (cast labels, cards, fleet/arsenal names, "Your move.")
src/trailer45/cast.ts      which photo plays which role, and its crop
src/trailer45/timeline.ts  BPM + beat anchor, every section in beats, the music edit, clip in/out points,
                           grid wipes, shakes, flashes, the letterbox, every sound cue and duck
```

## Re-render with one command

```bash
cd launch-film
npm install            # once
npm run render         # → out/EmpireOfBits_Trailer45_1080p.mp4 + poster + thumbnail + out/REPORT.md
```

`npm run render` renders 1920×1080 H.264 (CRF 16, BT.709) with the soundtrack, runs a two-pass ffmpeg
`loudnorm` to −14 LUFS / −1 dBTP, remuxes the audio as AAC 320k 48 kHz stereo (video copied untouched),
grabs the poster and thumbnail from the hook, and writes the ffprobe + loudness report.
`npm run draft` is a fast 960×540 review copy (`out/draft.mp4`). `npm run studio` opens Remotion Studio.

The renders point Remotion at the preinstalled Chromium (`/opt/pw-browsers/.../headless_shell`) because
Remotion's own browser download host was blocked in the build environment. Set `BX=/path/to/chrome` to use
another, or remove `--browser-executable` in `scripts/render.mjs` on a machine that can download it.

## Change a label or a line

Edit `src/trailer45/copy.ts` and re-render. Cards are Anton, ALL CAPS, max 3 words; "Your move." is Inter
Tight; in-game names use the game's own font (Bitter). Names and numbers must exist in the game
(`src/features/arsenal/catalog.ts`, `src/features/store/catalog.ts`, `src/engine/fleet.ts`).

## Swap a photo / recast a role

1. Put the photo in `demo-assets/users/`.
2. In `src/trailer45/cast.ts`: add it to `PHOTOS` (`focus` = the face), then point a hero, facecam or the
   celebration list at its id. Hero `box` is a 16:9 region in 0–1 of the photo; facecam `box` is a square.
3. `python3 scripts/detect_faces.py && npm run cast && python3 scripts/swarm.py` — `cast` refuses a crop
   that cuts through a detected face. Check `review/cast_sheet.jpg`. Everyone gets the same grade.

The bento tiles pick their crop with `TILE_PHOTO` / `TILE_FOCUS` in `src/trailer45/scenes/Battle.tsx`.

## Change the music

1. Put the track somewhere readable and set `MUSIC.file` in `timeline.ts`.
2. `python3 scripts/analyze_music.py <track>` prints the tempo, beats and an energy map
   (`build/audio/spectrogram.png`). Set `MUSIC.bpm` and `MUSIC.anchor` (source seconds of a strong
   downbeat you want as track beat 0 — here the first drop).
3. Point each `MUSIC_EDIT` segment at the track beats you want (its intro under beats 0–43, its drop
   under 46, a second drop under 66, a build under 83–91, an ending under 91–105).
4. `npm run score` rebuilds `public/audio/soundtrack.wav` (music edit, designed sounds, game SFX, ducking,
   master) and `out/sonic-logo.wav`. Then `npm run render`.

If the new song isn't 140 BPM, every section keeps its beat count and simply gets longer or shorter; check the
total stays 40–50 s (`DURATION` in `timeline.ts`) and adjust a section's beats if not.

## Change the timing of a cut

Sections are `[startBeat, endBeat)` in `SECTIONS`; shots in `SHOTS` have `from`/`to` beats, an `in` point in
seconds of the prepared clip, optional speed `ramps`, `freezeAt`, and camera keys `[beat, x, y, zoom]` in
recording pixels (1280×576). Sound cues in `CUES` are on the same beats, so move both together.

## Rebuild the media

`npm run prepare-media` re-transcodes only the segments used (CFR 30 fps, H.264 CRF 16, keyframe every
second, Lanczos) into `public/media/`. Sources in `demo-assets/` are only ever read.

## Review tooling

- `node scripts/stills.mjs build/stills 0 100 200` — stills of any frames.
- `python3 scripts/review.py out/draft.mp4 review/qa-roundN` — a still every 0.25 s on contact sheets
  (time, frame and beat burned in), a 640×360 phone copy, and a phone check of every card.
- `node scripts/report.mjs` — ffprobe + loudness report of the master.
