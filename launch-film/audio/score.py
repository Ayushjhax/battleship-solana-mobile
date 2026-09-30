"""
Original score for the Empire of Bits launch film. D minor, 120 BPM, built to the
scene grid in src/config/timeline.ts (read via build/timeline.json).

Minimal and powerful: a sub pulse, a filtered supersaw pad, braams and impacts,
noise risers, and the game's own mine / explosion / splash sounds as percussion.

Sections follow the edit:
  intro (the bit) → title hit, beat enters → journey (wallet … arsenal) →
  breakdown (matchmaking) → DROP (battle) → heartbeat → VICTORY lift →
  economy run → bento riser → supercut peak → hard silence → finale tone.

Run: python3 audio/score.py   → public/audio/score.wav (+ build/stems/*.wav)
"""
import json, os
import numpy as np
import pedalboard as pb
from synth import *

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = json.load(open(os.path.join(ROOT, 'build/timeline.json')))
BPM, OFF = T['bpm'], T['beatOffset']
SC = {k: v['start'] for k, v in T['scenes'].items()}
TOTAL = T['totalBeats']
BEAT = 60 / BPM
N = int((OFF + TOTAL * BEAT + 3.0) * SR)  # +3 s for the final tail


def tb(b):
    """beat → seconds in the file"""
    return OFF + b * BEAT


def nb(beats):
    return int(round(beats * BEAT * SR))


# ── Harmony: one chord per bar (4 beats), by absolute bar index ───────────────
# voicings (MIDI) for the pad; bass roots in the 36–65 Hz octave
CH = {
    'Dm': ([50, 53, 57, 62, 65], 26),
    'Bb': ([50, 53, 58, 62, 65], 34),
    'F': ([48, 53, 57, 60, 65], 29),
    'C': ([48, 52, 55, 60, 64], 36),
    'Gm': ([50, 55, 58, 62, 67], 31),
    'A': ([49, 52, 57, 61, 64], 33),
    'Bbmaj9': ([50, 53, 57, 60, 65, 69], 34),
    'Dm9': ([50, 53, 57, 60, 64, 69], 26),
}


def chord_at(bar):
    b = bar * 4
    if b < SC['title']:
        return 'Dm'
    if b < SC['match']:
        return ['Dm', 'Bb', 'F', 'C'][(bar - SC['title'] // 4) % 4]
    if b < SC['battle']:
        return ['Bb', 'A'][(bar - SC['match'] // 4) % 2]
    if b < SC['battle'] + 40:
        return ['Dm', 'Bb', 'Gm', 'A'][(bar - SC['battle'] // 4) % 4]
    if b < SC['victory']:
        return 'Dm'
    if b < SC['economy']:
        return ['Bb', 'F', 'C'][(bar - SC['victory'] // 4) % 3]
    if b < SC['bento']:
        return ['Dm', 'Bb', 'F', 'C'][(bar - SC['economy'] // 4) % 4]
    if b < SC['supercut']:
        return ['Gm', 'Bb', 'A'][(bar - SC['bento'] // 4) % 3]
    if b < SC['finale']:
        return ['Dm', 'Bb', 'A'][min(2, (bar - SC['supercut'] // 4))]
    return 'Bbmaj9'


# ── Energy per beat: drives filters, levels ──────────────────────────────────
def energy(b):
    if b < SC['title']:
        return 0.05
    if b < SC['wallet']:
        return 0.35
    if b < SC['match']:
        return 0.45 + 0.25 * (b - SC['wallet']) / (SC['match'] - SC['wallet'])
    if b < SC['battle']:
        return 0.3 + 0.5 * (b - SC['match']) / 8
    if b < SC['battle'] + 40:
        return 1.0
    if b < SC['victory']:
        return 0.15
    if b < SC['economy']:
        return 0.6
    if b < SC['bento']:
        return 0.65 + 0.2 * (b - SC['economy']) / 24
    if b < SC['supercut']:
        return 0.8 + 0.2 * (b - SC['bento']) / 12
    if b < SC['finale']:
        return 1.0
    return 0.1


stems = {k: np.zeros((2, N)) for k in ['drone', 'pad', 'bass', 'drums', 'arp', 'fx']}

# game sounds used as percussion (the film's signature)
G_MINE = load('mine.mp3')
G_EXPL = load('explosion.mp3') * db(18)
G_SPLASH = load('splash.mp3') * db(10)
G_NUKE = load('nuke.mp3')


# ── Drone (intro, heartbeat, finale) ─────────────────────────────────────────
def drone(b0, b1, gain_db, note=26):
    n = nb(b1 - b0)
    t = np.arange(n) / SR
    f0 = midi_hz(note)
    x = sine(f0, n) * 0.6 + sine(f0 * 2, n) * 0.25 + sine(f0 * 3.001, n) * 0.06
    x *= 1 + 0.08 * np.sin(2 * np.pi * 0.11 * t)
    air = static_filter(np.random.default_rng(3).standard_normal(n), [250, 900], 'bandpass') * 0.08
    y = stereo(x) + np.stack([air, np.roll(air, 480)])
    y *= adsr(n, a=min(3.0, (b1 - b0) * BEAT * 0.5), d=0.1, s=1, r=1.0)
    place(stems['drone'], fx(y, pb.Reverb(room_size=0.9, wet_level=0.35, dry_level=0.8)), tb(b0), gain_db)


drone(0, SC['title'], -30)
drone(SC['battle'] + 40, SC['victory'] - 0.5, -24)

# ── Pad: filtered supersaw, one chord per bar ────────────────────────────────
pad = np.zeros((2, N))
for bar in range(SC['title'] // 4, SC['finale'] // 4):
    b = bar * 4
    if SC['battle'] + 40 <= b < SC['victory']:
        continue  # heartbeat: no pad
    notes, _ = CH[chord_at(bar)]
    n = nb(4) + int(0.6 * SR)
    y = np.zeros((2, n))
    for i, m in enumerate(notes):
        y += supersaw(midi_hz(m), n, voices=5, detune_cents=8, seed=bar * 10 + i)
    e = energy(b)
    cut = 350 + 2600 * e ** 1.4
    lfo = 1 + 0.25 * np.sin(np.linspace(0, np.pi, n))
    y = sweep_filter(y, cut * lfo, 'lowpass', q=0.9)
    y *= adsr(n, a=0.35 if e < 0.9 else 0.08, d=0.3, s=0.85, r=0.6)
    place(pad, y, tb(b), -24 + 5 * e)
# the victory lift: a brighter, wider pad on top
for bar in range(SC['victory'] // 4, SC['economy'] // 4):
    notes, _ = CH[chord_at(bar)]
    n = nb(4) + int(0.8 * SR)
    y = sum(supersaw(midi_hz(m + 12), n, voices=7, detune_cents=12, seed=bar + i) for i, m in enumerate(notes))
    y = sweep_filter(y, np.linspace(1200, 5000, n), 'lowpass')
    place(pad, y * adsr(n, a=0.02, d=0.5, s=0.7, r=0.8), tb(bar * 4), -27)
stems['pad'] += fx(pad, pb.Chorus(rate_hz=0.3, depth=0.2, mix=0.3), pb.Reverb(room_size=0.85, damping=0.4, wet_level=0.45, dry_level=0.7, width=1.0))

# ── Finale: one soft tone, then a warm chord ─────────────────────────────────
fin = np.zeros((2, N))
n = int(5 * SR)
tone = (sine(midi_hz(74), n) + 0.3 * sine(midi_hz(86), n) + 0.08 * sine(midi_hz(93), n)) * exp_decay(n, 1.4)
tone *= np.minimum(1, np.arange(n) / (0.02 * SR))
place(fin, stereo(tone), tb(SC['finale'] + 2), -16)
n = nb(8) + int(3 * SR)
notes, _ = CH['Bbmaj9']
y = sum(supersaw(midi_hz(m), n, voices=5, detune_cents=6, seed=90 + i) for i, m in enumerate(notes))
y = static_filter(y, 1400, 'lowpass')
y *= adsr(n, a=1.2, d=0.5, s=0.8, r=3.0)
place(fin, y, tb(SC['finale'] + 12), -36)
n = nb(12)
sub = sine(midi_hz(34), n) * adsr(n, a=2.0, d=0.2, s=1, r=2.5)
place(fin, stereo(sub), tb(SC['finale'] + 6), -36)
stems['pad'] += fx(fin, pb.Reverb(room_size=0.95, damping=0.3, wet_level=0.55, dry_level=0.6, width=1.0))

# ── Bass: sub pulse, distorted saw in the drops ──────────────────────────────
bass = np.zeros((2, N))
grit = np.zeros((2, N))
for bar in range(SC['title'] // 4, SC['finale'] // 4):
    b0 = bar * 4
    _, root = CH[chord_at(bar)]
    f0 = midi_hz(root)
    e = energy(b0)
    if SC['battle'] + 40 <= b0 < SC['victory']:
        continue
    if b0 < SC['wallet'] or SC['victory'] <= b0 < SC['economy'] or SC['match'] <= b0 < SC['battle']:
        # sustained sub, one note per bar
        n = nb(4)
        y = sine(f0, n) * adsr(n, a=0.02, d=0.2, s=0.9, r=0.15)
        place(bass, stereo(np.tanh(1.6 * y)), tb(b0), -8)
        continue
    # 8th-note pulse
    for k in range(8):
        n = nb(0.5)
        y = sine(f0, n) * adsr(n, a=0.004, d=0.08, s=0.7, r=0.06)
        place(bass, stereo(np.tanh(1.8 * y)), tb(b0 + k * 0.5), -9)
        drop = SC['battle'] <= b0 < SC['battle'] + 40 or SC['supercut'] <= b0 < SC['finale'] or (SC['economy'] <= b0 < SC['bento'] and k % 2 == 1)
        if drop:
            g = saw(f0 * 2, n) * adsr(n, a=0.003, d=0.12, s=0.5, r=0.05)
            g = static_filter(g, 900 if SC['battle'] <= b0 < SC['battle'] + 40 else 600)
            place(grit, stereo(g), tb(b0 + k * 0.5), -16)
grit = fx(grit, pb.Distortion(drive_db=14), pb.LowpassFilter(cutoff_frequency_hz=2200))
stems['bass'] += bass + grit * 0.5

# ── Drums: synth kick + the game's mine; noise snare + the game's explosion ─
def kick(heavy=False):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 45 + 110 * np.exp(-t / 0.035)
    y = sine(f, n) * exp_decay(n, 0.16 if heavy else 0.12)
    y += 0.25 * static_filter(np.random.default_rng(1).standard_normal(n), 3000, 'highpass') * exp_decay(n, 0.004)
    y = np.tanh(1.5 * y)
    out = stereo(y)
    if heavy:
        m = G_MINE[:, :n] if G_MINE.shape[1] >= n else np.pad(G_MINE, ((0, 0), (0, n - G_MINE.shape[1])))
        out = out + 0.35 * static_filter(m, 180)
    return out


def snare(bright=0.5):
    n = int(0.3 * SR)
    rng = np.random.default_rng(7)
    noise = static_filter(rng.standard_normal(n), [1200, 9000], 'bandpass') * exp_decay(n, 0.07)
    body = sine(185, n) * exp_decay(n, 0.04) * 0.6
    y = stereo(noise * (0.6 + bright * 0.4) + body)
    e = G_EXPL[:, : int(0.25 * SR)]
    y[:, : e.shape[1]] += 0.5 * static_filter(e, 400, 'highpass')
    return fx(y, pb.Reverb(room_size=0.35, wet_level=0.2, dry_level=0.9))


def hat(open_=False):
    n = int((0.18 if open_ else 0.05) * SR)
    rng = np.random.default_rng(11)
    y = static_filter(rng.standard_normal(n), 7000, 'highpass') * exp_decay(n, 0.05 if open_ else 0.012)
    s = G_SPLASH[:, : n]
    out = stereo(y, 0.2)
    out[:, : s.shape[1]] += 0.25 * static_filter(s, 5000, 'highpass')
    return out


K, KH, SN, HT, HO = kick(), kick(True), snare(), hat(), hat(True)
drums = np.zeros((2, N))
for b in range(SC['title'], SC['finale']):
    e = energy(b)
    beat_in_bar = b % 4
    in_battle = SC['battle'] <= b < SC['battle'] + 40
    in_super = SC['supercut'] <= b < SC['finale'] - 2
    heavy = in_battle or in_super
    # kick
    if b < SC['wallet']:
        if beat_in_bar in (0, 2):
            place(drums, K, tb(b), -6)
    elif SC['match'] <= b < SC['battle']:
        pass  # breakdown
    elif SC['battle'] + 40 <= b < SC['victory']:
        pass  # heartbeat section
    elif SC['victory'] <= b < SC['economy']:
        if b >= SC['victory'] + 4 and beat_in_bar in (0, 2):
            place(drums, K, tb(b), -8)
    elif SC['finale'] - 2 <= b:
        pass
    else:
        place(drums, KH if heavy else K, tb(b), -4 if heavy else -6)
        if heavy and beat_in_bar == 3:
            place(drums, K, tb(b + 0.75), -12)
    # snare / clap on 2 and 4
    if beat_in_bar in (1, 3) and (SC['fleet'] <= b < SC['match'] or in_battle or SC['economy'] + 4 <= b < SC['finale'] - 2):
        place(drums, SN, tb(b), -8 if heavy else -12)
    # hats
    if SC['build'] <= b < SC['match'] or SC['economy'] <= b < SC['supercut']:
        place(drums, HT, tb(b + 0.5), -18)
        if b >= SC['fleet'] and b % 2 == 1 and b < SC['match']:
            place(drums, HO, tb(b + 0.5), -22)
    if in_battle or in_super:
        for k in range(4):
            place(drums, HT, tb(b + k * 0.25), -18 if k % 2 else -22)
# snare rolls into the drops
for start in (SC['battle'] - 4, SC['supercut'] - 4):
    for k in range(32):
        bb = start + k / 8
        if bb >= start + 3.5:
            break
        place(drums, SN, tb(bb), -26 + 16 * k / 32)
stems['drums'] += drums

# heartbeat: lub-dub every two beats
hb = np.zeros((2, N))
for b in np.arange(SC['battle'] + 40, SC['victory'] - 1, 2):
    for off, g in ((0, 0), (0.36, -5)):
        n = int(0.3 * SR)
        t = np.arange(n) / SR
        y = sine(40 + 30 * np.exp(-t / 0.03), n) * exp_decay(n, 0.09)
        place(hb, stereo(np.tanh(2 * y)), tb(b + off), -10 + g)
stems['drums'] += hb

# ── Arp: 8th-note chord tones, delayed ───────────────────────────────────────
arp = np.zeros((2, N))
for b in np.arange(SC['build'], SC['match'], 0.5):
    bar = int(b // 4)
    notes, _ = CH[chord_at(bar)]
    seq = [notes[0] + 12, notes[2] + 12, notes[3] + 12, notes[1] + 24, notes[2] + 12, notes[3] + 12, notes[0] + 24, notes[2] + 12]
    m = seq[int((b * 2) % 8)]
    n = nb(0.5)
    y = saw(midi_hz(m), n) * exp_decay(n, 0.09)
    y = static_filter(y, 1800 + 1500 * energy(b))
    place(arp, stereo(y, 0.3 if int(b * 2) % 2 else -0.3), tb(b), -30 + 4 * energy(b))
for b in np.arange(SC['economy'], SC['bento'], 0.5):
    bar = int(b // 4)
    notes, _ = CH[chord_at(bar)]
    m = [notes[0] + 24, notes[2] + 12, notes[3] + 12, notes[1] + 24][int((b * 2) % 4)]
    n = nb(0.5)
    y = static_filter(saw(midi_hz(m), n) * exp_decay(n, 0.08), 3200)
    place(arp, stereo(y, 0.3 if int(b * 2) % 2 else -0.3), tb(b), -28)
stems['arp'] += fx(arp, pb.Delay(delay_seconds=0.375, feedback=0.35, mix=0.3), pb.Reverb(room_size=0.6, wet_level=0.3))

# ── FX: braams, impacts, risers ──────────────────────────────────────────────
fxb = np.zeros((2, N))


def braam(b, chord='Dm', gain=-8, length=3.0):
    notes, root = CH[chord]
    n = int(length * SR)
    y = np.zeros((2, n))
    for m in (root, root + 7, root + 12, notes[1] - 12):
        y += supersaw(midi_hz(m), n, voices=7, detune_cents=18, seed=m)
    t = np.arange(n) / SR
    cut = 180 + 2200 * np.exp(-t / 0.35) + 300 * np.exp(-t / 1.5)
    y = sweep_filter(y, cut, 'lowpass', q=1.2)
    y *= adsr(n, a=0.01, d=0.6, s=0.55, r=1.2)
    y = fx(y, pb.Distortion(drive_db=10), pb.LowpassFilter(cutoff_frequency_hz=3000), pb.Reverb(room_size=0.95, wet_level=0.5, dry_level=0.7))
    place(fxb, y, tb(b), gain)


def impact(b, gain=-6):
    n = int(2.5 * SR)
    t = np.arange(n) / SR
    y = sine(30 + 70 * np.exp(-t / 0.25), n) * exp_decay(n, 0.7)
    nz = static_filter(np.random.default_rng(5).standard_normal(n), 2500) * exp_decay(n, 0.12) * 0.5
    z = fx(stereo(np.tanh(1.8 * y) + nz), pb.Reverb(room_size=0.9, wet_level=0.4, dry_level=0.9))
    place(fxb, z, tb(b), gain)


def riser(b0, b1, gain=-14, top=9000):
    n = nb(b1 - b0)
    rng = np.random.default_rng(int(b0))
    x = np.vstack([rng.standard_normal(n), rng.standard_normal(n)])
    ramp = np.linspace(0, 1, n)
    y = sweep_filter(x, 300 * (top / 300) ** (ramp ** 1.5), 'bandpass', q=2.0) * 3
    y += stereo(sine(midi_hz(62) * 2 ** (ramp * 2), n) * 0.08)
    y *= ramp ** 2.2
    place(fxb, fx(y, pb.Reverb(room_size=0.7, wet_level=0.3)), tb(b0), gain)


def reverse_swell(b_end, beats=2, gain=-14, chord='Dm'):
    notes, _ = CH[chord]
    n = nb(beats) + int(1.5 * SR)
    y = sum(supersaw(midi_hz(m + 12), n, seed=m) for m in notes[:4])
    y = fx(static_filter(y, 2500) * exp_decay(n, 0.4), pb.Reverb(room_size=0.95, wet_level=1.0, dry_level=0.0))
    y = y[:, ::-1][:, -nb(beats):]
    y *= np.linspace(0, 1, y.shape[1]) ** 2
    place(fxb, y, tb(b_end - beats), gain)


# intro → title
riser(SC['title'] - 8, SC['title'] - 0.25, -20, top=6000)
reverse_swell(SC['title'], 2, -16)
braam(SC['title'], 'Dm', -9)
impact(SC['title'], -6)
# breakdown → DROP
riser(SC['match'], SC['battle'] - 0.5, -12)
reverse_swell(SC['battle'], 2, -14, 'A')
braam(SC['battle'], 'Dm', -8)
impact(SC['battle'], -6)
braam(SC['battle'] + 24, 'Gm', -10)
# the last ship
reverse_swell(SC['battle'] + 52, 2, -16)
impact(SC['battle'] + 52, -8)
# VICTORY: the biggest hit
braam(SC['victory'], 'Bb', -4, 3.5)
impact(SC['victory'], -2)
# bento riser → supercut peak
riser(SC['bento'], SC['supercut'] - 0.25, -12)
reverse_swell(SC['supercut'], 2, -14, 'A')
braam(SC['supercut'], 'Dm', -8)
impact(SC['supercut'], -6)
braam(SC['finale'] - 2, 'Dm', -4, 2.0)
impact(SC['finale'] - 2, -2)
stems['fx'] += fxb

# ── Hard cuts to silence ─────────────────────────────────────────────────────
def gate(b0, b1, fade_ms=8):
    s0, s1 = int(tb(b0) * SR), int(tb(b1) * SR)
    fl = int(fade_ms / 1000 * SR)
    for k, s in stems.items():
        s[:, s0 + fl:s1] = 0
        s[:, s0:s0 + fl] *= np.linspace(1, 0, fl)


gate(SC['battle'] - 0.5, SC['battle'])  # the suck before the drop
gate(SC['victory'] - 0.5, SC['victory'])  # half a beat of silence before victory
gate(SC['supercut'] - 0.25, SC['supercut'])
# peak → hard cut to silence at the finale; only the finale's own layers survive
fin_start = int(tb(SC['finale']) * SR)
for k in stems:
    stems[k][:, fin_start:] = 0
place(stems['pad'], fx(fin, pb.Reverb(room_size=0.95, damping=0.3, wet_level=0.55, dry_level=0.6, width=1.0))[:, fin_start:], tb(SC['finale']))

# ── Mix the stems ────────────────────────────────────────────────────────────
levels = {'drone': 0, 'pad': 0, 'bass': -1, 'drums': 0, 'arp': 0, 'fx': 0}
# sidechain: pad, arp and grit duck on each kick in the grooves
duck = np.ones(N)
for b in range(SC['wallet'], SC['finale']):
    s = int(tb(b) * SR)
    n = int(0.28 * SR)
    if s + n < N:
        duck[s:s + n] = np.minimum(duck[s:s + n], 1 - 0.45 * np.exp(-np.arange(n) / (0.09 * SR)))
for k in ('pad', 'arp'):
    stems[k] *= duck
mix = sum(stems[k] * db(levels[k]) for k in stems)

# ── Macro-dynamics: scene-level gain automation (dB), linear between keys ────
KEYS = [
    (0, 0), (SC['title'], 0), (SC['wallet'], 2), (SC['wallet'] + 0.01, 3),
    (SC['build'], 4), (SC['fleet'], 5), (SC['match'], 5.5), (SC['match'] + 0.01, 2),
    (SC['battle'] - 0.01, 4), (SC['battle'], 5), (SC['battle'] + 40, 5.5), (SC['battle'] + 40.01, 2),
    (SC['victory'], 3), (SC['victory'] + 4, 2), (SC['economy'], 4.5), (SC['bento'], 5.5),
    (SC['supercut'], 6), (SC['finale'], 6), (SC['finale'] + 0.01, 3), (TOTAL + 8, 3),
]
kb = np.array([k for k, _ in KEYS]); kg = np.array([g for _, g in KEYS])
tt = np.arange(N) / SR
gain_db = np.interp((tt - OFF) / BEAT, kb, kg)
mix = mix * db(gain_db)
mix = fx(mix, pb.HighpassFilter(cutoff_frequency_hz=24), pb.Compressor(threshold_db=-8, ratio=1.6, attack_ms=25, release_ms=250))
mix = mix / np.abs(mix).max() * db(-1.0)

os.makedirs(os.path.join(ROOT, 'build/stems'), exist_ok=True)
os.makedirs(os.path.join(ROOT, 'public/audio'), exist_ok=True)
for k, s in stems.items():
    write(os.path.join(ROOT, f'build/stems/{k}.wav'), s)
write(os.path.join(ROOT, 'public/audio/score.wav'), mix, peak_db=-3.0)
print('score.wav', mix.shape[1] / SR, 's peak', 20 * np.log10(np.abs(mix).max()))
