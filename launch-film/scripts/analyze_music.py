"""Beat / downbeat / energy analysis of the supplied track. Writes build/audio/music_analysis.json."""
import json, sys
import numpy as np, librosa

path = sys.argv[1] if len(sys.argv) > 1 else '../demo-assets/music/Music.mp3'
y, sr = librosa.load(path, sr=44100, mono=True)
dur = len(y) / sr
tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units='time', tightness=100)
onset_env = librosa.onset.onset_strength(y=y, sr=sr)
tempo2 = librosa.feature.tempo(onset_envelope=onset_env, sr=sr, aggregate=None)
# RMS energy per 0.5 s
hop = int(sr * 0.25)
rms = librosa.feature.rms(y=y, frame_length=hop * 2, hop_length=hop)[0]
rms_db = 20 * np.log10(rms + 1e-9)
# low-band energy (kick) per 0.25 s
S = np.abs(librosa.stft(y, n_fft=4096, hop_length=hop))
freqs = librosa.fft_frequencies(sr=sr, n_fft=4096)
low = S[(freqs < 150)].mean(axis=0)
high = S[(freqs > 4000)].mean(axis=0)
print('duration', dur, 'tempo', tempo, 'beats', len(beats))
print('median local tempo', np.median(tempo2))
ib = np.diff(beats)
print('beat interval median', np.median(ib), 'std', ib.std())
out = {'duration': dur, 'tempo': float(np.atleast_1d(tempo)[0]), 'beats': [float(b) for b in beats],
       'rms_db_quarter': [float(v) for v in rms_db], 'low': [float(v) for v in low], 'high': [float(v) for v in high]}
json.dump(out, open('build/audio/music_analysis.json', 'w'))
# print a coarse energy map per 2 s
for t in range(0, int(dur), 2):
    i = t * 4
    seg = rms_db[i:i + 8]; l = low[i:i+8]; h = high[i:i+8]
    print(f'{t:4d}s  rms {seg.mean():6.1f}  low {20*np.log10(l.mean()+1e-9):6.1f}  high {20*np.log10(h.mean()+1e-9):6.1f}  ' + '#' * int(max(0, seg.mean() + 40)))
