"""Deck30 — One becomes all: the mosaic's tiles, atlases and plan. Deterministic (fixed seeds).

  python3 scripts/deck30/mosaic.py   →  public/deck30/mosaic/{atlas_color.jpg, atlas_duo.png, hero_*.jpg}
                                        src/deck30/mosaic.data.json

The bit divides on the 8ths: 1 → 4 (a row) → 16 (8x2) → 64 (16x4) → 256 (32x8). The final 32 x 8 grid IS the logo's
pixel grid: its cell is the logo's own bit (733 px / 32 = 22.9 source px), so the logo's pixel "bits" fall exactly on
cells and the top-right bit is cell (31, 2) — the one that stays empty and glowing. Cells the logo covers (>= 33 %)
keep their tiles (they duotone and lock); the rest fall away.

Tiles: every player (face-aware crops of the trailer's graded stills, several per photo), the live GIF, and real
battle frames. "Never the same image next to itself": no two neighbouring tiles (8-neighbourhood) at any stage share
an image or even a source photo / clip, and the GIF tiles are never neighbours.
"""
import json, os, subprocess, io
import numpy as np
from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
OUT = 'public/deck30/mosaic'
os.makedirs(OUT, exist_ok=True)
cast = json.loads(subprocess.check_output(['node', '--experimental-strip-types', '--no-warnings', '-e',
    "import('./src/deck30/cast.ts').then(m=>console.log(JSON.stringify(m)))"]))
trailer = json.loads(subprocess.check_output(['node', '--experimental-strip-types', '--no-warnings', '-e',
    "import('./src/trailer45/cast.ts').then(m=>console.log(JSON.stringify(m)))"]))
files = {p['id']: p['file'] for p in trailer['PHOTOS']}
focus = {p['id']: p['focus'] for p in trailer['PHOTOS']}
faces = json.load(open('build/cast/faces.json'))
rng = np.random.default_rng(20261001)
T, TD, TH = 256, 96, 640   # colour tile, duotone tile, hero tile (the 1- and 4-stage tiles are 410 px on screen)

# ---- the logo grid --------------------------------------------------------------------------------------------
mask = np.array(Image.open('../assets/ink/brand/logo.png').convert('LA'))[:, :, 1].astype(np.float32) / 255
LH, LW = mask.shape
COLS, ROWS = 32, 8
CELL = LW / COLS
OY = -10.3          # row 2 spans the bit (source y 34–60)
BIT = [31, 2]
cov = np.zeros((ROWS, COLS))
for r in range(ROWS):
    for c in range(COLS):
        y0, y1 = OY + r * CELL, OY + (r + 1) * CELL
        a = mask[max(0, int(round(y0))):max(0, int(round(y1))), int(round(c * CELL)):int(round((c + 1) * CELL))]
        cov[r, c] = a.mean() if a.size else 0.0
inside = (cov >= 0.33)
inside[BIT[1], BIT[0]] = False
print('logo grid', COLS, 'x', ROWS, 'cell', round(CELL, 3), '→', int(inside.sum()), 'tiles lock into the logo')

# ---- tiles ----------------------------------------------------------------------------------------------------
tiles, meta = [], []   # meta: {kind, src}


def add(img, kind, src):
    tiles.append(img.convert('RGB').resize((T, T), Image.LANCZOS))
    meta.append({'kind': kind, 'src': src})
    return len(tiles) - 1


def square(im, cx, cy, side):
    W, H = im.size
    side = int(min(side, W, H))
    x0 = int(np.clip(cx - side / 2, 0, W - side)); y0 = int(np.clip(cy - side / 2, 0, H - side))
    return im.crop((x0, y0, x0 + side, y0 + side))


players = []
hero_src = []   # high-res squares for the first stages
for pid in cast['MOSAIC_PHOTOS']:
    im = Image.open(f'build/cast/graded/{pid}.jpg').convert('RGB')
    W, H = im.size
    short = min(W, H)
    f = faces.get(files[pid], {'w': W, 'h': H, 'faces': []})
    sx, sy = W / f['w'], H / f['h']
    crops = []
    for b in f['faces']:
        if b['by'] == 'yunet' and b['score'] >= 0.6:
            cx, cy = (b['x'] + b['w'] / 2) * sx, (b['y'] + b['h'] / 2) * sy
            crops.append((cx, cy, max(b['w'], b['h']) * sx * 1.8, 'face'))
    fx, fy = focus[pid]
    crops.append((fx * W, fy * H, short * 0.55, 'focus'))
    crops.append((W / 2, H / 2, short * 0.95, 'wide'))
    for _ in range(5):
        crops.append((rng.uniform(0.3, 0.7) * W, rng.uniform(0.3, 0.7) * H, short * rng.uniform(0.35, 0.55), 'detail'))
    for cx, cy, side, kind in crops:
        if side < 200:   # too small a source to be a tile
            continue
        sq = square(im, cx, cy, side)
        i = add(sq, 'photo', pid)
        players.append(i)
        if kind in ('face', 'focus') and sq.size[0] >= 600 and pid not in ('desk',):
            hero_src.append((i, sq))
print('player tiles', len(players), '· hero-quality', len(hero_src))

# the live GIF, graded like the trailer's GIF facecams (a touch more contrast, less colour, ink in the shadows)
from PIL import ImageEnhance
gif = cast['MOSAIC_GIFS'][0]
gx, gy, gw, gh = gif['crop']
g = Image.open(os.path.join('../demo-assets/users', gif['file']))
gif_frames = []
for k in range(g.n_frames):
    g.seek(k)
    fr = g.convert('RGB').crop((gx, gy, gx + gw, gy + gh))
    fr = ImageEnhance.Color(ImageEnhance.Contrast(fr).enhance(1.06)).enhance(0.86)
    gif_frames.append(add(fr, 'gif', 'admiral-live'))
print('gif frames', len(gif_frames))

# real battle frames (raw recordings, cropped well under native size)
battle = []
SRC = {'atomic': 'arsenal-attack.mp4', 'raid': 'base-attack.mp4', 'defense': 'defense.mp4', 'victory': 'base-attack.mp4'}
for plate, t, cx, cy, side in cast['MOSAIC_BATTLE']:
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(t), '-i', f'../demo-assets/{SRC[plate]}', '-frames:v', '1',
                          '-vf', 'scale=1280:576', '-f', 'image2pipe', '-vcodec', 'png', '-'], capture_output=True, check=True).stdout
    fr = Image.open(io.BytesIO(raw)).convert('RGB')
    battle.append(add(square(fr, cx, cy, side), 'battle', f'{plate}@{t}'))
print('battle tiles', len(battle))

# ---- the plan: the quadtree on the 8ths -----------------------------------------------------------------------
STAGES = [(1, 1), (4, 1), (8, 2), (16, 4), (32, 8)]
src_of = lambda i: meta[i]['src']
hero_ids = [i for i, _ in hero_src]
plan = []           # per stage: rows x cols of tile ids
live = []           # (stage, col, row) cells that play the GIF
for s, (cols, rows) in enumerate(STAGES):
    grid = [[-1] * cols for _ in range(rows)]
    order = [(c, r) for r in range(rows) for c in range(cols)]
    rng.shuffle(order)
    # the top-left child keeps its parent's image (the cell visibly divides); the others are new
    used = {}
    for c, r in sorted(order, key=lambda cr: (cr[0] % 2 + cr[1] % 2) if s >= 2 else (0 if cr[0] == 0 else 1)):
        if s >= 1:
            pc, pr = (c // 2, r // 2) if s >= 2 else (0, 0)
            inherit = (c % 2 == 0 and r % 2 == 0) if s >= 2 else (c == 0)
            if inherit:
                grid[r][c] = plan[s - 1][pr][pc]
                continue
        pool = hero_ids if s <= 1 else (players if s == 2 else players + battle)
        nb = [grid[rr][cc] for rr in range(r - 1, r + 2) for cc in range(c - 1, c + 2)
              if 0 <= rr < rows and 0 <= cc < cols and (rr, cc) != (r, c) and grid[rr][cc] >= 0]
        cand = [i for i in pool if i not in nb and src_of(i) not in {src_of(j) for j in nb}]
        # prefer the least used images
        cand.sort(key=lambda i: (used.get(i, 0) + sum(1 for row in grid for v in row if v == i), rng.uniform()))
        pick = cand[0] if cand else rng.choice(pool)
        grid[r][c] = int(pick)
        used[pick] = used.get(pick, 0) + 1
    plan.append(grid)

# live GIF tiles at the last stage: spread out, never neighbours, never in the bit cell
cols, rows = STAGES[-1]
cells = [(c, r) for r in range(rows) for c in range(cols) if [c, r] != BIT]
rng.shuffle(cells)
for c, r in cells:
    if len(live) >= cast['MOSAIC_LIVE_TILES']:
        break
    if all(abs(c - lc) > 2 or abs(r - lr) > 1 for lc, lr in live):
        live.append((c, r))
        plan[-1][r][c] = gif_frames[0]
print('live GIF tiles at', live)

# verify: no identical neighbours (8-neighbourhood) at any stage
for s, grid in enumerate(plan):
    rows, cols = len(grid), len(grid[0])
    for r in range(rows):
        for c in range(cols):
            for rr in range(r - 1, r + 2):
                for cc in range(c - 1, c + 2):
                    if (rr, cc) != (r, c) and 0 <= rr < rows and 0 <= cc < cols:
                        assert grid[rr][cc] != grid[r][c], f'stage {s}: same image next to itself at {c},{r}'

# ---- atlases --------------------------------------------------------------------------------------------------
AC = 16
AR = int(np.ceil(len(tiles) / AC))
atlas = Image.new('RGB', (AC * T, AR * T), (5, 4, 11))
duo = Image.new('RGB', (AC * TD, AR * TD), (5, 4, 11))
INK = np.array([0x1E, 0x14, 0x5C], np.float32)       # deep ballpoint ink (shadows)
LIT = np.array([0xF5, 0xF5, 0xF7], np.float32)       # off-white (highlights) — the logo's own colour
for i, t in enumerate(tiles):
    atlas.paste(t, ((i % AC) * T, (i // AC) * T))
    g = np.asarray(ImageOps.autocontrast(t.convert('L').resize((TD, TD), Image.LANCZOS), cutoff=2)).astype(np.float32) / 255
    g = g ** 0.85
    d = INK[None, None, :] * (1 - g[..., None]) + LIT[None, None, :] * g[..., None]
    duo.paste(Image.fromarray(d.astype(np.uint8)), ((i % AC) * TD, (i // AC) * TD))
atlas.save(f'{OUT}/atlas_color.jpg', quality=90)
duo.save(f'{OUT}/atlas_duo.png')
# hero tiles at 640 px for the 1- and 4-stage
heroes = sorted({plan[0][0][0], *plan[1][0]})
for i in heroes:
    dict(hero_src)[i].resize((TH, TH), Image.LANCZOS).save(f'{OUT}/hero_{i}.jpg', quality=92)

data = {
    'grid': {'cols': COLS, 'rows': ROWS, 'cell': round(CELL, 4), 'oy': OY, 'logoW': LW, 'logoH': LH, 'bit': BIT},
    'inside': [[c, r] for r in range(ROWS) for c in range(COLS) if inside[r, c]],
    'stages': STAGES, 'plan': plan, 'live': live, 'gif': gif_frames, 'heroes': heroes,
    'atlas': {'cols': AC, 'rows': AR, 'color': T, 'duo': TD},
    'kinds': [m['kind'] for m in meta],
}
json.dump(data, open('src/deck30/mosaic.data.json', 'w'))
print(f'atlas {AC}x{AR} tiles ({len(tiles)}), heroes {heroes} → {OUT}, src/deck30/mosaic.data.json')
