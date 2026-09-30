"""Detect BPM, beat offset and downbeat of the music file with librosa; write build/beats.json.
The detected values go into src/config/timeline.ts (BPM, BEAT_OFFSET).

1. librosa tempo estimate (onset autocorrelation) as a starting point
2. fine grid fit: BPM ±4 in 0.01 steps × phase, maximising mean onset strength sampled on the grid
3. downbeat: the beat phase (of 4) whose onsets are strongest"""
import json, sys, os
import numpy as np, librosa
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'public/audio/score.wav')
sr, hop = 22050, 128
y, _ = librosa.load(path, sr=sr, mono=True)
onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
onset = onset / (onset.max() + 1e-9)
fps = sr / hop
dur = len(y) / sr
t0 = float(librosa.feature.tempo(onset_envelope=onset, sr=sr, hop_length=hop, start_bpm=120)[0])

def score(bpm, ph):
    t = np.arange(ph, dur, 60 / bpm)
    idx = np.clip(np.round(t * fps).astype(int), 0, len(onset) - 1)
    return onset[idx].mean()

best = (0, None, None)
for bpm in np.arange(max(40, t0 - 4), t0 + 4, 0.01):
    per = 60 / bpm
    for ph in np.arange(0, per, 1 / fps):
        s = score(bpm, ph)
        if s > best[0]:
            best = (s, bpm, ph)
_, bpm, ph = best
per = 60 / bpm
strength = [score(bpm / 4, ph + k * per) for k in range(4)]
down = ph + int(np.argmax(strength)) * per
out = {'file': os.path.relpath(path, ROOT), 'librosaTempo': round(t0, 2), 'bpm': round(float(bpm), 2),
       'beatOffset': round(float(ph), 4), 'downbeatOffset': round(float(down % (4 * per)), 4),
       'gridFit': round(float(best[0]), 4)}
os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
json.dump(out, open(os.path.join(ROOT, 'build/beats.json'), 'w'), indent=1)
print(out)
