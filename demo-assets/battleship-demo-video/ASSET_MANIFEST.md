# Asset manifest

What was supplied, what each file actually contains, and exactly what the edit uses.
All timings in the recordings are **source seconds**; timeline positions are **frames at 60 fps**.
Every value used by the edit lives in `src/config.ts`.

## Gameplay recordings (`../`)

All three are H.264, yuv420p, **1280 × 576** (20:9 landscape), ~30 fps **variable** frame rate, and **have no audio track**.

| File | Length | Frames | What happens |
|---|---|---|---|
| `arsenal-attack.mp4` | 3.334 s | 98 | **Atomic Bomb** armed in the Attack panel with its red 3×3 target on the enemy board (first frame only, 0.0–0.1 s) → bomber crosses (0.23 s) → white flash (1.000 s) → mushroom cloud (1.2–2.1 s) → smoke → hit marks in the 3×3 zone (2.8–3.3 s) |
| `defense.mp4` | 2.734 s | 79 | Enemy bomber over the player's board (0.4 s) → AA gun at H2 fires (≈0.71 s) → plane downed in smoke (0.9–1.4 s) → **"Shot down!"** stamp (1.50–2.67 s) → turn returns to the player |
| `base-attack.mp4` | 6.567 s | 187 | **Bomber** armed, "Bomber · release to fire" (0–1.63 s) → bomber crosses row A (1.8–2.8 s) → bomb → first hit (2.833 s) → ship sunk, ink blast (2.97–3.13 s) → game over, turn marker clears (3.533 s) → recorder gap (4.50 → 4.73 → 4.90 s) → **Victory** screen (from 4.933 s), coins 2,150 → 2,200 (5.7–6.5 s) |

The brief mentioned "base-attack.mp4" more than once and a "defencse.mp4". On disk there are exactly **two different attack recordings** (`arsenal-attack.mp4`, 3.3 s, Atomic Bomb; `base-attack.mp4`, 6.6 s, Bomber) and one defence recording named `defense.mp4`. None is a duplicate of another.

Event times were measured frame by frame: flash and fireball by board brightness and orange-pixel counts, the stamp by red-pixel counts, game over by the turn triangle's green pixels.

### Selected ranges

| Timeline frames | Scene | Source | Range (s) | Speed |
|---|---|---|---|---|
| 0–23 | Choose your attack | `arsenal-attack.mp4` frame 0 (still) | 0.000 (held 0.4 s) | hold |
| 24–185 | Choose your attack | `arsenal-attack.mp4` | 0.20 → 3.15 | 1.10× |
| 180–359 | Build your defense | `defense.mp4` | 0.00 → 2.72 (whole clip) | 0.91× |
| 510–679 | Take the fight to them | `base-attack.mp4` | 1.40 → 4.23 | 1.00× |
| 680–755 | Take the fight to them | `base-attack.mp4` | 4.95 → 6.20 | 1.00× |

- **Scene 1:** the armed state exists for only one frame of the recording, so that exact frame is held briefly (a deliberate freeze, with the push-in and red-ink rings) before the strike plays. It runs 10 % fast so the result, the hit marks, is on screen before the cut. Frames 180–185 dissolve under the pan into scene 2.
- **Scene 2:** slowed to 0.91× so the whole defence, including the stamp, fills its three seconds.
- **Scene 4:** real speed and real order. Only idle smoke (4.23–4.93 s) is trimmed, at the game's own cut to the result screen. The Victory screen plays until the window leaves for the end card.

The composition renders from 3× Lanczos proxies (`public/footage/*.3x.mp4`, 3840 × 1728) whose frame timestamps match the originals exactly. Originals are copied unchanged to `public/footage/source/`.

## Port City (`../port_city_assets/`, identical to the game repo's copy)

| File(s) | Size | Use |
|---|---|---|
| `backgrounds_and_reference/port_city_map_background.png` | 1774 × 887 | Ground layer (terrain, water, bridge, piers), 2× Lanczos |
| `buildings/*.png` (15) | 257–386 px | All fifteen, on their plots |
| `ui/*_label.png` (6), `ui/your_harbour_ribbon.png` | 430 × ~97, 600 × 125 | Landmark ribbons and "Your Harbour" |
| `ui/location_flag.png` | 122 × 138 | Caption mark, scene 3 |
| `backgrounds_and_reference/assembled_screen_reference.png` | 1860 × 846 | Not used. Its README calls it a concept, not the game |
| `../port-city.png` | 568 × 255 | Composition reference (the live game screen) |

Placement comes from the game's own layout data (`src/features/city/cityLayout.ts`): map-pixel ground line, drawn width, label offset, painter's order, and the "Your Harbour" box. The rebuilt scene matches `port-city.png` building for building, at up to 6× the screenshot's resolution. Nothing is added. Coin/gem counters, home button, compass and hint are left out: they are interaction UI, and the 2,200 coins would contradict the Victory count that follows.

## Fleet (`../fleet/`, 23 files)

Used as caption marks, each matching its scene's action:
- `icon-atomic-bomber.png` (97 × 84): Atomic Bomb
- `icon-aa-gun.png` (77 × 79): AA gun
- `icon-bomber.png` (78 × 69): Bomber

The top-down ship sprites don't match the isometric port or the board footage, so the scenes are bridged by camera moves on the matching game layout instead.

## Brand

| File | Size | Use |
|---|---|---|
| `logo.png` | 1200 × 1200, opaque | End card, shown whole at 1120 px |
| `solana-badge.png` | 696 × 273 | End card at 1.6× (1114 × 437), unaltered: no crop, tint or filter |
| `website.txt` | `https://empireofbits.xyz/` (25 bytes) | Read at render time. Shown as `empireofbits.xyz` |

## Sound: the game's own files

None of the recordings has audio, and the asset folder has no sound. The edit uses the game's own effects and music from `~/Desktop/gm/battleship-solana-mobile/assets/audio/`. Each effect sits where the game itself plays it (`src/fx/battleEffects.ts`).

| Frame | File | Game event | Level |
|---|---|---|---|
| 0 | `sfx/ui_tap.mp3` | selection (click lands as the ring draws) | 0.60 |
| 22 | `sfx/bomb_drop.mp3` | BOMB_DROPPED (whistle into the flash) | 0.30 |
| 68 | `sfx/nuke.mp3` | NUKE_FLASH, on the white flash | 0.60 |
| 226 | `sfx/plane_down.mp3` (+8 dB) | AIRCRAFT_DOWNED, 0.79 s before the stamp | 0.95 |
| 341 | `sfx/pen_scratch_long.mp3` | into the port (menu sound) | 0.65 |
| 549 | `sfx/bomb_drop.mp3` | BOMB_DROPPED, ends on the hit | 0.28 |
| 596 | `sfx/explosion.mp3` (+12 dB) | HIT, first impact frame | 0.90 |
| 597 | `sfx/ship_sink.mp3` | SUNK, the decisive impact | 0.74 |
| 638 | `sfx/victory.mp3` | GAME_OVER | 0.50 |
| 719 | `sfx/coin_flow.mp3` | result screen coins | 0.45 |
| 757 | `sfx/rank_up.mp3` | end card lands | 0.34 |
| 0–896 | `music/music_battle.mp3` | bed, faded out by frame 896 | 0.95 |

`explosion.mp3` peaks at −27 dBFS and `plane_down.mp3` at −17.5 dBFS as mastered, so each got one lossless gain step (WAV). Not used: `music_menu.mp3` (a second bed would break continuity), the Captain voice lines (no voiceover).

## Type and colour

- **Bitter** 600/700/800: the game's one display family (`src/ui/tokens.ts`). Bundled locally from `@fontsource/bitter` (SIL OFL, `public/fonts/`).
- **Palette** from `src/ui/tokens.ts`: paper `#FDFAF3`, sheet `#FBFCFE`, ink `#3E2FB8`, Port City ink `#0B0491`, red ink `#C7261C`, grid `#CFE9F6`/`#A6D8EE`. The stage and end card use that ink taken to its deepest (`#0E1060` → `#05062C`) with the graph-paper grid.

## v2 additions

| Source | Use in v2 |
|---|---|
| `port_city_assets/buildings/lighthouse.png` + the lighthouse painted on the battle screen (recording px 1234, 379) | The recurring element: the board's lighthouse is matched in position and height to the harbour's, and an ink bloom opens the board from it (frames 343–370) |
| `port_city_assets/buildings/expedition_dock.png` | The sailboat is cut from its dock along a polygon and rocks on its mooring (1.1°, 2.5 s period) |
| `fleet/ship-battleship.png` (720 × 248, 2× Lanczos) | Crosses the camera (frames 494–526); the raid is revealed in its wake |
| game repo `assets/result/victory-banner.png` (900 × 293) | The same banner the result screen draws, lifted off it at 1.85× over its native position |
| game repo `assets/battle/seagull.png` (71 × 40) | Two gulls over the harbour mouth |
| game repo `assets/audio/sfx/pen_scratch_short.mp3`, `splash.mp3` (+14 dB) | Ink ring on the selected weapon; the ship's wake |

v2 selected ranges:

| Timeline frames | Source | Range (s) | Speed |
|---|---|---|---|
| 0–23 | `arsenal-attack.mp4` frame 0 (still) | 0.000 (held 0.4 s) | hold |
| 24–185 | `arsenal-attack.mp4` | 0.20 → 3.30 | 1.15× |
| 180–369 | `defense.mp4` | 0.00 → 2.72 (whole clip) | 0.86× |
| 498–667 | `base-attack.mp4` | 1.20 → 4.03 | 1.00× |
| 668–755 | `base-attack.mp4` | 5.08 → 6.55 | 1.00× |

Water motion is limited to what the artwork supports: small sun glints on open water only, the rocking boat, and two gulls. The printed water itself is not distorted.
