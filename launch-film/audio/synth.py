"""Small synthesis toolkit for the score and the sound design (numpy + scipy + pedalboard)."""
import numpy as np
from scipy import signal
import soundfile as sf
import librosa
import pedalboard as pb

SR = 48000
GAME_SFX = '/home/user/battleship-solana-mobile/assets/audio/sfx/'


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def db(x):
    return 10 ** (x / 20)


def silence(sec):
    return np.zeros(int(round(sec * SR)))


def stereo(x, pan=0.0):
    """Mono → stereo with constant-power pan (-1 left … +1 right)."""
    a = (pan + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)])


def saw(freq, n, phase=0.0):
    """Band-limited sawtooth (polyBLEP). freq may be an array."""
    freq = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    dt = freq / SR
    ph = (phase + np.cumsum(dt)) % 1.0
    y = 2 * ph - 1
    # polyBLEP correction near the discontinuity
    m1 = ph < dt
    t = ph[m1] / dt[m1]
    y[m1] -= t + t - t * t - 1
    m2 = ph > 1 - dt
    t = (ph[m2] - 1) / dt[m2]
    y[m2] -= t * t + t + t + 1
    return y


def sine(freq, n, phase=0.0):
    freq = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    return np.sin(2 * np.pi * (phase + np.cumsum(freq / SR)))


def supersaw(freq, n, voices=5, detune_cents=9, seed=0):
    rng = np.random.default_rng(seed)
    out = np.zeros((2, n))
    for v in range(voices):
        c = (v - (voices - 1) / 2) / ((voices - 1) / 2 or 1) * detune_cents
        f = freq * 2 ** (c / 1200)
        pan = (v - (voices - 1) / 2) / ((voices - 1) / 2 or 1) * 0.7
        out += stereo(saw(f, n, rng.random()), pan)
    return out / voices


def adsr(n, a=0.01, d=0.1, s=0.7, r=0.2, hold=None):
    """Linear-ish ADSR over n samples; release happens at the end."""
    A, D, R = int(a * SR), int(d * SR), int(r * SR)
    env = np.full(n, s, dtype=float)
    A = min(A, n)
    env[:A] = np.linspace(0, 1, A, endpoint=False) if A else env[:A]
    D2 = min(D, max(0, n - A))
    if D2:
        env[A:A + D2] = np.linspace(1, s, D2, endpoint=False)
    R2 = min(R, n)
    if R2:
        env[n - R2:] *= np.linspace(1, 0, R2) ** 2
    return env


def exp_decay(n, tau):
    return np.exp(-np.arange(n) / (tau * SR))


def sweep_filter(x, cutoffs, kind='lowpass', q=0.707, block=256):
    """Time-varying 2nd-order filter: coefficients updated per block, state carried."""
    x = np.atleast_2d(x)
    ch, n = x.shape
    cutoffs = np.broadcast_to(np.asarray(cutoffs, dtype=float), (n,))
    y = np.zeros_like(x)
    zi = np.zeros((ch, 2))
    for s0 in range(0, n, block):
        s1 = min(n, s0 + block)
        fc = float(np.clip(cutoffs[(s0 + s1) // 2], 20, SR * 0.45))
        w0 = 2 * np.pi * fc / SR
        alpha = np.sin(w0) / (2 * q)
        cw = np.cos(w0)
        if kind == 'lowpass':
            b = np.array([(1 - cw) / 2, 1 - cw, (1 - cw) / 2])
        elif kind == 'highpass':
            b = np.array([(1 + cw) / 2, -(1 + cw), (1 + cw) / 2])
        else:  # bandpass (constant peak gain)
            b = np.array([alpha, 0, -alpha])
        a = np.array([1 + alpha, -2 * cw, 1 - alpha])
        b, a = b / a[0], a / a[0]
        for c in range(ch):
            y[c, s0:s1], zi[c] = signal.lfilter(b, a, x[c, s0:s1], zi=zi[c])
    return y


def static_filter(x, fc, kind='lowpass', order=2):
    sos = signal.butter(order, fc, btype=kind, fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=-1)


def fx(x, *plugins):
    """Run a stereo (2, n) array through pedalboard plugins."""
    x = np.atleast_2d(x).astype(np.float32)
    if x.shape[0] == 1:
        x = np.vstack([x, x])
    return pb.Pedalboard(list(plugins))(x, SR).astype(np.float64)


def load(name, sr=SR):
    y, _ = librosa.load(GAME_SFX + name, sr=sr, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])
    return y


def place(bus, x, t_sec, gain_db=0.0):
    """Add x (2, n) into bus (2, N) at t_sec. Negative starts are trimmed."""
    x = np.atleast_2d(x)
    if x.shape[0] == 1:
        x = np.vstack([x, x])
    s = int(round(t_sec * SR))
    if s < 0:
        x = x[:, -s:]
        s = 0
    e = min(bus.shape[1], s + x.shape[1])
    if e > s:
        bus[:, s:e] += x[:, : e - s] * db(gain_db)


def write(path, x, peak_db=None):
    x = np.atleast_2d(x)
    if peak_db is not None:
        pk = np.abs(x).max()
        if pk > 0:
            x = x / pk * db(peak_db)
    sf.write(path, x.T.astype(np.float32), SR, subtype='PCM_24')
