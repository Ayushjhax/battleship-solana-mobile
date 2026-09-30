"""
Sound design + mix. Places every cue from src/config/timeline.ts (SFX_CUES, via
build/timeline.json) over the music, ducks the music under the key SFX, and writes
public/audio/mix.wav, which the LaunchFilm composition plays.

The music is whatever MUSIC_FILE points at (the original score by default): a new
song only needs BPM + BEAT_OFFSET in timeline.ts, then `npm run audio`.

SFX are the game's own sounds (assets/audio/sfx) plus a few synthesized textures
(ticks, whooshes, sweeps, shimmer) that the game doesn't have.
"""
import json, os, sys
import numpy as np
import pedalboard as pb
import soundfile as sf
import librosa
from synth import *

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = json.load(open(os.path.join(ROOT, 'build/timeline.json')))
BPM, OFF = T['bpm'], T['beatOffset']
DUR = T['durationInFrames'] / T['fps']
N = int((DUR + 0.0) * SR)
music_path = os.path.join(ROOT, 'public', T.get('musicFile', 'audio/score.wav'))

music, _ = librosa.load(music_path, sr=SR, mono=False)
if music.ndim == 1:
    music = np.stack([music, music])
music = np.pad(music, ((0, 0), (0, max(0, N - music.shape[1]))))[:, :N]


def film_t(beat):
    """Cue beats are film beats: beat 0 = film frame 0."""
    return beat * 60 / BPM


# ── The palette of sounds ────────────────────────────────────────────────────
def trim_onset(x, pre_ms=0):
    """Remove leading silence so the transient sits at t=0."""
    a = np.abs(x).max(0)
    i = int(np.argmax(a > a.max() * 0.05))
    return x[:, max(0, i - int(pre_ms / 1000 * SR)):]


# Every sound below is the game's own (assets/audio/sfx), processed: filtered, layered, reverbed.
def resample(x, ratio):
    """play faster (ratio > 1: higher, shorter) by plain resampling"""
    n = int(x.shape[1] / ratio)
    idx = np.linspace(0, x.shape[1] - 1, n)
    return np.stack([np.interp(idx, np.arange(x.shape[1]), ch) for ch in x])


def tick():
    """text tick: the game's UI tap, thinned"""
    x = trim_onset(load('ui_tap.mp3')) * db(8)
    x = static_filter(x, 1800, 'highpass')[:, : int(0.12 * SR)]
    return fx(x, pb.Reverb(room_size=0.2, wet_level=0.15))


def whoosh(length=0.7, seed=0, up=True):
    """airy move: the game's torpedo run, band-limited and smeared"""
    x = trim_onset(load('torpedo.mp3')) * db(12)
    x = static_filter(x, [400, 6000], 'bandpass')
    n = x.shape[1]
    x *= np.sin(np.linspace(0, np.pi, n)) ** 1.5
    return fx(x, pb.Reverb(room_size=0.6, wet_level=0.35))


def sweep():
    """light sweep: the game's coin sparkle, lifted and spread"""
    x = trim_onset(load('coin_flow.mp3'))
    x = static_filter(x, 3000, 'highpass')
    return fx(x, pb.Chorus(rate_hz=0.8, depth=0.3, mix=0.4), pb.Reverb(room_size=0.85, wet_level=0.55))


def shimmer():
    """the bit / a settle: the game's rank-up chime, far away"""
    x = trim_onset(load('rank_up.mp3'))
    x = static_filter(x, 900, 'highpass')
    return fx(x, pb.Reverb(room_size=0.95, wet_level=0.7, dry_level=0.4))


def reveal():
    """sub drop: the game's mine, low-passed, under the nuke's body"""
    m = static_filter(trim_onset(load('mine.mp3')), 160, 'lowpass', order=2) * db(10)
    n = static_filter(trim_onset(load('nuke.mp3')), 120, 'lowpass', order=2)
    y = np.zeros((2, max(m.shape[1], n.shape[1])))
    place(y, m, 0)
    place(y, n, 0, -6)
    return fx(y, pb.Reverb(room_size=0.6, wet_level=0.25))


def thud():
    x = trim_onset(load('explosion.mp3')) * db(18)
    x = static_filter(x, 900)
    return fx(x, pb.Reverb(room_size=0.7, wet_level=0.4))


def slam():
    y = trim_onset(load('mine.mp3')) * db(4)
    s = static_filter(trim_onset(load('shot_fire.mp3')) * db(12), 1200)
    place(y, s, 0, -4)
    return fx(y, pb.Reverb(room_size=0.5, wet_level=0.2))


def metal(seed):
    """carousel tick: the game's ship-place click, pitched per step"""
    x = trim_onset(load('ship_place.mp3')) * db(6)
    x = resample(x, [1.0, 1.12, 1.26, 1.33, 1.5, 1.68][seed % 6])
    return fx(static_filter(x, 1500, 'highpass'), pb.Reverb(room_size=0.4, wet_level=0.25))


def lock():
    """lock-on: two of the game's radar pings, the second a fifth up"""
    p = trim_onset(load('radar_ping.mp3')) * db(10)
    y = np.zeros((2, int(1.2 * SR)))
    place(y, p, 0)
    place(y, resample(p, 1.5), 0.09, -2)
    return fx(y, pb.Reverb(room_size=0.5, wet_level=0.3))


def sonar():
    p = trim_onset(load('radar_ping.mp3')) * db(10)
    y = np.zeros((2, int(1.8 * SR)))
    place(y, p, 0)
    return fx(y, pb.Delay(delay_seconds=0.25, feedback=0.3, mix=0.25), pb.Reverb(room_size=0.9, wet_level=0.45))


def game(name, boost=0, pre=0.0, lp=None):
    x = trim_onset(load(name)) * db(boost)
    if lp:
        x = static_filter(x, lp)
    return x, pre


# name → (audio, pre-roll seconds: how far BEFORE the cue the file must start)
BANK = {
    'tick': (tick(), 0),
    'tap': game('ui_tap.mp3', 8),
    'whoosh': (whoosh(0.7, 1), 0.3),
    'sweep': (sweep(), 0.2),
    'shimmer': (shimmer(), 0.1),
    'reveal': (reveal(), 0),
    'thud': (thud(), 0),
    'slam': (slam(), 0),
    'metal': None,  # per-cue variations below
    'lock': (lock(), 0),
    'sonar': (sonar(), 0),
    'place': game('ship_place.mp3', 10),
    'fire': game('shot_fire.mp3', 14),
    'nuke': game('nuke.mp3', 0),
    'explosion': game('explosion.mp3', 18),
    'planeDown': (trim_onset(load('plane_down.mp3')) * db(12), 0.49),  # its crash peaks ~0.49 s after onset
    'radar': (sonar(), 0),
    'sub': game('sub_surface.mp3', 0),
    'mine': game('mine.mp3', 0),
    'torpedo': game('torpedo.mp3', 12),
    'bombDrop': (trim_onset(load('bomb_drop.mp3')), 0.72),  # whistle, impact 0.72 s in
    'sink': game('ship_sink.mp3', 0),
    'victory': game('victory.mp3', 2),
    'coin': game('coin_flow.mp3', 0),
    'rankUp': game('rank_up.mp3', 0),
}

# Designed default level of each sound: its loudest 400 ms window (momentary LUFS),
# relative to the score (journey ≈ −25, battle ≈ −17 LUFS short-term before mastering).
LEVEL = {
    'tick': -34, 'tap': -30, 'whoosh': -29, 'sweep': -31, 'shimmer': -34, 'reveal': -24, 'thud': -32,
    'slam': -20, 'metal': -30, 'lock': -26, 'sonar': -27, 'place': -26, 'fire': -22, 'nuke': -14,
    'explosion': -18, 'planeDown': -20, 'radar': -24, 'sub': -21, 'mine': -19, 'torpedo': -22,
    'bombDrop': -20, 'sink': -16, 'victory': -15, 'coin': -24, 'rankUp': -21,
}
import pyloudnorm as pyln
_meter = pyln.Meter(SR, block_size=0.4)


def momentary_max(x):
    hop = int(0.1 * SR); w = int(0.4 * SR)
    if x.shape[1] < w:
        x = np.pad(x, ((0, 0), (0, w - x.shape[1])))
    best = -70
    for s0 in range(0, x.shape[1] - w + 1, hop):
        seg = x[:, s0:s0 + w]
        if np.abs(seg).max() < 1e-5:
            continue
        best = max(best, _meter.integrated_loudness(seg.T))
    return best


_norm = {}


def normalised(name, x):
    key = name if name != 'metal' else 'metal'
    if name not in _norm:
        _norm[name] = LEVEL[key] - momentary_max(x)
    return x * db(_norm[name])


sfx = np.zeros((2, N))
key = np.zeros((2, N))  # the SFX that duck the music
KEYS = {'nuke', 'explosion', 'sink', 'victory', 'bombDrop', 'planeDown', 'fire', 'sonar', 'radar', 'mine', 'sub', 'torpedo', 'thud', 'coin', 'rankUp', 'lock'}
for i, c in enumerate(T['cues']):
    name = c['sfx']
    if name == 'metal':
        x, pre = metal(i), 0
    else:
        x, pre = BANK[name]
    x = normalised(name, x)
    t = film_t(c['beat']) - pre
    place(sfx, x, t, c.get('gain', 0))
    if name in KEYS:
        place(key, x, t, c.get('gain', 0))

# ── Duck the music 3–6 dB under the key SFX (envelope follower) ───────────────
env = np.abs(key).max(0)
win = int(0.01 * SR)
env = np.convolve(env, np.ones(win) / win, mode='same')
# attack fast, release ~250 ms
rel = np.exp(-1 / (0.25 * SR))
from scipy.signal import lfilter
env = np.maximum(env, lfilter([1 - rel], [1, -rel], env))
duck_db = -np.clip((20 * np.log10(env + 1e-6) + 30) / 20, 0, 1) * 5.0  # up to −5 dB
music_ducked = music * db(duck_db)

# ── Hard silences: nothing rings through them, SFX tails included ────────────
SCN = T['scenes']


def gate(b0, b1, keep_after=None, fade_ms=10):
    s0, s1 = int(film_t(b0) * SR), int(film_t(b1) * SR)
    fl = int(fade_ms / 1000 * SR)
    for bus in (sfx, music_ducked):
        bus[:, s0 + fl:s1] = 0
        bus[:, s0:s0 + fl] *= np.linspace(1, 0, fl)


gate(SCN['victory']['start'] - 0.5, SCN['victory']['start'])
gate(SCN['battle']['start'] - 0.5, SCN['battle']['start'])
# peak → hard cut to silence: kill the supercut's tails; re-place the finale's own cues
fin = SCN['finale']['start']
gate(fin, T['totalBeats'] + 8)
music_ducked[:, int(film_t(fin) * SR):] = music[:, int(film_t(fin) * SR):]
for i, c in enumerate(T['cues']):
    if c['beat'] >= fin:
        if c['sfx'] == 'metal':
            x, pre = metal(i), 0
        else:
            x, pre = BANK[c['sfx']]
        place(sfx, normalised(c['sfx'], x), film_t(c['beat']) - pre, c.get('gain', 0))

mix = music_ducked + sfx
mix = mix[:, :N]
# pre-master: glue + look-ahead limiter to −14.5 LUFS / −1.5 dBFS (final loudnorm trims)
from master import master
write(os.path.join(ROOT, 'build/stems/mix_premaster.wav'), mix / np.abs(mix).max() * db(-1.0))
mix, L = master(mix)
print(f'pre-master {L:.1f} LUFS, peak {20 * np.log10(np.abs(mix).max()):.1f} dBFS')
os.makedirs(os.path.join(ROOT, 'build/stems'), exist_ok=True)
write(os.path.join(ROOT, 'build/stems/sfx.wav'), sfx)
write(os.path.join(ROOT, 'public/audio/mix.wav'), mix)
print(f'mix.wav {N / SR:.2f} s, {len(T["cues"])} cues, max duck {duck_db.min():.1f} dB, peak {20*np.log10(np.abs(mix).max()):.1f} dBFS')
