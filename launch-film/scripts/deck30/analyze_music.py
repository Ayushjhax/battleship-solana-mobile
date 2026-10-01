"""Deck30 — tempo, downbeats and a per-beat energy map of the campaign song (librosa).

  python3 scripts/deck30/analyze_music.py            # prints the map, rewrites the analysis block
                                                      # in src/deck30/timeline.ts (between the markers)

Tempo: librosa beat tracker + a least-squares fit of a fixed grid to the tracked beats.
Downbeats: librosa has no downbeat tracker, so the bar phase is the beat position (mod 4) whose
low-band (< 150 Hz) onsets are strongest over the whole track — the kick lands on beat 1.
Anchor: the onset of the track's first drop (the trailer's track beat 0), searched near the grid.
"""
import json, re, sys
from pathlib import Path
import numpy as np, librosa

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT.parent / 'demo-assets' / 'music' / 'Music.mp3'
y, sr = librosa.load(SRC, sr=44100, mono=True)
dur = len(y) / sr
hop = 256
onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
tempo, beats = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=hop, units='time', tightness=200)
tempo = float(np.atleast_1d(tempo)[0])
# fit a straight grid to the tracked beats (robust: median period, then least squares on the inliers)
period = float(np.median(np.diff(beats)))
k = np.round((beats - beats[0]) / period)
A = np.vstack([k, np.ones_like(k)]).T
(p, t0), *_ = np.linalg.lstsq(A, beats, rcond=None)
res = beats - (k * p + t0)
ok = np.abs(res) < 0.03
(p, t0), *_ = np.linalg.lstsq(A[ok], beats[ok], rcond=None)
bpm = 60 / p
# low band onset envelope for kick-driven downbeat phase
S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
f = librosa.fft_frequencies(sr=sr, n_fft=2048)
low = librosa.onset.onset_strength(S=librosa.amplitude_to_db(S[f < 150]), sr=sr, hop_length=hop)
tt = librosa.frames_to_time(np.arange(len(low)), sr=sr, hop_length=hop)
grid = t0 + p * np.arange(-int(t0 / p), int((dur - t0) / p))
def at(env, t, w=0.04):
    m = (tt >= t - w) & (tt <= t + w)
    return float(env[m].max()) if m.any() else 0.0
lowb = np.array([at(low, t) for t in grid])
idx = np.round((grid - t0) / p).astype(int)
phase_strength = [float(lowb[(idx % 4) == ph].mean()) for ph in range(4)]
down_phase = int(np.argmax(phase_strength))
# the first drop: the biggest jump in low-band RMS from one bar to the next, on a downbeat, in 10–40 s
rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0]
rt = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
def bar_rms(t):
    m = (rt >= t) & (rt < t + 4 * p)
    return float(np.sqrt(np.mean(rms[m] ** 2))) if m.any() else 0.0
downs = grid[((idx - down_phase) % 4) == 0]
cand = [(bar_rms(t) / max(bar_rms(t - 4 * p), 1e-6), t) for t in downs if 10 < t < 40]
drop = max(cand)[1]
# exact onset of the drop: the low-band onset peak within ±50 ms of the grid
m = (tt >= drop - 0.05) & (tt <= drop + 0.05)
drop_onset = float(tt[m][np.argmax(low[m])])
print(f'duration {dur:.3f} s · librosa tempo {tempo:.2f} · grid fit {bpm:.3f} BPM (period {p:.5f} s) · '
      f'inliers {ok.sum()}/{len(ok)} · resid {np.std(res[ok]) * 1000:.1f} ms')
print('low-band strength by beat-in-bar (grid phase):', [round(v, 2) for v in phase_strength], '→ downbeat phase', down_phase)
print(f'first drop: grid {drop:.4f} s, low-band onset {drop_onset:.4f} s')
BEAT = 60 / round(bpm)
print('\nPER-BEAT MAP around the drop (track beat 0 = first drop; rms dB, low onset, D = downbeat)')
def row(b):
    t = drop_onset + b * BEAT
    a = int(max(0, t) * sr); z = int((t + BEAT) * sr)
    r = 20 * np.log10(np.sqrt(np.mean(y[a:z] ** 2)) + 1e-9) if z > a else -99
    lo = at(low, t)
    return f'{b:+5d} {t:8.3f}s {"D" if b % 4 == 0 else " "} rms {r:6.1f} low {lo:5.2f} ' + '#' * int(max(0, r + 40))
for b in list(range(-48, 40)) + list(range(150, 162)) + list(range(340, 372)):
    print(row(b))
# rewrite the analysis block in the Deck30 timeline
tl = ROOT / 'src' / 'deck30' / 'timeline.ts'
block = (f"// <music-analysis> written by scripts/deck30/analyze_music.py — do not edit by hand\n"
         f"export const ANALYSIS = {{ detectedBpm: {bpm:.3f}, librosaTempo: {tempo:.2f}, dropOnsetSec: {drop_onset:.4f}, "
         f"downbeatPhase: 'track beats 0, 4, 8 … (kick on 1)', trackSec: {dur:.3f} }} as const;\n"
         f"// </music-analysis>")
if tl.exists():
    s = tl.read_text()
    s2 = re.sub(r'// <music-analysis>.*?// </music-analysis>', block, s, flags=re.S)
    tl.write_text(s2)
    print('\nrewrote the analysis block in', tl.relative_to(ROOT))
else:
    print('\n' + block)
