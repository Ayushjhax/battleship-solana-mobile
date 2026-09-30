#!/usr/bin/env python3
"""Trailer45 — the score: music edit + designed sounds + game SFX, ducked and mastered.

`npm run score` (from launch-film/). Everything is read from src/trailer45/timeline.ts
through node, so a new song / BPM / anchor / edit / cue list only needs a re-run. Writes

  public/audio/soundtrack.wav             48 kHz, 24-bit stereo, exactly DURATION frames
  out/sonic-logo.wav                      the sonic logo on its own (ping -> BOOM)
  build/audio/cues.txt                    every cue (beat, frame, seconds, sound, gain) + the edit
  build/audio/soundtrack_spectrogram.png  beats every 4 on the x axis

Choices the timeline is silent on (change the comment when you change the rule):
  * Every cue lands on the FRAME of its beat, f(beat)/FPS s = f(beat) * 1600 samples.
  * Each music segment is pinned to the frame of its first beat. The segment's real onset
    is searched +-30 ms around the nominal track beat and put exactly on that frame, with a
    4 ms pre-roll so the attack is whole (the first segment, the intro pad, is not searched).
    Cuts get an equal-power crossfade (10 ms) when segments touch, a 12 ms fade-out into a
    gap, and a 5 ms click guard at film frame 0.
  * Gaps between music segments are DIGITAL silence: the whole mix is gated there, except
    sounds cued inside the gap (the one click before the drop).
  * Game SFX (the game's own assets/audio/sfx, read only) are peak-normalised to -3 dBFS and
    their attack, not the file start, is put on the cue frame. bomb_drop is a whistle: its
    impact goes on the next explosion/boom cue within 4 beats instead.
  * Designed sounds are synthesised here, deterministic (seeded by name@beat), and also
    peak-normalised to -3 dBFS; a cue's `db` is relative to that. `TRIM_DB` is the mixer's
    balance on top of the cue gains (the timeline keeps the picture editor's intent).
  * Ducks apply to the music only: 40 ms down from the duck's beat, hold `beats`, 250 ms up.
  * Master: bus compressor (2:1-ish, slow attack) -> gain -> true-peak brickwall limiter
    (-1.5 dB ceiling, 4x oversampled detector) -> measured true peak trimmed to <= -1.0 dBTP
    -> 0.4 s fade at the very end. Gain is iterated until integrated loudness is -14 LUFS.
"""
from __future__ import annotations

import json
import math
import re
import subprocess
import sys
import zlib
from pathlib import Path

import numpy as np
import pedalboard as pb
import scipy.signal as ss
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
SR = 48000
NORM_DB = -3.0            # every sound (designed or game) is peak-normalised to this before its cue db
SFX_DIR = ROOT.parent / 'assets' / 'audio' / 'sfx'   # the game's own effects — read only

MUSIC_GAIN_DB = -9.0      # the track is a hot master (peaks +5 dBFS decoded); sits under the design
TARGET_LUFS = -14.0
LIMIT_CEILING_DB = -1.5   # limiter ceiling (true-peak detector); the file is then checked to <= -1.0 dBTP
TP_MAX_DB = -1.0
END_FADE_SEC = 0.4

# Mixer's balance on top of each cue's db (dB). Measured against the music with the balance
# table in cues.txt (loudness of the cue vs the music under it), not guessed.
TRIM_DB: dict[str, float] = {
    'stab': +3.0,        # the cast cards need a clear hit over the intro pad
    'slam': +4.0,        # every text card lands above the track's drums (K-weighting hides its sub)
    'riser4': +1.0,
    'stamp': +2.0,
    'tick': +4.0,
    'whoosh': +1.0,
    'metal': +3.0,
    'pop': +2.0,
    'click': -5.0,       # alone in digital silence: crisp, not a gunshot
    'shot_fire': +3.0,
    'ui_tap': +10.0,     # a 10 ms tap: inaudible at the cue gain
    'plane_down': -6.0,  # a 1.5 s sustained noise block — peak-normalised it swamps the track
    'bomb_drop': -9.0,   # a pure 2-3.5 kHz whistle: peak-normalised it was the loudest thing in the film
    'ship_sink': -2.0,
    'sweep': -1.0,
    'pad': -2.0,
}
# Stem density (dB of peak limiting on the normalised sound, then re-normalised): the peaky hits
# carry more weight per dB of bus headroom, so the master limiter isn't the one flattening them.
DENSITY_DB: dict[str, float] = {
    'victory': 4.0,
    'explosion': 4.0,
    'boom': 3.0,
    'slam': 3.0,
    'landing': 3.0,
}
# Per-cue balance, keyed (sfx, beat), for the few places one instance needs its own level.
CUE_TRIM_DB: dict[tuple[str, float], float] = {
    ('nuke', 0): -2.5,       # the hook is massive, the drop is bigger
    ('explosion', 0): -3.0,
    ('nuke', 46): +2.0,      # the drop is the biggest moment of the first half
    ('boom', 46): +1.0,
    ('stamp', 41.5): +2.0,   # VS punch
    ('sonic', 97): -3.0,     # the ending is calm: the signature, not a second landing
    ('explosion', 50): +2.0,  # HIT. reads
    ('explosion', 59): -1.0,
    ('victory', 66): +5.0,   # VICTORY is the biggest hit of the film: the fanfare carries it...
    ('boom', 66): -3.0,      # ...and a smaller boom makes it BIGGER: its sub was pumping the limiter
    ('slam', 66): -4.0,      # its sub lands on the boom's (coherent): keep the thud, lose the stack
}


# Per-cue tail, keyed (sfx, beat): (fade start, fade length) in seconds after the cue frame.
# The hook's blast must not rumble under the four cast stabs (they start one beat later).
CUE_TAIL: dict[tuple[str, float], tuple[float, float]] = {
    ('nuke', 0): (0.40, 0.55),
    ('explosion', 0): (0.40, 0.45),
}


# ────────────────────────────────────────────────────────────────── the timeline ──

NODE_SNIPPET = r"""
import('./src/trailer45/timeline.ts').then((m) => {
  const out = {};
  for (const [k, v] of Object.entries(m)) if (typeof v !== 'function') out[k] = v;
  const beats = new Set([0, m.TOTAL_BEATS]);
  for (const c of m.CUES) beats.add(c.beat);
  for (const e of m.MUSIC_EDIT) { beats.add(e.from); beats.add(e.to); }
  for (const d of m.DUCKS) { beats.add(d.beat); beats.add(d.beat + d.beats); }
  out.__frames = [...beats].map((b) => [b, m.f(b)]);
  console.log(JSON.stringify(out));
});
"""


def load_timeline() -> dict:
    r = subprocess.run(['node', '--experimental-strip-types', '--no-warnings', '-e', NODE_SNIPPET],
                       cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit('score: could not read src/trailer45/timeline.ts through node\n' + r.stderr)
    return json.loads(r.stdout)


TL = load_timeline()
FPS: int = TL['FPS']
BEAT: float = TL['BEAT_SEC']
MUSIC = TL['MUSIC']
DURATION_FR: int = TL['DURATION']
if SR % FPS:
    sys.exit(f'score: {SR} Hz is not a whole number of samples per frame at {FPS} fps')
SPF = SR // FPS            # samples per frame (1600 at 30 fps)
N = DURATION_FR * SPF      # samples in the film


def frame(beat: float) -> int:
    """timeline.ts f(): Math.round(beat * BEAT_SEC * FPS), evaluated in the same double order."""
    return math.floor(beat * BEAT * FPS + 0.5)


for _b, _fr in TL['__frames']:
    if frame(_b) != _fr:
        sys.exit(f'score: frame maths disagrees with timeline.ts at beat {_b}: {frame(_b)} vs {_fr}')


def fsec(beat: float) -> float:
    return frame(beat) / FPS


def fsamp(beat: float) -> int:
    return frame(beat) * SPF


# ────────────────────────────────────────────────────────────────── DSP helpers ──

def ns(sec: float) -> int:
    return int(round(sec * SR))


def tax(n: int) -> np.ndarray:
    return np.arange(n) / SR


def db(x: float) -> float:
    return 10 ** (x / 20)


def seed_of(key: str) -> int:
    return zlib.crc32(key.encode())


def noise(n: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).standard_normal(n)


def attack(n: int, sec: float) -> np.ndarray:
    env = np.ones(n)
    k = min(n, max(1, ns(sec)))
    env[:k] = 0.5 - 0.5 * np.cos(np.pi * np.arange(k) / k)
    return env


def fade_out(x: np.ndarray, sec: float) -> np.ndarray:
    k = min(x.shape[-1], max(1, ns(sec)))
    x = x.copy()
    x[..., -k:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(1, k + 1) / k)
    return x


def delay(x: np.ndarray, sec: float, n: int | None = None) -> np.ndarray:
    d = ns(sec)
    n = x.shape[-1] if n is None else n
    out = np.zeros(x.shape[:-1] + (n,))
    m = max(0, min(x.shape[-1], n - d))
    out[..., d:d + m] = x[..., :m]
    return out


def _sos(kind: str, fc, order: int):
    return ss.butter(order, fc, kind, fs=SR, output='sos')


def lp(x, fc, order=2):
    return ss.sosfilt(_sos('lowpass', fc, order), x, axis=-1)


def hp(x, fc, order=2):
    return ss.sosfilt(_sos('highpass', fc, order), x, axis=-1)


def bp(x, lo, hi, order=2):
    return ss.sosfilt(_sos('bandpass', [lo, hi], order), x, axis=-1)


def sat(x, drive):
    return np.tanh(drive * x) / np.tanh(drive)


def osc_sine(freq, phase=0.0):
    freq = np.asarray(freq, dtype=float)
    return np.sin(2 * np.pi * np.cumsum(freq) / SR + phase)


def osc_saw(freq, phase=0.0):
    """Band-limited (polyBLEP) saw for a per-sample frequency array."""
    dt = np.asarray(freq, dtype=float) / SR
    ph = (phase + np.cumsum(dt)) % 1.0
    y = 2 * ph - 1
    m = ph < dt
    t = ph[m] / dt[m]
    y[m] -= 2 * t - t * t - 1
    m = ph > 1 - dt
    t = (ph[m] - 1) / dt[m]
    y[m] -= t * t + 2 * t + 1
    return y


def const(n, v):
    return np.full(n, float(v))


def st(mono: np.ndarray, pan: float = 0.0) -> np.ndarray:
    """Mono -> stereo. Centre is unity in both channels; +-1 is hard L/R (+3 dB)."""
    th = (pan + 1) * np.pi / 4
    return np.stack([mono * np.cos(th) * math.sqrt(2), mono * np.sin(th) * math.sqrt(2)])


def st_moving(mono: np.ndarray, pan: np.ndarray) -> np.ndarray:
    th = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    return np.stack([mono * np.cos(th) * math.sqrt(2), mono * np.sin(th) * math.sqrt(2)])


def pedal(x: np.ndarray, *plugins, tail: float = 0.0) -> np.ndarray:
    """Run a pedalboard chain on a (2, n) buffer, optionally padded for a tail."""
    if tail:
        x = np.concatenate([x, np.zeros((x.shape[0], ns(tail)))], axis=1)
    y = pb.Pedalboard(list(plugins))(x.astype(np.float32), SR)
    return y.astype(np.float64)


def peak(x) -> float:
    return float(np.max(np.abs(x))) if x.size else 0.0


def normalise(x: np.ndarray, to_db: float = NORM_DB) -> np.ndarray:
    p = peak(x)
    return x * (db(to_db) / p) if p > 0 else x


def true_peak_db(x: np.ndarray) -> float:
    up = ss.resample_poly(x, 4, 1, axis=-1)
    return 20 * math.log10(max(peak(up), 1e-12))


try:  # librosa depends on numba, so it is normally here; the fallback is plain (slower) Python
    from numba import njit
except Exception:  # pragma: no cover
    def njit(*a, **k):
        return a[0] if a and callable(a[0]) else (lambda f: f)


@njit(cache=False)
def _svf(x, fc, q, sr, mode):
    """Zavalishin TPT state-variable filter, per-sample cutoff. mode 0 LP, 1 BP (unity peak), 2 HP."""
    n = x.shape[0]
    y = np.empty(n)
    ic1 = 0.0
    ic2 = 0.0
    k = 1.0 / q
    for i in range(n):
        f = fc[i]
        if f > 0.45 * sr:
            f = 0.45 * sr
        g = math.tan(math.pi * f / sr)
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        if mode == 0:
            y[i] = v2
        elif mode == 1:
            y[i] = k * v1
        else:
            y[i] = x[i] - k * v1 - v2
    return y


def svf(x, fc, q=0.707, mode='lp'):
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape[-1]).copy()
    m = {'lp': 0, 'bp': 1, 'hp': 2}[mode]
    if x.ndim == 1:
        return _svf(np.ascontiguousarray(x, dtype=float), fc, float(q), float(SR), m)
    return np.stack([_svf(np.ascontiguousarray(c, dtype=float), fc, float(q), float(SR), m) for c in x])


def note(name: str) -> float:
    """'A2' -> 110.0 (A4 = 440, sharps only)."""
    names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    m = re.fullmatch(r'([A-G]#?)(-?\d)', name)
    midi = names.index(m.group(1)) + 12 * (int(m.group(2)) + 1)
    return 440.0 * 2 ** ((midi - 69) / 12)


def cents(c: float) -> float:
    return 2 ** (c / 1200)


# ──────────────────────────────────────────────────────────── designed sounds ──
# Each returns (stereo buffer (2, n), anchor seconds): the anchor is the instant that lands
# on the cue frame. Key: A minor. Subs and impacts centred; stabs, pads and risers wide.

class Ctx:
    def __init__(self, beat: float, seed: int, run_index: int = 0):
        self.beat = beat
        self.seed = seed
        self.run_index = run_index

    def span(self, beats: float) -> float:
        """Frame-accurate seconds from this cue's frame to the frame `beats` later."""
        return fsec(self.beat + beats) - fsec(self.beat)

    def to_end(self) -> float:
        return DURATION_FR / FPS - fsec(self.beat)


def ping_voice(seed: int, length: float = 1.2) -> np.ndarray:
    """The sonar ping: 1.55 -> 1.45 kHz sine blip, 2 ms attack, ~120 ms body, and a sonar echo
    tail of three repeats on the eighth notes (so in the logo they walk into the BOOM on 2)."""
    n = ns(length)
    t = tax(n)
    f = 1450.0 + 100.0 * np.exp(-t / 0.045)
    ph = 2 * np.pi * np.cumsum(f) / SR
    tone = np.sin(ph) + 0.045 * np.sin(2 * ph + 0.4) + 0.012 * np.sin(3 * ph + 1.1)
    env = attack(n, 0.002) * np.exp(-np.maximum(t - 0.016, 0) / 0.05)
    dry = tone * env
    wet = np.zeros((2, n))
    for k, (g, pan) in enumerate([(0.34, -0.45), (0.16, 0.45), (0.07, -0.3)]):
        e = bp(dry, 700, 5200 - 1100 * k)
        wet += delay(st(e * g, pan), BEAT / 2 * (k + 1), n)
    room = pedal(wet + 0.22 * st(dry), pb.Reverb(room_size=0.62, damping=0.55, wet_level=1.0,
                                                   dry_level=0.0, width=1.0))[:, :n]
    out = st(dry) + wet + 0.3 * room
    return fade_out(out, 0.15)


def boom_voice(seed: int, *, f0=62.0, f1=33.0, glide=0.3, sub_tau=0.5, size=1.0, crack=1.0,
               tonal=False, length=2.6, room=0.3) -> np.ndarray:
    """An impact: sub drop f0 -> f1, a saturated thump, low-passed noise, crack, rumble and a
    dark room. `tonal` adds the logo's short hit on A (A1/A2 + fifths, soft-clipped)."""
    n = ns(length)
    t = tax(n)
    fsub = f1 + (f0 - f1) * np.exp(-t / glide)
    sub = sat(osc_sine(fsub) * attack(n, 0.0015) * np.exp(-t / sub_tau), 1.5)
    fth = 48.0 + 120.0 * np.exp(-t / 0.028)
    thump = sat(osc_sine(fth) * attack(n, 0.0008) * np.exp(-t / (0.075 * size)), 2.6)
    common = noise(n, seed)
    nz = np.stack([lp(0.8 * common + 0.6 * noise(n, seed + c + 1), 1100, 4) for c in range(2)])
    nz = nz / peak(nz) * attack(n, 0.001) * np.exp(-t / (0.12 * size))
    cr = bp(noise(n, seed + 7), 1800, 7500) * np.exp(-t / 0.009)
    cr = cr / peak(cr)
    rb = np.stack([lp(noise(n, seed + 11 + c), 170, 4) for c in range(2)])
    rb = rb / peak(rb) * attack(n, 0.02) * np.exp(-t / (0.7 * size))
    body = st(0.55 * thump) + 0.38 * nz + st(0.13 * crack * cr) + 0.28 * rb
    if tonal:
        env = attack(n, 0.003) * np.exp(-t / 0.42)
        hit = (0.6 * osc_sine(const(n, note('A1'))) + 0.55 * osc_saw(const(n, note('A2')))
               + 0.35 * osc_saw(const(n, note('E3')) * cents(4)) + 0.22 * osc_saw(const(n, note('A3')) * cents(-5)))
        hit = sat(lp(hit, 1400, 2) * env, 1.8)
        body += np.stack([0.42 * hit, 0.42 * lp(hit, 1200, 1)])
    tail = pedal(body, pb.Reverb(room_size=0.86, damping=0.72, wet_level=1.0, dry_level=0.0, width=0.9))[:, :n]
    out = st(sub) + body + room * tail
    return fade_out(out, 0.35)


DESIGNED = {}


def designed(name):
    def deco(fn):
        DESIGNED[name] = fn
        return fn
    return deco


@designed('stab')
def snd_stab(c: Ctx):
    """Synth-orchestral hit on A minor: detuned saws (A2 E3 A3 C4 E4 + a top voice that climbs
    card to card), filter snap 7 kHz -> 900 Hz, sub on A1, a noise 'bite', a little room."""
    n = ns(1.1)
    t = tax(n)
    tops = ['A4', 'C5', 'E5', 'A5']
    voices = ['A2', 'E3', 'A3', 'C4', 'E4', tops[c.run_index % len(tops)]]
    out = np.zeros((2, n))
    rng = np.random.default_rng(c.seed)
    for vi, v in enumerate(voices):
        for det, pan in [(-9, -0.55), (0, 0.0), (9, 0.55)]:
            out += st(osc_saw(const(n, note(v) * cents(det + rng.uniform(-2, 2))), rng.uniform()) *
                      (0.8 if vi == len(voices) - 1 else 1.0), pan)
    cutoff = 900 + 6200 * np.exp(-t / 0.075)
    out = svf(out, cutoff, 0.8, 'lp')
    env = attack(n, 0.002) * np.exp(-t / 0.11)
    out = sat(out * env / 6.0, 1.3)
    sub = osc_sine(const(n, note('A1'))) * attack(n, 0.002) * np.exp(-t / 0.13)
    bite = bp(noise(n, c.seed + 1), 2000, 6500) * np.exp(-t / 0.006)
    out = out / peak(out) + st(0.55 * sub) + st(0.12 * bite / peak(bite))
    room = pedal(out, pb.Reverb(room_size=0.5, damping=0.5, wet_level=1.0, dry_level=0.0, width=1.0))[:, :n]
    return fade_out(out + 0.2 * room, 0.2), 0.0


@designed('slam')
def snd_slam(c: Ctx):
    """The card slam: sub sine 55 -> 38 Hz over 400 ms, a short low-passed noise transient and a
    tight saturated thud (its harmonics are what a phone speaker plays)."""
    n = ns(0.75)
    t = tax(n)
    sub = sat(osc_sine(38 + 17 * np.exp(-t / 0.12)) * attack(n, 0.001) * np.exp(-t / 0.16), 1.3)
    thud = sat(osc_sine(90 + 90 * np.exp(-t / 0.02)) * attack(n, 0.0006) * np.exp(-t / 0.05), 2.5)
    nz = hp(lp(noise(n, c.seed), 2800, 2), 90, 1) * attack(n, 0.0005) * np.exp(-t / 0.018)
    nz = nz / peak(nz)
    clk = hp(noise(n, c.seed + 1), 5000, 2) * np.exp(-t / 0.0008)
    clk = clk / peak(clk)
    body = st(0.6 * thud + 0.45 * nz + 0.1 * clk)
    room = pedal(body, pb.Reverb(room_size=0.25, damping=0.6, wet_level=1.0, dry_level=0.0, width=0.7))[:, :n]
    return fade_out(st(sub) + body + 0.1 * room, 0.1), 0.0


def riser_voice(c: Ctx, beats: float, big: bool):
    """Noise + pitched riser that peaks exactly `beats` later and stops there (the next event
    takes over). The big one adds an A-minor swell, a sub swell and a tremolo that speeds up
    from eighths to 32nds."""
    D = c.span(beats)
    n = ns(D)
    t = tax(n)
    u = t / D
    out = np.zeros((2, n))
    # noise bed: band-pass sweeping 250 Hz -> 9 kHz, decorrelated L/R
    fc = 250 * (9000 / 250) ** (u ** 1.25)
    for ch in range(2):
        out[ch] += svf(noise(n, c.seed + ch), fc, 1.4, 'bp') * u ** 2.2
        out[ch] += 0.35 * hp(noise(n, c.seed + 10 + ch), 6500, 2) * u ** 3.2
    # pitched sweep: detuned saws two octaves up, filter opening
    fs = note('A2') * 4 ** (u ** 1.15)
    saw = st(osc_saw(fs * cents(-12)), -0.5) + st(osc_saw(fs * cents(12), 0.37), 0.5)
    saw = svf(saw, 500 * (6000 / 500) ** u, 0.9, 'lp') * u ** 2.4
    out += 0.3 * saw
    if big:
        swell = np.zeros((2, n))
        rng = np.random.default_rng(c.seed + 3)
        for i, v in enumerate(['A2', 'E3', 'A3', 'C4', 'E4']):
            for det, pan in [(-8, -0.7), (8, 0.7)]:
                swell += st(osc_saw(const(n, note(v) * cents(det + rng.uniform(-3, 3))), rng.uniform()), pan)
        swell = svf(swell, 250 * (3800 / 250) ** (u ** 1.4), 0.8, 'lp') * u ** 1.8
        out += 0.22 * swell / max(peak(swell), 1e-9) * peak(out)
        sub = osc_sine(const(n, note('A1'))) * u ** 2.6
        out += st(0.45 * sub)
        shep = osc_sine(note('A3') * 2 ** (u ** 1.2)) * u ** 2.0
        out += st(0.12 * shep)
        rate = 140 / 60 * (2 + 6 * u ** 1.5)          # eighths -> 32nds at 140 BPM
        trem = 1 - 0.28 * (0.5 + 0.5 * np.cos(2 * np.pi * np.cumsum(rate) / SR)) * u
        out *= trem
    return fade_out(out, 0.003), 0.0


@designed('sonic')
def snd_sonic(c: Ctx):
    """THE SIGNATURE: ping on the cue beat, BOOM on the frame two beats later."""
    return sonic_logo(c.span(2), c.seed), 0.0


def sonic_logo(boom_at: float, seed: int, length: float | None = None) -> np.ndarray:
    ping = ping_voice(seed, 1.2)
    boom = boom_voice(seed + 1, f0=60.0, f1=35.0, glide=0.28, sub_tau=0.42, size=1.0, crack=0.8,
                      tonal=True, length=2.6, room=0.34)
    total = ns(boom_at) + boom.shape[1] if length is None else ns(length)
    out = np.zeros((2, total))
    k = min(ping.shape[1], total)
    out[:, :k] += 1.25 * ping[:, :k]   # the ping ~3 LU under the BOOM
    b0 = ns(boom_at)
    k = min(boom.shape[1], total - b0)
    out[:, b0:b0 + k] += boom[:, :k]
    return out


@designed('ping')
def snd_ping(c: Ctx):
    return ping_voice(c.seed, 1.2), 0.0


@designed('boom')
def snd_boom(c: Ctx):
    """Big sub boom / impact, no ping, no pitch (sits under any chord of the track)."""
    return boom_voice(c.seed, f0=64.0, f1=31.0, glide=0.34, sub_tau=0.6, size=1.25, crack=1.0,
                      length=2.8, room=0.32), 0.0


@designed('whoosh')
def snd_whoosh(c: Ctx):
    """Whip whoosh: band-pass noise sweep up then down, peaking ON the cue (150 ms lead), panned
    across; alternate whooshes in a run pan the other way."""
    lead, n = 0.15, ns(0.29)
    t = tax(n)
    u = t / lead
    env = np.where(t < lead, np.clip(u, 0, 1) ** 2.4, np.exp(-(t - lead) / 0.045))
    fc = np.where(t < lead, 450 * (3200 / 450) ** np.clip(u, 0, 1), 3200 * np.exp(-(t - lead) / 0.08) + 900)
    body = svf(noise(n, c.seed), fc, 1.3, 'bp')
    air = hp(noise(n, c.seed + 1), 4500, 2) * 0.25
    mono = (body + air) * env
    d = 1 if c.run_index % 2 == 0 else -1
    pan = d * np.clip(-0.7 + 1.4 * t / 0.25, -0.7, 0.7)
    return fade_out(st_moving(mono, pan), 0.02), lead


@designed('metal')
def snd_metal(c: Ctx):
    """Short metallic tick, inharmonic partials 2-8 kHz; climbs a semitone per tick in a run."""
    n = ns(0.1)
    t = tax(n)
    base = 2050 * 2 ** (c.run_index / 12)
    rng = np.random.default_rng(c.seed)
    x = np.zeros(n)
    for r, tau, a in [(1.0, 0.028, 1.0), (1.483, 0.022, 0.7), (1.932, 0.018, 0.55), (2.546, 0.014, 0.4), (2.99, 0.011, 0.3)]:
        x += a * np.sin(2 * np.pi * base * r * t + rng.uniform(0, 2 * np.pi)) * np.exp(-t / tau)
    x *= attack(n, 0.0003)
    clk = hp(noise(n, c.seed + 1), 4000, 2) * np.exp(-t / 0.001)
    x = x / peak(x) + 0.3 * clk / peak(clk)
    pan = 0.25 if c.run_index % 2 else -0.25
    out = st(x, pan)
    room = pedal(out, pb.Reverb(room_size=0.3, damping=0.4, wet_level=1.0, dry_level=0.0, width=1.0))[:, :n]
    return fade_out(out + 0.12 * room, 0.02), 0.0


@designed('lock')
def snd_lock(c: Ctx):
    """Mechanical lock-on: a click, a short low clunk 12 ms later, a tiny high sparkle (E7 A7 E8)."""
    n = ns(0.45)
    t = tax(n)
    click = hp(noise(n, c.seed), 3000, 2) * np.exp(-t / 0.0012)
    click /= peak(click)
    td = np.maximum(t - 0.012, 0)
    gate = (t >= 0.012).astype(float)
    clunk = sat(osc_sine(85 + 60 * np.exp(-td / 0.02)) * np.exp(-td / 0.045) * gate, 2.0)
    mech = bp(noise(n, c.seed + 1), 250, 1400) * np.exp(-td / 0.02) * gate
    mech /= peak(mech)
    ts = np.maximum(t - 0.022, 0)
    gs = (t >= 0.022).astype(float) * attack(n, 0.023)
    spark = np.zeros((2, n))
    for f, a, pan in [(note('E7'), 0.5, -0.3), (note('A7'), 0.35, 0.3), (note('E8'), 0.2, 0.0)]:
        spark += st(a * np.sin(2 * np.pi * f * ts) * np.exp(-ts / 0.09) * gs, pan)
    spark = spark + 0.4 * pedal(spark, pb.Reverb(room_size=0.4, damping=0.3, wet_level=1.0, dry_level=0.0))[:, :n]
    out = st(0.5 * click + 1.0 * clunk + 0.4 * mech) + 0.28 * spark
    return fade_out(out, 0.05), 0.0


@designed('stamp')
def snd_stamp(c: Ctx):
    """Paper/ink stamp: short, dry, low-mid thud + paper slap."""
    n = ns(0.2)
    t = tax(n)
    thud = sat(osc_sine(95 + 70 * np.exp(-t / 0.018)) * attack(n, 0.0005) * np.exp(-t / 0.035), 2.2)
    body = bp(noise(n, c.seed), 180, 1600) * np.exp(-t / 0.022)
    slap = hp(noise(n, c.seed + 1), 2500, 2) * np.exp(-t / 0.004)
    x = thud + 0.5 * body / peak(body) + 0.22 * slap / peak(slap)
    pan = np.random.default_rng(c.seed).uniform(-0.12, 0.12)
    return fade_out(st(x, pan), 0.03), 0.0


@designed('tick')
def snd_tick(c: Ctx):
    """A very soft UI tick."""
    n = ns(0.05)
    t = tax(n)
    x = np.sin(2 * np.pi * 2200 * t) * attack(n, 0.0004) * np.exp(-t / 0.006)
    clk = hp(noise(n, c.seed), 5000, 2) * np.exp(-t / 0.0015)
    x = lp(x + 0.25 * clk / peak(clk), 9000, 2)
    return fade_out(st(x), 0.01), 0.0


@designed('pop')
def snd_pop(c: Ctx):
    """Soft UI pop for a facecam: a sine that bubbles up 300 -> 700 Hz, round attack, no edge."""
    n = ns(0.16)
    t = tax(n)
    f = 300 * (700 / 300) ** np.clip(t / 0.025, 0, 1)
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = (np.sin(ph) + 0.12 * np.sin(2 * ph)) * attack(n, 0.0025) * np.exp(-t / 0.028)
    x = lp(x, 2500, 2)
    pan = np.random.default_rng(c.seed).uniform(-0.25, 0.25)
    out = st(x, pan)
    room = pedal(out, pb.Reverb(room_size=0.2, damping=0.5, wet_level=1.0, dry_level=0.0))[:, :n]
    return fade_out(out + 0.1 * room, 0.03), 0.0


@designed('click')
def snd_click(c: Ctx):
    """ONE dry mechanical trigger click: a sharp transient, a small metal ring, a little body."""
    n = ns(0.07)
    t = tax(n)
    tr = hp(noise(n, c.seed), 1500, 2) * np.exp(-t / 0.0007)
    res = sum(a * np.sin(2 * np.pi * f * t + p) * np.exp(-t / tau)
              for f, tau, a, p in [(3150, 0.007, 1.0, 0.3), (4730, 0.005, 0.6, 1.2), (6920, 0.004, 0.35, 2.0), (2210, 0.009, 0.5, 0.7)])
    body = np.sin(2 * np.pi * 230 * t) * np.exp(-t / 0.010)
    x = 0.8 * tr / peak(tr) + 0.45 * res / peak(res) + 0.35 * body
    return fade_out(st(x * attack(n, 0.0002)), 0.01), 0.0


@designed('wipe')
def snd_wipe(c: Ctx):
    """The grid wipe: 13 tiny ticks over ~300 ms, cells landing like shots across the frame."""
    n = ns(0.45)
    rng = np.random.default_rng(c.seed)
    count = 13
    times = 0.3 * (np.arange(count) / (count - 1)) ** 0.9 + np.r_[0, rng.uniform(-0.006, 0.006, count - 1)]
    out = np.zeros((2, n))
    for i, t0 in enumerate(np.clip(times, 0, None)):
        m = ns(0.05)
        t = tax(m)
        fc = rng.uniform(1300, 4200)
        tick = bp(noise(m, c.seed + 100 + i), fc / 1.6, min(fc * 1.6, 20000)) * np.exp(-t / 0.006)
        tick /= peak(tick)
        blip = np.sin(2 * np.pi * rng.uniform(700, 1400) * t) * np.exp(-t / 0.01) * 0.4
        low = np.sin(2 * np.pi * 180 * t) * np.exp(-t / 0.008) * 0.35
        g = rng.uniform(0.7, 1.0) * (0.75 + 0.25 * math.sin(math.pi * i / (count - 1)))
        pan = rng.uniform(-0.7, 0.7) * (0.4 + 0.6 * i / (count - 1))
        s = ns(t0)
        out[:, s:s + m] += st((tick + blip + low) * g * attack(m, 0.0003), pan)[:, :max(0, n - s)]
    return fade_out(out, 0.05), 0.0


@designed('sweep')
def snd_sweep(c: Ctx):
    """Shimmering airy sweep, one beat, panned L -> R with the light across the logo."""
    D = c.span(1)
    n = ns(D + 0.5)
    t = tax(n)
    u = np.clip(t / D, 0, 1)
    env = np.where(t < D, np.sin(np.pi * u) ** 1.5, 0.0)
    air = svf(noise(n, c.seed), 2500 * (11000 / 2500) ** u, 2.0, 'bp') + 0.3 * hp(noise(n, c.seed + 1), 7000, 2)
    rng = np.random.default_rng(c.seed)
    sh = np.zeros(n)
    for f in [note('A6'), note('E7'), note('A7'), note('C8'), note('E8')]:
        am = 0.55 + 0.45 * np.sin(2 * np.pi * rng.uniform(18, 31) * t + rng.uniform(0, 6.28))
        sh += np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * am
    mono = (air / peak(air) + 0.35 * sh / peak(sh)) * env
    out = st_moving(mono, -0.8 + 1.6 * u)
    room = pedal(out, pb.Reverb(room_size=0.7, damping=0.3, wet_level=1.0, dry_level=0.0, width=1.0))[:, :n]
    return fade_out(out + 0.35 * room, 0.2), 0.0


@designed('landing')
def snd_landing(c: Ctx):
    """The swarm lands: a warm boom + a soft, wide A-minor bloom (filtered, no edge), ~2 s tail."""
    boom = boom_voice(c.seed, f0=60.0, f1=33.0, glide=0.3, sub_tau=0.55, size=1.1, crack=0.35, length=2.8, room=0.35)
    n = boom.shape[1]
    t = tax(n)
    rng = np.random.default_rng(c.seed + 5)
    chord = np.zeros((2, n))
    for v in ['A2', 'E3', 'A3', 'C4', 'E4', 'A4']:
        for det, pan in [(-7, -0.8), (0, 0.0), (7, 0.8)]:
            fr = note(v) * cents(det + rng.uniform(-2, 2))
            chord += st(0.6 * osc_saw(const(n, fr), rng.uniform()) + 0.5 * osc_sine(const(n, fr), rng.uniform(0, 6)), pan)
    chord = svf(chord, 700 + 1300 * np.exp(-t / 0.6), 0.7, 'lp')
    env = (1 - np.exp(-t / 0.03)) * (0.45 + 0.55 * np.exp(-t / 0.35)) * np.exp(-t / 1.1)
    chord = chord * env
    chord = pedal(chord, pb.Chorus(rate_hz=0.4, depth=0.2, centre_delay_ms=9, mix=0.4),
                  pb.Reverb(room_size=0.85, damping=0.55, wet_level=0.45, dry_level=0.8, width=1.0))[:, :n]
    out = boom / peak(boom) + 0.55 * chord / peak(chord)
    return fade_out(out, 0.4), 0.0


@designed('pad')
def snd_pad(c: Ctx):
    """Warm A-minor add9 pad, swelling in over one beat and sustaining to the last frame."""
    D = c.to_end()
    n = ns(D)
    t = tax(n)
    rng = np.random.default_rng(c.seed)
    out = np.zeros((2, n))
    for v, a in [('A2', 1.0), ('E3', 0.8), ('C4', 0.7), ('E4', 0.55), ('B4', 0.3)]:
        for det, pan in [(-6, -0.75), (6, 0.75)]:
            fr = note(v) * cents(det + rng.uniform(-2, 2))
            out += st(a * (0.5 * osc_saw(const(n, fr), rng.uniform()) + 0.6 * osc_sine(const(n, fr), rng.uniform(0, 6))), pan)
    out = svf(out, 820 + 180 * np.sin(2 * np.pi * 0.15 * t), 0.7, 'lp')
    u = np.clip(t / BEAT, 0, 1)
    out *= 0.5 - 0.5 * np.cos(np.pi * u)
    out = pedal(out, pb.Chorus(rate_hz=0.25, depth=0.25, centre_delay_ms=12, mix=0.5),
                pb.Reverb(room_size=0.8, damping=0.6, wet_level=0.3, dry_level=0.85, width=1.0))[:, :n]
    return out, 0.0


@designed('soft')
def snd_soft(c: Ctx):
    """Soft, warm low hit (the badge settles): a round thump with a whisper of A2/E3."""
    n = ns(0.9)
    t = tax(n)
    thump = osc_sine(65 + 35 * np.exp(-t / 0.06)) * attack(n, 0.005) * np.exp(-t / 0.13)
    felt = lp(noise(n, c.seed), 500, 2) * attack(n, 0.002) * np.exp(-t / 0.03)
    tone = (np.sin(2 * np.pi * note('A2') * t) + 0.6 * np.sin(2 * np.pi * note('E3') * t)) * attack(n, 0.006) * np.exp(-t / 0.25)
    x = thump + 0.3 * felt / peak(felt) + 0.22 * tone
    out = st(x)
    room = pedal(out, pb.Reverb(room_size=0.6, damping=0.7, wet_level=1.0, dry_level=0.0, width=1.0))[:, :n]
    return fade_out(out + 0.2 * room, 0.2), 0.0


def designed_sound(name: str, c: Ctx):
    m = re.fullmatch(r'riser(\d+(?:\.\d+)?)', name)
    if m:
        beats = float(m.group(1))
        return riser_voice(c, beats, big=beats >= 8)
    return DESIGNED[name](c)


# ─────────────────────────────────────────────────────────────── game effects ──

IMPACT_LEADS = {'bomb_drop'}      # whistles: their impact goes on the next explosion/boom cue
SUSTAINED = {'plane_down'}         # abrupt sustained blocks: a softer 12 ms fade-in
_decoded: dict[str, np.ndarray] = {}


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '2',
                          '-af', f'aresample={SR}:resampler=soxr:precision=28', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.astype(np.float64)


def game_file(name: str) -> Path | None:
    for ext in ('mp3', 'wav', 'ogg', 'm4a'):
        p = SFX_DIR / f'{name}.{ext}'
        if p.exists():
            return p
    return None


def game_sound(name: str):
    """Returns (buffer, onset sample, impact sample). Onset = the attack start (first sample
    above -30 dB re peak), impact = the loudest 5 ms (used only for IMPACT_LEADS)."""
    if name not in _decoded:
        _decoded[name] = normalise(decode(game_file(name)))
    x = _decoded[name]
    m = np.max(np.abs(x), axis=0)
    pk = m.max()
    onset = int(np.argmax(m > pk * db(-30)))
    last = len(m) - int(np.argmax(m[::-1] > pk * db(-45)))
    env = np.convolve(m, np.ones(240) / 240, mode='same')
    impact = int(np.argmax(env))
    return x, onset, impact, last


def place_game(name: str, beat: float, cues: list[dict]) -> tuple[np.ndarray, int, str]:
    """Buffer + the sample (in the buffer) that lands on the returned film sample."""
    x, onset, impact, last = game_sound(name)
    pre = min(onset, ns(0.001))
    if name in IMPACT_LEADS:
        nxt = [q for q in cues if q['sfx'] in ('explosion', 'boom', 'nuke') and beat < q['beat'] <= beat + 4]
        if nxt:
            target = min(q['beat'] for q in nxt)
            end = min(x.shape[1], impact + ns(0.012))
            y = fade_out(x[:, onset - pre:end], 0.012)
            y[:, :pre] *= attack(pre, pre / SR)[None, :] if pre else 1
            return y, impact - (onset - pre), fsamp(target), f'impact +{impact / SR:.3f}s on beat {target:g}'
    y = x[:, onset - pre:last].copy()
    fade_in = ns(0.012) if name in SUSTAINED else pre
    if fade_in:
        y[:, :fade_in] *= attack(fade_in, fade_in / SR)[None, :]
    y = fade_out(y, 0.03 if name in SUSTAINED else 0.015)
    return y, pre, fsamp(beat), f'attack +{onset / SR:.3f}s on frame'


# ───────────────────────────────────────────────────────────────── the music ──

def onset_near(src: np.ndarray, t_nominal: float, window: float = 0.03) -> float | None:
    """The attack of the hit nearest `t_nominal` (+-window), or None when there is no clean one.
    Detected on the low band (< 200 Hz, zero-phase, 1 ms envelope) because a drop is a kick/bass
    attack; 'clean' = the 20 ms before it sit >= 20 dB under the hit, so a busy bar is never
    mistaken for an attack (build_music then uses the median shift of the clean ones)."""
    a = max(0, ns(t_nominal - 0.12))
    b = min(src.shape[1], ns(t_nominal + 0.15))
    low = ss.sosfiltfilt(_sos('lowpass', 200, 4), src[:, a:b].mean(axis=0))
    hop = ns(0.001)
    m = np.abs(low[: len(low) // hop * hop]).reshape(-1, hop).max(axis=1)
    e = 20 * np.log10(m + 1e-12)
    t = (a + np.arange(len(e)) * hop) / SR
    near = (t >= t_nominal - window) & (t <= t_nominal + window + 0.06)
    ref = e[near].max()
    for i in np.flatnonzero((t >= t_nominal - window) & (t <= t_nominal + window)):
        if e[i] < ref - 12:
            continue
        before = e[max(0, i - 28):max(0, i - 8)]
        if not len(before) or before.max() > ref - 20:
            return None
        j = i
        while j > 0 and i - j < 8 and e[j - 1] > ref - 40:
            j -= 1
        return float(t[j])
    return None


def build_music() -> tuple[np.ndarray, list[dict]]:
    src = decode((ROOT / MUSIC['file']).resolve())
    edit = sorted(TL['MUSIC_EDIT'], key=lambda e: e['from'])
    out = np.zeros((2, N))
    rows = []
    PRE, XF, OUT_FADE, GUARD = ns(0.004), ns(0.010), ns(0.012), ns(0.005)
    nominals = [MUSIC['anchor'] + e['track'] * BEAT for e in edit]
    found = [onset_near(src, t) if fsamp(e['from']) > 0 else None for e, t in zip(edit, nominals)]
    shifts = [f - t for f, t in zip(found, nominals) if f is not None]
    typical = float(np.median(shifts)) if shifts else 0.0
    for i, e in enumerate(edit):
        prev = edit[i - 1] if i else None
        nxt = edit[i + 1] if i + 1 < len(edit) else None
        n0, n1 = fsamp(e['from']), min(N, fsamp(e['to']))
        nominal = nominals[i]
        if n0 == 0:
            s0, how = nominal, 'film start: nominal'
        elif found[i] is not None:
            s0, how = found[i], 'clean attack'
        else:
            s0, how = nominal + typical, 'no clean attack: median shift'
        joined_before = prev is not None and prev['to'] == e['from']
        lead = 0 if n0 == 0 else (XF if joined_before else PRE)
        joined_after = nxt is not None and nxt['from'] == e['to']
        a, b = n0 - lead, n1
        seg = np.zeros((2, b - a))
        s_a = ns(s0) - lead
        lo, hi = max(0, s_a), min(src.shape[1], s_a + (b - a))
        if hi > lo:
            seg[:, lo - s_a:hi - s_a] = src[:, lo:hi]
        g = np.ones(b - a)
        if n0 == 0:
            g[:GUARD] = attack(GUARD, GUARD / SR)[:GUARD]
        elif joined_before:
            g[:lead] = np.sin(np.pi / 2 * np.arange(lead) / lead)
        else:
            g[:lead] = attack(lead, lead / SR)
        if joined_after:
            g[-XF:] *= np.cos(np.pi / 2 * np.arange(1, XF + 1) / XF)
        elif n1 < N:
            g[-OUT_FADE:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(1, OUT_FADE + 1) / OUT_FADE)
        out[:, a:b] += seg * g
        rows.append(dict(e, frame_from=frame(e['from']), frame_to=frame(e['to']), sec_from=n0 / SR, sec_to=n1 / SR,
                         src_nominal=nominal, src_start=s0, src_end=s0 + (n1 - n0) / SR,
                         onset_shift_ms=(s0 - nominal) * 1000, onset_how=how, lead_ms=lead / SR * 1000))
    return out, rows


def gaps() -> list[tuple[float, float]]:
    edit = sorted(TL['MUSIC_EDIT'], key=lambda e: e['from'])
    return [(a['to'], b['from']) for a, b in zip(edit, edit[1:]) if b['from'] > a['to']]


def duck_env() -> np.ndarray:
    gdb = np.zeros(N)
    t = np.arange(N)
    ATT, REL = ns(0.040), ns(0.250)
    for d in TL['DUCKS']:
        a = fsamp(d['beat'])
        b = min(N, fsamp(d['beat'] + d['beats']))
        curve = np.zeros(N)
        curve[a:b] = 1.0
        k = min(ATT, b - a)
        curve[a:a + k] = np.linspace(0, 1, k, endpoint=False)
        r = min(REL, N - b)
        curve[b:b + r] = np.linspace(1, 0, r, endpoint=False)
        gdb = np.minimum(gdb, curve * d['db'])
    del t
    return 10 ** (gdb / 20)


def gate_env() -> np.ndarray:
    g = np.ones(N)
    DOWN, UP = ns(0.010), ns(0.004)
    for a_b, b_b in gaps():
        a, b = fsamp(a_b), fsamp(b_b)
        g[a - DOWN:a] = np.minimum(g[a - DOWN:a], 0.5 + 0.5 * np.cos(np.pi * np.arange(1, DOWN + 1) / DOWN))
        g[a:b - UP] = 0.0
        g[b - UP:b] = np.minimum(g[b - UP:b], attack(UP, UP / SR))
    return g


# ──────────────────────────────────────────────────────────────── loudness ──

_KB1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]
_KA1 = [1.0, -1.69065929318241, 0.73248077421585]
_KB2 = [1.0, -2.0, 1.0]
_KA2 = [1.0, -1.99004745483398, 0.99007225036621]


def kpower(x: np.ndarray) -> np.ndarray:
    """K-weighted power summed over channels, per sample (BS.1770, 48 kHz coefficients)."""
    z = ss.lfilter(_KB2, _KA2, ss.lfilter(_KB1, _KA1, x, axis=-1), axis=-1)
    return (z ** 2).sum(axis=0)


def block_loudness(p: np.ndarray, win: float, hop: float) -> tuple[np.ndarray, np.ndarray]:
    w, h = ns(win), ns(hop)
    c = np.concatenate([[0.0], np.cumsum(p)])
    starts = np.arange(0, max(1, len(p) - w + 1), h)
    ms = (c[starts + w] - c[starts]) / w
    return starts, ms


def integrated_lufs(x: np.ndarray) -> float:
    _, ms = block_loudness(kpower(x), 0.4, 0.1)
    lk = -0.691 + 10 * np.log10(np.maximum(ms, 1e-20))
    g1 = ms[lk > -70]
    if not len(g1):
        return -70.0
    rel = -0.691 + 10 * math.log10(g1.mean()) - 10
    g2 = ms[(lk > -70) & (lk > rel)]
    return -0.691 + 10 * math.log10(g2.mean())


def momentary(x: np.ndarray, t0: float, t1: float, win: float = 0.4) -> float:
    """Max momentary loudness (400 ms windows) inside [t0, t1]."""
    a, b = max(0, ns(t0)), min(x.shape[1], ns(t1) + ns(win))
    if b - a < ns(win):
        return -70.0
    _, ms = block_loudness(kpower(x[:, a:b]), win, 0.02)
    return float(-0.691 + 10 * np.log10(max(ms.max(), 1e-20)))


def rms_db(x: np.ndarray) -> float:
    return 20 * math.log10(max(math.sqrt(float(np.mean(x ** 2))) if x.size else 0.0, 1e-12))


# ──────────────────────────────────────────────────────────────────── the mix ──

def run_indices(cues: list[dict]) -> dict[int, int]:
    """Position of each cue within a run of the same sound (<= 1 beat apart)."""
    idx = {}
    by = {}
    for i, q in sorted(enumerate(cues), key=lambda iq: iq[1]['beat']):
        prev = by.get(q['sfx'])
        idx[i] = idx[prev[0]] + 1 if prev and q['beat'] - prev[1] <= 1.0 + 1e-9 else 0
        by[q['sfx']] = (i, q['beat'])
    return idx


def render_cues():
    cues = list(TL['CUES'])
    runs = run_indices(cues)
    gap_list = gaps()
    gated = np.zeros((2, N))
    ungated = np.zeros((2, N))
    rows = []
    stems = {}
    for i, q in enumerate(cues):
        name, beat = q['sfx'], q['beat']
        cue_db = q.get('db', 0.0)
        trim = TRIM_DB.get(name, 0.0) + CUE_TRIM_DB.get((name, beat), 0.0)
        ctx = Ctx(beat, seed_of(f'{name}@{beat}'), runs[i])
        if name in DESIGNED or re.fullmatch(r'riser\d+(?:\.\d+)?', name):
            buf, anchor_sec = designed_sound(name, ctx)
            buf = normalise(buf)
            anchor, at = ns(anchor_sec), fsamp(beat)
            how = f'anchor +{anchor_sec:.3f}s on frame' if anchor_sec else 'starts on frame'
            kind = 'designed'
        elif game_file(name):
            buf, anchor, at, how = place_game(name, beat, cues)
            kind = 'game'
        else:
            sys.exit(f"score: cue at beat {beat} names '{name}', which is neither a designed sound "
                     f"(scripts/score.py DESIGNED / riserN) nor a file in {SFX_DIR}")
        if DENSITY_DB.get(name):
            buf = normalise(pedal(buf, pb.BrickwallLimiter(ceiling_db=NORM_DB - DENSITY_DB[name], release_ms=60.0,
                                                           lookahead_ms=3.0)))
            how += f', density {DENSITY_DB[name]:g} dB'
        gain = cue_db + trim
        buf = buf * db(gain)
        if (name, beat) in CUE_TAIL:
            f0, fl = CUE_TAIL[(name, beat)]
            k0, kl = anchor + ns(f0), ns(fl)
            if k0 < buf.shape[1]:
                env = np.ones(buf.shape[1])
                seg = min(kl, buf.shape[1] - k0)
                env[k0:k0 + seg] = 0.5 + 0.5 * np.cos(np.pi * np.arange(seg) / kl)
                env[k0 + seg:] = 0.0
                buf = buf * env
                how += f', tail faded {f0:.2f}+{fl:.2f}s'
        start = at - anchor
        a, b = max(0, start), min(N, start + buf.shape[1])
        in_gap = any(fsamp(g0) <= at < fsamp(g1) for g0, g1 in gap_list)
        target = ungated if in_gap else gated
        # where the ear-proxy balance is measured (400 ms windows): the body of the sound
        if re.fullmatch(r'riser\d+(?:\.\d+)?', name):
            measure = [('peak', (start + buf.shape[1]) / SR - 0.45)]
        elif name == 'whoosh' or name in IMPACT_LEADS:
            measure = [('', start / SR)]
        elif name == 'pad':
            measure = [('', at / SR + BEAT)]
        elif name == 'sonic':
            measure = [('ping', at / SR), ('BOOM', fsec(beat + 2))]
        else:
            measure = [('', at / SR)]
        if b > a:
            target[:, a:b] += buf[:, a - start:b - start]
            stems[i] = (a, buf[:, a - start:b - start])
        rows.append(dict(beat=beat, frame=frame(beat), sec=at / SR, sfx=name, kind=kind, cue_db=cue_db, trim=trim,
                         gain=gain, how=how, note=q.get('note', ''), in_gap=in_gap, start_sec=start / SR,
                         len_sec=buf.shape[1] / SR, measure=measure))
    return gated, ungated, rows, stems


def master_chain(mix: np.ndarray, gain_db: float) -> np.ndarray:
    x = mix * db(gain_db)
    # gentle glue: ~1.5 dB on the track, 2-3 dB on the big hits (the limiter takes 2-3 dB more there)
    x = pedal(x, pb.Compressor(threshold_db=-10.0, ratio=1.6, attack_ms=30.0, release_ms=200.0))
    x = pedal(x, pb.BrickwallLimiter(ceiling_db=LIMIT_CEILING_DB, release_ms=90.0, lookahead_ms=5.0, true_peak=True))
    tp = true_peak_db(x)
    if tp > TP_MAX_DB - 0.05:
        x *= db(TP_MAX_DB - 0.05 - tp)
    k = ns(END_FADE_SEC)
    x[:, -k:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(1, k + 1) / k)
    x[:, -1] = 0.0
    return x


def main():
    print(f'score: {MUSIC["file"]} @ {MUSIC["bpm"]} BPM, anchor {MUSIC["anchor"]} s, {DURATION_FR} frames = {N / SR:.3f} s')
    music, edit_rows = build_music()
    music *= db(MUSIC_GAIN_DB) * duck_env()[None, :]
    gated, ungated, cue_rows, stems = render_cues()
    gate = gate_env()
    # 25 Hz high-pass BEFORE the gate (infrasonic energy only eats limiter headroom; an IIR after the
    # gate would ring into the silences). Compressor and limiter keep a digital zero a zero.
    pre = hp(music + gated, 25, 2) * gate[None, :] + ungated
    print(f'score: pre-master peak {20 * math.log10(peak(pre)):+.1f} dBFS (float, headroom is restored below)')

    gain = TARGET_LUFS - integrated_lufs(pre)
    for _ in range(6):
        out = master_chain(pre, gain)
        lufs = integrated_lufs(out)
        if abs(lufs - TARGET_LUFS) < 0.05:
            break
        gain += TARGET_LUFS - lufs
    # belt and braces: inside every gap, nothing but the sounds cued there
    keep = np.zeros(N, dtype=bool)
    for r in cue_rows:
        if r['in_gap']:
            keep[max(0, ns(r['start_sec'])):ns(r['start_sec'] + r['len_sec'])] = True
    for g0, g1 in gaps():
        a, b = fsamp(g0), fsamp(g1) - ns(0.004)
        out[:, a:b] *= keep[a:b]
    lufs = integrated_lufs(out)
    tp = true_peak_db(out)
    print(f'score: master gain {gain:+.2f} dB -> {lufs:.2f} LUFS integrated, true peak {tp:.2f} dBTP')

    # ── checks
    assert out.shape == (2, N), out.shape
    silent = []
    for g0, g1 in gaps():
        a, b = fsamp(g0) + ns(0.02), fsamp(g1) - ns(0.02)
        span = out[:, a:b].copy()
        for r in cue_rows:
            if r['in_gap'] and fsamp(g0) <= ns(r['sec']) < fsamp(g1):
                s = ns(r['start_sec']) - a
                span[:, max(0, s):max(0, s + ns(r['len_sec']) + ns(0.02))] = 0.0
        silent.append((g0, g1, rms_db(span), peak(span)))
    for g0, g1, r, p in silent:
        print(f'score: gap beats {g0:g}-{g1:g}: rms {r:.1f} dBFS, peak {p:.2e} (outside cued sounds)')

    # ── write
    (ROOT / 'public' / 'audio').mkdir(parents=True, exist_ok=True)
    (ROOT / 'out').mkdir(parents=True, exist_ok=True)
    (ROOT / 'build' / 'audio').mkdir(parents=True, exist_ok=True)
    wav = ROOT / 'public' / 'audio' / 'soundtrack.wav'
    sf.write(wav, np.clip(out, -1, 1 - 2 ** -23).T, SR, subtype='PCM_24')

    logo = sonic_logo(4 * BEAT / 2, seed_of('sonic-logo'), length=2.5)
    logo = fade_out(logo, 0.45)
    logo = logo * db(-1.0 - true_peak_db(logo))
    sf.write(ROOT / 'out' / 'sonic-logo.wav', np.clip(logo, -1, 1).T, SR, subtype='PCM_24')
    print(f'score: out/sonic-logo.wav {logo.shape[1] / SR:.3f} s, peak {20 * math.log10(peak(logo)):.2f} dBFS, '
          f'true peak {true_peak_db(logo):.2f} dBTP')

    balance = balance_table(music * gate[None, :], cue_rows, stems, out)
    big = {(name, b): momentary(out, fsec(b), fsec(b) + 1.5 * BEAT - 0.4) for name, b in BIG_MOMENTS}
    for (name, b), v in big.items():
        print(f'score: {name:<12} beat {b:>3}: {v:6.1f} LUFS momentary')
    write_cues(edit_rows, cue_rows, balance, gain, lufs, tp, silent, big)
    spectrogram(out, cue_rows)
    print(f'score: wrote {wav.relative_to(ROOT)}, out/sonic-logo.wav, build/audio/cues.txt, '
          f'build/audio/soundtrack_spectrogram.png')


def balance_table(music, cue_rows, stems, out):
    """Ear-proxy: max momentary loudness (400 ms) of each cue alone vs the (ducked, gated) music
    under it and the final mix, over windows starting in the first 50 ms of the cue's body."""
    res = {}
    for i, r in enumerate(cue_rows):
        if i not in stems:
            continue
        a, seg = stems[i]
        res[i] = []
        for label, t0 in r['measure']:
            t1 = t0 + 0.05
            lo, hi = max(0, ns(t0) - 1), min(N, ns(t1) + ns(0.5))
            local = np.zeros((2, hi - lo))
            s0, s1 = max(a, lo), min(a + seg.shape[1], hi)
            if s1 > s0:
                local[:, s0 - lo:s1 - lo] = seg[:, s0 - a:s1 - a]
            res[i].append((label, momentary(local, t0 - lo / SR, t1 - lo / SR), momentary(music, t0, t1),
                           momentary(out, t0, t1)))
    return res


BIG_MOMENTS = [('hook', 0), ('drop', 46), ('HIT (split)', 59), ('VICTORY', 66), ('landing', 91), ('end BOOM', 99)]


def write_cues(edit_rows, cue_rows, balance, gain, lufs, tp, silent, big):
    L = []
    L.append(f'Trailer45 score — {MUSIC["file"]}, {MUSIC["bpm"]} BPM, anchor {MUSIC["anchor"]} s, key {MUSIC["key"]}')
    L.append(f'{DURATION_FR} frames @ {FPS} fps = {N / SR:.3f} s = {N} samples @ {SR} Hz. Cue time = f(beat)/{FPS}.')
    L.append(f'Master: music {MUSIC_GAIN_DB:+.1f} dB, gain {gain:+.2f} dB -> {lufs:.2f} LUFS integrated (own BS.1770 meter), '
             f'true peak {tp:.2f} dBTP.')
    L.append('')
    L.append('MUSIC EDIT  (film beats [from,to) -> source seconds; onset = measured attack put on the frame)')
    L.append(f'{"beats":>9} {"frames":>11} {"film s":>17} {"track":>6} {"src nominal":>11} {"src start":>10} {"src end":>9} {"onset":>8}  note')
    for r in edit_rows:
        sh = f'{r["onset_shift_ms"]:+5.1f}ms'
        L.append(f'{r["from"]:>4}-{r["to"]:<4} {r["frame_from"]:>5}-{r["frame_to"]:<5} {r["sec_from"]:8.4f}-{r["sec_to"]:<8.4f} '
                 f'{r["track"]:>6} {r["src_nominal"]:11.4f} {r["src_start"]:10.4f} {r["src_end"]:9.4f} {sh:>8}  '
                 f'[{r["onset_how"]}] {r.get("note", "")}')
    L.append('')
    L.append('GAPS (digital silence; everything gated except sounds cued inside)')
    for g0, g1, r, p in silent:
        L.append(f'  beats {g0:g}-{g1:g}  frames {frame(g0)}-{frame(g1)}  {fsec(g0):.4f}-{fsec(g1):.4f} s   '
                 f'rms {r:.1f} dBFS  peak {p:.2e}')
    L.append('')
    L.append('DUCKS (music only; 40 ms down from the beat, hold, 250 ms up)')
    for d in TL['DUCKS']:
        L.append(f'  beat {d["beat"]:>5g} ({fsec(d["beat"]):7.4f} s) for {d["beats"]:g} beats: {d["db"]:+g} dB')
    L.append('')
    L.append('CUES  (gain = cue db + mixer trim, re the sound peak-normalised to -3 dBFS; '
             'LU: cue alone / music under it / final mix, max momentary in 400 ms from the cue)')
    L.append(f'{"beat":>6} {"frame":>5} {"seconds":>8}  {"sound":<11} {"cue":>5} {"trim":>5} {"gain":>5}  '
             f'{"cue LU":>6} {"music":>6} {"mix":>6}  placement / note')
    order = sorted(range(len(cue_rows)), key=lambda i: (cue_rows[i]['sec'], cue_rows[i]['sfx']))
    nan = float('nan')
    for i in order:
        r = cue_rows[i]
        ms = balance.get(i) or [('', nan, nan, nan)]
        label, s, m, o = ms[0]
        L.append(f'{r["beat"]:>6g} {r["frame"]:>5} {r["sec"]:8.4f}  {r["sfx"]:<11} {r["cue_db"]:+5.1f} {r["trim"]:+5.1f} {r["gain"]:+5.1f}  '
                 f'{s:6.1f} {m:6.1f} {o:6.1f}  {r["how"]}{" (in gap, not gated)" if r["in_gap"] else ""}'
                 f'{" — " + r["note"] if r["note"] else ""}{f" [LU at {label}]" if label else ""}')
        for label, s, m, o in ms[1:]:
            L.append(f'{"":>6} {"":>5} {"":>8}  {"  ↳ " + label:<11} {"":>5} {"":>5} {"":>5}  {s:6.1f} {m:6.1f} {o:6.1f}')
    L.append('')
    L.append('BIG MOMENTS  (final mix, max momentary loudness in the 1.5 beats from the hit)')
    for name, b in big:
        L.append(f'  {name:<12} beat {b:>3}  {big[(name, b)]:6.1f} LUFS')
    (ROOT / 'build' / 'audio' / 'cues.txt').write_text('\n'.join(L) + '\n')


def spectrogram(out, cue_rows):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import librosa
    y = out.mean(axis=0).astype(np.float32)
    hop = 256
    S = np.abs(librosa.stft(y, n_fft=4096, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=SR, n_fft=4096)
    logf = np.geomspace(25, 20000, 480)          # log-frequency rows, drawn with imshow (fast)
    S = np.stack([np.interp(logf, freqs, col) for col in S.T], axis=1)
    D = librosa.amplitude_to_db(S, ref=np.max)
    fig, (a0, a1) = plt.subplots(2, 1, figsize=(34, 11), gridspec_kw={'height_ratios': [1, 4]}, sharex=True)
    # short-term loudness strip (momentary, 400 ms)
    starts, ms = block_loudness(kpower(out), 0.4, 0.02)
    a0.plot((starts + ns(0.2)) / SR, -0.691 + 10 * np.log10(np.maximum(ms, 1e-20)), lw=0.8, color='k')
    a0.axhline(TARGET_LUFS, color='r', lw=0.6, ls='--')
    a0.set_ylim(-50, -2)
    a0.set_ylabel('momentary LUFS')
    a1.imshow(D, origin='lower', aspect='auto', cmap='magma', vmin=-80, vmax=0, interpolation='nearest',
              extent=[0, D.shape[1] * hop / SR, 0, len(logf)])
    ft = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
    a1.set_yticks([np.interp(math.log(f), np.log(logf), np.arange(len(logf))) for f in ft])
    a1.set_yticklabels([f'{f:g}' if f < 1000 else f'{f / 1000:g}k' for f in ft])
    a1.set_ylabel('Hz')
    for name, (b0, _b1) in TL['SECTIONS'].items():
        for ax in (a0, a1):
            ax.axvline(fsec(b0), color='w' if ax is a1 else '0.5', lw=0.7, ls='--', alpha=0.7)
        a0.text(fsec(b0) + 0.05, -6, name, fontsize=9, color='0.2')
    top = len(logf)
    for r in cue_rows:
        a1.plot([r['sec'], r['sec']], [top - 25, top], color='c', lw=1.0)
        a1.text(r['sec'], top - 30, r['sfx'], rotation=90, fontsize=6, color='c', va='top', ha='center')
    ticks = list(range(0, TL['TOTAL_BEATS'] + 1, 4))
    a1.set_xticks([fsec(b) for b in ticks])
    a1.set_xticklabels([f'{b}\n{fsec(b):.1f}s' for b in ticks], fontsize=8)
    a1.set_xlabel('film beat (frame-rounded) / seconds')
    a1.set_xlim(0, N / SR)
    fig.suptitle('Trailer45 soundtrack — cyan: cues, dashed: sections', fontsize=12)
    plt.tight_layout()
    plt.savefig(ROOT / 'build' / 'audio' / 'soundtrack_spectrogram.png', dpi=70)
    plt.close(fig)


if __name__ == '__main__':
    main()
