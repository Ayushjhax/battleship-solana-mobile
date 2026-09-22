# Asset Guide — Empire of Bits: Ocean Warfare

Everything you need to make or find, **exactly where to put it**, and every route to getting it.

---

## 1. Read this before you make anything

**About a third of this list should not be produced as image files at all.** Cell marks, mines, torpedoes, rank shields, buttons, panels and every border in the game are cheaper, sharper and more consistent generated at runtime by **Rough.js** (the `useRough` hook in prompt P01). Making them as PNGs costs you hours and gives you a *less* consistent set.

Each row below is tagged:

- 🖼️ **Image file** — you make it and drop it in
- ✏️ **Code** — Claude Code draws it with Rough.js, no file needed

**Total files you actually need: 34.** Not 200.

---

## 2. Folder tree — create this exactly

Prompt P00 scaffolds these empty directories. You drop files in. Paths are relative to your repo root.

```
assets/
├── images/
│   ├── brand/          logo, app icon
│   ├── board/          watermarks, desk texture
│   ├── ships/          4 ship classes
│   ├── arsenal/        8 weapon icons
│   ├── fx/             planes, explosions, splashes
│   ├── avatars/        4 portraits + the Captain
│   ├── ui/             a few icons + emotes
│   └── city/           the port-city map
└── audio/
    ├── sfx/            22 effects
    ├── voice/          17 Captain lines
    └── music/          2 loops
```

---

## 3. THE DROP MAP

This is the section you'll come back to. Filename must match **exactly** — the prompts reference these paths.

**After dropping files, run `npm run assets`.** It reads `assets/images/`, converts every
line-art PNG into a black alpha mask under `assets/ink/` (that is what the app requires —
a drawing with white fill tinted directly turns into a solid violet shape), mirrors the
three flight planes to face right, and builds the app icon, adaptive icon and splash from
`ship-battleship.png`. Commit `assets/ink/` too. Needs ImageMagick 7 (`brew install imagemagick`).
The 4.1 format rules below still apply to what you drop — the script only makes them robust.

### Images — 34 files

| Drop at this exact path | Size (px) | Used by |
|---|---|---|
| `assets/images/brand/logo.png` | 1024×384 | P02 boot sequence |
| `assets/images/brand/app-icon.png` | 1024×1024 | app.json |
| `assets/images/brand/adaptive-icon-fg.png` | 1024×1024 | app.json (Android) |
| `assets/images/ships/ship-battleship.png` | 512×128 | P04, P05 |
| `assets/images/ships/ship-cruiser.png` | 384×128 | P04, P05 |
| `assets/images/ships/ship-destroyer.png` | 256×128 | P04, P05 |
| `assets/images/ships/ship-boat.png` | 128×128 | P04, P05 |
| `assets/images/arsenal/arsenal-aa-gun.png` | 128×128 | P06, P08 |
| `assets/images/arsenal/arsenal-radar.png` | 128×128 | P06, P08 |
| `assets/images/arsenal/arsenal-mine.png` | 128×128 | P06 |
| `assets/images/arsenal/arsenal-submarine.png` | 128×128 | P06, P08 |
| `assets/images/arsenal/arsenal-bomber.png` | 128×128 | P06, P08 |
| `assets/images/arsenal/arsenal-torpedo-bomber.png` | 128×128 | P06, P08 |
| `assets/images/arsenal/arsenal-double-torpedo-bomber.png` | 128×128 | P06, P08 |
| `assets/images/arsenal/arsenal-atomic-bomber.png` | 128×128 | P06, P08 |
| `assets/images/fx/plane-bomber.png` | 256×128 | P08 |
| `assets/images/fx/plane-torpedo.png` | 256×128 | P08 |
| `assets/images/fx/plane-atomic.png` | 256×128 | P08 |
| `assets/images/fx/plane-downed.png` | 256×160 | P08 — the AA intercept |
| `assets/images/fx/explosion-sheet.png` | 1536×256 (6 frames) | P07 |
| `assets/images/fx/splash-sheet.png` | 1024×256 (4 frames) | P07 |
| `assets/images/fx/smoke-puff.png` | 256×256 | P04 wrecks, P08 |
| `assets/images/avatars/avatar-1.png` | 512×512 | P10, P07 HUD |
| `assets/images/avatars/avatar-2.png` | 512×512 | P10, P07 HUD |
| `assets/images/avatars/avatar-3.png` | 512×512 | P10, P07 HUD |
| `assets/images/avatars/avatar-4.png` | 512×512 | P10, P07 HUD |
| `assets/images/avatars/captain.png` | 768×1024 | P02, P09 tutorial |
| `assets/images/board/watermark-kraken.png` | 600×600 | P04 enemy board |
| `assets/images/board/watermark-tiger.png` | 600×600 | P04 |
| `assets/images/board/watermark-anchor.png` | 600×600 | P04 |
| `assets/images/board/desk-wood.jpg` | 1024×1024 tileable | P01 Paper |
| `assets/images/ui/hand-pointer.png` | 128×128 | P09 tutorial cursor |
| `assets/images/ui/emote-01.png` … `emote-08.png` | 256×256 each | P07 chat |
| `assets/images/city/city-port.png` | 2048×1024 | P15 |

### Audio — 41 files

| Drop at this exact path | Count | Used by |
|---|---|---|
| `assets/audio/sfx/*.mp3` | 22 | P02, P05, P07, P08, P15, P16 |
| `assets/audio/voice/captain-01.mp3` … `captain-14.mp3` | 14 | P09 tutorial |
| `assets/audio/voice/captain-idle-01.mp3` … `-03.mp3` | 3 | P07 |
| `assets/audio/music/music_menu.mp3` | 1 | P02 |
| `assets/audio/music/music_battle.mp3` | 1 | P07 |

Exact SFX filenames are in section 5.1. Exact Captain lines in section 5.2.

### Fonts — nothing to drop

Prompt P00 installs `@expo-google-fonts/bitter`. Weights load at runtime: `Bitter_500Medium`, `Bitter_600SemiBold`, `Bitter_700Bold`. No files.

### Drawn in code — don't make these

Cell marks (miss/hit/sunk/revealed/mine) · every button, panel, frame and border · the turn triangle · rank shields · the title ribbon · crosshair arrows · the radar sweep · torpedoes and bombs · the fuel gauge · all UI icons except the hand pointer · the graph paper itself · the coin and gem chips · the custom keyboard keys.

---

## 4. Every route to getting the images

Pick per-asset. Mixing routes is normal and fine as long as everything ends up monochrome black line art.

### Route A — Excalidraw (free, fast, and the closest match to the reference)

**This is the one most people miss and it's probably your best option for the ships.** Excalidraw's entire visual language *is* hand-drawn ballpoint on paper. Draw a ship in two minutes, export as SVG or PNG with a transparent background, done. It's free, needs no account, and every asset you draw there will be perfectly consistent with the Rough.js UI — because Excalidraw and your UI are both built on Rough.js.

Best for: ships, arsenal icons, the hand pointer, emotes.
Not great for: the Captain portrait, avatars, the city map.

`excalidraw.com` → draw → select → right-click → Copy to clipboard as PNG / Export image → tick "transparent background".

### Route B — game-icons.net (free, 4000+ icons, instant)

A CC BY 3.0 library of hand-inked game icons. It already has: battleship, cruiser, submarine, sea mine, radar sweep, bomber plane, anti-aircraft gun, explosion, anchor, kraken. You can set foreground/background colour and size in the browser and download PNG or SVG directly.

This can cover **most of your arsenal folder in about fifteen minutes.** Attribution is required — that's what the credits screen in P10 is for.

Best for: all 8 arsenal icons, watermarks, emotes.

### Route C — AI image generation

Use for anything organic: the Captain, the four avatars, the city map, explosion frames.

Good models for clean line art on white, roughly in order:
- **Recraft** — can output actual SVG, best for crisp line work
- **Ideogram** — most reliable at "pure black line art on white"
- **Flux** (via Replicate/Fal) — good detail control
- **Nano Banana / Gemini image** — fast iteration, good at consistency across a set
- **Midjourney** — best-looking output, hardest to keep clean and isolated

Prompts are in section 4.4 below.

### Route D — other free libraries

- **SVG Repo** — 500k+ free SVGs, many CC0
- **Kenney.nl** — CC0 game assets, no attribution needed at all
- **OpenGameArt** — mixed licences, check each
- **Freesound** and **Pixabay Audio** — for sound, if you skip ElevenLabs
- **The Noun Project** — clean icons, free tier requires attribution

### Route E — Rough.js in code

Already covered. Anything geometric goes here.

---

### 4.1 Format rules — apply to every image

- **PNG with a real alpha channel.** No white boxes behind sprites.
- **Pure black (`#000000`) line art only.** The app tints at runtime with `<Image tintColor={color.ink} />`. This is why you make 4 avatars instead of 40, and why every sprite matches the ink colour exactly with zero drift.
- Generate at **2× the listed size**, then downscale. Line art loses crispness when upscaled.
- **No text baked into any image.** All text is live Bitter so it stays sharp and can be changed.
- Key out white backgrounds:
  ```bash
  magick in.png -fuzz 12% -transparent white -trim +repage out.png
  ```
  Batch the whole folder:
  ```bash
  for f in *.png; do magick "$f" -fuzz 12% -transparent white -trim +repage "clean_$f"; done
  ```

### 4.2 The style prompt

Append this to **every** AI image prompt. Consistency across the set matters more than any single sprite being beautiful.

```
STYLE: single isolated object drawn as a technical ballpoint-pen doodle. Pure black ink on
a pure white background. Fine parallel cross-hatched shading. Slightly wobbly, imperfect
hand-drawn linework, as if sketched quickly in the margin of a school exercise book.
Confident single-weight outline with hatching for volume. Orthographic view, flat lighting,
no cast shadow, no perspective. No colour whatsoever. No background elements, no grid, no
paper texture, no text, no labels, no signature. Object centred with even margins.
Sticker-style cutout.
```

If the model keeps adding a notebook background, add a negative prompt: `paper, notebook, grid, graph, texture, background, colour, shadow`.

### 4.3 Ships — draw these in Excalidraw if you can

All four face **left**, horizontal. The app rotates 90° for vertical placement. Aspect is `length : 1`.

| File | Size | What to draw / prompt |
|---|---|---|
| `ship-battleship.png` | 512×128 | A 4-turret battleship seen directly from above, pointed bow on the left, deck guns, bridge tower, radar mast, long narrow hull |
| `ship-cruiser.png` | 384×128 | A cruiser from above, pointed bow left, two gun turrets, a central superstructure |
| `ship-destroyer.png` | 256×128 | A small destroyer from above, pointed bow left, one forward gun, compact deck |
| `ship-boat.png` | 128×128 | A single-cell patrol boat from above, wide arrowhead bow, one small deck fixture |

Match your reference: chunky, slightly cartoonish top-down silhouettes with dense internal hatching. Not accurate naval line drawings.

### 4.4 AI prompts for the organic assets

**`captain.png`** — 768×1024. Generate this one at full quality; he's on screen for two minutes straight during the tutorial.
> *Three-quarter length portrait of an elderly ship's captain with a full white beard, a peaked naval cap with a badge, and a double-breasted greatcoat with shoulder boards. One hand tucked into his coat. Warm, friendly expression.* + style block

**`avatar-1..4.png`** — 512×512 each. **Four files, not forty** — they're tinted at runtime.
1. *Head-and-shoulders portrait of a young woman in a naval uniform with a striped undershirt collar, short hair, confident neutral expression, facing forward*
2. *Head-and-shoulders portrait of a young male sailor in a naval cap with a star badge and a striped undershirt, facing forward*
3. *Head-and-shoulders portrait of a young soldier in a helmet with an anchor emblem and a buttoned uniform shirt, facing forward*
4. *Head-and-shoulders portrait of an older officer with a moustache in a peaked service cap with rank insignia, facing forward*

The ten tint colours, wired into `src/ui/tokens.ts` as `AVATAR_TINTS`:
`violet #3E2FB8 · brown #8A5A2B · charcoal #3A3A3A · teal #2E7D6B · rust #B4532A · crimson #A62B36 · blue #2A5FA6 · magenta #93357A · green #3E7D3E · slate #4A5568`

**`plane-bomber.png`** — *A WWII bomber aircraft seen from directly above, flying left to right, wings level*
**`plane-torpedo.png`** — same airframe, slimmer, a torpedo slung underneath
**`plane-atomic.png`** — a heavier four-engine airframe
**`plane-downed.png`** — *A bomber from above, banking steeply, trailing a thick curling smoke plume, one wing damaged* — this is the AA intercept payoff, make it read clearly

**`explosion-sheet.png`** — six 256×256 frames, generated separately then stripped with `magick +append frame*.png explosion-sheet.png`
> *A hand-drawn ink explosion burst, frame N of 6, expanding from a small spark to a large starburst with radiating debris ticks and a smoke cloud*

**`splash-sheet.png`** — four 256×256 frames: an ink water splash expanding then dissipating

**`smoke-puff.png`** — *A small curling smoke puff cloud*

**Watermarks** — 600×600, sit behind the boards at 12% opacity
- `watermark-kraken.png` — *A giant octopus wrapped around a ship's anchor, tentacles curling outward, detailed cross-hatched engraving style*
- `watermark-tiger.png` — *A roaring tiger's head, front-facing, detailed cross-hatched engraving style*
- `watermark-anchor.png` — *A heavy ship's anchor with a coiled rope*

**`desk-wood.jpg`** — 1024×1024, the **only** non-line-art image in the project
> *Seamless tileable dark walnut wood grain texture, top-down, evenly lit*

If the model can't produce a seamless tile, grab a free one from Poly Haven or ambientCG. A flat `#6B4527` is an acceptable fallback — nobody will notice.

**`city-port.png`** — 2048×1024
> *An isometric bird's-eye map of a large port city in fine ballpoint-pen line art: bridges over a river, a stadium, a cathedral, an airport, shipping cranes at the docks, an industrial zone with cooling towers, a lighthouse on a headland, dense blocks of buildings and trees. Extremely detailed engraving style.*

Generate once and accept it. This is a static backdrop, not an interactive layer.

**`hand-pointer.png`** — *A cartoon hand with the index finger extended, pointing up and slightly left, outlined*

**`emote-01..08.png`** — 256×256 each. Generate as one batch for style consistency: thumbs-up, laughing face, angry face, crying face, salute, skull, question mark, fire. Or pull all eight from game-icons.net in five minutes.

**`logo.png`** — 1024×384. **This is your brand mark and I can't invent it.** If you want one generated:
> *The words "EMPIRE OF BITS" as a hand-drawn ballpoint-pen wordmark, slab-serif letterforms with cross-hatched fills, a small anchor and a pixel-block motif flanking the text* + style block

**`app-icon.png`** — 1024×1024. *A battleship viewed from above inside a square graph-paper frame, ballpoint-pen doodle* + style block. Then composite it onto `#FBFCFE` with the cyan grid — the icon is the one asset that **keeps** its paper background.

**`adaptive-icon-fg.png`** — same ship, transparent, inset to the 66% safe zone. Background colour is set to `#FBFCFE` in `app.json`.

---

## 5. Audio — ElevenLabs

ElevenLabs makes **audio**: sound effects, text-to-speech, and music. Use it for all three sections below. Free alternatives if you'd rather not: **Freesound.org** (CC, needs attribution), **Pixabay Audio** (no attribution), **Kenney audio packs** (CC0).

Export everything as **MP3, 128kbps, mono**.

### 5.1 `assets/audio/sfx/` — ElevenLabs Sound Effects

Paste each prompt straight into the Sound Effects box.

| Filename | Length | Prompt |
|---|---|---|
| `paper_drop.mp3` | 0.6s | a single sheet of paper landing flat on a wooden desk |
| `pen_scratch_long.mp3` | 1.2s | a ballpoint pen drawing one long confident line across paper |
| `pen_scratch_short.mp3` | 0.3s | a short quick pen stroke on paper |
| `ui_tap.mp3` | 0.15s | a soft pen tap on paper, dry, close-mic'd |
| `ship_place.mp3` | 0.4s | a wooden game piece set down firmly on a table |
| `ship_invalid.mp3` | 0.3s | a short dull buzz, like a wrong-answer buzzer heard through a wall |
| `shot_fire.mp3` | 0.5s | a distant naval cannon firing, muffled |
| `splash.mp3` | 0.7s | a heavy object hitting open water, single splash, no echo |
| `explosion.mp3` | 1.0s | a mid-sized explosion with debris, dry, no reverb tail |
| `ship_sink.mp3` | 2.0s | metal groaning and buckling as a ship breaks apart and sinks, with bubbling water |
| `mine.mp3` | 0.8s | a sharp underwater mine detonation, muffled thud with a metallic ring |
| `plane_flyby.mp3` | 2.5s | a WWII propeller bomber flying past overhead, left to right |
| `plane_down.mp3` | 2.5s | a propeller aircraft engine sputtering and failing, pitch falling as it spirals down |
| `bomb_drop.mp3` | 0.8s | a falling bomb whistle, descending pitch |
| `nuke.mp3` | 3.0s | an enormous distant explosion with a long low rumbling shockwave |
| `torpedo.mp3` | 1.0s | an underwater torpedo launch, compressed air and a bubbling trail |
| `radar_ping.mp3` | 0.8s | a single sonar ping with a short decaying tail |
| `sub_surface.mp3` | 1.2s | water draining off metal as a submarine surfaces |
| `turn_tick.mp3` | 0.1s | a single soft clock tick |
| `rank_up.mp3` | 1.5s | a short triumphant brass fanfare, three rising notes |
| `victory.mp3` | 2.5s | a naval victory fanfare with a ship's bell |
| `defeat.mp3` | 2.0s | a slow descending brass phrase, melancholy but not grim |

*(22 files — `coin_flow.mp3` folded into `victory.mp3`. Add it separately if you want the result-screen coin animation to have its own sound: "a stream of metal coins pouring into a wooden chest", 1.2s.)*

### 5.2 `assets/audio/voice/` — ElevenLabs Text to Speech

One voice for all 17 lines: an older British or Northern-European male, warm and gravelly, unhurried. A retired naval officer, not a drill sergeant. Stability ~0.5, similarity high so the lines match each other.

Files map 1:1 to the tutorial steps in prompt P09:

| File | Line |
|---|---|
| `captain-01.mp3` | Welcome aboard. Let's sink something. |
| `captain-02.mp3` | Your turn. Tap a square on the right to fire. |
| `captain-03.mp3` | A hit. That means you fire again. |
| `captain-04.mp3` | Sunk. The squares around a wreck are always empty, so we mark them for you. |
| `captain-05.mp3` | A miss ends your turn. |
| `captain-06.mp3` | They've missed. Back to you. |
| `captain-07.mp3` | You're not limited to one square at a time. |
| `captain-08.mp3` | A bomber hits three squares at once. |
| `captain-09.mp3` | Pick your row. |
| `captain-10.mp3` | Their anti-air covers that row. Aircraft can't cross it. |
| `captain-11.mp3` | Before every battle, you set your own fleet. |
| `captain-12.mp3` | Tap a ship to turn it. |
| `captain-13.mp3` | And you can buy defences. You can buy more mid-battle too. |
| `captain-14.mp3` | That's everything. Go win one. |
| `captain-idle-01.mp3` | Take your time. |
| `captain-idle-02.mp3` | They're waiting. |
| `captain-idle-03.mp3` | Good shooting. |

### 5.3 `assets/audio/music/` — ElevenLabs Music

Both must loop seamlessly. Trim in Audacity and crossfade the last 200ms if the export doesn't loop cleanly.

| File | Length | Prompt |
|---|---|---|
| `music_menu.mp3` | 60s loop | a light nostalgic waltz for accordion, upright bass and brushed snare, mid-century seaside bandstand feel, unhurried, warm, no vocals |
| `music_battle.mp3` | 90s loop | a restrained military march for snare drum, low brass and pizzicato strings, tense but playful, building slightly, no vocals, no big climax |

Keep both quiet. Default music volume in the app is **0.35**. This is a thinking game — loud music makes people mute the app, which loses your sound effects too.

---

## 6. Generation order

Claude Code builds against placeholders, so hand assets over as they land. Nothing should block on art.

**Batch 1 — needed for P02, P04, P05. Do this first (~40 min).**
`logo.png` · the 4 ships · `captain.png` · the 4 avatars · `desk-wood.jpg`

**Batch 2 — needed for P06, P07, P08 (~40 min).**
The 8 arsenal icons · `explosion-sheet.png` · `splash-sheet.png` · `plane-bomber.png` · `plane-downed.png` · the 3 watermarks

**Batch 3 — needed for P16 (~50 min).**
All 22 SFX · the 17 Captain lines · the 2 music loops

**Batch 4 — polish, cut if short on time.**
8 emotes · `city-port.png` · `plane-torpedo.png` · `plane-atomic.png` · `smoke-puff.png` · `hand-pointer.png` · both icons

Until an asset exists, `AssetSlot` (built in P01) renders a labelled Rough.js placeholder at the exact declared dimensions, so layout is correct from day one:

```tsx
<AssetSlot source={SHIPS.battleship} w={112} h={28} label="battleship" />
```

---

## 7. Attribution

Check each source's licence and put the required credits on the settings screen (P10 builds it).

| Source | Licence | Attribution required? |
|---|---|---|
| game-icons.net | CC BY 3.0 | **Yes** — name the artist and the site |
| Kenney.nl | CC0 | No |
| Freesound | varies per sound | Usually yes, check each |
| Pixabay | Pixabay licence | No |
| Excalidraw exports (your own drawings) | yours | No |
| AI-generated images | yours, check your tool's terms | No |
| Bitter font | SIL Open Font License | No, but include the OFL text |
| Rough.js | MIT | Include the licence in your dependency notice |

Two minutes of work. Skipping it on a public showcase build is a genuinely bad look.