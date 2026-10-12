"""QA: a still every 0.25 s into contact sheets (with time, frame and beat burned in), plus a 640x360 phone copy.
  python3 scripts/review.py out/draft.mp4 review/qa-round1
"""
import os, subprocess, sys
src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
BEAT = 60 / 140
dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]))
per = 36  # stills per sheet = 9 s
n = int(dur * 4 + 0.5)
for k, s0 in enumerate(range(0, n, per)):
    t0 = s0 / 4
    label = "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf:text='%{pts\\:hms} f%{eif\\:(t+" + str(t0) + ")*30\\:d} b%{eif\\:(t+" + str(t0) + ")/" + f"{BEAT:.6f}" + "\\:d}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6"
    vf = f"fps=4,scale=426:-2,{label},tile=6x6:padding=3:color=0x222222"
    subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-ss', str(t0), '-t', str(per / 4), '-i', src, '-vf', vf, '-frames:v', '1', f'{dst}/sheet_{k:02d}.jpg'])
subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vf', 'scale=640:360:flags=lanczos', '-c:v', 'libx264', '-crf', '24', '-c:a', 'aac', '-b:a', '128k', f'{dst}/phone_640x360.mp4'])
# phone check: every card and the end card at 640x360
cards = [0.2, 0.9, 1.4, 1.9, 2.4, 3.6, 5.3, 6.6, 9.8, 13.3, 16.5, 19.3, 21.5, 26.6, 29.2, 32.5, 33.5, 34.3, 35.0, 44.9]
for i, t in enumerate(cards):
    subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-ss', str(t), '-i', f'{dst}/phone_640x360.mp4', '-frames:v', '1', f'{dst}/_p{i:02d}.png'])
subprocess.check_call(['montage'] + [f'{dst}/_p{i:02d}.png' for i in range(len(cards))] + ['-tile', '4x', '-geometry', '+3+3', '-background', '#222', f'{dst}/phone_check.png'])
for i in range(len(cards)):
    os.remove(f'{dst}/_p{i:02d}.png')
print('sheets →', dst)
