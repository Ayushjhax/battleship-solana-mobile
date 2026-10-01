"""Deck30 quality gate: everything one review round looks at.

  python3 scripts/deck30/review.py build/deck30/draft.mp4 build/deck30/qa1

Writes into the target folder:
  sheet_NN.jpg        a still every 0.25 s (time, frame and film beat burned in), 6x6 per sheet = 9 s
  projector_NN.jpg    the same with the blacks lifted to ~10 % (projector test)
  phone_640x360.mp4   + phone_check.png: every card and the end card at phone size
  sound.png           momentary loudness + spectrogram of the film's audio, with sections, cuts and cues overlaid
  sound.txt           silence / clipping / transient checks
"""
import json, math, os, subprocess, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
TL = json.loads(subprocess.check_output(['node', '--experimental-strip-types', '--no-warnings', '-e',
    "import('./src/deck30/timeline.ts').then(m=>{const o={};for(const[k,v]of Object.entries(m))if(typeof v!=='function')o[k]=v;console.log(JSON.stringify(o))})"], cwd=ROOT))
FPS, BEAT = TL['FPS'], TL['BEAT_SEC']
fr = lambda b: math.floor(b * BEAT * FPS + 0.5)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]))

# ---- contact sheets (+ projector sheets)
per = 36
n = int(dur * 4 + 0.5)
for k, s0 in enumerate(range(0, n, per)):
    t0 = s0 / 4
    label = (f"drawtext=fontfile={FONT}:text='%{{pts\\:hms}} f%{{eif\\:(t+{t0})*{FPS}\\:d}} b%{{eif\\:(t+{t0})/{BEAT:.6f}*100\\:d}}'"
             ":x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6")
    for name, grade in [('sheet', ''), ('projector', 'colorlevels=romin=0.1:gomin=0.1:bomin=0.1,')]:
        vf = f"fps=4,scale=426:-2,{grade}{label},tile=6x6:padding=3:color=0x222222"
        subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-ss', str(t0), '-t', str(per / 4), '-i', src, '-vf', vf,
                               '-frames:v', '1', f'{dst}/{name}_{k:02d}.jpg'])
print('sheets: beat label is film beat x 100 (e.g. b2900 = beat 29)')

# ---- phone copy + phone check of every card and the end card
phone = f'{dst}/phone_640x360.mp4'
subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vf', 'scale=640:360:flags=lanczos', '-c:v', 'libx264', '-crf', '24',
                       '-c:a', 'aac', '-b:a', '128k', phone])
cards = [0.0, 0.3, 2.0, 3.5, 6.1, 7.9, 8.8, 9.6, 10.4, 11.98, 12.45, 13.1, 15.2, 16.3, 18.0, 19.9, 21.6, 23.0, 25.0, 26.05, 27.3, 29.98]
tiles = []
for i, t in enumerate(cards):
    p = f'{dst}/_p{i:02d}.png'
    subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-ss', str(min(t, dur - 0.04)), '-i', phone, '-frames:v', '1', p])
    tiles.append(p)
subprocess.check_call(['montage'] + tiles + ['-tile', '4x', '-geometry', '+3+3', '-background', '#222', f'{dst}/phone_check.png'])
for p in tiles:
    os.remove(p)

# ---- sound: loudness over time + spectrogram with the cut list, and the hard checks
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import librosa
SR = 48000
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
x = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.astype(np.float64)
mono = x.mean(axis=0)
lines = []
# silence [28,29): true silence (encoded AAC: allow codec noise floor < -90 dBFS)
a, b = fr(28) * SR // FPS + int(0.02 * SR), fr(29) * SR // FPS - int(0.02 * SR)
sil = x[:, a:b]
rms = 20 * math.log10(max(np.sqrt(np.mean(sil ** 2)), 1e-12))
lines.append(f'silence beats 28-29 ({a / SR:.3f}-{b / SR:.3f} s): rms {rms:.1f} dBFS, peak {20 * math.log10(max(np.abs(sil).max(), 1e-12)):.1f} dBFS')
pk = np.abs(x).max()
lines.append(f'sample peak {20 * math.log10(pk):.2f} dBFS; samples >= 0.999: {(np.abs(x) >= 0.999).sum()}')
# transients on the hit frames: the onset-strength peak nearest each key cue, in ms from the frame
oenv = librosa.onset.onset_strength(y=mono.astype(np.float32), sr=SR, hop_length=240)
ot = librosa.frames_to_time(np.arange(len(oenv)), sr=SR, hop_length=240)
for name, beat in [('ALIVE', 1), ('logo BOOM', 13), ('drop', 29), ('HIT.', 30), ('burst', 32), ('Shot down!', 35), ('last ship', 40),
                   ('VICTORY', 45), ('lock', 61), ('end ping', 65), ('end BOOM', 67)]:
    t = fr(beat) / FPS
    m = (ot > t - 0.05) & (ot < t + 0.06)
    j = np.argmax(oenv[m])
    lines.append(f'transient {name:<11} beat {beat:>3}  frame {fr(beat):>3}: onset peak at {(ot[m][j] - t) * 1000:+6.1f} ms ({oenv[m][j] / np.median(oenv):.0f}x median)')
open(f'{dst}/sound.txt', 'w').write('\n'.join(lines) + '\n')
print('\n'.join(lines))

hop = 512
S = np.abs(librosa.stft(mono.astype(np.float32), n_fft=4096, hop_length=hop))
D = librosa.amplitude_to_db(S, ref=np.max)
w = int(0.4 * SR)
step = int(0.05 * SR)
ms = [10 * math.log10(max(np.mean(x[:, i:i + w] ** 2) * 2, 1e-12)) for i in range(0, x.shape[1] - w, step)]
fig, (a0, a1) = plt.subplots(2, 1, figsize=(30, 10), gridspec_kw={'height_ratios': [1, 3]}, sharex=True)
a0.plot(np.arange(len(ms)) * 0.05 + 0.2, ms, lw=0.8, color='k')
a0.set_ylabel('400 ms rms (dB)')
a0.set_ylim(-70, 0)
a1.imshow(D, origin='lower', aspect='auto', cmap='magma', vmin=-80, vmax=0, extent=[0, D.shape[1] * hop / SR, 0, SR / 2])
a1.set_yscale('symlog', linthresh=200)
a1.set_ylim(30, 20000)
for k, (s0, s1) in TL['SECTIONS'].items():
    for ax in (a0, a1):
        ax.axvline(fr(s0) / FPS, color='c', lw=1)
    a0.text(fr(s0) / FPS + 0.03, -6, k, fontsize=9)
for c in TL['CUES']:
    a1.axvline(fr(c['beat']) / FPS, color='w', lw=0.4, alpha=0.5)
a1.set_xticks(np.arange(0, dur + 0.01, 1.0))
a1.set_xlabel('seconds (cyan: sections; white: cues)')
fig.suptitle(f'Deck30 sound check — {os.path.basename(src)}')
plt.tight_layout()
plt.savefig(f'{dst}/sound.png', dpi=60)
print('→', dst)
