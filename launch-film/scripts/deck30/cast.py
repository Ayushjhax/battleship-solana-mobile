"""Deck30 cast crops: reads src/deck30/cast.ts and crops the trailer's GRADED stills (build/cast/graded, made by
`npm run cast`), so Deck30 shares the trailer's grade exactly. Refuses any crop that cuts through a detected face
(build/cast/faces.json) and any person who appears more than twice outside the mosaic. Writes

  public/deck30/cast/strobe/<id>.jpg   16:9, long side <= 2016 px (room for the 1.05 push)
  public/deck30/cast/face/<id>.jpg     square, 720 px
  public/deck30/cast/split.jpg         8:9, 1014 x 1148
  deck30/review/cast_sheet.jpg         everything on one sheet
"""
import json, os, subprocess, sys
from collections import Counter
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
cast = json.loads(subprocess.check_output(['node', '--experimental-strip-types', '--no-warnings', '-e',
    "import('./src/deck30/cast.ts').then(m=>console.log(JSON.stringify(m)))"]))
trailer = json.loads(subprocess.check_output(['node', '--experimental-strip-types', '--no-warnings', '-e',
    "import('./src/trailer45/cast.ts').then(m=>console.log(JSON.stringify(m)))"]))
files = {p['id']: p['file'] for p in trailer['PHOTOS']}
faces = json.load(open('build/cast/faces.json'))
OUT = 'public/deck30/cast'
for d in ['strobe', 'face']:
    os.makedirs(f'{OUT}/{d}', exist_ok=True)
os.makedirs('deck30/review', exist_ok=True)


def graded(pid):
    p = f'build/cast/graded/{pid}.jpg'
    if not os.path.exists(p):
        sys.exit(f'{p} missing: run `npm run cast` (the trailer\'s grade) first')
    return Image.open(p).convert('RGB')


def check(c):
    f = faces.get(files[c['photo']])
    if not f:
        return
    W, H = f['w'], f['h']
    x, y, w, h = c['box']
    x0, y0, x1, y1 = x * W, y * H, (x + w) * W, (y + h) * H
    for b in f['faces']:
        if b['by'] != 'yunet' or b['score'] < 0.6:
            continue
        fx0, fy0 = max(b['x'], 0), max(b['y'], 0)
        fx1, fy1 = min(b['x'] + b['w'], W), min(b['y'] + b['h'], H)
        ix = max(0, min(x1, fx1) - max(x0, fx0)); iy = max(0, min(y1, fy1) - max(y0, fy0))
        inter = ix * iy / max((fx1 - fx0) * (fy1 - fy0), 1)
        if 0.02 < inter < 0.97:
            sys.exit(f"crop {c['id']} {c['box']} cuts through a face in {c['photo']} ({inter:.0%} inside): fix src/deck30/cast.ts")


def crop(c, size):
    im = graded(c['photo'])
    W, H = im.size
    x, y, w, h = c['box']
    r = im.crop((round(x * W), round(y * H), round((x + w) * W), round((y + h) * H)))
    native = r.size
    tw, th = size
    if r.size[0] > tw:
        r = r.resize((tw, th), Image.LANCZOS)
    return r, native


sheet = []
for c in cast['STROBE']:
    check(c)
    r, native = crop(c, (2016, 1134))
    r.save(f"{OUT}/strobe/{c['id']}.jpg", quality=93)
    print('strobe', c['id'], 'native', native, f'→ shown at {1920 * 1.05 / native[0]:.2f}x')
    sheet.append(f"{OUT}/strobe/{c['id']}.jpg")
for c in cast['FACECAMS']:
    check(c)
    r, native = crop(c, (720, 720))
    r = r.resize((720, 720), Image.LANCZOS)
    r.save(f"{OUT}/face/{c['id']}.jpg", quality=93)
    print('facecam', c['id'], 'native', native)
    sheet.append(f"{OUT}/face/{c['id']}.jpg")
c = cast['SPLIT']
check(c)
r, native = crop(c, (1014, 1148))
r.save(f'{OUT}/split.jpg', quality=93)
print('split', native)
sheet.append(f'{OUT}/split.jpg')

# the spread rule: nobody more than twice outside the mosaic
seen = Counter(p for c in cast['STROBE'] + cast['FACECAMS'] + [cast['SPLIT']] for p in c['people'])
over = {k: v for k, v in seen.items() if v > 2}
print('appearances outside the mosaic:', dict(seen))
if over:
    sys.exit(f'these people appear more than twice: {over}')
subprocess.check_call(['montage', '-background', '#111', '-fill', '#ddd', '-geometry', '480x270+6+6', '-tile', '4x',
                       '-label', '%t'] + sheet + ['deck30/review/cast_sheet.jpg'])
print('ok → deck30/review/cast_sheet.jpg')
