# CAST — Deck30

Starts from the trailer's `CAST.md` (every file in `demo-assets/users/` rated, three GIFs excluded: one possible
minor, two off-brand). Deck30 crops from the trailer's **graded** stills, so the campaign shares one grade
(`scripts/cast.py` → `build/cast/graded/`). Roles and crops: `src/deck30/cast.ts`; `npm run deck30:cast` refuses a
crop that cuts through a detected face and anyone appearing more than twice outside the mosaic.
Sheet: `deck30/review/cast_sheet.jpg`.

| Person (photo) | Face visible | Strobe (0:01.3–0:03.9) | Elsewhere | Total |
|---|---|---|---|---|
| Hunter (`hunter`, night, phone-lit) | yes | REAL PLAYERS., first face | split-screen reaction (the drop) | 2 |
| Crew (`sofa`, left, laughing) | yes | REAL PLAYERS., with the Captain | facecam on the 3×3 burst | 2 |
| Captain (`sofa`, centre, glasses) | yes | REAL PLAYERS., with the Crew | facecam on "Shot down!" | 2 |
| Admiral (`admiral`, profile) | partly | REAL PLAYERS. | the rival who locks in (FIND YOUR RIVAL.) | 2 |
| Duo (`duo`, glasses, from behind) | no | REAL BATTLES. | — | 1 |
| Focus (`focus`, over the shoulder) | no | REAL BATTLES. | — | 1 |
| Topdown (`topdown`, phone lit) | edge | REAL BATTLES. | — | 1 |
| everyone (11 photos) + the Admiral's live GIF | | | the mosaic (One becomes all) | — |

Crop sizes: strobe crops are 0.4–1.6× native (Hunter's photo is only 1284 px wide: 1.57× at full frame with the
1.05 push); facecams 720 px from ≥ 771 px; the split reaction 954 px from 1284 px.

Respect: no crosshairs, damage, explosions or warping on any face (lock-on brackets frame the rival's *tile*, never
his face; explosions never overlap a facecam). No names (filenames carry none), no quotes. Nobody is shown next to a
rank, a score or a result: the VS screen is frozen before its name plates arrive, and the leaderboard's names and
points are blurred.
