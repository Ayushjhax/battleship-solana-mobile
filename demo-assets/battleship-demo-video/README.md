# Empire of Bits: Battleship: 15 s demo

Remotion 4.0.529 · React 19 · TypeScript. 3840 × 2160, 60 fps, 900 frames.

| Frames | Scene | Source |
|---|---|---|
| 0–179 | Choose your attack. | `arsenal-attack.mp4` (Atomic Bomb) |
| 180–359 | Build your defense. | `defense.mp4` (AA gun, "Shot down!") |
| 360–509 | Your home port. | Port City, rebuilt from the game's layout |
| 510–779 | Take the fight to them. | `base-attack.mp4` (Bomber → sunk → Victory) |
| 780–899 | Live on Solana dApp Store + Web | end card, static |

## Versions

- **v1** (`EmpireOfBitsDemo`, `src/Demo.tsx` + `src/config.ts`): the original cut, gameplay in a window on the stage.
- **v2** (`EmpireOfBitsDemoV2`, `src/v2/`): "the board becomes a world". Full-bleed gameplay, the board's lighthouse opening into the harbour, a layered living Port City, a battleship wipe back into the raid, and the real Victory banner lifted off the result screen. Its editable values are in `src/v2/configV2.ts`.

## Commands

```bash
npm install
npm run studio      # live preview in the browser (Remotion Studio)
npm run preview     # quick 960×540 render → out/review/preview-540p.mp4 (~2 min)
npm run render      # all deliverables → out/ (~10 min on an M2)
npm run verify      # checks frames, fps, duration, size, codecs, fast start, end card

npm run preview:v2  # v2 quick render → out/review/v2-preview-540p.mp4
npm run render:v2   # v2 deliverables → out/empire-of-bits-demo-v2-{4k,1080p}.mp4
npm run verify:v2
```

`npm run render` produces:

- `out/empire-of-bits-demo-4k.mp4`: master, H.264 CRF 17, yuv420p, BT.709, AAC 320 kb/s, fast start
- `out/empire-of-bits-demo-1080p.mp4`: Lanczos downscale of the master, same timing
- `out/empire-of-bits-demo-1080p-muted.mp4`: same picture, no audio track
- `out/empire-of-bits-end-card-4k.png`: frame 899, lossless

Set `CONCURRENCY=2` if a 4K render runs out of memory.

## Editing

Everything editable is in **`src/config.ts`**:
- source trims, playback speeds and the held frame (`SHOTS`)
- camera keyframes and impact punches (`CAMERA`, `PORT.camera`)
- captions and their icons (`CAPTIONS`)
- the Port City layout (`PORT`)
- end-card copy and timing (`END_CARD`)
- every sound cue (`SFX`, `MUSIC`)

The web address is read from `public/brand/website.txt` at render time.

`ASSET_MANIFEST.md` records what every supplied file contains and which ranges are used.

## Media

`public/` is already prepared. To rebuild it from the supplied files:

```bash
npm run prepare-media
```

This copies the assets, makes 3× Lanczos proxies of the recordings (original timestamps kept), 2× Port City art, and the game's sound effects. Source locations are set in `scripts/media-sources.json`: the demo assets in `..`, the game's audio in `../../gm/battleship-solana-mobile/assets/audio`. Source files are only read, never modified.

No system ffmpeg is needed: the scripts use the ffmpeg bundled with Remotion (`npx remotion ffmpeg`).
