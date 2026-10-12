"""Tile rendered stills (fNNNN.jpg) into labelled contact sheets.
python3 tools/sheet.py <dir> <out-prefix> [cols=5] [per_sheet=30] [thumb_w=760]"""
import glob, json, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d, prefix = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 5
per = int(sys.argv[4]) if len(sys.argv) > 4 else 30
tw = int(sys.argv[5]) if len(sys.argv) > 5 else 760
T = json.load(open(os.path.join(ROOT, 'build/timeline.json')))
fps, bpm = T['fps'], T['bpm']
scenes = sorted(T['scenes'].items(), key=lambda kv: kv[1]['start'])


def scene_of(frame):
    beat = frame / (fps * 60 / bpm)
    name = scenes[0][0]
    for n, s in scenes:
        if beat >= s['start']:
            name = n
    return name, beat


files = sorted(glob.glob(os.path.join(d, 'f*.jpg')))
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 20)
except Exception:
    font = ImageFont.load_default()
for si in range(0, len(files), per):
    chunk = files[si:si + per]
    ims = [Image.open(p) for p in chunk]
    th = int(tw * ims[0].height / ims[0].width)
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (tw + 8) + 8, rows * (th + 36) + 8), (32, 32, 36))
    dr = ImageDraw.Draw(sheet)
    for i, (p, im) in enumerate(zip(chunk, ims)):
        x = 8 + (i % cols) * (tw + 8)
        y = 8 + (i // cols) * (th + 36)
        sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + 28))
        fr = int(os.path.basename(p)[1:5])
        name, beat = scene_of(fr)
        dr.text((x + 4, y + 4), f'{fr // fps // 60}:{fr / fps % 60:05.2f}  f{fr}  b{beat:.2f}  {name}', fill=(255, 220, 0), font=font)
    out = f'{prefix}_{si // per + 1:02d}.jpg'
    sheet.save(out, quality=86)
    print(out)
