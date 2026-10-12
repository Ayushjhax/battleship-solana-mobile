# CAST — Trailer45

Every file in `demo-assets/users/` was looked at (GIFs as frame contact sheets, `build/cast/preview/`).
Faces were located with YuNet (`scripts/detect_faces.py`); `npm run cast` refuses any crop that cuts
through a detected face. Roles and crops live in `src/trailer45/cast.ts`; copy (the labels) in `copy.ts`.

Ratings are 1–5: **S**harpness · **E**motion/energy · **L**ighting · **F**ace visible · **B**rand fit.

| # | File | Kind | S | E | L | F | B | Role |
|---|---|---|---|---|---|---|---|---|
| 1 | `IMG_0056.HEIC` (3024×4032) | face photo — bearded man with glasses, playing on his phone | 4 | 2 | 4 | 3 | 5 | **Hero: THE ADMIRAL** · rival facecam · swarm |
| 2 | `DSC02686.jpg` (7952×5136) | event photo — hands mid-move on the board, shallow focus | 5 | 3 | 4 | 1 | 5 | **Hero: THE TACTICIAN** · celebration · swarm |
| 3 | `View recent photos.png` (1284×2194) | face photo — lit by the phone at night, half a smile | 3 | 4 | 3 | 5 | 4 | **Hero: THE HUNTER** · reaction (split screen) · swarm |
| 4 | `fxn 2026-09-23 1753407071EF832BCA.JPG` (3024×3780) | community photo — three on a sofa, two laughing at a match | 4 | 5 | 4 | 5 | 4 | **Hero: THE CAPTAIN** (centre, glasses) · reactions (his crewmate on the left; the captain) · celebration · swarm |
| 5 | `DSC00193.jpg` (7952×5304) | event photo — over the shoulder, the board on the phone | 5 | 2 | 3 | 1 | 5 | celebration · swarm |
| 6 | `DSC02671.jpg` (7952×5136) | event photo — two players side by side | 5 | 3 | 3 | 2 | 5 | celebration · swarm |
| 7 | `HTE6dy9bkAIeyVl.jpeg` (2048×1638) | event photo — two players at a table | 3 | 2 | 3 | 1 | 4 | celebration · swarm |
| 8 | `IMG_0825.jpg` (1284×795) | event photo — the phone glowing in the dark | 3 | 3 | 2 | 1 | 5 | celebration · swarm |
| 9 | `fxn 2026-09-26 200056522D97253BF5.JPG` (3023×3779) | event photo — top-down, a player and his phone | 4 | 2 | 3 | 2 | 4 | celebration · swarm |
| 10 | `fxn 2026-09-26 2001073D0C3B0DC2D8.JPG` (3023×3779) | event photo — top-down, the phone lit up | 4 | 2 | 3 | 1 | 4 | celebration · swarm |
| 11 | `IMG_0826.jpg` (1284×2081) | community photo — a player at his desk (another game on the monitor) | 3 | 2 | 3 | 2 | 2 | swarm only |
| 12 | `…8c6 2 (online-video-cutter.com).gif` (400×225, 9 fr) | reaction GIF — the Admiral (#1) at his desk | 2 | 2 | 3 | 3 | 2 | swarm only, as live tiles (burned-in subtitle cropped off; face too small and another game on the monitor for a facecam) |
| 13 | `…8c6 3 (online-video-cutter.com).gif` (400×225) | reaction GIF — a player with glasses and his phone | — | — | — | — | — | **Excluded:** appears very young; age can't be confirmed. Re-enable in `cast.ts` only if he is an adult. |
| 14 | `…8c6-ezgif.com-video-to-gif-converter.gif` (800×450) | animated sequence — silhouette with video-call and web-game windows, subtitles | — | — | — | — | 1 | **Excluded:** off-brand (third-party products, another film's text) |
| 15 | `…8c6.gif` (400×225) | animated sequence — arcade cabinet showing other games, subtitles | — | — | — | — | 1 | **Excluded:** off-brand |

No file shows a wallet address, email or phone number. Filenames carry no names or handles, so **no one is
named** in the film. The only names on screen are in-game display names inside the game's own UI.

## Roles

- **Hero cast (4, one person each, no repeats):** ADMIRAL = #1 · TACTICIAN = #2 · HUNTER = #3 · CAPTAIN = #4 (centre).
- **Reactions (3 facecams + the rival):** crewmate (#4, left) at the Atomic hit · HUNTER (#3) in the split screen · CAPTAIN (#4) at SUNK · rival = ADMIRAL (#1) locking in at matchmaking.
- **Celebration (8):** #4 #6 #2 #8 #7 #9 #5 #10 around the Victory screen.
- **Swarm:** all 11 photos (several crops each) + the live GIF (#12), then in-game art. Only 12 usable
  player images (< 40), so the logo is filled out with the game's own art tinted to the palette: the 40 captain
  avatars, the Purple-edition fleet and arsenal, and the Port City buildings. Players take the tiles in view first.

## Grade (`scripts/cast.py`)

Per photo: grey-world white balance on the mid-tones (60 % of the way to neutral) and exposure pulled to a
shared target (night shots #3 and #8 keep their dark). Then one grade for everyone: gentle S-curve, 14 % less
colour, ballpoint-ink violet in the shadows, warm paper in the highlights, lifted (never crushed) blacks.
Film grain is added once, over the whole frame, in Remotion — so the whole cast shares it.

## Swapping someone

1. Drop the file in `demo-assets/users/`.
2. In `src/trailer45/cast.ts` add it to `PHOTOS` and point a role at its id (hero `box` = a 16:9 region in 0–1 of
   the photo; facecam `box` = a square; `focus` = the face, for tiles).
3. `python3 scripts/detect_faces.py && npm run cast` — it stops if a crop cuts a face. Check `review/cast_sheet.jpg`.
