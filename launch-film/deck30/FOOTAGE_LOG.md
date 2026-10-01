# FOOTAGE LOG — Deck30

Extends the campaign's logs: the 2-minute film's `ASSET_INVENTORY.md` and `FOOTAGE_LOG.md` (branch
`claude/loving-goodall-g4rfgh`, `launch-film/`) and the trailer's `CAST.md`. Everything below was re-checked on
contact sheets for this film (`build/deck30/contact/`, rebuilt by eye with ffmpeg `tile`). Times are SOURCE
seconds of the files in `demo-assets/`. Rating 1–5.

## Sources Deck30 uses

| Source | Native | Prepared as (`scripts/deck30/prepare_media.py`) |
|---|---|---|
| `arsenal-attack.mp4` (Atomic Bomber strike) | 1280×576, ~29 fps VFR | `deck30/media/poster.mp4` 1.30–2.434 s, Real-ESRGAN 4× (5120×2304 → 3840×1728) · `deck30/media/atomic.mp4` 0.80–3.334 s, ESRGAN 2× (2560×1152) |
| `base-attack.mp4` (Bomber → last ship → Victory) | 1280×576 | `deck30/media/raid.mp4` 1.25–3.10 s, ESRGAN 2× (the result screen is not used as footage: see VICTORY below) |
| `defense.mp4` (AA gun) | 1280×576 | `deck30/media/defense.mp4` 0.20–2.00 s, ESRGAN 2× |
| `material/buildyourbase.mp4` | 2670×1200 VFR | `deck30/media/build.mp4` 1.0–6.0 s, Lanczos → 1920 |
| `material/matchmaking.mp4` | 2670×1200 VFR | `deck30/media/matchmaking.mp4` 0.5–3.25 s |
| `material/buy_points.mp4`, `sell_points.mp4`, `store.mp4` | 2670×1200 | `deck30/media/{buy,sell,store}.mp4` |
| `material/leaderboard.mp4` | 2670×1200 (real frames only to 0.97 s) | `deck30/media/leaderboard.png` — the table at 0.90 s, a still |
| `material/wallet_profile.mp4` | 2670×1200 | `deck30/media/wallet.mp4` 1.30–1.70 s (Send tab), address line blurred at prep |
| `demo-assets/users/*` | photos + GIFs | graded by the trailer's `scripts/cast.py`, cropped by `scripts/deck30/cast.py` |

All transcodes: CFR 30 fps, H.264 yuv420p CRF 16, keyframe every second (`-g 30`), audio stripped.

## Picks (what plays where)

### The Atomic Bomber strike — `arsenal-attack.mp4`, the biggest explosion in the footage
| t | Moment | Rating | Deck30 use |
|---|---|---|---|
| 1.00–1.10 | the game's own white flash over the enemy board | 5 | **the drop (0:12.4)**: the bit's flash cuts straight into the game's flash |
| 1.40 | **fireball at its fullest** (round, ~160 px wide at native) | 5 | **frame 0: the poster**, frozen from the same clip ALIVE plays (4× plate) |
| 1.40–2.27 | fireball → mushroom cloud → smoke | 5 | **ALIVE (0:00.4)** plays on from the poster frame |
| 1.65–1.86 | mushroom cloud | 5 | strobe hit 6 |
| 2.40–3.10 | smoke, then the 3×3 hit marks burst into three fireballs (2.85) | 4 | the drop, beat 31–33 (+ crew facecam on the burst) · strobe hit 4 |
| 0.00–0.30 | "Atomic Bomb" card armed in the Attack deck | 3 | not used (static) |

### The AA gun — `defense.mp4`
| t | Moment | Rating | Deck30 use |
|---|---|---|---|
| 0.30–0.71 | enemy bomber over your board | 4 | the drop, approach at 2.5× (speed ramp) |
| 0.71 | the AA gun fires | 4 | `shot_fire` on its frame |
| 1.05–1.30 | plane hit, puff | 4 | strobe hit 2 · the drop |
| 1.50 | red stamp **"Shot down!"** | 5 | the drop (+ captain facecam) · strobe hit 5 |

### The last ship — `base-attack.mp4`
| t | Moment | Rating | Deck30 use |
|---|---|---|---|
| 1.40–1.80 | Bomber armed, released | 3 | split screen, left |
| 1.80–2.95 | the Bomber crosses the enemy board | 3 | split screen, left (the Hunter reacts on the right) |
| 3.00–3.13 | **the last ship goes down** (small fireball, top-right of the enemy board, peak 3.067) | 4 | **the drop's climax**: SUNK., freeze on 3.067 and push in · strobe hit 3 |
| 4.93–6.57 | **the Victory result screen**: ribbon, both captains, panel counting up | 5 | not used as footage: every frame carries text (ribbon, panel, names, buttons). Inside VICTORY. plays the same screen without its text layer — its backdrop art, `assets/backgrounds/decision.jpg` (ship, sea, islands, lighthouse), drifting |

### UI recordings — `material/`
| File | t | Moment | Deck30 use |
|---|---|---|---|
| `buildyourbase.mp4` | 4.00–5.00 | tap AA Gun → board tints green → AA gun lands, Points 260 → 250 | flip face 1, BUILD YOUR BASE. |
| `buildyourbase.mp4` | 1.30–2.20 | placement board, 8 ships, Arsenal panel | flip faces 2–3 (behind the ships and weapons rising out of the glass) |
| `matchmaking.mp4` | 0.75–2.75 | "Finding an opponent", radar sweep | flip face 4 |
| `matchmaking.mp4` | 2.99–3.07 | the red VS slams in (3.00); the name plates slide in from 3.12 | flip face 4: the punch into the match. Frozen at 3.07 — **no names or points on screen** next to the facecam |
| `buy_points.mp4` | 4.00–5.00 | counter 200 → 300, "Purchase complete" | bento BUY POINTS |
| `sell_points.mp4` | 1.80–3.00 | counter 300 → 200 | bento SELL POINTS |
| `store.mp4` | 0.50–3.00 | Crimson → Emerald → Purple tabs | bento STORE |
| `leaderboard.mp4` | 0.90 | the table, #1 row in red | bento LEADERBOARD → the fly-in and the #1 row; **names, wins and points blurred** |
| `wallet_profile.mp4` | 1.30–1.70 | Captain's wallet, Send tab (empty fields) | bento WALLET; the address under the balance is blurred at prep |

### In-game art (`launch-film/public/art`, `public/port`, the trailer's copies of `assets/`)
Fleet (Purple edition), arsenal and defence art, the 15 Port City buildings — the flip's pieces rising out of the
glass. The board (two 10×10 grids, rows A–J, columns 1–10, `src/engine/types.ts`, `src/board/layout.ts`) is drawn
plainly in the game's tokens for FIRE.

## Flags
- Baked captions: every gameplay frame of both demo renders. Not used.
- Personal data: `wallet_profile.mp4` 0–1.25 (QR + address), 1.75–4.5 (tx signatures), 6.21+ (email, Privy ID) —
  never used; 1.30–1.70 has the address line under the balance — blurred at prep.
- Names next to people: the VS screen's name plates (3.25+) are never shown next to a facecam; the leaderboard's
  names and points are blurred. In-game display names inside the battle HUD stay small and are never tied to a face.
- Wager copy ("Wager won", stakes) appears on the result and matchmaking screens; never framed or called out.
