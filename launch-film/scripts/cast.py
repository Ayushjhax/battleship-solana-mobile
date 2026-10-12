"""Cast pipeline: reads src/trailer45/cast.ts, then crops, evens out and grades every photo so the
cast looks like one film, and writes public/cast/. Source photos are only read.

  public/cast/photo/<id>.jpg   graded, long side 1800 px (bento, tiles)
  public/cast/hero/<role>.jpg  16:9 hero crops, 2112 x 1188 (room for the 1.05 push)
  public/cast/face/<id>.jpg    square facecams, 720 px (photos)
  public/cast/face/<id>.mp4    square facecams from GIFs: CFR 30 fps H.264 yuv420p, one loop
  review/cast_sheet.jpg        everything above on one sheet
"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageOps
import pillow_heif

pillow_heif.register_heif_opener()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '..', 'demo-assets', 'users')
OUT = os.path.join(ROOT, 'public', 'cast')
os.chdir(ROOT)

cast = json.loads(subprocess.check_output(['node', '--experimental-strip-types', '--no-warnings', '-e',
    "import('./src/trailer45/cast.ts').then(m=>console.log(JSON.stringify(m)))"]))
faces = json.load(open('build/cast/faces.json')) if os.path.exists('build/cast/faces.json') else {}
photos = {p['id']: p for p in cast['PHOTOS']}


def srgb_to_lin(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)


INK_SHADOW = np.array([0x1A, 0x12, 0x40]) / 255.0   # deep ballpoint ink
PAPER_HIGH = np.array([0xFB, 0xF4, 0xEA]) / 255.0   # warm paper


def grade(im: Image.Image, mood=None) -> Image.Image:
    a = np.asarray(im.convert('RGB')).astype(np.float32) / 255.0
    lin = srgb_to_lin(a)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722])
    # 1. white balance: grey-world on the mid-tones, 60 % of the way to neutral
    mid = (lum > 0.02) & (lum < 0.6)
    if mid.sum() > 1000:
        m = lin[mid].mean(axis=0)
        gains = (m.mean() / np.maximum(m, 1e-4)) ** 0.6
        lin = lin * gains
    # 2. exposure: pull the median luminance towards a shared target (night photos keep their dark)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722])
    med = np.median(lum)
    target = 0.075 if mood == 'night' else 0.16
    g = float(np.clip(target / max(med, 1e-4), 0.7, 2.4))
    lin = lin * g / (1 + lin * (g - 1) * 0.35)          # soft shoulder protects highlights
    s = lin_to_srgb(lin)
    # 3. the shared grade: gentle S-curve, a touch less colour, ink in the shadows, paper in the highlights
    s = np.clip(s, 0, 1)
    s = s + 0.10 * (s - 0.5) * (1 - np.abs(2 * s - 1))   # soft contrast
    l = s @ np.array([0.299, 0.587, 0.114])
    s = l[..., None] + (s - l[..., None]) * 0.86
    sh = np.clip(1 - l / 0.45, 0, 1)[..., None] ** 1.5
    hi = np.clip((l - 0.6) / 0.4, 0, 1)[..., None] ** 1.5
    s = s * (1 - 0.18 * sh) + INK_SHADOW * 0.18 * sh
    s = s * (1 - 0.07 * hi) + PAPER_HIGH * 0.07 * hi
    s = 0.012 + s * (1 - 0.012)                           # deep, not crushed, blacks
    return Image.fromarray((np.clip(s, 0, 1) * 255 + 0.5).astype(np.uint8))


def load(pid):
    im = Image.open(os.path.join(SRC, photos[pid]['file']))
    return ImageOps.exif_transpose(im).convert('RGB')


def check_faces(pid, box):
    """A crop may contain a face or miss it; it may never cut through one."""
    f = faces.get(photos[pid]['file'])
    if not f:
        return
    W, H = f['w'], f['h']
    x0, y0, x1, y1 = box[0] * W, box[1] * H, (box[0] + box[2]) * W, (box[1] + box[3]) * H
    for b in f['faces']:
        if b['by'] != 'yunet' or b['score'] < 0.75:
            continue
        # faces already cut by the photo's own edge are clamped to it
        fx0, fy0 = max(b['x'], 0), max(b['y'], 0)
        fx1, fy1 = min(b['x'] + b['w'], W), min(b['y'] + b['h'], H)
        ix = max(0, min(x1, fx1) - max(x0, fx0)); iy = max(0, min(y1, fy1) - max(y0, fy0))
        inter = ix * iy / max((fx1 - fx0) * (fy1 - fy0), 1)
        if 0.02 < inter < 0.97:
            sys.exit(f'crop {box} of {pid} cuts through a face ({inter:.0%} inside): fix cast.ts')


def crop(im, box):
    W, H = im.size
    return im.crop((round(box[0] * W), round(box[1] * H), round((box[0] + box[2]) * W), round((box[1] + box[3]) * H)))


for d in ['photo', 'hero', 'face']:
    os.makedirs(os.path.join(OUT, d), exist_ok=True)
os.makedirs('review', exist_ok=True)

graded = {}
os.makedirs('build/cast/graded', exist_ok=True)
for pid, p in photos.items():
    cache = f'build/cast/graded/{pid}.jpg'
    src = os.path.join(SRC, p['file'])
    if os.path.exists(cache) and os.path.getmtime(cache) > max(os.path.getmtime(src), os.path.getmtime(__file__)):
        g = Image.open(cache).convert('RGB'); im = g
    else:
        im = load(pid)
        g = grade(im, p.get('mood'))
        g.save(cache, quality=96)
    graded[pid] = g
    t = g.copy(); t.thumbnail((1800, 1800), Image.LANCZOS)
    t.save(os.path.join(OUT, 'photo', pid + '.jpg'), quality=92)
    print('photo', pid, im.size)

sheet = []
for h in cast['HEROES']:
    check_faces(h['photo'], h['box'])
    c = crop(graded[h['photo']], h['box']).resize((2112, 1188), Image.LANCZOS)
    c.save(os.path.join(OUT, 'hero', h['role'] + '.jpg'), quality=93)
    sheet.append(os.path.join(OUT, 'hero', h['role'] + '.jpg'))
    print('hero', h['role'])

for fc in cast['FACECAMS']:
    if fc.get('photo'):
        check_faces(fc['photo'], fc['box'])
        c = crop(graded[fc['photo']], fc['box']).resize((720, 720), Image.LANCZOS)
        c.save(os.path.join(OUT, 'face', fc['id'] + '.jpg'), quality=93)
        sheet.append(os.path.join(OUT, 'face', fc['id'] + '.jpg'))
    else:
        x, y, w, h = fc['gifCrop']
        # native size (never shown above 1.5x), CFR 30 fps, even dims, same grade via ffmpeg curves
        dst = os.path.join(OUT, 'face', fc['id'] + '.mp4')
        subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(SRC, fc['gif']),
            '-vf', f'crop={w}:{h}:{x}:{y},scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,fps=30,'
                   'eq=contrast=1.06:saturation=0.86:gamma=1.04,colorbalance=rs=-0.03:bs=0.05',
            '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-g', '30', '-an', '-movflags', '+faststart', dst])
        subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-i', dst, '-frames:v', '1', dst.replace('.mp4', '.poster.jpg')])
        sheet.append(dst.replace('.mp4', '.poster.jpg'))
    print('facecam', fc['id'])

subprocess.check_call(['montage', '-background', '#111', '-fill', '#ddd', '-geometry', '640x360+6+6', '-tile', '4x',
                       '-label', '%t'] + sheet + ['review/cast_sheet.jpg'])
print('ok')
