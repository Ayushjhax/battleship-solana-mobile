"""
Instruments for the trailer score (audio/score_trailer.py): hybrid trailer sound design built
from numpy + scipy + pedalboard, with the game's own explosion / nuke / mine recordings layered
into the impacts.

Everything returns stereo float arrays shaped (2, n) at synth.SR. Nothing here knows about the
film's timeline; score_trailer.py places the sounds on the beat grid.
"""
from functools import lru_cache

import numpy as np
from scipy import signal
import pedalboard as pb

from synth import SR, db, midi_hz, stereo, saw, sine, supersaw, adsr, sweep_filter, static_filter, fx, load, place


def rng(seed):
    return np.random.default_rng(seed)


def tt(n):
    return np.arange(n) / SR


def decay(n, tau):
    return np.exp(-np.arange(n) / (tau * SR))


def ns(sec):
    return int(round(sec * SR))


def square(freq, n, phase=0.0):
    """Band-limited square: the difference of two polyBLEP saws half a cycle apart."""
    return 0.5 * (saw(freq, n, phase) - saw(freq, n, (phase + 0.5) % 1.0))


def soft_clip(x, drive=1.0):
    return np.tanh(drive * x) / np.tanh(drive)


def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


# ── Reverb: convolution with a synthetic, frequency-dependent hall ────────────
def make_ir(seconds=3.5, rt60=(3.4, 2.8, 1.9, 1.0), predelay=0.02, seed=0, early=8):
    """Stereo IR: decorrelated noise in four bands, each with its own RT60 (highs die first),
    a soft diffuse build-up and a few early reflections. Energy-normalised."""
    n = ns(seconds)
    bands = [(None, 250), (250, 1500), (1500, 5000), (5000, None)]
    out = np.zeros((2, n))
    t = np.arange(n)
    for ch in range(2):
        noise = rng(seed * 11 + ch).standard_normal(n)
        y = np.zeros(n)
        for (lo, hi), rt in zip(bands, rt60):
            if lo is None:
                b = static_filter(noise, hi, 'lowpass', 4)
            elif hi is None:
                b = static_filter(noise, lo, 'highpass', 4)
            else:
                b = static_filter(noise, [lo, hi], 'bandpass', 3)
            y += b * np.exp(-6.91 * t / (rt * SR))
        y *= np.minimum(1, t / (0.04 * SR)) ** 1.5
        r = rng(seed * 13 + ch + 5)
        for k in range(early):
            d = int(r.uniform(0.006, 0.07) * SR)
            y[d] += r.uniform(0.6, 1.2) * (1 - k / early) * (1 if r.random() > 0.5 else -1) * 6
        out[ch] = y
    pd = ns(predelay)
    out = np.pad(out, ((0, 0), (pd, 0)))[:, :n]
    out /= np.sqrt((out ** 2).sum(axis=1)).max()
    return out


IR_HALL = make_ir(4.0, (3.6, 3.0, 2.1, 1.1), 0.025, seed=1)
IR_EPIC = make_ir(6.5, (6.0, 5.0, 3.4, 1.6), 0.035, seed=2)
IR_ROOM = make_ir(1.2, (1.0, 0.85, 0.6, 0.35), 0.008, seed=3)


def convolve(x, ir):
    return np.stack([signal.oaconvolve(x[c], ir[c])[: x.shape[1]] for c in range(2)])


def reverb(x, ir, wet_db=-6.0, dry=1.0, hp=None, lp=None):
    """x + its convolution with ir. hp/lp shape the send (dark reverbs read as bigger)."""
    send = x
    if hp:
        send = static_filter(send, hp, 'highpass')
    if lp:
        send = static_filter(send, lp, 'lowpass')
    return x * dry + convolve(send, ir) * db(wet_db)


def with_tail(x, seconds):
    return np.pad(x, ((0, 0), (0, ns(seconds))))


# ── Game recordings (cached) ──────────────────────────────────────────────────
@lru_cache(None)
def game(name):
    x = load(name)
    a = np.abs(x).max(0)
    i = int(np.argmax(a > a.max() * 0.05))
    x = x[:, i:]
    return x / (np.abs(x).max() + 1e-9)


# ── Drums ─────────────────────────────────────────────────────────────────────
@lru_cache(None)
def taiko(f0=58.0, tau=0.5, seed=0):
    """One big drum: a pitch-dropping membrane, two inharmonic modes, skin noise and stick slap."""
    n = ns(tau * 5 + 0.2)
    t = tt(n)
    f = f0 * (1 + 0.9 * np.exp(-t / 0.022))
    y = sine(f, n) * decay(n, tau)
    y += 0.32 * sine(f * 1.59, n) * decay(n, tau * 0.33)
    y += 0.16 * sine(f * 2.28, n) * decay(n, tau * 0.18)
    r = rng(seed)
    y += 0.8 * static_filter(r.standard_normal(n), [140, 1600], 'bandpass') * decay(n, 0.028)
    y += 0.35 * static_filter(r.standard_normal(n), 2500, 'highpass') * decay(n, 0.005)
    return soft_clip(y, 1.6)


@lru_cache(None)
def taiko_ens(f0=56.0, tau=0.55, voices=4, seed=0, spread=0.7):
    """An ensemble hit: several drums a few ms apart, spread across the field."""
    r = rng(seed + 100)
    out = np.zeros((2, ns(tau * 5 + 0.25)))
    for v in range(voices):
        fv = f0 * 2 ** (r.uniform(-0.7, 0.7) / 12)
        pan = ((v / max(1, voices - 1)) * 2 - 1) * spread
        place(out, stereo(taiko(round(fv, 1), round(tau * r.uniform(0.9, 1.1), 3), seed + v), pan), r.uniform(0, 0.014))
    return out / np.abs(out).max()


@lru_cache(None)
def kick(tune=46.0, tau=0.3, click=0.5):
    """Hybrid trailer kick: a 400→46 Hz pitch sweep with a click, driven."""
    n = ns(tau * 5)
    t = tt(n)
    f = tune + tune * 3.6 * np.exp(-t / 0.028) + 380 * np.exp(-t / 0.0025)
    y = sine(f, n) * decay(n, tau)
    y += click * static_filter(rng(4).standard_normal(n), 3500, 'highpass') * decay(n, 0.0018)
    return stereo(soft_clip(y, 2.2))


@lru_cache(None)
def snare(tone=190.0, tau=0.16, seed=0):
    n = ns(0.7)
    t = tt(n)
    r = rng(seed + 7)
    body = sine(tone * (1 + 0.35 * np.exp(-t / 0.01)), n) * decay(n, 0.055)
    noise = static_filter(r.standard_normal(n), [900, 10000], 'bandpass') * decay(n, tau)
    crack = static_filter(r.standard_normal(n), 3500, 'highpass') * decay(n, 0.008)
    return stereo(soft_clip(0.8 * body + noise + 0.6 * crack, 1.5))


@lru_cache(None)
def clap(seed=0):
    n = ns(0.5)
    out = np.zeros(n)
    r = rng(seed + 31)
    for k, d in enumerate((0, 0.010, 0.021, 0.033)):
        m = n - ns(d)
        tau = 0.0055 if k < 3 else 0.12
        b = static_filter(r.standard_normal(m), [850, 6000], 'bandpass') * decay(m, tau)
        out[ns(d):] += b
    l, rr = out, np.roll(out, 90)
    return np.stack([l, rr]) / np.abs(out).max()


@lru_cache(None)
def epic_snare(seed=0):
    """The backbeat of the drop: snare + clap + the game's explosion crack, in a tight room."""
    y = snare(205.0, 0.17, seed) * 0.9
    y = with_tail(y, 0.3)
    place(y, clap(seed) * 0.8, 0.002)
    e = static_filter(game('explosion.mp3'), 500, 'highpass')[:, : ns(0.4)] * decay(ns(0.4), 0.09)
    place(y, e * 0.55, 0)
    return y / np.abs(y).max()


HAT_FREQS = (205.3, 304.4, 369.6, 522.7, 540.0, 800.0)


@lru_cache(None)
def hat(tau=0.018, seed=0):
    n = ns(max(0.08, tau * 6))
    t = tt(n)
    metal = sum(np.sign(np.sin(2 * np.pi * f * 1.7 * t + k)) for k, f in enumerate(HAT_FREQS))
    y = static_filter(metal, [7000, 13000], 'bandpass', 3) * 0.6
    y += static_filter(rng(seed + 9).standard_normal(n), 8000, 'highpass') * 0.6
    y *= decay(n, tau)
    return stereo(y / np.abs(y).max(), 0.15)


@lru_cache(None)
def crash(tau=1.4, seed=0):
    n = ns(tau * 4)
    t = tt(n)
    metal = sum(np.sign(np.sin(2 * np.pi * f * 2.9 * t + k)) for k, f in enumerate(HAT_FREQS))
    r = rng(seed + 17)
    y = np.stack([
        static_filter(r.standard_normal(n), 3500, 'highpass') + 0.3 * static_filter(metal, 4000, 'highpass'),
        static_filter(r.standard_normal(n), 3500, 'highpass') + 0.3 * static_filter(np.roll(metal, 37), 4000, 'highpass'),
    ])
    y *= decay(n, tau) * (1 - np.exp(-t / 0.002))
    return y / np.abs(y).max()


@lru_cache(None)
def tick(pitch=3200.0, seed=0):
    """Clock tick: a click through a resonant band."""
    n = ns(0.06)
    x = rng(seed + 3).standard_normal(n) * decay(n, 0.0015)
    b, a = signal.iirpeak(pitch, 12, SR)
    y = signal.lfilter(b, a, x) + 0.3 * static_filter(x, 6000, 'highpass')
    return stereo(y / np.abs(y).max())


@lru_cache(None)
def heartbeat():
    """lub-dub: two low thumps."""
    out = np.zeros((2, ns(0.9)))
    for off, g in ((0.0, 1.0), (0.27, 0.6)):
        n = ns(0.35)
        t = tt(n)
        y = sine(38 + 34 * np.exp(-t / 0.03), n) * decay(n, 0.085)
        y += 0.2 * static_filter(rng(2).standard_normal(n), 300, 'lowpass') * decay(n, 0.02)
        place(out, stereo(soft_clip(y, 2.5)) * g, off)
    return out


# ── Bass ──────────────────────────────────────────────────────────────────────
@lru_cache(None)
def bass808(m, length, punch=True, drive=3.0):
    """808 with saturation: the harmonics carry it on phone speakers."""
    n = ns(length + 0.08)
    t = tt(n)
    f0 = midi_hz(m)
    f = f0 * (1 + (0.5 * np.exp(-t / 0.014) if punch else 0))
    y = sine(f, n)
    env = np.minimum(1, t / 0.002) * np.exp(-t / 1.6)
    env *= np.clip((n - np.arange(n)) / ns(0.06), 0, 1)
    y = soft_clip(y * env * drive, 1.0) * 0.8 + 0.2 * np.tanh(8 * y * env)
    y = static_filter(y, 1400, 'lowpass')
    return stereo(y)


def reese(m, length, cutoff=700.0, wobble=0.0, seed=0):
    """Detuned saw bass, low-passed and driven: the growl under the drop."""
    n = ns(length)
    f = midi_hz(m)
    r = rng(seed)
    y = saw(f * 2 ** (-11 / 1200), n, r.random()) + saw(f * 2 ** (11 / 1200), n, r.random()) + 0.6 * saw(f / 2, n, r.random())
    t = tt(n)
    cut = cutoff * (1 + wobble * 0.6 * np.sin(2 * np.pi * 4 * t - np.pi / 2))
    y = sweep_filter(y, cut, 'lowpass', q=1.4)[0]
    y *= adsr(n, a=0.01, d=0.1, s=0.9, r=0.08)
    return stereo(y)


# ── Tonal ─────────────────────────────────────────────────────────────────────
@lru_cache(None)
def spiccato(m, length=0.125, bright=0.6, seed=0):
    """A short bowed note for the ostinato: detuned saws, bow noise, fast decay."""
    n = ns(length + 0.12)
    f = midi_hz(m)
    r = rng(seed + int(m))
    y = sum(saw(f * 2 ** (c / 1200), n, r.random()) for c in (-7, 0, 6)) / 3
    t = tt(n)
    env = np.minimum(1, t / 0.004) * (0.25 + 0.75 * np.exp(-t / (length * 0.45)))
    env *= np.clip((n - np.arange(n)) / ns(0.1), 0, 1) ** 2
    y = y * env
    y += 0.06 * static_filter(r.standard_normal(n), [1800, 5000], 'bandpass') * decay(n, 0.02)
    y = static_filter(y, 500 + 3500 * bright, 'lowpass', 2)
    y = static_filter(y, 70, 'highpass', 2)
    return y


def pad(notes, length, bright=0.5, attack=0.4, release=1.2, voices=5, detune=10, seed=0):
    """Supersaw string-pad: slow bow, gentle vibrato, low-passed by brightness."""
    n = ns(length + release)
    t = tt(n)
    y = np.zeros((2, n))
    for i, m in enumerate(notes):
        vib = 1 + 0.0025 * np.sin(2 * np.pi * 5.2 * t + i) * smoothstep(t / 0.8)
        y += supersaw(midi_hz(m) * vib, n, voices=voices, detune_cents=detune, seed=seed + i * 7)
    y /= max(1, len(notes)) ** 0.7
    y = static_filter(y, 300 + 5000 * bright ** 1.5, 'lowpass', 2)
    y = static_filter(y, 90, 'highpass', 2)
    return y * adsr(n, a=attack, d=0.3, s=0.9, r=release)


# Formants (Hz, bandwidth Hz, gain dB) for an open "ah", per register.
FORMANTS = {
    'bass': [(600, 60, 0), (1040, 70, -7), (2250, 110, -9), (2450, 120, -9), (2750, 130, -20)],
    'tenor': [(650, 80, 0), (1080, 90, -6), (2650, 120, -7), (2900, 130, -8), (3250, 140, -22)],
    'alto': [(800, 80, 0), (1150, 90, -4), (2800, 120, -20), (3500, 130, -36), (4950, 140, -60)],
    'soprano': [(800, 80, 0), (1150, 90, -6), (2900, 120, -32), (3900, 130, -20), (4950, 140, -50)],
}


def _formant_bank(x, voice):
    out = np.zeros_like(x)
    for f, bw, g in FORMANTS[voice]:
        sos = signal.butter(2, [f - bw, f + bw], btype='bandpass', fs=SR, output='sos')
        out += signal.sosfilt(sos, x, axis=-1) * db(g)
    return out


def choir(notes, length, attack=0.5, release=1.5, singers=6, seed=0):
    """Synthetic 'aah' choir: per note a section of glottal-ish sources (vibrato, drift, breath)
    through the formants of the matching register."""
    n = ns(length + release)
    t = tt(n)
    out = np.zeros((2, n))
    for i, m in enumerate(notes):
        voice = 'bass' if m < 52 else 'tenor' if m < 60 else 'alto' if m < 67 else 'soprano'
        r = rng(seed + i * 19 + int(m))
        src = np.zeros((2, n))
        for s in range(singers):
            rate = r.uniform(4.8, 6.0)
            depth = r.uniform(0.004, 0.009)
            drift = np.cumsum(r.standard_normal(n // 4800 + 2))[np.arange(n) // 4800] * 0.0006
            vib = 1 + depth * np.sin(2 * np.pi * rate * t + r.uniform(0, 6.28)) * smoothstep(t / 0.6) + drift
            f = midi_hz(m) * 2 ** (r.uniform(-9, 9) / 1200) * vib
            g = static_filter(saw(f, n, r.random()), 2500, 'lowpass', 1)
            src += stereo(g, r.uniform(-0.8, 0.8))
        src += 0.03 * np.stack([rng(seed + 3).standard_normal(n), rng(seed + 4).standard_normal(n)])
        out += _formant_bank(src, voice) / singers ** 0.5
    out /= max(1, len(notes)) ** 0.6
    return out * adsr(n, a=attack, d=0.4, s=0.9, r=release)


def brass(m, length, dyn=0.8, voices=4, seed=0):
    """A horn section note: detuned saws, a brassy filter swell, delayed vibrato."""
    n = ns(length + 0.4)
    t = tt(n)
    f0 = midi_hz(m)
    r = rng(seed + int(m))
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.0 * t) * smoothstep((t - 0.35) / 0.5)
    y = np.zeros((2, n))
    for v in range(voices):
        y += stereo(saw(f0 * vib * 2 ** (r.uniform(-8, 8) / 1200), n, r.random()), r.uniform(-0.6, 0.6))
    y /= voices
    cut = f0 * (1.5 + 7 * dyn * (1 - np.exp(-t / 0.07)) * (0.75 + 0.25 * np.exp(-t / 0.6)))
    y = sweep_filter(y, np.minimum(cut, 6000), 'lowpass', q=0.9)
    return y * adsr(n, a=0.05, d=0.2, s=0.85, r=0.35)


@lru_cache(None)
def bell(m, tau=1.6):
    n = ns(tau * 5)
    f = midi_hz(m)
    y = sum(a * sine(f * p, n) * decay(n, tau * d) for p, a, d in ((1, 1, 1), (2.76, 0.4, 0.5), (5.4, 0.2, 0.3), (8.9, 0.08, 0.2)))
    y *= np.minimum(1, tt(n) / 0.003)
    return stereo(y / np.abs(y).max())


def drone(root, length, seed=0):
    """Low unease: a sub, two filtered saws a hair apart, air, and a faint high cluster."""
    n = ns(length)
    t = tt(n)
    f = midi_hz(root)
    y = stereo(0.35 * sine(f, n))
    r = rng(seed)
    s = saw(f * 2, n, r.random()) + saw(f * 2 * 2 ** (6 / 1200), n, r.random()) + 0.5 * saw(f * 3, n, r.random())
    lfo = 160 + 90 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.09 * t))
    y += 0.45 * sweep_filter(stereo(s), lfo, 'lowpass', q=1.2)
    air = np.stack([r.standard_normal(n), r.standard_normal(n)])
    y += 0.05 * sweep_filter(air, 500 + 300 * np.sin(2 * np.pi * 0.05 * t), 'bandpass', q=1.5)
    hi = sum(sine(midi_hz(root + 48 + k), n, r.random()) for k in (0, 1)) * 0.012 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.13 * t))
    y += stereo(hi)
    return y * np.clip((n - np.arange(n)) / ns(min(0.6, length / 4)), 0, 1)


# ── Hits and transitions ──────────────────────────────────────────────────────
def braam(notes, length=4.0, bright=1.0, bend=0.0, sub=True, seed=0):
    """Brass-and-synth BRAAM: low cluster of saws + squares, a brassy filter blat, driven, with a sub.
    bend (semitones) sags the pitch over the tail."""
    n = ns(length)
    t = tt(n)
    sag = 2 ** (bend * smoothstep((t - length * 0.35) / (length * 0.6)) / 12)
    y = np.zeros((2, n))
    for i, m in enumerate(notes):
        f = midi_hz(m) * sag
        y += supersaw(f, n, voices=5, detune_cents=16, seed=seed + i)
        y += 0.5 * stereo(square(f, n, 0.1 * i), 0.0)
    y /= len(notes) ** 0.6
    cut = 140 + 3400 * bright * (np.exp(-t / 0.9) - np.exp(-t / 0.035)) + 380 * bright
    y = sweep_filter(y, np.maximum(cut, 90), 'lowpass', q=1.6)
    y = fx(y, pb.Distortion(drive_db=16), pb.LowpassFilter(cutoff_frequency_hz=3800), pb.HighpassFilter(cutoff_frequency_hz=32))
    env = np.minimum(1, t / 0.018) * (0.55 + 0.45 * np.exp(-t / 0.5))
    env *= np.clip((length - t) / (length * 0.55), 0, 1) ** 1.5
    y *= env
    if sub:
        s = sine(midi_hz(min(notes)) * sag, n) * np.minimum(1, t / 0.01) * np.exp(-t / (length * 0.45))
        y += stereo(soft_clip(s * 1.5, 1.2)) * 0.5
    return y / np.abs(y).max()


def impact(size=1.0, seed=0, metal=True, game_layer='explosion.mp3'):
    """Trailer hit: sub sweep + drum ensemble + noise body + metallic clang + crash + a game recording."""
    n = ns(2.5 + 3 * size)
    t = tt(n)
    sub = sine(26 + 95 * np.exp(-t / 0.11), n) * np.exp(-t / (0.9 + 0.8 * size))
    y = stereo(soft_clip(sub * 1.6, 1.4))
    place(y, taiko_ens(48.0, 0.7, 4, seed) * 0.8, 0)
    r = rng(seed + 41)
    body = static_filter(np.stack([r.standard_normal(n), r.standard_normal(n)]), 2200, 'lowpass') * np.exp(-t / 0.22)
    y += 0.35 * body
    if metal:
        clang = sum(sine(f, n, r.random()) * np.exp(-t / d) for f, d in ((187, 1.1), (419, 0.9), (733, 0.7), (1039, 0.6), (1847, 0.45), (2731, 0.3), (3907, 0.22)))
        y += 0.08 * stereo(clang / 7)
    place(y, crash(1.2 + 0.6 * size, seed) * 0.22, 0)
    if game_layer:
        g = static_filter(game(game_layer), 3000, 'lowpass')
        place(y, g * 0.5, 0)
    y *= np.clip((n - np.arange(n)) / ns(0.4), 0, 1)
    return y / np.abs(y).max()


def sub_drop(length=2.5, f_hi=90.0, f_lo=28.0):
    n = ns(length)
    t = tt(n)
    f = f_lo + (f_hi - f_lo) * np.exp(-t / (length * 0.3))
    y = soft_clip(sine(f, n) * np.exp(-t / (length * 0.45)) * 1.4, 1.2)
    return stereo(y * np.clip((n - np.arange(n)) / (n * 0.3), 0, 1)) * 0.7


def noise_riser(length, top=9000.0, bottom=250.0, seed=0, curve=1.6):
    n = ns(length)
    r = rng(seed + 61)
    x = np.stack([r.standard_normal(n), r.standard_normal(n)])
    ramp = np.linspace(0, 1, n)
    y = sweep_filter(x, bottom * (top / bottom) ** (ramp ** curve), 'bandpass', q=1.8) * 2.5
    return y * ramp ** 2.4


def tone_riser(root, length, octaves=2.0, seed=0):
    """Pitch riser: a supersaw gliding up with an accelerating tremolo and an opening filter."""
    n = ns(length)
    t = tt(n)
    ramp = t / length
    f = midi_hz(root) * 2 ** (octaves * ramp ** 1.7)
    y = supersaw(f, n, voices=5, detune_cents=20, seed=seed)
    trem_rate = 4 + 20 * ramp ** 2
    trem = 0.6 + 0.4 * np.sin(2 * np.pi * np.cumsum(trem_rate) / SR)
    y = sweep_filter(y * trem, 400 + 7000 * ramp ** 2, 'lowpass', q=1.0)
    return y * ramp ** 2


def shepard(length, base=110.0, rate_oct=1.0, seed=0):
    """Endlessly rising Shepard tone over `length` s, rising `rate_oct` octaves per 4 s."""
    n = ns(length)
    t = tt(n)
    y = np.zeros(n)
    r = rng(seed)
    pos0 = rate_oct * t / 4
    for k in range(7):
        pos = (k + pos0) % 7  # octave position 0..7
        f = base / 4 * 2 ** pos
        amp = np.exp(-0.5 * ((pos - 3.5) / 1.3) ** 2)
        y += amp * np.sin(2 * np.pi * np.cumsum(f) / SR + r.random() * 6)
    y /= np.abs(y).max()
    return stereo(y * (t / length) ** 1.5)


def reverse_swell(notes, length=2.0, seed=0):
    """A chord through the epic hall, reversed: swells into the downbeat it ends on."""
    n = ns(length) + ns(2.5)
    y = sum(supersaw(midi_hz(m), n, voices=5, detune_cents=12, seed=seed + i) for i, m in enumerate(notes))
    y = static_filter(y, 2600, 'lowpass') * decay(n, 0.35)
    w = convolve(y, IR_EPIC)
    w = w[:, ::-1][:, -ns(length):]
    w *= np.linspace(0, 1, w.shape[1]) ** 2
    return w / np.abs(w).max()


def reverse_crash(length=1.5, seed=0):
    c = crash(length * 0.8, seed)[:, : ns(length)][:, ::-1]
    return c * np.linspace(0, 1, c.shape[1]) ** 1.5
