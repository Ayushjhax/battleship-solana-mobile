"""Deck30 media: transcode only the segments the film uses (plus handles) into public/deck30/media/.

  python3 scripts/deck30/prepare_media.py          (after scripts/deck30/upscale.sh for the gameplay plates)

Constant 30 fps, H.264 yuv420p CRF 16, a keyframe every second, audio stripped, Lanczos scaling. Times are
SOURCE seconds and must match MEDIA[...].start in src/deck30/timeline.ts (the edit's in-points are source
seconds; the components subtract `start`). Sources in demo-assets/ are only ever read.

  gameplay  Real-ESRGAN plates (build/deck30/esr/<name>/out, scripts/deck30/upscale.sh) → 2560x1152; the
            poster's 4x plate → 3840x1728 (H.264 level 5.1)
  UI        the 2670x1200 phone captures → 1920 wide
  privacy   the wallet's address line and the leaderboard's names / flags / wins / points are blurred HERE,
            baked into the prepared files, so no push-in can ever reveal them
"""
import os, subprocess, sys
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
DA = '../demo-assets'
OUT = 'public/deck30/media'
os.makedirs(OUT, exist_ok=True)
X264 = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-g', '30', '-keyint_min', '30',
        '-sc_threshold', '0', '-an', '-movflags', '+faststart']


def probe(p):
    return subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                                    'stream=width,height,r_frame_rate,nb_frames', '-of', 'csv=p=0', p]).decode().strip()


# ---- gameplay plates (name, width) — ranges live in scripts/deck30/upscale.sh
PLATES = [('poster', 3840), ('atomic', 2560), ('raid', 2560), ('defense', 2560)]
LANCZOS_RANGES = {'poster': ('arsenal-attack.mp4', 1.30, 2.434), 'atomic': ('arsenal-attack.mp4', 0.80, 3.334),
                  'raid': ('base-attack.mp4', 1.25, 3.10), 'defense': ('defense.mp4', 0.20, 2.00)}
only = [a for a in sys.argv[1:] if not a.startswith('--')]
for name, width in PLATES:
    if only and name not in only:
        continue
    src = f'build/deck30/esr/{name}'
    n_in = len(os.listdir(f'{src}/in')) if os.path.isdir(f'{src}/in') else 0
    n_out = len(os.listdir(f'{src}/out')) if os.path.isdir(f'{src}/out') else 0
    dst = f'{OUT}/{name}.mp4'
    if n_in == 0 or n_out < n_in:
        if '--lanczos' not in sys.argv:
            print(f'{name}: upscale not finished ({n_out}/{n_in}) — skipped; run scripts/deck30/upscale.sh (or --lanczos for a stand-in)')
            continue
        # stand-in until the Real-ESRGAN plate is ready: the same range, Lanczos-scaled (drafts only)
        src_file, ss, to = LANCZOS_RANGES[name]
        subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-ss', str(ss), '-to', str(to), '-i', f'{DA}/{src_file}',
                               '-vf', f'fps=30,scale={width}:-2:flags=lanczos,format=yuv420p', '-fps_mode', 'cfr', *X264, dst])
        print(name, 'LANCZOS STAND-IN', probe(dst))
        continue
    subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-framerate', '30', '-i', f'{src}/out/f%04d.png',
                           '-vf', f'scale={width}:-2:flags=lanczos,format=yuv420p', '-r', '30', *X264, dst])
    print(name, probe(dst))

# ---- UI captures: (name, source, start, end, extra filter before scaling)
WALLET_BLUR = '[0:v]split[a][b];[b]crop=700:100:330:620,boxblur=24:4[bl];[a][bl]overlay=330:620'
UI = [
    ('build', f'{DA}/material/buildyourbase.mp4', 1.0, 6.0, None),
    ('matchmaking', f'{DA}/material/matchmaking.mp4', 0.5, 3.25, None),
    ('buy', f'{DA}/material/buy_points.mp4', 3.5, 5.03, None),
    ('sell', f'{DA}/material/sell_points.mp4', 1.3, 3.04, None),
    ('store', f'{DA}/material/store.mp4', 0.3, 3.04, None),
    ('wallet', f'{DA}/material/wallet_profile.mp4', 1.3, 1.72, WALLET_BLUR),
]
for name, src, start, end, pre in UI:
    if only and name not in only:
        continue
    dst = f'{OUT}/{name}.mp4'
    if pre:
        fc = f'{pre},fps=30,scale=1920:-2:flags=lanczos,format=yuv420p[v]'
        args = ['-filter_complex', fc, '-map', '[v]']
    else:
        args = ['-vf', 'fps=30,scale=1920:-2:flags=lanczos,format=yuv420p']
    subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-to', str(end), '-i', src, *args,
                           '-fps_mode', 'cfr', *X264, dst])
    print(name, probe(dst))

# ---- the leaderboard table (real frames end at 0.97 s): one still, names / flags / wins / points blurred
if not only or 'leaderboard' in only:
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', '0.9', '-i', f'{DA}/material/leaderboard.mp4', '-frames:v', '1',
                          '-f', 'image2pipe', '-vcodec', 'png', '-'], capture_output=True, check=True).stdout
    import io
    im = Image.open(io.BytesIO(raw)).convert('RGB')
    box = (905, 415, 2000, 1015)  # flags, captain names, wins, points of every row (2670x1200 px)
    im.paste(im.crop(box).filter(ImageFilter.GaussianBlur(16)), box)
    im.save(f'{OUT}/leaderboard.png')
    print('leaderboard', im.size, 'blurred', box)

# ---- the victory screen without its text: the result screen's own backdrop art + its seagulls (assets/, read only)
if not only or 'art' in only:
    import shutil
    os.makedirs('public/deck30/art', exist_ok=True)
    shutil.copyfile('../assets/backgrounds/decision.jpg', 'public/deck30/art/victory-backdrop.jpg')
    for k in range(1, 4):
        shutil.copyfile(f'../assets/battle-complete-assets/results/winner/seagull-0{k}.png', f'public/deck30/art/seagull-0{k}.png')
    print('art: victory backdrop + seagulls')
