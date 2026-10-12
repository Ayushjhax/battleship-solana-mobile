"""Pre-master: gentle glue compression + a look-ahead peak limiter, so the mix can sit at
−14 LUFS integrated under a −1 dBTP ceiling without the final loudnorm pumping it.
The final two-pass ffmpeg loudnorm (tools/master.sh) runs on the rendered film's audio."""
import numpy as np
import pyloudnorm as pyln
from scipy.ndimage import minimum_filter1d
from scipy.signal import lfilter
import pedalboard as pb
from synth import SR, db, fx


def lookahead_limit(x, ceiling_db=-1.5, lookahead_ms=5.0, release_ms=120.0):
    ceil = db(ceiling_db)
    peak = np.abs(x).max(0)
    g = np.minimum(1.0, ceil / np.maximum(peak, 1e-9))
    la = max(1, int(lookahead_ms / 1000 * SR))
    g = minimum_filter1d(g, size=2 * la + 1, mode='nearest')  # reach the peak early
    # release smoothing (only lets gain rise slowly); attack is covered by the look-ahead
    rel = np.exp(-1 / (release_ms / 1000 * SR))
    out = np.empty_like(g)
    cur = 1.0
    for i in range(0, len(g), 64):  # block-wise to keep python fast; min within block
        blk = g[i:i + 64]
        m = blk.min()
        cur = m if m < cur else cur * rel ** 64 + m * (1 - rel ** 64)
        out[i:i + 64] = np.minimum(cur, blk)
    # smooth the block steps
    out = lfilter([0.02], [1, -0.98], out)
    out = np.minimum(out, g)
    return x * out


def master(x, target_lufs=-14.5, ceiling_db=-1.5):
    x = fx(x, pb.Compressor(threshold_db=-20, ratio=1.8, attack_ms=20, release_ms=220))
    meter = pyln.Meter(SR)
    for _ in range(3):  # gain + limit converges in a couple of passes
        L = meter.integrated_loudness(x.T)
        x = lookahead_limit(x * db(target_lufs - L), ceiling_db)
    return x, meter.integrated_loudness(x.T)
