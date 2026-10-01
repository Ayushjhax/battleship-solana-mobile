#!/usr/bin/env python3
"""Deck30 — the score: the trailer's song cut to 30 s, designed sounds + game SFX, ducked and mastered.

`npm run deck30:score` (from launch-film/). Everything is read from src/deck30/timeline.ts through node
(the source of truth: MUSIC, MUSIC_EDIT, FILTERS, SUCKOUT, CUES, DUCKS, SECTIONS, DIVISIONS), and every
helper of the trailer's scripts/score.py is reused by importing it and pointing its globals at Deck30's grid
(scripts/score.py is never modified). Writes

  public/deck30/audio/soundtrack.wav             48 kHz, 24-bit stereo, exactly DURATION frames
  out/deck30/deck30-music.wav                    the music edit on its own (filters, suck-out, silence; no
                                                 ducks, no SFX), same length, ~-14 LUFS / <= -1 dBTP
  build/deck30/audio/cues.txt                    the edit, the music FX, every cue + balance, silences,
                                                 big moments, onset checks
  build/deck30/audio/soundtrack_spectrogram.png  loudness strip + spectrogram, sections and cues marked

Choices the timeline is silent on (change the comment when you change the rule):
  * Everything score.py says holds (cues on the FRAME of their beat, game SFX attack on the frame, designed
    sounds peak-normalised to -3 dBFS before the cue db, ducks 40 ms down / 250 ms up, gaps gated to digital
    silence, master: glue comp -> true-peak limiter -> <= -1 dBTP, gain iterated to -14 LUFS).
  * The pickup: the film-start segment is pinned by its first DOWNBEAT (film beat PICKUP), not by frame 0,
    so the drums entering under ALIVE attack on ALIVE's frame (score.py pins frame 0 nominally, which put
    them 11.7 ms early). The pickup before it is the intro pad; where it starts in the source is free.
  * Re-sync under the suck-out: the drop segment is split at the suck-out's end (film 45 = track 16) and
    track 16 is re-pinned to its frame by the segment-attack rule (it was 8.5 ms early: the source drifts
    ~1 ms per 16 beats against the frame grid). The music is at -18 dB / 250 Hz there, so the 8.5 ms slip
    is inaudible, and VICTORY's own downbeat lands on VICTORY's frame. Film [29,45) is still track 0..16,
    untouched. (Recommended for timeline.ts: an explicit {from: 45, to: 61, track: 16} row.)
  * FILTERS: zero-phase (filtfilt) Butterworth low-pass, 12 dB/oct, so filtered and dry are phase-identical
    in the passband and switching between them only adds/removes highs (no comb, no click). In: 30 ms raised
    cosine from the `from` frame. Out: a 1.5 ms snap that is fully open at the music's own attack on the
    `to` beat (measured, at most 15 ms before the frame; the frame when there is none). FILTER_MAKEUP_DB is
    added to the filter's `db` (see the mixer section for why).
  * SUCKOUT: over its beat the music runs through a per-sample TPT low-pass closing 16 kHz -> 250 Hz
    (exponential) and falls to -18 dB; it is back at full level, dry, at the next beat's attack. Every SFX
    cued BEFORE the suck-out that is still ringing is sucked out with it (-30 dB, then nothing from the
    next beat): only the `suck` inhale rises into VICTORY.
  * New designed sounds and where their anchor sits (the instant on the cue frame):
      swell       one beat, ENDS on its cue (it starts on frame 0 of the film; 5 ms fade-in guard)
      shatter     starts on its cue; ~0.75 s of glass grains spreading wide
      rush        starts on its cue; its glassy click lands on the frame 0.65 beat later (13.1 -> 13.75)
      collapse    starts on its cue; the pull-in lands (soft tick) on the frame half a beat later
      unfold      starts on its cue, ~0.4 s
      glass       on its cue, <= 120 ms
      dtick       on its cue; pitch climbs the A natural minor scale A4 -> G6 along the run (score.py
                  run_indices: the 14 FIRE locks are one run), so the roll ends on the leading tone and the
                  drop resolves it to A
      suck        starts on its cue and lasts exactly one beat: cut dead on the next beat's frame
      openwhoosh  starts on its cue, peaks on the frame one beat later, then opens out
      tile        on its cue; a rounder, softer tick
      step        on its cue; A4 C5 E5 A5 C6 by run index (the five DIVISIONS are one run)
      riser6      starts on its cue (55), steps up a note on every DIVISIONS beat (A3 C4 E4 A4 C5), then
                  rises smoothly to A5 and stops dead on the frame six beats later (61)
      scatter     starts on its cue, ~one beat of tiny ticks falling away and spreading out
  * Run overrides (RUN_OVERRIDE): the second REAL card's stab climbs (top voice C5), and the five flip
    whooshes alternate direction (they are two beats apart, so score.py's runs would pan them all one way).
  * The film ends on the sonic logo's tail: only the last 0.25 s is faded (END_FADE_SEC).
  * The silence [28,29) is written as exact zeros over the whole beat (the drop's 4 ms pre-roll is dropped;
    its attack starts with a 0.5 ms fade on the frame).
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
import pedalboard as pb
import scipy.signal as ss
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]          # launch-film/
sys.path.insert(0, str(ROOT / 'scripts'))
sys.dont_write_bytecode = True    # scripts/__pycache__/score.cpython-311.pyc is tracked: importing must not rewrite it
import score as S  # noqa: E402  — loads the TRAILER timeline into its globals; pointed at Deck30's below

from score import (SR, Ctx, attack, bp, cents, const, db, fade_out, frame, fsamp, fsec, hp, lp,  # noqa: E402
                   noise, note, ns, osc_saw, osc_sine, peak, pedal, st, st_moving, svf, tax)

OUT_WAV = ROOT / 'public' / 'deck30' / 'audio' / 'soundtrack.wav'
OUT_MUSIC = ROOT / 'out' / 'deck30' / 'deck30-music.wav'
BUILD = ROOT / 'build' / 'deck30' / 'audio'

# ───────────────────────────────────────────────────────────── Deck30's timeline ──

NODE_SNIPPET = r"""
import('./src/deck30/timeline.ts').then((m) => {
  const out = {};
  for (const [k, v] of Object.entries(m)) if (typeof v !== 'function') out[k] = v;
  const beats = new Set([0, m.TOTAL_BEATS]);
  for (const c of m.CUES) { beats.add(c.beat); for (const k of [0.5, 0.65, 1, 2, 6]) beats.add(c.beat + k); }
  for (const e of m.MUSIC_EDIT) { beats.add(e.from); beats.add(e.to); }
  for (const d of m.DUCKS) { beats.add(d.beat); beats.add(d.beat + d.beats); }
  for (const x of m.FILTERS) { beats.add(x.from); beats.add(x.to); }
  beats.add(m.SUCKOUT.beat); beats.add(m.SUCKOUT.beat + m.SUCKOUT.beats);
  for (const b of [...m.DIVISIONS, ...m.LOCKS, ...m.TILE_BEATS, ...Object.values(m.ANCHORS)]) beats.add(b);
  for (const [a, b] of Object.values(m.SECTIONS)) { beats.add(a); beats.add(b); }
  for (let b = 0; b <= m.TOTAL_BEATS; b++) beats.add(b);
  out.__frames = [...beats].map((b) => [b, m.f(b)]);
  console.log(JSON.stringify(out));
});
"""


def load_timeline() -> dict:
    r = subprocess.run(['node', '--experimental-strip-types', '--no-warnings', '-e', NODE_SNIPPET],
                       cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit('deck30 score: could not read src/deck30/timeline.ts through node\n' + r.stderr)
    return json.loads(r.stdout)


TL = load_timeline()
# Every score.py helper looks these up at call time, so this is all it takes to move it onto Deck30's grid.
S.TL = TL
S.FPS = FPS = TL['FPS']
S.BEAT = BEAT = TL['BEAT_SEC']
S.MUSIC = MUSIC = TL['MUSIC']
S.DURATION_FR = DURATION_FR = TL['DURATION']
if SR % FPS:
    sys.exit(f'deck30 score: {SR} Hz is not a whole number of samples per frame at {FPS} fps')
S.SPF = SPF = SR // FPS
S.N = N = DURATION_FR * SPF
PICKUP: int = TL['PICKUP']
SUCK = TL['SUCKOUT']
SUCK_END = SUCK['beat'] + SUCK['beats']

for _b, _fr in TL['__frames']:
    if frame(_b) != _fr:
        sys.exit(f'deck30 score: frame maths disagrees with timeline.ts at beat {_b}: {frame(_b)} vs {_fr}')

# ──────────────────────────────────────────────────────────────────── the mixer ──

S.END_FADE_SEC = 0.25        # the sonic logo's tail rings to the last frame; only this much is faded
MUSIC_GAIN_DB = S.MUSIC_GAIN_DB
TARGET_LUFS = S.TARGET_LUFS

FILTER_ORDER = 1             # x2 (filtfilt) = 12 dB/oct, zero phase: muffled, not gone
# Make-up on top of the filter's `db`: the breakdown under the bit has almost nothing below 360 Hz (< 150 Hz
# it measures -31 LUFS), so the low-pass alone took 13-22 dB off it and the "muffled pulse" measured -40 LUFS
# in the mix, a near-silence that stole from the real one at 28. With +8 dB (net +4 dB in the passband) the bed
# measures -28 to -33 LUFS momentary, ~15 LU under the strobe, and the ping sits ~18 LU above it.
FILTER_MAKEUP_DB = 8.0
FILTER_IN_SEC = 0.030
FILTER_SNAP_SEC = 0.0015
SUCK_HZ = (16000.0, 250.0)
SUCK_DB = -18.0              # music level by the end of the suck-out beat
SUCK_CURVE = 0.5             # dB fall ~ u^0.5 (-9 dB a quarter of the way in): the beat reads as sucked out
SUCK_SFX_DB = -30.0          # SFX tails ringing into the suck-out
RESYNC_AT_SUCKOUT = True

# Mixer's balance on top of each cue's db (dB): the trailer's values for the shared sounds, re-measured here
# against Deck30's music with the balance table in cues.txt.
S.TRIM_DB = {
    'stab': +4.5,        # REAL PLAYERS. lands on the drums at full tilt (track -30)
    'slam': +4.0,        # every text card lands above the track's drums
    'stamp': +4.0,
    'tick': +4.0,
    'whoosh': +3.0,      # the flips: a whoosh is 0.3 s, it reads ~6 LU under the music at +1
    'metal': +3.0,
    'pop': +4.0,
    'wipe': +4.0,
    'swell': +4.0,       # the breath in sits over the intro pad, not under it
    'collapse': +4.0,
    'tile': +5.0,        # soft, but a tick you hear
    'dtick': +2.0,
    'glass': +2.0,
    'step': -6.0,        # FM bell tones: peak-normalised they were louder than the drop (-9.5 LUFS)
    'scatter': +3.0,     # a cascade of tiny ticks: ~10 LU under the bed at the cue gain
    'suck': -3.0,        # the inhale rises into VICTORY, it is not a second hit
    'shot_fire': +3.0,
    'plane_down': -6.0,  # a 1.5 s sustained noise block
    'bomb_drop': -9.0,   # a pure 2-3.5 kHz whistle
    'ship_sink': -2.0,
    'sweep': -1.0,
    'pad': -2.0,
}
S.DENSITY_DB = {
    'nuke': 3.0,         # the drop's blast carries the moment: more loudness per dB of limiter headroom
    'victory': 4.0,
    'explosion': 4.0,
    'boom': 3.0,
    'slam': 3.0,
    'landing': 3.0,
}
S.CUE_TRIM_DB = {
    # The big hits are limiter-bound (each one's loudness caps near -10.4 LUFS momentary, whatever is stacked
    # on it), so the order VICTORY > drop > ALIVE is set by how dense each moment is, not by how much is in it.
    ('nuke', 1): -5.5,       # ALIVE is big, the drop is bigger
    ('explosion', 1): -5.0,
    ('boom', 1): -5.0,       # the boom carried ALIVE's loudness (-11.5 LU alone)
    ('slam', 17): +2.0,      # the flip labels land above the build
    ('slam', 19): +2.0,
    ('slam', 21): +2.0,
    ('slam', 23): +2.0,
    ('nuke', 29): +3.0,      # the drop: the game's blast and the boom carry it...
    ('boom', 29): +1.0,
    ('slam', 29): -6.0,      # ...the period's slam only adds peak there (its thud sat on both attacks)
    ('slam', 30): -2.0,      # HIT.: its thud sat on the explosion's attack (+5.3 dBFS pre-limiter)
    ('victory', 45): +5.0,   # VICTORY is the biggest hit of the film: the fanfare carries it...
    ('boom', 45): -3.0,      # ...and a smaller boom makes it BIGGER (its sub was pumping the limiter)
    ('slam', 45): -4.0,      # its sub lands on the boom's: keep the thud, lose the stack
    ('whoosh', 37.2): +2.0,  # the Bomber's release reads over the battle bed
    ('explosion', 40): -1.5,  # the last ship sits under the drop and VICTORY
    ('boom', 40): -1.0,
    ('landing', 61): +0.5,   # the lock stands over the mitosis steps, level with the logo BOOM
    ('sonic', 65): -3.0,     # the ending is calm: the signature, not a second landing
}
# Per-cue tail (fade start, fade length) in seconds after the cue frame.
S.CUE_TAIL = {
    ('nuke', 1): (0.55, 0.30),       # ALIVE must not rumble under REAL PLAYERS. two beats later
    ('explosion', 1): (0.45, 0.35),
    ('boom', 1): (0.55, 0.30),
    ('explosion', 8.5): (0.20, 0.15),  # the strobe's last hit is gone when the film goes black on 9
}
# Run index overrides, keyed (sfx, beat): see the header.
RUN_OVERRIDE = {('stab', 6): 1, ('whoosh', 19): 1, ('whoosh', 23): 1}

BIG_MOMENTS = [('ALIVE', 1), ('logo BOOM', 13), ('drop', 29), ('HIT.', 30), ('last ship', 40),
               ('VICTORY', 45), ('lock', 61), ('end ping', 65), ('end BOOM', 67)]
S.BIG_MOMENTS = BIG_MOMENTS

# ──────────────────────────────────────────────────────────────── designed sounds ──


def reg(name):
    def deco(fn):
        S.DESIGNED[name] = fn
        return fn
    return deco


def _with_runs(name, fn):
    def wrapped(c: Ctx):
        if (name, c.beat) in RUN_OVERRIDE:
            c.run_index = RUN_OVERRIDE[(name, c.beat)]
        return fn(c)
    return wrapped


for _name in {k for k, _ in RUN_OVERRIDE}:
    S.DESIGNED[_name] = _with_runs(_name, S.DESIGNED[_name])

_trailer_designed_sound = S.designed_sound


def designed_sound(name: str, c: Ctx):
    """Deck30's registry first (so `riser6` is the stepped riser, not score.py's riserN)."""
    if name in S.DESIGNED:
        return S.DESIGNED[name](c)
    return _trailer_designed_sound(name, c)


S.designed_sound = designed_sound


def release_at(n: int, k0: int, sec: float = 0.0015) -> np.ndarray:
    """1 up to sample k0 - sec, a raised-cosine release ending at k0, 0 after: a noise body that stops dead on
    a landing without its own click."""
    g = np.zeros(n)
    k = max(1, ns(sec))
    g[:max(0, k0 - k)] = 1.0
    g[max(0, k0 - k):k0] = 0.5 + 0.5 * np.cos(np.pi * np.arange(1, min(k, k0) + 1) / k)[-min(k, k0):]
    return g


def rev(x: np.ndarray) -> np.ndarray:
    return np.ascontiguousarray(x[..., ::-1])


def widen(l: np.ndarray, r: np.ndarray, width) -> np.ndarray:
    """Two decorrelated channels -> stereo with `width` (0 = mono centre, 1 = as is), per sample or scalar."""
    mid, side = 0.5 * (l + r), 0.5 * (l - r)
    return np.stack([mid + side * width, mid - side * width])


def glass_grain(f0: float, tau: float, m: int, rng, fmax: float = 9500.0) -> np.ndarray:
    """One glass grain: inharmonic plate partials (1, 2.32, 4.25, 6.63), the higher ones decaying faster."""
    t = tax(m)
    g = np.zeros(m)
    for r, a in ((1.0, 1.0), (2.32, 0.5), (4.25, 0.28), (6.63, 0.15)):
        f = f0 * r
        if f > fmax:
            continue
        g += a * np.sin(2 * np.pi * f * t + rng.uniform(0, 2 * np.pi)) * np.exp(-t / (tau / r ** 0.5))
    return g * attack(m, 0.0002)


def room(x: np.ndarray, size=0.4, damping=0.4, width=1.0) -> np.ndarray:
    return pedal(x, pb.Reverb(room_size=size, damping=damping, wet_level=1.0, dry_level=0.0, width=width))


@reg('swell')
def snd_swell(c: Ctx):
    """A breath in: the game's nuke, reverse-reverbed, + its own tail reversed, + rising air, swelling over
    one beat and ENDING on the cue frame (anchor = length). Dark -> open as it rises."""
    L = min(fsec(c.beat) - fsec(c.beat - 1), fsec(c.beat))     # one beat, never before frame 0
    n = ns(L)
    t = tax(n)
    u = t / L
    x, onset, impact, last = S.game_sound('nuke')
    # reverse reverb: the hit into a big dark hall (wet only), reversed, so the room builds INTO the hit
    hit = x[:, onset:onset + ns(0.7)]
    wet = pedal(hit, pb.Reverb(room_size=0.93, damping=0.55, wet_level=1.0, dry_level=0.0, width=1.0), tail=2.5)
    rv = rev(wet)[:, -n:]
    # the nuke's own tail reversed: crackle and rumble pulled back towards the hit
    tail = x[:, impact + ns(0.10): impact + ns(0.10) + n]
    tl = rev(tail)
    if tl.shape[1] < n:
        tl = np.concatenate([np.zeros((2, n - tl.shape[1])), tl], axis=1)
    air = widen(svf(noise(n, c.seed), 400 * (6000 / 400) ** u, 1.1, 'bp'),
                svf(noise(n, c.seed + 1), 400 * (6000 / 400) ** u, 1.1, 'bp'), 0.3 + 0.7 * u)
    out = rv / max(peak(rv), 1e-9) + 0.55 * tl / max(peak(tl), 1e-9) + 0.22 * air / peak(air)
    out = svf(out, 350 * (9000 / 350) ** (u ** 1.3), 0.7, 'lp')          # opens up as it rises
    out *= (u ** 2.2)[None, :]
    out *= attack(n, 0.005)[None, :]                                    # frame 0 never clicks
    return fade_out(out, 0.002), L


@reg('shatter')
def snd_shatter(c: Ctx):
    """Granular glass sweep: the logo blowing apart. ~260 glass grains (2-9 kHz partials), dense at the
    crack and thinning out, spreading from the centre to hard L/R; a crack, a widening spray and a bright room."""
    L = 0.75
    n = ns(L + 0.35)
    rng = np.random.default_rng(c.seed)
    out = np.zeros((2, n))
    count = 260
    times = np.sort(np.minimum(rng.exponential(0.16, count), L - 0.06))
    times[:6] = rng.uniform(0, 0.004, 6)
    for t0 in times:
        u = t0 / L
        tau = rng.uniform(0.006, 0.028)
        m = ns(tau * 6)
        gr = glass_grain(rng.uniform(2000, 4300) * (1 - 0.18 * u), tau, m, rng)
        g = rng.uniform(0.35, 1.0) * math.exp(-t0 / 0.24)
        spread = 0.15 + 0.85 * min(1.0, u * 2.5)
        pan = float(np.clip(rng.uniform(-1, 1) * spread * 1.1, -1, 1))
        s = ns(t0)
        k = min(m, n - s)
        out[:, s:s + k] += st(gr * g, pan)[:, :k]
    t = tax(n)
    crack = hp(noise(n, c.seed + 1), 2500, 2) * np.exp(-t / 0.004) * attack(n, 0.0003)
    spray = widen(bp(noise(n, c.seed + 2), 2500, 9000), bp(noise(n, c.seed + 3), 2500, 9000),
                  np.clip(t / 0.3, 0.1, 1.0))
    spray *= (attack(n, 0.002) * np.exp(-t / 0.11))[None, :]
    out = out / peak(out) + st(0.45 * crack / peak(crack)) + 0.3 * spray / peak(spray)
    out = out + 0.28 * room(out, 0.45, 0.2)
    return fade_out(out, 0.2), 0.0


@reg('rush')
def snd_rush(c: Ctx):
    """The scattered bits rushing back: grains converging from wide to the centre, denser and louder,
    over an inward noise swell, ending in a tiny glassy click on the frame 0.65 beat after the cue."""
    L = c.span(0.65)
    n = ns(L + 0.12)
    rng = np.random.default_rng(c.seed)
    out = np.zeros((2, n))
    count = 150
    times = np.clip(L - rng.exponential(0.09, count), 0, L - 0.004)
    for t0 in times:
        u = t0 / L
        tau = rng.uniform(0.004, 0.012)
        m = ns(tau * 6)
        gr = glass_grain(rng.uniform(1900, 3200) * (1 + 0.45 * u), tau, m, rng)
        g = 0.15 + 0.85 * u ** 2
        pan = float(np.clip(rng.uniform(-1, 1) * (1.0 - 0.9 * u), -1, 1))
        s = ns(t0)
        k = min(m, n - s)
        out[:, s:s + k] += st(gr * g, pan)[:, :k]
    t = tax(n)
    u = np.clip(t / L, 0, 1)
    on = release_at(n, ns(L))
    fc = 1500 * (7500 / 1500) ** u
    sw = widen(svf(noise(n, c.seed + 1), fc, 1.4, 'bp'), svf(noise(n, c.seed + 2), fc, 1.4, 'bp'), 1 - 0.9 * u)
    sw *= (u ** 2.5 * on)[None, :]
    out = out / peak(out) + 0.5 * sw / peak(sw)
    k0 = ns(L)
    m = n - k0
    click = glass_grain(note('E7'), 0.03, m, rng, fmax=14000) + hp(noise(m, c.seed + 3), 5000, 2) * np.exp(-tax(m) / 0.0005)
    out[:, k0:] += st(0.9 * click / peak(click))
    return fade_out(out, 0.03), 0.0


@reg('collapse')
def snd_collapse(c: Ctx):
    """The logo collapsing into a point: a reverse whoosh pulling inward (band sweeping down, stereo width
    closing to the centre) that lands with a soft tick on the frame half a beat after the cue."""
    L = c.span(0.5)
    n = ns(L + 0.09)
    t = tax(n)
    u = np.clip(t / L, 0, 1)
    on = release_at(n, ns(L))
    fc = 5200 * (750 / 5200) ** u
    body = widen(svf(noise(n, c.seed), fc, 1.2, 'bp'), svf(noise(n, c.seed + 1), fc, 1.2, 'bp'), 1.0 - u)
    low = lp(noise(n, c.seed + 2), 220, 2)
    pull = body / peak(body) + st(0.35 * low / peak(low))
    pull *= (u ** 2.6 * on)[None, :]
    k0 = ns(L)
    m = n - k0
    tm = tax(m)
    tick = np.sin(2 * np.pi * note('A6') * tm) * attack(m, 0.0006) * np.exp(-tm / 0.009)
    tick += 0.3 * np.sin(2 * np.pi * note('E7') * tm) * np.exp(-tm / 0.005)
    out = pull
    out[:, k0:] += st(0.55 * tick / peak(tick))
    return fade_out(out, 0.02), 0.0


@reg('unfold')
def snd_unfold(c: Ctx):
    """The bit unfolding into a glass screen: an airy whoosh opening up (band rising 700 Hz -> 7.5 kHz,
    width growing from the centre to wide) with a fluttering glass shimmer on top. ~0.4 s."""
    n = ns(0.62)
    t = tax(n)
    rng = np.random.default_rng(c.seed)
    env = (1 - np.exp(-t / 0.05)) * np.exp(-np.maximum(t - 0.13, 0) / 0.1)
    fc = 700 * (7500 / 700) ** np.clip(t / 0.3, 0, 1)
    air = widen(svf(noise(n, c.seed), fc, 1.0, 'bp'), svf(noise(n, c.seed + 1), fc, 1.0, 'bp'),
                np.clip(t / 0.25, 0.0, 1.0) * 1.2)
    sh = np.zeros((2, n))
    for i, v in enumerate(['A6', 'E7', 'A7', 'C8']):
        am = 0.5 + 0.5 * np.sin(2 * np.pi * rng.uniform(22, 34) * t + rng.uniform(0, 6.28))
        sh += st(np.sin(2 * np.pi * note(v) * t + rng.uniform(0, 6.28)) * am, (-0.6, 0.6, -0.3, 0.3)[i])
    she = np.clip(t / 0.15, 0, 1) ** 1.5 * np.exp(-np.maximum(t - 0.15, 0) / 0.12)
    out = air / peak(air) * env[None, :] + 0.22 * sh / peak(sh) * she[None, :]
    out = out + 0.3 * room(out, 0.6, 0.3)
    return fade_out(out, 0.12), 0.0


@reg('glass')
def snd_glass(c: Ctx):
    """The glassy tick when a flipping screen lands face-on: bright, crystalline, <= 120 ms."""
    n = ns(0.12)
    t = tax(n)
    rng = np.random.default_rng(c.seed)
    f0 = note('A6') * cents(rng.uniform(-15, 15))
    x = np.zeros(n)
    for r, tau, a in ((1.0, 0.035, 1.0), (2.32, 0.020, 0.6), (4.25, 0.012, 0.35), (6.63, 0.006, 0.2)):
        x += a * np.sin(2 * np.pi * f0 * r * t + rng.uniform(0, 6.28)) * np.exp(-t / tau)
    click = hp(noise(n, c.seed + 1), 6000, 2) * np.exp(-t / 0.0006)
    x = (x / peak(x) + 0.25 * click / peak(click)) * attack(n, 0.0002)
    return fade_out(st(x, rng.uniform(-0.15, 0.15)), 0.03), 0.0


DTICK_SCALE = ['A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6', 'D6', 'E6', 'F6', 'G6']


@reg('dtick')
def snd_dtick(c: Ctx):
    """A lock-on: a tight band-limited square blip with a click, no tail. Climbs the A minor scale along
    the run (A4 ... G6 over the 14 FIRE locks)."""
    n = ns(0.045)
    t = tax(n)
    f = note(DTICK_SCALE[min(c.run_index, len(DTICK_SCALE) - 1)])
    sq = sum(np.sin(2 * np.pi * k * f * t) / k for k in range(1, 40, 2) if k * f < 10000)
    env = attack(n, 0.0003) * np.where(t < 0.006, 1.0, np.exp(-(t - 0.006) / 0.006))
    click = hp(noise(n, c.seed), 5000, 2) * np.exp(-t / 0.0005)
    x = lp(sq / peak(sq) * env + 0.15 * click / peak(click), 9000, 2)
    return fade_out(st(x, 0.18 * (-1) ** c.run_index), 0.008), 0.0


@reg('suck')
def snd_suck(c: Ctx):
    """The suck-out inhale: a reverse cymbal + the reverse reverb of an A-minor stab, rising over exactly
    one beat from the cue and cut dead on the next beat's frame."""
    L = c.span(1)
    n = ns(L)
    rng = np.random.default_rng(c.seed)
    m = ns(2.2)
    tm = tax(m)
    # 808-style cymbal: six square partials, high-passed, long decay, then a bright room
    cym = sum(np.sign(np.sin(2 * np.pi * f * tm + rng.uniform(0, 6.28))) for f in (205.3, 304.4, 369.6, 522.7, 540.0, 800.0))
    cym = hp(bp(cym, 5000, 12000, 2), 6000, 2) + 0.5 * hp(noise(m, c.seed), 7000, 2)
    cym = cym * attack(m, 0.001) * np.exp(-tm / 0.55)
    cym = st(cym / peak(cym))
    cym = cym + 0.6 * room(cym, 0.8, 0.2)
    rc = rev(cym)[:, -n:]
    chord = np.zeros((2, ns(0.25)))
    tc = tax(chord.shape[1])
    for v, pan in (('A3', -0.5), ('C4', 0.5), ('E4', -0.2), ('A4', 0.2)):
        chord += st(osc_saw(const(len(tc), note(v)), rng.uniform()) * np.exp(-tc / 0.08), pan)
    chord = lp(chord, 2500, 2)
    rr = rev(pedal(chord, pb.Reverb(room_size=0.9, damping=0.5, wet_level=1.0, dry_level=0.0, width=1.0), tail=2.0))[:, -n:]
    t = tax(n)
    u = t / L
    out = rc / peak(rc) * (u ** 1.5)[None, :] + 0.5 * rr / peak(rr) * (u ** 2.5)[None, :]
    out *= attack(n, 0.01)[None, :]
    return fade_out(out, 0.0015), 0.0


@reg('openwhoosh')
def snd_openwhoosh(c: Ctx):
    """Through the O of VICTORY: a big airy whoosh, the filter opening and the stereo widening over one
    beat, peaking on the frame one beat after the cue, then opening out."""
    P = c.span(1)
    n = ns(P + 0.5)
    t = tax(n)
    u = np.clip(t / P, 0, 1)
    env = np.where(t < P, u ** 2.2, np.exp(-(t - P) / 0.14))
    fc = np.where(t < P, 250 * (5000 / 250) ** u, 5000 * np.exp(-(t - P) / 0.3) + 1500)
    width = np.where(t < P, 0.1 + 1.1 * u, 1.2)
    body = widen(svf(noise(n, c.seed), fc, 0.9, 'bp'), svf(noise(n, c.seed + 1), fc, 0.9, 'bp'), width)
    lowpass = widen(svf(noise(n, c.seed + 2), fc * 0.5, 0.7, 'lp'), svf(noise(n, c.seed + 3), fc * 0.5, 0.7, 'lp'), width)
    air = widen(hp(noise(n, c.seed + 4), 6000, 2), hp(noise(n, c.seed + 5), 6000, 2), width)
    low = lp(noise(n, c.seed + 6), 160, 2)
    out = body / peak(body) + 0.6 * lowpass / peak(lowpass) + 0.18 * air / peak(air) + st(0.35 * low / peak(low))
    out *= env[None, :]
    out = out + 0.3 * room(out, 0.7, 0.4)
    return fade_out(out, 0.1), 0.0


TILE_NOTES = ['E6', 'C6', 'D6', 'A5', 'E6']
TILE_PANS = [-0.35, 0.35, -0.2, 0.2, 0.0]


@reg('tile')
def snd_tile(c: Ctx):
    """A bento tile snapping in: softer and rounder than `tick` (1.2 ms attack, a little body)."""
    n = ns(0.14)
    t = tax(n)
    i = c.run_index % len(TILE_NOTES)
    body = np.sin(2 * np.pi * note(TILE_NOTES[i]) * t) * attack(n, 0.0012) * np.exp(-t / 0.014)
    low = 0.45 * np.sin(2 * np.pi * 260 * t) * attack(n, 0.001) * np.exp(-t / 0.012)
    x = lp(body + low, 4500, 2)
    out = st(x, TILE_PANS[i])
    return fade_out(out + 0.12 * room(out, 0.25, 0.5), 0.03), 0.0


STEP_NOTES = ['A4', 'C5', 'E5', 'A5', 'C6']


@reg('step')
def snd_step(c: Ctx):
    """A pitched step for each division: an FM bell-pluck climbing A4 C5 E5 A5 C6 along the run,
    walking left to right."""
    n = ns(1.0)
    t = tax(n)
    i = min(c.run_index, len(STEP_NOTES) - 1)
    f = note(STEP_NOTES[i])
    index = 2.4 * np.exp(-t / 0.05) + 0.25
    car = np.sin(2 * np.pi * f * t + index * np.sin(2 * np.pi * 2 * f * t))
    bell = 0.22 * np.sin(2 * np.pi * 3.01 * f * t) * np.exp(-t / 0.12)
    x = (car * np.exp(-t / 0.32) + bell) * attack(n, 0.0015)
    pl = bp(noise(n, c.seed), f, min(4 * f, 16000), 2) * np.exp(-t / 0.004)
    x = lp(x / peak(x) + 0.25 * pl / peak(pl), 8000, 2)
    out = st(x, -0.4 + 0.2 * i)
    return fade_out(out + 0.25 * room(out, 0.55, 0.4), 0.2), 0.0


@reg('riser6')
def snd_riser6(c: Ctx):
    """The stepped riser: a detuned-saw tone that steps up a note on every DIVISIONS beat (A3 C4 E4 A4 C5,
    an octave under the steps), then rises smoothly to A5 and stops dead six beats after the cue; a noise
    bed sweeping 250 Hz -> 9 kHz, a sub swell and a tremolo speeding up over the smooth rise."""
    D = c.span(6)
    n = ns(D)
    t = tax(n)
    u = t / D
    rng = np.random.default_rng(c.seed)
    divs = [fsec(d) - fsec(c.beat) for d in TL['DIVISIONS'] if c.beat <= d < c.beat + 6]
    notes = [note(v) for v in ('A3', 'C4', 'E4', 'A4', 'C5')][:len(divs)]
    logf = np.full(n, math.log(notes[0]))
    for k, t0 in enumerate(divs):
        logf[ns(t0):] = math.log(notes[k])
    t_last = divs[-1]
    after = t >= t_last
    v = (t[after] - t_last) / (D - t_last)
    logf[after] = math.log(notes[-1]) + (math.log(note('A5')) - math.log(notes[-1])) * v ** 1.6
    a = math.exp(-1 / (SR * 0.006))                                        # 6 ms portamento on the steps
    logf = ss.lfilter([1 - a], [1, -a], logf, zi=[logf[0] * a])[0]
    fr = np.exp(logf)
    tone = np.zeros((2, n))
    for det, pan in ((-10, -0.6), (10, 0.6), (0, 0.0)):
        tone += st(osc_saw(fr * cents(det + rng.uniform(-2, 2)), rng.uniform()), pan)
    tone += st(0.6 * osc_sine(fr / 2))
    tone = svf(tone, 700 * (6500 / 700) ** u, 0.9, 'lp') * (0.3 + 0.7 * u ** 1.4)[None, :]
    bed = np.zeros((2, n))
    fc = 250 * (9000 / 250) ** (u ** 1.25)
    for ch in range(2):
        bed[ch] = svf(noise(n, c.seed + 10 + ch), fc, 1.4, 'bp') * u ** 2.2
        bed[ch] += 0.35 * hp(noise(n, c.seed + 20 + ch), 6500, 2) * u ** 3.2
    out = tone / peak(tone) + 0.8 * bed / peak(bed)
    t_smooth = (t - t_last) / (D - t_last)
    w = np.clip(t_smooth, 0, 1)
    sub = osc_sine(const(n, note('A1'))) * w ** 2.4
    out += st(0.35 * sub)
    rate = 140 / 60 * (2 + 6 * w ** 1.5)
    out *= (1 - 0.25 * (0.5 + 0.5 * np.cos(2 * np.pi * np.cumsum(rate) / SR)) * w)[None, :]
    return fade_out(out, 0.003), 0.0


@reg('scatter')
def snd_scatter(c: Ctx):
    """Tiles falling away: ~26 tiny ticks over one beat, falling in pitch and level, spreading out L/R."""
    L = c.span(1)
    n = ns(L + 0.15)
    rng = np.random.default_rng(c.seed)
    out = np.zeros((2, n))
    count = 26
    for i in range(count):
        v = i / (count - 1)
        t0 = max(0.0, L * v ** 0.8 + rng.uniform(-0.006, 0.006))
        m = ns(0.04)
        tm = tax(m)
        fc = 3200 * (1300 / 3200) ** v * rng.uniform(0.85, 1.15)
        tick = bp(noise(m, c.seed + 100 + i), fc / 1.5, min(fc * 1.5, 20000), 2) * np.exp(-tm / 0.005)
        tick = tick / peak(tick) + 0.35 * np.sin(2 * np.pi * fc * 0.5 * tm) * np.exp(-tm / 0.008)
        g = (1 - 0.65 * v) * rng.uniform(0.6, 1.0)
        pan = (-1) ** i * (0.15 + 0.75 * v) * rng.uniform(0.7, 1.0)
        s = ns(t0)
        k = min(m, n - s)
        out[:, s:s + k] += st(tick * g * attack(m, 0.0003), pan)[:, :k]
    return fade_out(out + 0.15 * room(out, 0.3, 0.5), 0.05), 0.0


# ───────────────────────────────────────────────────────────────────── the music ──

def effective_edit() -> list[dict]:
    """MUSIC_EDIT, with the segment under the suck-out's end split there (see the header)."""
    edit = sorted((dict(e) for e in TL['MUSIC_EDIT']), key=lambda e: e['from'])
    if not RESYNC_AT_SUCKOUT:
        return edit
    out = []
    for e in edit:
        if e['from'] < SUCK_END < e['to']:
            out.append(dict(e, to=SUCK_END))
            out.append(dict(e, **{'from': SUCK_END, 'track': e['track'] + SUCK_END - e['from'],
                                  'note': f're-pinned under the suck-out (track {e["track"] + SUCK_END - e["from"]:g} on film {SUCK_END:g})'}))
        else:
            out.append(e)
    return out


def build_music(edit: list[dict]) -> tuple[np.ndarray, list[dict], np.ndarray]:
    """score.build_music, with the film-start segment pinned by its first downbeat (see the header)."""
    src = S.decode((ROOT / MUSIC['file']).resolve())
    out = np.zeros((2, N))
    rows = []
    PRE, XF, OUT_FADE, GUARD = ns(0.004), ns(0.010), ns(0.012), ns(0.005)
    pins = [PICKUP if fsamp(e['from']) == 0 and e['from'] < PICKUP < e['to'] else e['from'] for e in edit]
    pin_nominal = [MUSIC['anchor'] + (e['track'] + p - e['from']) * BEAT for e, p in zip(edit, pins)]
    found = [S.onset_near(src, t) for t in pin_nominal]
    shifts = [f - t for f, t in zip(found, pin_nominal) if f is not None]
    typical = float(np.median(shifts)) if shifts else 0.0
    for i, e in enumerate(edit):
        prev = edit[i - 1] if i else None
        nxt = edit[i + 1] if i + 1 < len(edit) else None
        n0, n1 = fsamp(e['from']), min(N, fsamp(e['to']))
        nominal = MUSIC['anchor'] + e['track'] * BEAT
        if found[i] is not None:
            on, how = found[i], 'clean attack'
        else:
            on, how = pin_nominal[i] + typical, f'no clean attack: median shift {typical * 1000:+.1f} ms'
        s0 = on - (fsamp(pins[i]) - n0) / SR          # source second at film sample n0
        if pins[i] != e['from']:
            how += f', pinned by its downbeat {pins[i]:g}'
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
                         onset_shift_ms=(s0 - nominal) * 1000, onset_how=how, lead_ms=lead / SR * 1000,
                         xfade_ms=XF / SR * 1000 if joined_before else 0.0))
    return out, rows, src


def music_attack(music: np.ndarray, beat: float, early: float = 0.015) -> int | None:
    """Sample of the edited music's own attack at `beat`, if it is within `early` s before (or 3 ms after)
    the frame; None when there is no clean attack."""
    t = S.onset_near(music, fsec(beat))
    if t is None or not (-early <= t - fsec(beat) <= 0.003):
        return None
    return ns(t)


def apply_music_fx(music: np.ndarray) -> tuple[np.ndarray, list[dict]]:
    y = music.copy()
    notes = []
    for flt in TL['FILTERS']:
        a = fsamp(flt['from'])
        att = music_attack(music, flt['to'])
        snap = min(fsamp(flt['to']), att) if att is not None else fsamp(flt['to'])
        pad = ns(0.25)
        lo, hi = max(0, a - pad), min(N, snap + pad)
        wet = ss.sosfiltfilt(S._sos('lowpass', flt['hz'], FILTER_ORDER), music[:, lo:hi], axis=-1) * db(flt['db'] + FILTER_MAKEUP_DB)
        w = np.zeros(hi - lo)
        k0, ki, ks = a - lo, ns(FILTER_IN_SEC), ns(FILTER_SNAP_SEC)
        w[k0:k0 + ki] = 0.5 - 0.5 * np.cos(np.pi * np.arange(ki) / ki)
        w[k0 + ki:snap - lo] = 1.0
        w[snap - lo - ks:snap - lo] = 0.5 + 0.5 * np.cos(np.pi * np.arange(1, ks + 1) / ks)
        y[:, lo:hi] = music[:, lo:hi] * (1 - w) + wet * w
        notes.append(dict(kind='filter', **flt, a=a, snap=snap,
                          snap_ms=(snap - fsamp(flt['to'])) / SR * 1000, att=att))
    # the suck-out
    a = fsamp(SUCK['beat'])
    att = music_attack(music, SUCK_END)
    end = min(fsamp(SUCK_END), att) if att is not None else fsamp(SUCK_END)
    warm = ns(0.08)
    lo = a - warm
    seg = y[:, lo:end]
    L = end - a
    u = np.clip((np.arange(lo, end) - a) / L, 0, 1)
    fc = SUCK_HZ[0] * (SUCK_HZ[1] / SUCK_HZ[0]) ** u
    wet = svf(seg, fc, 0.707, 'lp') * db(SUCK_DB * u ** SUCK_CURVE)[None, :]
    w = np.ones(end - lo)
    w[:warm] = 0.0
    k = ns(0.005)
    w[warm:warm + k] = 0.5 - 0.5 * np.cos(np.pi * np.arange(k) / k)
    y[:, lo:end] = seg * (1 - w) + wet * w
    notes.append(dict(kind='suckout', beat=SUCK['beat'], beats=SUCK['beats'], a=a, snap=end,
                      snap_ms=(end - fsamp(SUCK_END)) / SR * 1000, att=att))
    return y, notes


def suck_cue_tails(gated: np.ndarray, cue_rows: list[dict], stems: dict) -> list[str]:
    """Every SFX cued before the suck-out and still ringing into it falls with it, and is gone on the next beat."""
    a, b = fsamp(SUCK['beat']), fsamp(SUCK_END)
    env = np.zeros(N)
    u = np.arange(b - a) / (b - a)
    env[:a] = 1.0
    env[a:b] = db(SUCK_SFX_DB * u) * (1 - u ** 6)
    touched = []
    for i, r in enumerate(cue_rows):
        if r['beat'] >= SUCK['beat'] or i not in stems:
            continue
        s0, seg = stems[i]
        s1 = s0 + seg.shape[1]
        if s1 <= a:
            continue
        k = max(0, a - s0)
        part = seg[:, k:]
        gated[:, s0 + k:s1] -= part * (1 - env[s0 + k:s1])[None, :]
        r['how'] += ', sucked out on ' + f'{SUCK["beat"]:g}'
        touched.append(f'{r["sfx"]}@{r["beat"]:g}')
    return touched


# ───────────────────────────────────────────────────────────────────── checks ──

def stem_onset(seg: np.ndarray, start: int = 0, rel_db: float = -30.0) -> int:
    """First sample (from `start`) above rel_db re the peak of seg[start:]."""
    m = np.max(np.abs(seg[:, start:]), axis=0)
    return start + int(np.argmax(m > m.max() * db(rel_db)))


def mix_onset(x: np.ndarray, at: int) -> tuple[int, float]:
    """In the final mix: the spectral-flux peak (librosa onset strength, 256-point FFT, 32-sample hop) within
    [-10, +15] ms of `at`, and how far it stands above the flux median around it (x). Spectral flux sees the
    broadband attack even where a swell or a sub's slow rise hides it from the waveform."""
    import librosa
    hop = 32
    lo = at - ns(0.25)
    y = x[:, lo:at + ns(0.25)].mean(axis=0).astype(np.float32)
    env = librosa.onset.onset_strength(y=y, sr=SR, n_fft=256, hop_length=hop, center=True, lag=1, max_size=1,
                                       n_mels=24)
    tt = np.arange(len(env)) * hop
    win = np.flatnonzero((tt >= ns(0.25) - ns(0.010)) & (tt <= ns(0.25) + ns(0.015)))
    k = win[np.argmax(env[win])]
    return lo + int(tt[k]), float(env[k] / max(np.median(env), 1e-9))


def flux_x(v: float) -> str:
    return 'out of silence' if v > 1e4 else f'flux {v:.0f}x median'


ONSET_CHECKS = [('nuke', 1, 0), ('sonic', 11, 2), ('nuke', 29, 0), ('explosion', 40, 0), ('victory', 45, 0),
                ('landing', 61, 0), ('sonic', 65, 2)]


def onset_checks(out, cue_rows, stems):
    res = []
    for name, beat, plus in ONSET_CHECKS:
        idx = next((i for i, r in enumerate(cue_rows) if r['sfx'] == name and r['beat'] == beat), None)
        if idx is None or idx not in stems:
            continue
        at = fsamp(beat + plus)
        s0, seg = stems[idx]
        start = max(0, at - s0 - ns(0.003)) if plus else 0
        so = s0 + stem_onset(seg, start)
        mo = mix_onset(out, at)
        label = f'{name}@{beat:g}' + (f' BOOM@{beat + plus:g}' if plus else '')
        res.append(dict(label=label, frame=frame(beat + plus), at=at, stem=so, mix=mo))
    return res


# ───────────────────────────────────────────────────────────────────── main ──

def master(pre: np.ndarray) -> tuple[np.ndarray, float, float]:
    gain = TARGET_LUFS - S.integrated_lufs(pre)
    for _ in range(8):
        out = S.master_chain(pre, gain)
        lufs = S.integrated_lufs(out)
        if abs(lufs - TARGET_LUFS) < 0.05:
            break
        gain += TARGET_LUFS - lufs
    return out, gain, lufs


def hard_silence(x: np.ndarray, keep: np.ndarray | None = None) -> None:
    """Exact zeros over every gap (except sounds cued inside it), the next attack faded in over 0.5 ms."""
    k = ns(0.0005)
    for g0, g1 in S.gaps():
        a, b = fsamp(g0), fsamp(g1)
        x[:, a:b] *= keep[a:b] if keep is not None else 0.0
        x[:, b:b + k] *= (0.5 - 0.5 * np.cos(np.pi * np.arange(k) / k))[None, :]


def main():
    print(f'deck30 score: {MUSIC["file"]} @ {MUSIC["bpm"]} BPM, anchor {MUSIC["anchor"]} s, '
          f'{DURATION_FR} frames = {N / SR:.3f} s = {N} samples')
    edit = effective_edit()
    music_raw, edit_rows, _src = build_music(edit)
    music, fx_rows = apply_music_fx(music_raw)
    anchors = sorted(set(TL['ANCHORS'].values()) | {SUCK_END})
    music_onsets = []
    for b in anchors:
        t = S.onset_near(music, fsec(b))
        music_onsets.append((b, None if t is None else (t - fsec(b)) * 1000))

    gate = S.gate_env()
    music_mix = music * db(MUSIC_GAIN_DB) * S.duck_env()[None, :]
    gated, ungated, cue_rows, stems = S.render_cues()
    sucked = suck_cue_tails(gated, cue_rows, stems)
    for r in cue_rows:      # where the ear-proxy balance is measured, for sounds that are not "on the cue"
        if r['sfx'] == 'swell':
            r['measure'] = [('body', r['start_sec'] + r['len_sec'] - 0.45)]
        elif r['sfx'] == 'suck':
            r['measure'] = [('end', r['start_sec'] + r['len_sec'] - 0.42)]
        elif r['sfx'] == 'openwhoosh':
            r['measure'] = [('peak', fsec(r['beat'] + 1) - 0.25)]
        elif r['sfx'] in ('collapse', 'rush'):
            r['measure'] = [('body', r['sec'] + 0.05)]

    pre = hp(music_mix + gated, 25, 2) * gate[None, :] + ungated
    print(f'deck30 score: pre-master peak {20 * math.log10(peak(pre)):+.1f} dBFS (float)')
    out, gain, lufs = master(pre)
    keep = np.zeros(N)
    for r in cue_rows:
        if r['in_gap']:
            keep[max(0, ns(r['start_sec'])):ns(r['start_sec'] + r['len_sec'])] = 1.0
    hard_silence(out, keep)
    lufs = S.integrated_lufs(out)
    tp = S.true_peak_db(out)
    print(f'deck30 score: master gain {gain:+.2f} dB -> {lufs:.2f} LUFS integrated, true peak {tp:.2f} dBTP')

    # the music on its own: same edit, filters, suck-out and silence; no ducks, no SFX
    m_pre = hp(music * db(MUSIC_GAIN_DB), 25, 2) * gate[None, :]
    m_out, m_gain, m_lufs = master(m_pre)
    hard_silence(m_out)
    m_lufs, m_tp = S.integrated_lufs(m_out), S.true_peak_db(m_out)
    print(f'deck30 score: music edit alone {m_lufs:.2f} LUFS, true peak {m_tp:.2f} dBTP')

    # ── checks
    assert out.shape == (2, N) and m_out.shape == (2, N)
    silent = []
    for g0, g1 in S.gaps():
        a, b = fsamp(g0), fsamp(g1)
        silent.append((g0, g1, S.rms_db(out[:, a:b]), peak(out[:, a:b]), S.rms_db(m_out[:, a:b]), peak(m_out[:, a:b])))
    for g0, g1, r, p, mr, mp in silent:
        print(f'deck30 score: silence beats {g0:g}-{g1:g}: mix rms {r:.1f} dBFS peak {p:.1e}; music rms {mr:.1f} dBFS')
    a, b = fsamp(SUCK['beat']), fsamp(SUCK_END)
    suck_q = dict(rms=S.rms_db(out[:, a:b]), rms_first=S.rms_db(out[:, a:(a + b) // 2]),
                  mom=S.momentary(out, fsec(SUCK['beat']), fsec(SUCK_END) - 0.4),
                  music_only=S.momentary(music_mix * gate[None, :] * db(gain), fsec(SUCK['beat']), fsec(SUCK_END) - 0.4))
    big = {(name, b): S.momentary(out, fsec(b), fsec(b) + 1.5 * BEAT - 0.4) for name, b in BIG_MOMENTS}
    pre_g = pre * db(gain)
    big_pre = {}
    for name, b in BIG_MOMENTS:
        a0, a1 = fsamp(b), fsamp(b) + ns(1.5 * BEAT)
        big_pre[(name, b)] = (S.momentary(pre_g, fsec(b), fsec(b) + 1.5 * BEAT - 0.4),
                              20 * math.log10(max(peak(pre_g[:, a0:a1]), 1e-12)))
    for (name, b), v in big.items():
        lp_, pk_ = big_pre[(name, b)]
        print(f'deck30 score: {name:<10} beat {b:>3}: {v:6.1f} LUFS momentary  (pre-limiter {lp_:6.1f} LUFS, peak {pk_:+5.1f} dBFS)')
    print(f'deck30 score: suck-out beat {SUCK["beat"]}: {suck_q["mom"]:.1f} LUFS momentary (first half rms {suck_q["rms_first"]:.1f} dBFS)')
    onsets = onset_checks(out, cue_rows, stems)
    for o in onsets:
        mix = f'{o["mix"][0] - o["at"]:+d} ({flux_x(o["mix"][1])})'
        print(f'deck30 score: onset {o["label"]:<22} frame {o["frame"]}: stem {o["stem"] - o["at"]:+d} samples, mix {mix}')

    # ── write
    for d in (OUT_WAV.parent, OUT_MUSIC.parent, BUILD):
        d.mkdir(parents=True, exist_ok=True)
    sf.write(OUT_WAV, np.clip(out, -1, 1 - 2 ** -23).T, SR, subtype='PCM_24')
    sf.write(OUT_MUSIC, np.clip(m_out, -1, 1 - 2 ** -23).T, SR, subtype='PCM_24')
    balance = S.balance_table(music_mix * gate[None, :] * db(gain), cue_rows, stems, out)
    write_cues(edit_rows, fx_rows, music_onsets, cue_rows, balance, gain, lufs, tp, (m_lufs, m_tp), silent,
               suck_q, sucked, big, big_pre, onsets)
    spectrogram(out, cue_rows)
    print(f'deck30 score: wrote {OUT_WAV.relative_to(ROOT)}, {OUT_MUSIC.relative_to(ROOT)}, '
          f'{(BUILD / "cues.txt").relative_to(ROOT)}, {(BUILD / "soundtrack_spectrogram.png").relative_to(ROOT)}')


def write_cues(edit_rows, fx_rows, music_onsets, cue_rows, balance, gain, lufs, tp, music_only, silent, suck_q,
               sucked, big, big_pre, onsets):
    L = []
    L.append(f'Deck30 score — {MUSIC["file"]}, {MUSIC["bpm"]} BPM, anchor {MUSIC["anchor"]} s, key {MUSIC["key"]}')
    L.append(f'{DURATION_FR} frames @ {FPS} fps = {N / SR:.3f} s = {N} samples @ {SR} Hz. Cue time = f(beat)/{FPS}.')
    L.append(f'Master: music {MUSIC_GAIN_DB:+.1f} dB, gain {gain:+.2f} dB -> {lufs:.2f} LUFS integrated (own BS.1770 meter), '
             f'true peak {tp:.2f} dBTP. Music edit alone (out/deck30/deck30-music.wav): {music_only[0]:.2f} LUFS, '
             f'{music_only[1]:.2f} dBTP.')
    L.append('')
    L.append('MUSIC EDIT  (film beats [from,to) -> source seconds; onset = measured attack put on the frame; '
             'joins are 10 ms equal-power crossfades)')
    L.append(f'{"beats":>9} {"frames":>11} {"film s":>17} {"track":>6} {"src nominal":>11} {"src start":>10} {"src end":>9} {"onset":>8}  note')
    for r in edit_rows:
        sh = f'{r["onset_shift_ms"]:+5.1f}ms'
        xf = f', xfade {r["xfade_ms"]:.0f} ms' if r['xfade_ms'] else ''
        L.append(f'{r["from"]:>4g}-{r["to"]:<4g} {r["frame_from"]:>5}-{r["frame_to"]:<5} {r["sec_from"]:8.4f}-{r["sec_to"]:<8.4f} '
                 f'{r["track"]:>6g} {r["src_nominal"]:11.4f} {r["src_start"]:10.4f} {r["src_end"]:9.4f} {sh:>8}  '
                 f'[{r["onset_how"]}{xf}] {r.get("note", "")}')
    L.append('')
    L.append('MUSIC FX  (music only)')
    for r in fx_rows:
        if r['kind'] == 'filter':
            L.append(f'  low-pass beats {r["from"]:g}-{r["to"]:g}: {r["hz"]:g} Hz zero-phase {12 * FILTER_ORDER} dB/oct, {r["db"]:+g} dB '
                     f'(+ make-up {FILTER_MAKEUP_DB:+g} dB: net {r["db"] + FILTER_MAKEUP_DB:+g} dB in the passband); '
                     f'in 30 ms from {r["a"] / SR:.4f} s, snap open at {r["snap"] / SR:.4f} s '
                     f'({r["snap_ms"]:+.1f} ms re frame {frame(r["to"])}: the music\'s own attack) — {r["note"]}')
        else:
            L.append(f'  suck-out beat {r["beat"]:g} for {r["beats"]:g}: low-pass {SUCK_HZ[0]:g} -> {SUCK_HZ[1]:g} Hz (exp), '
                     f'level 0 -> {SUCK_DB:g} dB, {r["a"] / SR:.4f}-{r["snap"] / SR:.4f} s; music back at full level '
                     f'{r["snap_ms"]:+.1f} ms re frame {frame(SUCK_END)}')
    L.append(f'  SFX tails sucked out with it ({SUCK_SFX_DB:g} dB, gone on beat {SUCK_END:g}): {", ".join(sucked) or "none"}')
    L.append('')
    L.append('MUSIC DOWNBEATS AT THE ANCHORS  (edited music, measured attack re the frame; - = early)')
    for b, ms in music_onsets:
        L.append(f'  beat {b:>3g} frame {frame(b):>4}: ' + ('no clean attack' if ms is None else f'{ms:+.1f} ms'))
    L.append('')
    L.append('SILENCE (gaps: exact zeros, everything gated, nothing cued)')
    for g0, g1, r, p, mr, mp in silent:
        L.append(f'  beats {g0:g}-{g1:g}  frames {frame(g0)}-{frame(g1)}  {fsec(g0):.4f}-{fsec(g1):.4f} s   '
                 f'mix rms {r:.1f} dBFS peak {p:.2e}   music-only rms {mr:.1f} dBFS peak {mp:.2e}')
    L.append(f'  suck-out beat {SUCK["beat"]:g}-{SUCK_END:g}: momentary max {suck_q["mom"]:.1f} LUFS (music alone '
             f'{suck_q["music_only"]:.1f}), rms {suck_q["rms"]:.1f} dBFS, first half rms {suck_q["rms_first"]:.1f} dBFS')
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
    L.append('BIG MOMENTS  (final mix, max momentary loudness in the 1.5 beats from the hit; pre-limiter = the same '
             'window before the bus compressor/limiter, at the master gain)')
    for name, b in big:
        lp_, pk_ = big_pre[(name, b)]
        L.append(f'  {name:<10} beat {b:>3}  {big[(name, b)]:6.1f} LUFS   (pre-limiter {lp_:6.1f} LUFS, peak {pk_:+5.1f} dBFS)')
    L.append('')
    L.append('ONSET CHECKS  (stem: first sample > -30 dB re the sound\'s peak, as placed; mix: spectral-flux peak in '
             '[-10, +15] ms, 0.67 ms hop; both re f(beat) * 1600)')
    for o in onsets:
        mix = f'{o["mix"][0] - o["at"]:+d} samples ({(o["mix"][0] - o["at"]) / SR * 1000:+.2f} ms, {flux_x(o["mix"][1])})'
        L.append(f'  {o["label"]:<22} frame {o["frame"]:>4} sample {o["at"]:>8}: stem {o["stem"] - o["at"]:+d} samples '
                 f'({(o["stem"] - o["at"]) / SR * 1000:+.2f} ms), mix {mix}')
    (BUILD / 'cues.txt').write_text('\n'.join(L) + '\n')


def spectrogram(out, cue_rows):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import librosa
    y = out.mean(axis=0).astype(np.float32)
    hop = 256
    Sx = np.abs(librosa.stft(y, n_fft=4096, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=SR, n_fft=4096)
    logf = np.geomspace(25, 20000, 480)
    Sx = np.stack([np.interp(logf, freqs, col) for col in Sx.T], axis=1)
    D = librosa.amplitude_to_db(Sx, ref=np.max)
    fig, (a0, a1) = plt.subplots(2, 1, figsize=(26, 11), gridspec_kw={'height_ratios': [1, 4]}, sharex=True)
    starts, ms = S.block_loudness(S.kpower(out), 0.4, 0.02)
    a0.plot((starts + ns(0.2)) / SR, -0.691 + 10 * np.log10(np.maximum(ms, 1e-20)), lw=0.9, color='k')
    a0.axhline(TARGET_LUFS, color='r', lw=0.6, ls='--')
    a0.set_ylim(-60, -2)
    a0.set_ylabel('momentary LUFS')
    a1.imshow(D, origin='lower', aspect='auto', cmap='magma', vmin=-80, vmax=0, interpolation='nearest',
              extent=[0, D.shape[1] * hop / SR, 0, len(logf)])
    ft = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
    a1.set_yticks([np.interp(math.log(f), np.log(logf), np.arange(len(logf))) for f in ft])
    a1.set_yticklabels([f'{f:g}' if f < 1000 else f'{f / 1000:g}k' for f in ft])
    a1.set_ylabel('Hz')
    for flt in TL['FILTERS']:
        a0.axvspan(fsec(flt['from']), fsec(flt['to']), color='tab:blue', alpha=0.12)
        a0.text(fsec(flt['from']) + 0.03, -56, f'LP {flt["hz"]:g} Hz', fontsize=8, color='tab:blue')
    a0.axvspan(fsec(SUCK['beat']), fsec(SUCK_END), color='tab:orange', alpha=0.2)
    a0.text(fsec(SUCK['beat']) + 0.02, -56, 'suck', fontsize=8, color='tab:orange')
    for g0, g1 in S.gaps():
        a0.axvspan(fsec(g0), fsec(g1), color='0.5', alpha=0.25)
        a0.text(fsec(g0) + 0.02, -56, 'silence', fontsize=8, color='0.3')
    for name, (b0, _b1) in TL['SECTIONS'].items():
        for ax in (a0, a1):
            ax.axvline(fsec(b0), color='w' if ax is a1 else '0.5', lw=0.7, ls='--', alpha=0.7)
        a0.text(fsec(b0) + 0.04, -7, name, fontsize=9, color='0.2')
    top = len(logf)
    for r in cue_rows:
        a1.plot([r['sec'], r['sec']], [top - 25, top], color='c', lw=1.0)
        a1.text(r['sec'], top - 30, r['sfx'], rotation=90, fontsize=6, color='c', va='top', ha='center')
    ticks = [0] + list(range(PICKUP, TL['TOTAL_BEATS'] + 1, 4)) + [TL['TOTAL_BEATS']]
    a1.set_xticks([fsec(b) for b in ticks])
    a1.set_xticklabels([f'{b}\n{fsec(b):.2f}s' for b in ticks], fontsize=8)
    a1.set_xlabel('film beat (downbeats; frame-rounded) / seconds')
    a1.set_xlim(0, N / SR)
    fig.suptitle('Deck30 soundtrack — cyan: cues, dashed: sections, shaded: low-pass / suck-out / silence', fontsize=12)
    plt.tight_layout()
    plt.savefig(BUILD / 'soundtrack_spectrogram.png', dpi=70)
    plt.close(fig)


if __name__ == '__main__':
    main()
