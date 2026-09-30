import json, numpy as np, librosa, librosa.display
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
y, sr = librosa.load('../demo-assets/music/Music.mp3', sr=44100, mono=True)
A = json.load(open('build/audio/music_analysis.json'))
beats = np.array(A['beats'])
# key via chroma
chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
prof_major = np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88])
prof_minor = np.array([6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17])
c = chroma.mean(axis=1)
names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
scores = []
for i in range(12):
    scores.append((np.corrcoef(c, np.roll(prof_major, i))[0,1], names[i]+' major'))
    scores.append((np.corrcoef(c, np.roll(prof_minor, i))[0,1], names[i]+' minor'))
print(sorted(scores)[-4:])
# low band onset envelope near drops
hop = 512
S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
f = librosa.fft_frequencies(sr=sr, n_fft=2048)
low = S[f < 120].sum(axis=0); lowdb = 20*np.log10(low+1e-6)
t = librosa.frames_to_time(np.arange(len(low)), sr=sr, hop_length=hop)
for a, b in [(14, 24), (48, 62), (76, 92), (118, 146), (170, 180)]:
    m = (t >= a) & (t < b)
    # per-beat low energy
    print(f'--- {a}-{b}s')
    for bt in beats[(beats >= a) & (beats < b)]:
        mm = (t >= bt - 0.03) & (t < bt + 0.12)
        print(f'  beat {bt:7.3f}  low {lowdb[mm].max():5.1f}  rms {20*np.log10(np.sqrt(np.mean(y[int(bt*sr):int((bt+0.2)*sr)]**2))+1e-9):6.1f}')
fig, ax = plt.subplots(3, 1, figsize=(24, 12))
for axi, (a, b) in zip(ax, [(0, 60), (60, 120), (120, 180)]):
    seg = y[int(a*sr):int(b*sr)]
    D = librosa.amplitude_to_db(np.abs(librosa.stft(seg, n_fft=4096, hop_length=1024)), ref=np.max)
    librosa.display.specshow(D, sr=sr, hop_length=1024, x_axis='time', y_axis='log', ax=axi)
    axi.set_xticks(np.arange(0, b-a+1, 2)); axi.set_xticklabels([str(a+i) for i in range(0, b-a+1, 2)])
    axi.set_ylim(30, 16000)
plt.tight_layout(); plt.savefig('build/audio/spectrogram.png', dpi=60)
