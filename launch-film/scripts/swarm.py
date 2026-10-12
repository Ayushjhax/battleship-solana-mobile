"""Swarm assets: the logo's cell map and two tile atlases (colour for the wall, brand duotone for the logo).
Players first: every graded cast photo gives several crops (faces, phones, hands), the live GIF gives an
animated tile, then the game's own art fills the rest (captain avatars, Purple-edition fleet and arsenal,
Port City buildings). Writes public/swarm/atlas_color.jpg, public/swarm/atlas_duo.png and
src/trailer45/swarm.data.json. Deterministic (fixed seeds)."""
import json, os, glob, subprocess
import numpy as np
from PIL import Image, ImageOps

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.makedirs('public/swarm', exist_ok=True)
cast = json.loads(subprocess.check_output(['node', '--experimental-strip-types', '--no-warnings', '-e',
    "import('./src/trailer45/cast.ts').then(m=>console.log(JSON.stringify(m)))"]))
faces = json.load(open('build/cast/faces.json'))
rng = np.random.default_rng(20260930)
CT, DT = 160, 40   # colour / duotone tile size

# ---- logo cells ------------------------------------------------------------------------------
mask = np.array(Image.open('../assets/ink/brand/logo.png').convert('LA'))[:, :, 1].astype(np.float32) / 255
H, W = mask.shape
CELL = 7.5
cols, rows = int(np.ceil(W / CELL)), int(np.ceil(H / CELL))
BIT = (709, 34, 732, 60)   # the logo's top-right "bit" square (source px): stays empty and glowing
cells = []
for r in range(rows):
    for c in range(cols):
        x0, y0 = c * CELL, r * CELL
        cov = mask[int(y0):int(min(H, y0 + CELL)), int(x0):int(min(W, x0 + CELL))].mean()
        cx, cy = x0 + CELL / 2, y0 + CELL / 2
        in_bit = BIT[0] - 2 <= cx <= BIT[2] + 2 and BIT[1] - 2 <= cy <= BIT[3] + 2
        if cov >= 0.42 and not in_bit:
            cells.append([c, r])
print('logo grid', cols, 'x', rows, '→', len(cells), 'filled cells')

# ---- tiles ------------------------------------------------------------------------------------
color_tiles, meta = [], []
def add(img, kind, src):
    color_tiles.append(img.convert('RGB').resize((CT, CT), Image.LANCZOS))
    meta.append({'kind': kind, 'src': src})
    return len(color_tiles) - 1

def square_crop(im, cx, cy, side):
    W, H = im.size
    side = int(min(side, W, H))
    x0 = int(np.clip(cx - side / 2, 0, W - side)); y0 = int(np.clip(cy - side / 2, 0, H - side))
    return im.crop((x0, y0, x0 + side, y0 + side))

photo_idx, best_idx = [], []
for p in cast['PHOTOS']:
    im = Image.open(f'build/cast/graded/{p["id"]}.jpg').convert('RGB')
    W0, H0 = im.size
    short = min(W0, H0)
    f = faces.get(p['file'], {'w': W0, 'h': H0, 'faces': []})
    sx, sy = W0 / f['w'], H0 / f['h']
    crops = []
    for b in f['faces']:
        if b['by'] == 'yunet' and b['score'] >= 0.75:
            cx, cy = (b['x'] + b['w'] / 2) * sx, (b['y'] + b['h'] / 2) * sy
            crops.append((cx, cy, max(b['w'], b['h']) * sx * 1.7))
    fx, fy = p['focus']
    crops.append((fx * W0, fy * H0, short * 0.55))
    crops.append((W0 / 2, H0 / 2, short * 0.9))
    for _ in range(6):
        crops.append((rng.uniform(0.25, 0.75) * W0, rng.uniform(0.25, 0.75) * H0, short * rng.uniform(0.3, 0.5)))
    nbest = len(crops) - 6
    for k, (cx, cy, side) in enumerate(crops):
        i = add(square_crop(im, cx, cy, side), 'photo', p['id'])
        photo_idx.append(i)
        if k < nbest and p['id'] != 'desk':
            best_idx.append(i)
print('photo tiles', len(photo_idx))

# live GIF (the Admiral at his desk): subtitle-free square around his face, graded like the rest
gif_frames = []
gif = Image.open(os.path.join('../demo-assets/users', cast['SWARM_GIFS'][0]))
for i in range(gif.n_frames):
    gif.seek(i)
    fr = gif.convert('RGB').crop((70, 10, 240, 180))
    gif_frames.append(add(fr, 'gif', 'admiral-live'))
print('gif frames', len(gif_frames))

INK_BG = (21, 14, 58)
def on_ink(path, pad=0.12):
    a = Image.open(path).convert('RGBA')
    a.thumbnail((400, 400), Image.LANCZOS)
    side = int(max(a.size) * (1 + pad * 2))
    bg = Image.new('RGBA', (side, side), (*INK_BG, 255))
    bg.alpha_composite(a, ((side - a.size[0]) // 2, (side - a.size[1]) // 2))
    return bg
art_idx = []
for pth in sorted(glob.glob('../assets/avatars/avatar-*.webp')):
    art_idx.append(add(Image.open(pth), 'avatar', os.path.basename(pth)))
for pth in sorted(glob.glob('public/art/*/*.png')):
    art_idx.append(add(on_ink(pth), 'art', os.path.basename(pth)))
for pth in sorted(glob.glob('public/port/buildings/*.png')):
    art_idx.append(add(on_ink(pth, 0.06), 'port', os.path.basename(pth)))
print('art tiles', len(art_idx))

# ---- atlases ------------------------------------------------------------------------------------
n = len(color_tiles)
AC = int(np.ceil(np.sqrt(n)))
AR = int(np.ceil(n / AC))
color = Image.new('RGB', (AC * CT, AR * CT), (0, 0, 0))
duo = Image.new('RGB', (AC * DT, AR * DT), (0, 0, 0))
# brand duotone: luminance → ink violet … lilac-white (never dark enough to vanish on black)
stops = np.array([[0.0, 0x33, 0x25, 0xA0], [0.5, 0x6C, 0x5F, 0xD6], [1.0, 0xE4, 0xE0, 0xFF]], dtype=np.float32)
def duotone(img):
    a = np.asarray(img.resize((DT, DT), Image.LANCZOS)).astype(np.float32) / 255
    l = a @ np.array([0.299, 0.587, 0.114])
    l = np.clip((l - 0.08) / 0.84, 0, 1) ** 0.9
    out = np.zeros(a.shape, np.float32)
    for ch in range(3):
        out[..., ch] = np.interp(l, stops[:, 0], stops[:, ch + 1])
    return Image.fromarray(out.astype(np.uint8))
for i, t in enumerate(color_tiles):
    x, y = (i % AC), (i // AC)
    color.paste(t, (x * CT, y * CT))
    duo.paste(duotone(t), (x * DT, y * DT))
color.save('public/swarm/atlas_color.jpg', quality=90)
duo.save('public/swarm/atlas_duo.png')
data = {
    'logo': {'w': W, 'h': H, 'cell': CELL, 'cols': cols, 'rows': rows, 'bit': BIT},
    'cells': cells,
    'atlas': {'cols': AC, 'rows': AR, 'color': CT, 'duo': DT},
    'photos': photo_idx, 'best': best_idx, 'gif': gif_frames, 'art': art_idx,
    'kinds': [m['kind'] for m in meta],
}
json.dump(data, open('src/trailer45/swarm.data.json', 'w'))
print('atlas', AC, 'x', AR, '=', n, 'tiles')
