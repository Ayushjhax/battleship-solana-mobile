# Footage log

Watched via 1 fps + dense (4–10 fps) contact sheets and scene-change detection (`phase1/contact/`, `phase1/scenes/`), plus full-resolution stills at every candidate moment (`phase1/frames/`). Times are source seconds. Rating 1–5 (5 = hero).

Paths below are relative to `demo-assets/`.

## Battle footage (1280×576, ~30 fps VFR, no audio)

These are the only true battle recordings. Native res is low: at 4K the 1.5× rule caps them at 1920 px wide (half the frame). See "Resolution plan" at the end.

### `arsenal-attack.mp4`: 3.33 s, Atomic Bomber strike
| t | Moment | Rating | Notes |
|---|---|---|---|
| 0.00–0.30 | Both boards, HUD (Ayush 1125 vs Saad 1115), Attack deck left. Target square highlighted (red) on enemy board | 4 | Clean, readable establishing state. Top bar shows a small "Back" button (0.0 only). |
| 0.10–0.90 | Atomic bomber flies left→right across the enemy board | 4 | Aim/Fire beat. |
| 1.00–1.10 | Game's own white flash over the enemy board (2 frames) | 5 | **The hit.** Frame-accurate impact at 1.00. |
| 1.20–1.50 | Fireball blooms (orange) | 5 | Best single explosion frame at 1.40–1.50. |
| 1.60–1.90 | Mushroom cloud rises | 5 | Hero. Freeze + push-in candidate at 1.70. |
| 2.00–2.70 | Smoke billows | 3 | Good for decay / heartbeat. |
| 2.80–3.20 | Fire marks appear on hit cells (3×3) | 4 | "Hit." payoff: damage revealed. |

### `base-attack.mp4`: 6.57 s, Bomber strike → Victory
| t | Moment | Rating | Notes |
|---|---|---|---|
| 0.00–1.50 | Bomber selected. Top banner "Bomber — release to fire" | 3 | Aim beat. Slightly static. |
| 1.80–2.90 | Bomber crosses the enemy board | 3 | Small plane on a 1280 frame. |
| 3.00–3.20 | Bomb impact, small fireball top-right of enemy board | 4 | Hit at 3.00. The last ship goes down. |
| 3.50–4.80 | Smoke over the last hit; board fully hatched | 3 | Heartbeat pause before victory. |
| 4.93 | **Hard cut to the Victory screen** (scene change) | 5 | Victory banner, both captains, points panel. |
| 4.93–6.57 | Victory result: "Points gained +0 → +24" counts up, coins 2150 → 2199 | 5 | Clean, readable. Shows "Wager won · 200 total +100": keep it small, never callout. |

### `defense.mp4`: 2.73 s, AA gun shoots down an enemy plane
| t | Moment | Rating | Notes |
|---|---|---|---|
| 0.00–1.00 | Enemy plane crosses own board (left), AA guns on H column | 4 | Defence working. |
| 1.10–1.40 | Plane hit, turns to smoke | 4 | |
| 1.50–2.60 | Red stamp **"Shot down!"** | 5 | Great readable payoff. |

## The earlier demo renders (`battleship-demo-video/out/`)
The brief's "Empire of Bits demo v4" does not exist in the repo. The newest is **v2** (`empire-of-bits-demo-v2-4k.mp4`, 3840×2160, 60 fps, 15 s). Both v1 and v2 are 3× Lanczos upscales of the three battle clips above, with **baked-in captions** ("Choose your attack.", "Build your defense.", "Your home port.", "Take the fight to them.") and a baked end card. **Flag: baked-in titles.** Every useful frame in them already exists in the raw sources, so I re-cut from the raw sources (with better upscaling) instead of re-using captioned frames.
| t (v2) | Moment | Rating | Notes |
|---|---|---|---|
| 1.0–2.0 | Full-bleed zoom on the atomic fireball / smoke | 4 | Same as arsenal-attack 1.2–2.2. Soft at 4K. Caption bottom-left. |
| 6.0–8.0 | Port City rebuilt from art, slow drift | 4 | Rebuilt from `port_city_assets`. I can rebuild it sharper. |
| 8.0 | Battleship wipe back to the raid | 3 | |
| 11.0 | Victory banner lifted off the result screen | 4 | |
| 13–15 | End card: key-art logo + "Get it on Solana dApp Store" badge + empireofbits.xyz | 3 | Reference for the finale; don't reuse (baked). |

## Phone recordings: `material/` (2670×1200 = 20:9 phone landscape, no audio)
Sharp and high-res. Full-bleed at 4K is ≤1.44×, within the 1.5× rule.

### `buildyourbase.mp4`: 8.39 s, fleet placement + defences
| t | Moment | Rating | Notes |
|---|---|---|---|
| 0.00–1.10 | Main menu (Play online / Play offline, 6 tiles) | 3 | Nice establishing menu, sky/sea art. |
| 1.23 | Cut to placement screen: board with 8 ships, Arsenal panel, "Points 260/260", big green **Battle!** | 5 | Clean. Arsenal panel lists real names + costs. |
| 2.30–3.00 | A column/row highlight sweeps (hatching) | 3 | |
| 4.00–4.90 | Tap **AA Gun** → board tints green, "Now tap an open cell on your board" | 4 | Build moment. |
| 5.00 | AA gun lands on the board, Points 260 → 250 | 5 | **"Position is everything."** payoff. |
| 6.25–7.25 | Tap **Mine** → green tint again → mine placed, Points → 245 | 4 | |
| 7.50–8.39 | Fleet + AA gun + mine on board, Battle! ready | 4 | Clean end state. |
| top-left | "Wager OFF" button | – | Leave unremarked. |

### `wallet_profile.mp4`: 7.61 s (last frame at 6.59)
| t | Moment | Rating | Notes |
|---|---|---|---|
| 0.00–1.25 | Captain's wallet, Receive tab: **QR code + full wallet address** | 1 | **Unusable unblurred** (scannable QR, readable address). |
| 1.25–1.75 | Send tab (empty fields) | 2 | |
| 1.75–4.50 | Activity tab: 5 "Confirmed" rows with **tx signatures**; "Privy embedded Solana wallet · Status: connected · 0.009945 SOL" | 4 | Best wallet state, **with signatures and the address blurred**. |
| 4.64 | Slide transition to the menu | 2 | |
| 6.21–6.59 | Captain's profile: **email address, Privy ID, wallet address** | 0 | **Do not use**: personal data. |

### `matchmaking.mp4`: 4.01 s
| t | Moment | Rating | Notes |
|---|---|---|---|
| 0.00–0.50 | Placement screen, Battle! pressed | 3 | |
| 0.75–2.75 | "Finding an opponent": radar sweep (red wedge rotating) | 4 | Status line "Raising the match server · 0s" / "In line · 1s · 1 sailor online" reads as a loading state: keep small or cropped. |
| 3.00–3.25 | VS slams in (red hand-drawn "VS") | 5 | **Match found.** |
| 3.50–4.01 | "Ironwater Sound" arena: Ayush 1175 pts vs Saad 1125 pts | 5 | At 3.40 the tagline overlaps the arena title mid-animation; clean from ~3.6. |

### `buy_points.mp4`: 5.03 s
| t | Moment | Rating | Notes |
|---|---|---|---|
| 0.00–4.00 | Points exchange, "Buy 100 points", 200 available; button disabled with "Preparing your Privy wallet request…" | 2 | Waiting state. Use only the end. |
| 4.25 | **Counter 200 → 300**, "Purchase complete: 100 points were added" | 5 | The beat. |
| 4.25–5.03 | 300 held, green "Pay 0.001 SOL" | 4 | |

### `sell_points.mp4`: 3.04 s
| t | Moment | Rating | Notes |
|---|---|---|---|
| 0.00–1.90 | "Sell 100 points", 300 available, processing | 2 | Waiting state. |
| 2.00 | **Counter 300 → 200**, "0.001 SOL was sent to your Privy wallet" | 5 | The beat. |
| 2.25–3.04 | Green "Exchange for SOL" ready | 4 | |

### `store.mp4`: 3.04 s
| t | Moment | Rating | Notes |
|---|---|---|---|
| 0.00–1.25 | Store, **Crimson** tab: Attack / Boards / Defence / Fleet grids with prices | 4 | |
| 1.50–2.00 | **Emerald** tab | 4 | Tab switch = on-beat cut. |
| 2.25–3.04 | **Purple** tab | 4 | |

### `leaderboard.mp4`: 4.05 s (real frames only 0–0.97, then held)
| t | Moment | Rating | Notes |
|---|---|---|---|
| 0.00–0.45 | Menu, Leaderboard tile tapped | 2 | |
| 0.45–0.70 | Empty table with **loading spinner** | 0 | **Unusable.** |
| 0.75–0.97 (held) | Table: **#1 Ayush · 34 wins · 1175 points** (in red), then Saad, kunal, kash, khyh, cghk, guru | 5 | Punch into the #1 row. Static: needs a camera move. |

## In-game art (high-res enough for 4K)
| Asset | Size | Use |
|---|---|---|
| `assets/store/purple/fleet/*.png` (battleship, cruiser, destroyer, boat) | ~1750–1920 px wide | Fleet lineup (real store editions, cream + violet ink, read well on black). |
| `assets/store/{crimson,emerald}/…` | ~2000 px | Store beat: one hull in three editions. |
| `assets/store/purple/attack/*.png` + `defence/*.png` | 1000–1450 px | Arsenal carousel. |
| `assets/fleet/ship-*.png` | ≤720 px | The default ink hulls (as seen in battle). |
| `assets/images/fx/plane-atomic.png`, `plane-bomber.png` | ~350 px | Small, fine for flight silhouettes. |
| `assets/port_city_assets/…` | map + 15 buildings | Base / Port City sequence. |
| `assets/searching/radar-base.png`, `radar-sweep.png` | 380 px | Matchmaking radar (small). |
| `assets/result/victory-banner.png` | 900×293 | Victory ribbon. |
| `demo-assets/solana-badge.png` | 696×273 | **Finale hero** ("Get it on Solana dApp Store"). ≤1.5× → ≤1044 px wide at 4K. |
| `demo-assets/logo.png` | 1200×1200 | Key-art logo ("Empire of Bits BATTLESHIP"). Raster. |
| `assets/images/battle-screen/empire-ocean-logo.png` | 597×231 | In-game banner logo. Raster. |

No SVG logo exists. The official title in `app.json` is **"Empire of Bits: Ocean Warfare"**. I typeset it in **Bitter** (the game's display font) for crisp 4K, which is what §4.3 asks for anyway.

## Unusable / flagged
- Loading spinner: `leaderboard.mp4` 0.45–0.70.
- Waiting states: `buy_points.mp4` 0–4.0 and `sell_points.mp4` 0–1.9 ("Preparing…", disabled buttons). Use only the counter changes.
- Baked-in titles: both demo renders (captions + end card).
- Readable addresses and personal data: `wallet_profile.mp4` (QR + full address 0–1.25 and 4.5; address under the balance throughout; tx signatures 1.75–4.5; profile screen 6.21+ with email and Privy ID). Blur is baked into the prepared media. The profile screen is never used.
- Cursor jitter / debug UI: none (touch recordings).
- Copy caution: "Wager won", "50-point stake · 100-point prize" appear in UI. Never highlighted or called out.

## Resolution plan
- Phone recordings: native 2670 px, full-bleed OK.
- Battle clips: 1280 px. In a floating screen they sit at ≤1.5× (≤1920 px at 4K). For impact moments I test a Real-ESRGAN anime-video 4× upscale (`tools/upscale.py`). If it holds up (clean line art and legible HUD text), the upscaled plates count as the "native" source for full-bleed. Otherwise impact moments stay in the floating screen at ≤1.5× and the size comes from macro crops instead.
