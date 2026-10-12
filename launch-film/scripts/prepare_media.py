"""Transcode only the source segments the trailer uses (plus handles) into public/media/.
Constant 30 fps, H.264 yuv420p CRF 16, a keyframe every second, audio stripped, Lanczos scaling.
Gameplay (1280x576) is upscaled 2x so the camera can push in; the 2670x1200 UI captures are
downscaled to 1920 wide. Times below are SOURCE seconds; the edit's in/out points are in timeline.ts
and are relative to the start of each prepared file (i.e. source time minus `start`)."""
import os, subprocess
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
DA = '../demo-assets'
os.makedirs('public/media', exist_ok=True)

MEDIA = [
    # name,            source,                          start, end,   width
    ('atomic',        f'{DA}/arsenal-attack.mp4',        0.0,  3.334, 2560),   # whole clip: Atomic Bomb strike
    ('defense',       f'{DA}/defense.mp4',               0.0,  2.734, 2560),   # whole clip: AA gun, "Shot down!"
    ('raid',          f'{DA}/base-attack.mp4',           0.0,  6.567, 2560),   # Bomber → hit → sunk → Victory
    ('build',         f'{DA}/material/buildyourbase.mp4', 1.0, 6.0,   1920),   # arsenal panel, AA gun placed
    ('matchmaking',   f'{DA}/material/matchmaking.mp4',  0.5,  4.013, 1920),   # radar sweep → VS
    ('buy',           f'{DA}/material/buy_points.mp4',   0.0,  5.0,   1920),
    ('sell',          f'{DA}/material/sell_points.mp4',  0.0,  3.0,   1920),
    ('store',         f'{DA}/material/store.mp4',        0.0,  3.0,   1920),
]

for name, src, start, end, width in MEDIA:
    dst = f'public/media/{name}.mp4'
    vf = f'fps=30,scale={width}:-2:flags=lanczos,format=yuv420p'
    subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-to', str(end), '-i', src,
                           '-vf', vf, '-fps_mode', 'cfr', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
                           '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-an', '-movflags', '+faststart', dst])
    out = subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                                   'stream=width,height,r_frame_rate,nb_frames', '-of', 'csv=p=0', dst]).decode().strip()
    print(name, out)
