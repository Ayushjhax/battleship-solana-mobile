"""Spectrogram + short-term loudness of an audio file, with the scene boundaries marked.
Usage: python3 tools/audio_report.py <wav> <out.png>"""
import json, sys, os
import numpy as np, librosa, matplotlib, pyloudnorm as pyln
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = json.load(open(os.path.join(ROOT, 'build/timeline.json')))
path, out = sys.argv[1], sys.argv[2]
y, sr = librosa.load(path, sr=48000, mono=False)
mono = y.mean(0) if y.ndim > 1 else y
meter = pyln.Meter(sr)
integ = meter.integrated_loudness(y.T if y.ndim > 1 else y)
# short-term loudness (3 s window, 0.5 s hop)
st = []
for s in np.arange(0, len(mono) / sr - 3, 0.5):
    seg = (y[:, int(s * sr):int((s + 3) * sr)].T) if y.ndim > 1 else mono[int(s * sr):int((s + 3) * sr)]
    try:
        st.append((s + 1.5, meter.integrated_loudness(seg)))
    except Exception:
        st.append((s + 1.5, -70))
S = librosa.amplitude_to_db(np.abs(librosa.stft(mono, n_fft=4096, hop_length=1024)), ref=np.max)
fig, ax = plt.subplots(2, 1, figsize=(24, 9), sharex=True, gridspec_kw={'height_ratios': [2, 1]})
librosa.display.specshow(S, sr=sr, hop_length=1024, x_axis='time', y_axis='log', ax=ax[0], cmap='magma', vmin=-80)
ax[1].plot([a for a, _ in st], [max(-60, b) for _, b in st], color='k')
ax[1].set_ylabel('short-term LUFS'); ax[1].set_ylim(-60, -5); ax[1].grid(alpha=.3)
for name, sc in T['scenes'].items():
    t = T['beatOffset'] + sc['start'] * 60 / T['bpm']
    for a in ax:
        a.axvline(t, color='cyan' if a is ax[0] else 'tab:blue', lw=1)
    ax[0].text(t + 0.3, 12000, name, color='cyan', fontsize=10)
ax[0].set_title(f'{os.path.basename(path)} · integrated {integ:.1f} LUFS · peak {20*np.log10(np.abs(y).max()):.1f} dBFS')
plt.tight_layout(); plt.savefig(out, dpi=70)
print(f'integrated {integ:.1f} LUFS')
