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

---

# EDIT NOTES — Deck30

The 30-second deck film is the `Deck30` composition in this same Remotion project (`src/deck30/`). Brief:
`deck30/BRIEF.md`; decisions and state: `deck30/PROGRESS.md`; quality gate: `deck30/REVIEW.md`; shot list:
`deck30/review/STORYBOARD.md`. Everything you're likely to tweak is data in four files; frames are derived from beats.

```
src/deck30/copy.ts      every string on screen (cards, bento labels, fleet/arsenal names, "Your move.")
src/deck30/cast.ts      who plays which role (strobe, facecams, the rival, the split screen), their crops, the mosaic pool
src/deck30/timeline.ts  BPM + anchor, every section in beats, the music edit, clip in/out points (source seconds),
                        cameras, lock-ons, divisions, flashes, shakes, the letterbox, every sound cue and duck
src/deck30/mosaic.data.json  generated by scripts/deck30/mosaic.py (the 256-tile plan) — don't edit by hand
```

## Re-render with one command

```bash
cd launch-film
npm run deck30:render   # → out/deck30/: master, deck file, poster_frame0.png, endcard.png, thumbnail, REPORT.md
```

It renders 1920×1080 H.264 (CRF 16, BT.709) with `public/deck30/audio/soundtrack.wav`, runs a two-pass ffmpeg
`loudnorm` to −14 LUFS / −1 dBTP, remuxes the audio as AAC 320k 48 kHz stereo (video copied untouched), makes the
≤ 25 MB deck file (two-pass H.264 High@4.1, `DECK_MB=35` to allow more), exports the exact first and last frames as
PNG, and writes the ffprobe + loudness report. `npm run deck30:draft` makes a 960×540 review copy;
`npm run deck30:review -- build/deck30/draft.mp4 build/deck30/qaN` builds the quality-gate sheets (0.25 s contact
sheets, projector sheets, a 640×360 phone copy and card check, the sound check).

From a fresh clone: `npm ci`, then the media is already committed (`public/deck30/`). To rebuild it:
`npm run cast` (the trailer's grade) → `npm run deck30:cast` → `bash scripts/deck30/upscale.sh` (Real-ESRGAN, slow on
CPU) → `npm run deck30:prepare` → `npm run deck30:mosaic` → `npm run deck30:score`.

## Swap a player

1. Put the photo in `demo-assets/users/` and add it to the trailer's `PHOTOS` in `src/trailer45/cast.ts` (that's where
   the shared grade comes from), then `python3 scripts/detect_faces.py && npm run cast`.
2. In `src/deck30/cast.ts` point a `STROBE` crop, a `FACECAMS` entry or `SPLIT` at it (`box` = [x, y, w, h] in 0–1 of
   the photo: 16:9 for the strobe, square for facecams, 8:9 for the split).
3. `npm run deck30:cast` — it refuses a crop that cuts through a detected face, and anyone appearing more than twice
   outside the mosaic. Check `deck30/review/cast_sheet.jpg`. Then `npm run deck30:mosaic` to refresh the mosaic.

## Change the copy

Edit `src/deck30/copy.ts`. Cards are Anton, ALL CAPS, max 3 words; "Your move." is Inter Tight; in-game names use the
game's own font (Bitter). Every name and number must exist in the game (`src/features/arsenal/catalog.ts`,
`src/features/store/catalog.ts`, `src/engine/fleet.ts`, `src/engine/types.ts`). FIRE is spelled in board cells: its
3×5 pixel letters live in `src/deck30/components/LockOnGrid.tsx` (`GLYPHS`) — a new word needs its strokes there and one
`LOCKS` beat per stroke in the timeline.

## Change the timing

Sections are `[startBeat, endBeat)` in `SECTIONS`; the six anchors (ALIVE, the logo BOOM, the drop, VICTORY, the lock,
the final ping) must stay on downbeats — `node --experimental-strip-types scripts/deck30/check_timeline.mjs` checks
that, the runtime (28–32 s) and that the music edit is on bar lines. Shots in `SHOTS` have `from`/`to` beats, an `in`
point in SOURCE seconds, optional speed `ramps`, `freezeAt`, and camera keys `[beat, x, y, zoom]` in recording pixels
(1280×576). Sound cues in `CUES` are on the same beats: move both together, then `npm run deck30:score`.

## Change the music

1. `python3 scripts/deck30/analyze_music.py` measures tempo / downbeats and rewrites the `ANALYSIS` block in
   `timeline.ts`; for another track set `MUSIC.file`, `MUSIC.bpm` and `MUSIC.anchor` (source seconds of a strong
   downbeat = track beat 0).
2. Point each `MUSIC_EDIT` segment at the track beats you want (`from`/`to` film beats, `track` = track beat under
   `from`), keeping film downbeats (1 + 4k) on track downbeats.
3. `npm run deck30:score` rebuilds `public/deck30/audio/soundtrack.wav` (music edit with filters and the suck-out,
   designed sounds, game SFX, ducks, −14 LUFS master) and `out/deck30/deck30-music.wav` (the music edit alone).
   Then `npm run deck30:render`.

A new BPM keeps every section's beat count, so the film simply gets longer or shorter; keep it 28–32 s.

## Embed it in a deck

Use `EmpireOfBits_Deck30_1080p_deck.mp4` (≤ 25 MB). Its first frame is the poster and its last frame is the end card,
so the slide looks finished before and after playback (`poster_frame0.png` / `endcard.png` are those exact frames).

- **Keynote:** drag the MP4 onto the slide → Format ▸ Movie: Start Movie *On Click* or *After Transition*
  (automatically); leave Repeat at *None* (no loop).
- **PowerPoint:** Insert ▸ Video ▸ This Device → Playback tab: Start *Automatically* (or *When Clicked On*); leave
  *Loop until Stopped* off.
- **Google Slides:** upload the MP4 to Google Drive → Insert ▸ Video ▸ Google Drive → Format options ▸ Video
  playback: *Play (automatically)*.
- **Pitch:** add a video block and upload the MP4; set it to autoplay, loop off.
