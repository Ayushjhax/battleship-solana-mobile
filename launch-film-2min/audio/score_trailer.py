"""
Trailer score for the Empire of Bits launch film: a hybrid epic-trailer cue (D minor, 120 BPM)
built to the scene grid in src/config/timeline.ts (read via build/timeline.json). Instruments
are in audio/trailer_kit.py.

  0:00 cold open    distant war drums, drone, ticking clock, riser + reverse swell into…
  0:08 title        BRAAM + impact + sub drop; the ostinato engine starts under the title
  0:14 journey      wallet → build → fleet → arsenal: drums, strings and braams stack bar by bar
  0:42 matchmaking  breakdown: ticking clock, snare roll, risers, half a beat of silence
  0:46 battle       THE DROP: trap/epic hybrid (808s, taikos, half-time snare, trap hats, braams)
                    Aim / Fire (stop, tick, rise) → HIT → horn theme + choir → four hits →
                    heartbeat → the last ship (hit) → riser, silence
  1:14 victory      the biggest hit: Bb-major braam, choir, horn fanfare (Bb–F–C)
  1:20 economy      four-on-the-floor banger: 808 octaves, claps, 16th hats, pluck arp, pumping pads
  1:32 bento        lift → snare roll + riser → a quarter beat of silence
  1:38 supercut     a hit on every cut, horns + choir, the biggest braam on the nuke → hard cut
  1:44 finale       silence → one soft tone → warm bloom on the dApp Store badge →
                    the button (D5 braam) on the logo → tail

Run: python3 audio/score_trailer.py   → public/audio/score_trailer.wav (+ build/stems/trailer_*.wav)
Then: npm run mix (MUSIC_FILE = 'audio/score_trailer.wav' in timeline.ts).
"""
import json, os
import numpy as np
import pedalboard as pb
import pyloudnorm as pyln

from synth import SR, db, stereo, place, write, fx, static_filter
from master import lookahead_limit
import trailer_kit as K

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = json.load(open(os.path.join(ROOT, 'build/timeline.json')))
BPM, OFF = T['bpm'], T['beatOffset']
SC = {k: v['start'] for k, v in T['scenes'].items()}
TOTAL = T['totalBeats']
BEAT = 60 / BPM
N = int(round((OFF + TOTAL * BEAT) * SR))
NB = N + K.ns(8)  # room for tails while rendering; cropped to N at the end

STEMS = ('drums', 'perc', 'bass', 'reese', 'ost', 'harm', 'hits', 'trans')
MAIN = {k: np.zeros((2, NB), np.float32) for k in STEMS}
FIN = {k: np.zeros((2, NB), np.float32) for k in STEMS}  # the finale, after the hard cut
BUS = MAIN


def tb(b):
    return OFF + b * BEAT


def put(stem, x, beat, gain=0.0, pre=0.0, pan=None):
    if pan is not None and np.ndim(x) == 1:
        x = stereo(x, pan)
    place(BUS[stem], x, tb(beat) - pre, gain)


def put_ending(stem, x, end_beat, gain=0.0):
    """Place x so that it ENDS on end_beat (risers, reverse swells)."""
    place(BUS[stem], x, tb(end_beat) - x.shape[-1] / SR, gain)


def curve(keys):
    kb = np.array([k for k, _ in keys], float)
    kv = np.array([v for _, v in keys], float)
    return lambda b: float(np.interp(b, kb, kv))


def q(x, step=0.05):
    """Quantise a parameter so the instrument caches hit."""
    return round(round(x / step) * step, 3)


# ── Harmony ───────────────────────────────────────────────────────────────────
PC = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'Ab': 8, 'A': 9, 'Bb': 10, 'B': 11}
QUAL = {'m': (0, 3, 7), '': (0, 4, 7), '5': (0, 7), 'maj9': (0, 4, 7, 11, 14)}


def split(name):
    r = name[:2] if len(name) > 1 and name[1] in 'b#' else name[:1]
    return PC[r], QUAL[name[len(r):]]


def lowest(pc, lo):
    return lo + (pc - lo) % 12


def tones(name, lo, hi):
    pc, ivs = split(name)
    pcs = {(pc + i) % 12 for i in ivs}
    return [m for m in range(lo, hi + 1) if m % 12 in pcs]


def pad_notes(name, lo=48):
    pc, _ = split(name)
    r = lowest(pc, lo)
    return [r] + tones(name, r + 1, r + 19)[:5]


def braam_notes(name):
    pc, ivs = split(name)
    r = lowest(pc, 26)
    notes = [r, r + 7, r + 12, r + 19]
    third = [i for i in ivs if i in (3, 4)]
    if third:
        notes.append(r + 12 + third[0])
    return sorted(notes)


def choir_notes(name):
    return tones(name, 50, 74)


PROG = [
    (0, 'Dm'), (24, 'Bb'), (28, 'Dm'), (32, 'Bb'),
    (36, 'Dm'), (40, 'Bb'), (44, 'F'), (48, 'C'), (52, 'Gm'), (56, 'A'),
    (60, 'Dm'), (64, 'Bb'), (68, 'C'),
    (72, 'Dm'), (76, 'F'), (80, 'C'),
    (84, 'Bb'), (88, 'A'),
    (92, 'Dm'), (96, 'Bb'), (100, 'A'),
    (104, 'Dm'), (108, 'Bb'), (112, 'Gm'), (116, 'A'), (120, 'Dm'), (124, 'Bb'), (128, 'A'),
    (132, 'Dm'), (140, 'Bb'), (142, 'A'), (144, 'Dm'), (146, 'A'),
    (148, 'Bb'), (152, 'F'), (156, 'C'),
    (160, 'Dm'), (164, 'Bb'), (168, 'F'), (172, 'C'), (176, 'Dm'), (180, 'Bb'),
    (184, 'F'), (188, 'C'), (192, 'A'),
    (196, 'Dm'), (200, 'Bb'), (204, 'A'), (206, 'Dm'),
    (208, 'D5'), (214, 'Bbmaj9'), (220.5, 'D5'),
]


def chord(b):
    name = PROG[0][1]
    for s, c in PROG:
        if s <= b + 1e-9:
            name = c
    return name


def segments(b0, b1):
    cuts = sorted({b0, b1} | {s for s, _ in PROG if b0 < s < b1})
    return [(a, z, chord(a)) for a, z in zip(cuts[:-1], cuts[1:])]


def root(b, lo):
    return lowest(split(chord(b))[0], lo)


KICKS = []  # (beat, depth) → the sidechain pump


# ── Drums ─────────────────────────────────────────────────────────────────────
def kick(b, gain=-5.0, pump=0.5):
    put('drums', K.kick(51.0, 0.26), b, gain)
    KICKS.append((b, pump))


def b808(b, length_beats, gain=-7.0, octave=0):
    L = q(max(0.1, min(1.6, length_beats * BEAT)), 0.0625)
    put('bass', K.bass808(root(b, 29) + 12 * octave, L), b, gain)


def hats(bar, gain=-18.0, sixteenths=False, roll=False):
    for s in range(0, 16, 1 if sixteenths else 2):
        acc = s % 4 == 2
        put('drums', K.hat(0.018), bar + s / 4, gain + (0 if acc else -4) + (-4 if s % 2 else 0))
    if roll:
        for k in range(8):
            put('drums', K.hat(0.012), bar + 3 + k / 8, gain - 6 + k * 0.9)


def snare_roll(b0, b1, g0=-24.0, g1=-8.0, accel=True):
    """A roll whose density rises from 8ths to 32nds, with a crescendo."""
    b = b0
    while b < b1 - 1e-6:
        x = (b - b0) / (b1 - b0)
        put('drums', K.snare(200.0, 0.12, 1), b, g0 + (g1 - g0) * x ** 1.3)
        step = (0.5 if x < 0.25 else 0.25 if x < 0.6 else 0.125) if accel else 0.25
        b += step


def taiko_build(b0, b1, g0=-18.0, g1=-6.0):
    b = b0
    while b < b1 - 1e-6:
        x = (b - b0) / (b1 - b0)
        put('perc', K.taiko_ens(62.0, 0.32, 3, 3), b, g0 + (g1 - g0) * x)
        b += 0.5 if x < 0.5 else 0.25


def ticking(b0, b1, step=0.5, g0=-30.0, g1=-22.0):
    b, k = b0, 0
    while b < b1 - 1e-6:
        x = (b - b0) / (b1 - b0)
        put('trans', K.tick(3300.0 if k % 2 == 0 else 2500.0), b, g0 + (g1 - g0) * x, pan=None)
        b += step
        k += 1


def groove_epic(bar, level=1.0, snare=True, hat=True, full_taiko=True):
    """Journey groove: taikos on 1 and 3 (+ the 3-3-2 pattern when full), kick, backbeat."""
    g = -6 * (1 - level)
    put('perc', K.taiko_ens(56.0, 0.55, 4, 0), bar, -5 + g)
    put('perc', K.taiko_ens(60.0, 0.5, 4, 1), bar + 2, -7 + g)
    kick(bar, -8 + g, 0.35)
    kick(bar + 2, -9 + g, 0.35)
    if full_taiko:
        for s in (3, 6, 11, 14):
            put('perc', K.taiko(88.0, 0.22, s), bar + s / 4, -13 + g, pan=(-0.5 if s % 2 else 0.5))
    if snare:
        for s in (4, 12):
            put('drums', K.epic_snare(0), bar + s / 4, -11 + g)
    if hat:
        hats(bar, -21 + g)


def groove_drop(bar, variant, braam_on=True):
    """THE DROP: trap kick pattern with 808s, half-time epic snare, taikos, trap hats."""
    kicks = (0, 7, 10) if variant == 0 else (0, 6, 10, 13)
    for i, s in enumerate(kicks):
        nxt = kicks[i + 1] if i + 1 < len(kicks) else 16
        kick(bar + s / 4, -4, 0.55)
        b808(bar + s / 4, (nxt - s) / 4, -6)
    put('drums', K.epic_snare(0), bar + 2, -4)
    put('perc', K.taiko_ens(54.0, 0.6, 4, 0), bar, -3)
    for s in (4, 12):
        put('perc', K.taiko_ens(72.0, 0.35, 3, 5), bar + s / 4, -10)
    for s in (3, 6, 11, 14):
        put('perc', K.taiko(92.0, 0.22, s), bar + s / 4, -12, pan=(-0.5 if s % 2 else 0.5))
    hats(bar, -15, sixteenths=False, roll=(variant == 1))
    if variant == 0:
        put('drums', K.crash(1.6, 0), bar, -15)
        if braam_on:
            put('hits', K.braam(braam_notes(chord(bar)), 1.9, 0.75, seed=int(bar)), bar, -9)
    put('reese', K.reese(root(bar, 38), 4 * BEAT, 650.0, 0.5, seed=int(bar)), bar, -15)


def groove_banger(bar, gain=0.0, open_hats=True):
    """Economy: four-on-the-floor, 808 octaves on the 8ths, claps on 2 and 4, 16th hats."""
    for s in (0, 4, 8, 12):
        kick(bar + s / 4, -5 + gain, 0.6)
    for k in range(8):
        b808(bar + k / 2, 0.45, -9 + gain, octave=(k % 2))
    for s in (4, 12):
        put('drums', K.epic_snare(1), bar + s / 4, -7 + gain)
    hats(bar, -17 + gain, sixteenths=True)
    if open_hats:
        for s in (2, 6, 10, 14):
            put('drums', K.hat(0.09, 1), bar + s / 4, -22 + gain)
    put('perc', K.taiko_ens(56.0, 0.55, 4, 0), bar, -8 + gain)


# ── Strings, pads, choir, horns ───────────────────────────────────────────────
ACC = {0, 3, 6, 8, 11, 14}
OST_GAIN = curve([(20, -32), (28, -23), (36, -20), (60, -17), (84, -16), (84.01, -22), (91.5, -15), (92, -14),
                  (132, -13), (140, -24), (144, -15), (152, -21), (160, -18), (196, -12), (208, -12)])
OST_BRIGHT = curve([(20, 0.05), (28, 0.2), (60, 0.45), (84, 0.55), (84.01, 0.2), (91.5, 0.7), (92, 0.75),
                    (132, 0.85), (140, 0.3), (144, 0.6), (152, 0.4), (196, 0.9), (208, 1.0)])


def ostinato(b0, b1, high_from=None):
    for step in range(int(round(b0 * 4)), int(round(b1 * 4))):
        b = step / 4
        s = step % 16
        r = root(b, 38)
        acc = s in ACC
        g = OST_GAIN(b) + (0 if acc else -7)
        br = q(OST_BRIGHT(b))
        put('ost', K.spiccato(r, 0.125, br), b, g, pan=-0.3)
        if high_from is not None and b >= high_from and (acc or s in (14, 15)):
            hm = r + 12 + (7 if s in (14, 15) else 0)
            put('ost', K.spiccato(hm, 0.125, br), b, g - 3, pan=0.35)


def pads(b0, b1, bright, gain, attack=0.15, release=0.9, lo=48):
    for a, z, name in segments(b0, b1):
        put('harm', K.pad(pad_notes(name, lo), (z - a) * BEAT, bright, attack, release, seed=int(a)), a, gain)


def choirs(b0, b1, gain, attack=0.3, release=1.2):
    for a, z, name in segments(b0, b1):
        put('harm', K.choir(choir_notes(name), (z - a) * BEAT, attack, release, seed=int(a)), a, gain)


NOTE = {'G4': 67, 'A4': 69, 'Bb4': 70, 'C5': 72, 'C#5': 73, 'D5': 74, 'E5': 76, 'F5': 77, 'G5': 79, 'F4': 65, 'D4': 62}


def horns(b, line, gain=-12.0, dyn=0.8):
    """line: [(note, beats), …] from beat b. Doubled an octave down."""
    for name, beats in line:
        m = NOTE[name]
        put('harm', K.brass(m, beats * BEAT, dyn, seed=int(b * 4)), b, gain)
        put('harm', K.brass(m - 12, beats * BEAT, dyn * 0.9, seed=int(b * 4) + 1), b, gain - 3)
        b += beats


THEME = [('A4', 3), ('D5', 1), ('D5', 2), ('C5', 1), ('Bb4', 1), ('Bb4', 2), ('A4', 1), ('G4', 1), ('A4', 4)]
FANFARE = [('F4', 1), ('Bb4', 1), ('D5', 2), ('C5', 3), ('A4', 1), ('C5', 2), ('E5', 2)]
FINAL = [('A4', 3), ('D5', 1), ('D5', 2), ('C5', 1), ('Bb4', 1), ('A4', 1), ('C#5', 1)]  # 196–206
FINAL_HIT = [('D5', 2)]  # on the nuke

# ═════════════════════════════════════════════════════════════════════════════
# 0:00 COLD OPEN — the bit
# ═════════════════════════════════════════════════════════════════════════════
put('trans', K.bell(86), 2, -24)
d = K.drone(26, 14 * BEAT + 0.3)
d *= np.minimum(1, np.arange(d.shape[1]) / K.ns(3.0))
put('trans', d, 2, -11)
for b, g in ((4, -16), (8, -12), (12, -9)):  # distant war drums
    put('perc', static_filter(K.taiko_ens(44.0, 0.9, 4, 7), 500), b, g)
ticking(8, 15.5, 0.5, -34, -24)
for b, g in ((9.5, -12), (14.5, -9), (15, -7)):  # flash-frame hits
    put('hits', K.sub_drop(0.8, 110, 40), b, g + 2)
    put('perc', K.taiko_ens(66.0, 0.3, 3, 9), b, g)
put_ending('trans', K.noise_riser(3.9 * BEAT, 8000, 300, 1), 15.9, -17)
put_ending('trans', K.shepard(3.9 * BEAT, 110, 1.5, 2), 15.9, -24)
put_ending('trans', K.reverse_swell(braam_notes('Dm')[1:], 2 * BEAT, 3), 16, -9)
put_ending('trans', K.reverse_crash(1.0, 1), 16, -15)

# ═════════════════════════════════════════════════════════════════════════════
# 0:08 TITLE — first hit
# ═════════════════════════════════════════════════════════════════════════════
t = SC['title']
put('hits', K.braam(braam_notes('Dm'), 5.5, 1.0, bend=-0.6, seed=16), t, -1)
put('hits', K.impact(1.0, 16, game_layer='nuke.mp3'), t, -2)
put('hits', K.sub_drop(3.0, 95, 27), t, -4)
choirs(t + 3.25, t + 8, -16, attack=1.6, release=1.5)
pads(t + 3.25, t + 12, 0.15, -22, attack=1.5)
d = K.drone(26, 12 * BEAT)
put('trans', d * np.linspace(1, 0, d.shape[1]) ** 0.5, t, -16)
ostinato(t + 4, SC['match'], high_from=SC['build'] + 8)
put('hits', K.braam(braam_notes('Bb'), 3.5, 0.8, seed=24), t + 8, -6)
put('perc', K.taiko_ens(54.0, 0.6, 4, 2), t + 8, -4)
taiko_build(t + 10, t + 12, -18, -8)

# ═════════════════════════════════════════════════════════════════════════════
# 0:14 → 0:42 THE JOURNEY — wallet, build, fleet, arsenal
# ═════════════════════════════════════════════════════════════════════════════
w = SC['wallet']
for bar in (w, w + 4):
    put('perc', K.taiko_ens(56.0, 0.55, 4, 0), bar, -6)
    put('perc', K.taiko_ens(60.0, 0.5, 4, 1), bar + 2, -9)
    for s in (14, 15):
        put('perc', K.taiko(92.0, 0.2, s), bar + s / 4, -15, pan=0.4)
    hats(bar, -26)
pads(w, SC['fleet'], 0.3, -17)

bu = SC['build']
put('drums', K.crash(1.4, 2), bu, -18)
groove_epic(bu, 0.6, snare=False, full_taiko=False)
groove_epic(bu + 4, 0.65, snare=False, full_taiko=False)
groove_epic(bu + 8, 0.75, snare=True)
groove_epic(bu + 12, 0.8, snare=True)
put('drums', K.crash(1.4, 3), bu + 16, -17)  # the defence cards fly in
groove_epic(bu + 16, 0.9)
groove_epic(bu + 20, 0.95)
snare_roll(bu + 22, bu + 24, -26, -10)
put_ending('trans', K.reverse_crash(1.0, 2), SC['fleet'], -16)
choirs(bu + 16, SC['fleet'], -19, attack=1.0)

f = SC['fleet']
put('hits', K.braam(braam_notes('Dm'), 2.6, 0.8, seed=60), f, -6)
put('drums', K.crash(1.6, 4), f, -15)
for bar in (f, f + 4, f + 8):
    groove_epic(bar, 1.0)
put('hits', K.braam(braam_notes('C'), 3.2, 0.95, seed=68), f + 8, -3)  # "8 ships."
put('hits', K.impact(0.6, 68), f + 8, -8)
pads(f, SC['match'], 0.45, -16)
choirs(f, SC['match'], -18)

a = SC['arsenal']
for bar in (a, a + 4, a + 8):
    groove_epic(bar, 1.0)
for k in range(6):  # the carousel steps one weapon per beat
    put('perc', K.taiko_ens(78.0, 0.25, 3, 11 + k), a + k, -10)
put('trans', K.bell(81), a + 6, -24)  # the atomic bomber settles
taiko_build(a + 10, a + 12, -14, -4)
put_ending('trans', K.reverse_crash(1.0, 3), SC['match'], -14)

# ═════════════════════════════════════════════════════════════════════════════
# 0:42 MATCHMAKING — breakdown into the drop
# ═════════════════════════════════════════════════════════════════════════════
m = SC['match']
put('hits', K.braam(braam_notes('Bb'), 2.6, 0.7, seed=84), m, -6)
put('hits', K.impact(0.5, 84), m, -9)
ostinato(m, m + 7.5, high_from=m + 4)
ticking(m, m + 4, 0.5, -28, -24)
ticking(m + 4, m + 7.5, 0.25, -24, -18)
put('perc', static_filter(K.taiko_ens(48.0, 0.8, 4, 6), 900), m + 2, -10)
put('hits', K.braam(braam_notes('A'), 2.0, 0.8, seed=89), m + 5, -6)  # lock-on: VS
put('perc', K.taiko_ens(54.0, 0.6, 4, 2), m + 5, -6)
snare_roll(m + 4, m + 7.5, -28, -7)
put_ending('trans', K.noise_riser(5.5 * BEAT, 9000, 250, 4), m + 7.5, -13)
put_ending('trans', K.tone_riser(45, 3.5 * BEAT, 2.0, 5), m + 7.5, -18)
put_ending('trans', K.shepard(7.5 * BEAT, 110, 1.6, 6), m + 7.5, -22)
pads(m, m + 7.5, 0.35, -21, attack=0.6)

# ═════════════════════════════════════════════════════════════════════════════
# 0:46 BATTLE — THE DROP
# ═════════════════════════════════════════════════════════════════════════════
B = SC['battle']
put('hits', K.braam(braam_notes('Dm'), 3.2, 1.0, seed=92), B, -2)
put('hits', K.impact(1.0, 92), B, -3)
put('hits', K.sub_drop(2.5, 90, 28), B, -5)
groove_drop(B, 0, braam_on=False)
groove_drop(B + 4, 1)
ostinato(B, B + 8, high_from=B)
pads(B, B + 8, 0.55, -19, attack=0.05)
choirs(B, B + 8, -18, attack=0.2)

# Aim. Fire. Hit. — everything stops but the clock
ticking(B + 8, B + 11.9, 0.25, -24, -14)
d = K.drone(33, 4 * BEAT)
put('trans', d, B + 8, -14)
put_ending('trans', K.tone_riser(45, 3.9 * BEAT, 2.0, 7), B + 11.9, -16)
put_ending('trans', K.noise_riser(3.9 * BEAT, 9000, 300, 8), B + 11.9, -16)
put_ending('trans', K.reverse_swell(braam_notes('Dm')[1:], 2 * BEAT, 9), B + 12, -8)
put('perc', K.taiko_ens(50.0, 0.7, 4, 4), B + 10, -8)  # Fire.

# HIT
H = B + 12
put('hits', K.braam(braam_notes('Dm'), 4.0, 1.0, seed=104), H, -1)
put('hits', K.impact(1.1, 104, game_layer='nuke.mp3'), H, -2)
put('hits', K.sub_drop(3.0, 95, 27), H, -4)
for i, bar in enumerate(range(H, B + 36, 4)):  # 104 … 128: the battle groove, horn theme on top
    groove_drop(bar, i % 2, braam_on=(i % 2 == 0 and i > 0))
ostinato(H, B + 40, high_from=H)
pads(H, B + 36, 0.6, -18, attack=0.05)
choirs(H, B + 36, -15, attack=0.2)
horns(H, THEME, -11, 0.85)
horns(B + 28, THEME[:5], -9, 1.0)  # 120: the theme again, louder
put('drums', K.crash(1.8, 5), B + 28, -12)
# four hits into the break (the four explosions on screen)
for k in range(4):
    bb = B + 36 + k
    put('perc', K.taiko_ens(52.0, 0.6, 4, 20 + k), bb, -5 + k)
    put('drums', K.epic_snare(0), bb, -8 + k)
    kick(bb, -5 + k * 0.5, 0.4)
    b808(bb, 1, -7)
    put('hits', K.braam(braam_notes('A'), 0.9, 0.6 + 0.1 * k, seed=128 + k), bb, -10 + 1.5 * k)
put('drums', K.crash(1.4, 6), B + 36, -13)
pads(B + 36, B + 40, 0.7, -18, attack=0.05)

# the heartbeat: every move matters
put('hits', K.sub_drop(2.5, 80, 27), B + 40, -4)
for bb in (B + 40, B + 42, B + 44, B + 46):
    put('perc', K.heartbeat(), bb, -5)
ticking(B + 40, B + 48, 0.5, -30, -26)
put('trans', K.drone(26, 8 * BEAT), B + 40, -12)
trem = K.pad([74, 75], 8 * BEAT, 0.5, 1.5, 0.5, voices=3, detune=6, seed=140)
trem = trem * (0.55 + 0.45 * np.sin(2 * np.pi * 16 * np.arange(trem.shape[1]) / SR))
put('harm', trem, B + 40, -26)

# the last ship
L = B + 48
taiko_build(L, L + 4, -20, -5)
snare_roll(L + 2, L + 4, -24, -8)
put_ending('trans', K.noise_riser(3.9 * BEAT, 9000, 250, 10), L + 3.9, -15)
put_ending('trans', K.reverse_swell(braam_notes('Dm')[1:], 2 * BEAT, 11), L + 4, -8)
pads(L, L + 4, 0.4, -20, attack=0.8)
put('hits', K.braam(braam_notes('Dm'), 3.6, 1.0, bend=-1.0, seed=144), L + 4, -1)
put('hits', K.impact(1.0, 144), L + 4, -2)
put('hits', K.sub_drop(2.5, 90, 27), L + 4, -5)
ostinato(L, L + 4)
# riser into victory, cut on the half-beat of silence
put_ending('trans', K.noise_riser(2.5 * BEAT, 10000, 400, 12), B + 55.5, -12)
put_ending('trans', K.shepard(3.5 * BEAT, 110, 1.8, 13), B + 55.5, -20)
put_ending('trans', K.reverse_swell(braam_notes('Bb')[1:], 1.5 * BEAT, 14), B + 55.5, -9)
snare_roll(B + 54, B + 55.5, -20, -6)

# ═════════════════════════════════════════════════════════════════════════════
# 1:14 VICTORY — the biggest hit
# ═════════════════════════════════════════════════════════════════════════════
V = SC['victory']
put('hits', K.braam(braam_notes('Bb'), 5.5, 1.0, seed=148), V, 0)
put('hits', K.impact(1.3, 148, game_layer='nuke.mp3'), V, -1)
put('hits', K.sub_drop(3.0, 95, 27), V, -3)
put('drums', K.crash(2.2, 7), V, -10)
choirs(V, SC['economy'], -12, attack=0.08)
pads(V, SC['economy'], 0.75, -17, attack=0.05)
horns(V, FANFARE, -9, 1.0)
for bar in (V + 4, V + 8):
    groove_epic(bar, 1.0)
ostinato(V + 4, SC['economy'], high_from=V + 4)
snare_roll(V + 10, V + 12, -22, -7)
put_ending('trans', K.reverse_crash(1.0, 4), SC['economy'], -14)

# ═════════════════════════════════════════════════════════════════════════════
# 1:20 ECONOMY → 1:32 BENTO — the banger
# ═════════════════════════════════════════════════════════════════════════════
E = SC['economy']
put('drums', K.crash(1.8, 8), E, -12)
put('hits', K.braam(braam_notes('Dm'), 2.0, 0.8, seed=160), E, -7)
for bar in range(E, SC['bento'] + 8, 4):
    groove_banger(bar, 0.0)
put('drums', K.crash(1.6, 9), E + 16, -14)
put('perc', K.taiko_ens(54.0, 0.6, 4, 2), E + 21, -6)  # punch into No. 1
put('drums', K.crash(1.4, 10), E + 21, -15)
pads(E, SC['bento'] + 8, 0.55, -18, attack=0.03, release=0.5)
choirs(E + 16, SC['bento'] + 8, -21)
ARP = (0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 4, 3, 2, 1, 2)
for step in range(E * 4, (SC['bento'] + 8) * 4):  # pluck arp on the 16ths
    b = step / 4
    ns_ = tones(chord(b), 62, 86)
    m_ = ns_[ARP[step % 16] % len(ns_)]
    put('ost', K.spiccato(m_, 0.1, 0.95, 1), b, -20 + (2 if step % 4 == 0 else 0), pan=(0.4 if step % 2 else -0.4))

Bt = SC['bento']
put('drums', K.crash(1.8, 11), Bt, -12)
put('hits', K.braam(braam_notes('F'), 2.0, 0.8, seed=184), Bt, -7)
# fly-in: build to the supercut, a quarter beat of silence
for k in range(4):
    kick(Bt + 8 + k, -5, 0.5)
    b808(Bt + 8 + k, 1, -8)
snare_roll(Bt + 8, Bt + 11.75, -22, -5)
put_ending('trans', K.noise_riser(3.75 * BEAT, 10000, 300, 15), Bt + 11.75, -12)
put_ending('trans', K.shepard(3.75 * BEAT, 110, 2.0, 16), Bt + 11.75, -19)
put_ending('trans', K.reverse_swell(braam_notes('Dm')[1:], 1.75 * BEAT, 17), Bt + 11.75, -9)
pads(Bt + 8, Bt + 11.75, 0.8, -18, attack=0.05)

# ═════════════════════════════════════════════════════════════════════════════
# 1:38 SUPERCUT — a hit on every cut, the biggest on the nuke
# ═════════════════════════════════════════════════════════════════════════════
S = SC['supercut']
for k in range(10):
    bb = S + k
    kick(bb, -4, 0.5)
    b808(bb, 1, -6)
    put('perc', K.taiko_ens(54.0, 0.5, 4, 30 + k % 3), bb, -4)
    put('drums', K.epic_snare(k % 2), bb, -7 if k % 2 else -9)
    if k % 2 == 0:
        put('drums', K.crash(1.2, 12 + k), bb, -16)
for bar in (S, S + 4):
    hats(bar, -15, sixteenths=True)
    put('hits', K.braam(braam_notes(chord(bar)), 1.9, 0.9, seed=int(bar)), bar, -6)
    put('reese', K.reese(root(bar, 38), 4 * BEAT, 900.0, 0.6, seed=int(bar)), bar, -14)
put('hits', K.braam(braam_notes('A'), 1.0, 0.9, seed=204), S + 8, -6)
snare_roll(S + 8, S + 10, -18, -5)
ostinato(S, S + 10, high_from=S)
pads(S, S + 10, 0.85, -16, attack=0.03)
choirs(S, S + 10, -11, attack=0.08)
horns(S, FINAL, -8, 1.0)
put_ending('trans', K.reverse_swell(braam_notes('Dm')[1:], 1.0 * BEAT, 18), S + 10, -8)
# the nuke: everything at once, then a hard cut to black
put('hits', K.braam(braam_notes('Dm'), 2.4, 1.0, seed=206), S + 10, 0)
put('hits', K.impact(1.5, 206, game_layer='nuke.mp3'), S + 10, 0)
put('hits', K.sub_drop(2.0, 95, 27), S + 10, -3)
put('drums', K.crash(2.0, 13), S + 10, -9)
choirs(S + 10, S + 12, -10, attack=0.03)
horns(S + 10, FINAL_HIT, -7, 1.0)
put('perc', K.taiko_ens(48.0, 0.8, 4, 40), S + 10, -2)

# ═════════════════════════════════════════════════════════════════════════════
# 1:44 FINALE — silence → one soft tone → the badge → the button
# ═════════════════════════════════════════════════════════════════════════════
BUS = FIN
F = SC['finale']
put('trans', K.bell(74, 2.2), F + 1.75, -18)  # "One more thing."
tone = K.pad([50, 57, 62], 4.25 * BEAT, 0.12, 1.6, 1.4, voices=3, detune=5, seed=209)
put('harm', tone, F + 1.75, -24)
put_ending('trans', K.reverse_swell(pad_notes('Bbmaj9', 50)[:4], 1.5 * BEAT, 19), F + 6, -16)
put('hits', K.sub_drop(2.5, 70, 27), F + 6, -9)  # the dApp Store badge
put('perc', K.taiko_ens(50.0, 0.7, 4, 41), F + 6, -12)
put('trans', K.bell(86, 2.0), F + 6, -22)
pads(F + 6, F + 12.5, 0.35, -19, attack=0.08, release=1.5, lo=46)
choirs(F + 6, F + 12.5, -20, attack=0.2)
put_ending('trans', K.reverse_swell(braam_notes('D5')[1:], 2 * BEAT, 20), F + 12.5, -10)
put_ending('trans', K.reverse_crash(1.2, 5), F + 12.5, -16)
# the button, on the logo
put('hits', K.braam(braam_notes('D5'), 6.0, 0.9, seed=220), F + 12.5, -1)
put('hits', K.impact(1.2, 220, game_layer='explosion.mp3'), F + 12.5, -2)
put('hits', K.sub_drop(3.5, 90, 26), F + 12.5, -4)
put('perc', K.taiko_ens(46.0, 0.9, 4, 42), F + 12.5, -3)
put('trans', K.bell(86, 3.0), F + 12.5, -17)
put('trans', K.bell(81, 3.0), F + 12.5, -21)
choirs(F + 12.5, F + 17, -16, attack=0.05, release=2.5)

# ═════════════════════════════════════════════════════════════════════════════
# Mix
# ═════════════════════════════════════════════════════════════════════════════
# sidechain pump from the kicks onto pads, reese and (lightly) the ostinato
duck = np.ones(NB)
for b, depth in KICKS:
    s = int(tb(b) * SR)
    n = K.ns(0.32)
    if s + n < NB:
        shape = 1 - depth * np.exp(-np.arange(n) / (0.075 * SR))
        duck[s:s + n] = np.minimum(duck[s:s + n], shape)
duck = np.convolve(duck, np.ones(96) / 96, mode='same')  # de-click

LEVEL = {'drums': 0, 'perc': -1, 'bass': -4.5, 'reese': -2, 'ost': 15, 'harm': 6, 'hits': -1.5, 'trans': -4}


def process(bus, pump):
    out = {}
    out['drums'] = K.reverb(bus['drums'], K.IR_ROOM, -13, hp=250)
    out['perc'] = K.reverb(bus['perc'], K.IR_HALL, -7, hp=90)
    out['bass'] = static_filter(bus['bass'], 2200, 'lowpass')
    out['reese'] = fx(bus['reese'] * (duck if pump else 1), pb.Distortion(drive_db=10), pb.LowpassFilter(cutoff_frequency_hz=2400), pb.HighpassFilter(cutoff_frequency_hz=45))
    out['ost'] = K.reverb(bus['ost'] * (0.4 + 0.6 * duck if pump else 1), K.IR_HALL, -11, hp=200)
    h = fx(bus['harm'] * (0.35 + 0.65 * duck if pump else 1), pb.Chorus(rate_hz=0.25, depth=0.15, mix=0.25))
    out['harm'] = K.reverb(h, K.IR_HALL, -4, hp=160)
    out['hits'] = K.reverb(bus['hits'], K.IR_EPIC, -8, hp=80, lp=6000)
    out['trans'] = K.reverb(bus['trans'], K.IR_HALL, -9, hp=150)
    return {k: v.astype(np.float32) for k, v in out.items()}


main = process(MAIN, True)
fin = process(FIN, False)


def silence(stems, b0, b1, fade_ms=8):
    s0, s1 = int(tb(b0) * SR), int(tb(b1) * SR)
    fl = K.ns(fade_ms / 1000)
    for x in stems.values():
        x[:, s0:s0 + fl] *= np.linspace(1, 0, fl)
        x[:, s0 + fl:s1] = 0


silence(main, SC['battle'] - 0.5, SC['battle'])
silence(main, SC['victory'] - 0.5, SC['victory'])
silence(main, SC['supercut'] - 0.25, SC['supercut'])
silence(main, SC['finale'], TOTAL + 16)  # peak → hard cut to black

stems = {k: main[k] + fin[k] for k in STEMS}
mix = sum(stems[k] * db(LEVEL[k]) for k in STEMS)

# macro dynamics (dB), linear between keys: the film's arc
ARC = [
    (0, -3), (SC['title'] - 4, -3), (SC['title'], 0), (SC['title'] + 4, -1), (SC['wallet'], -3.5), (SC['build'], -3.5),
    (SC['fleet'], -3), (SC['arsenal'], -2.5), (SC['match'], -2.5), (SC['match'] + 0.01, -4.5), (SC['battle'] - 0.5, 0), (SC['battle'], 0.5),
    (SC['battle'] + 40, 0.5), (SC['battle'] + 40.01, -1), (SC['victory'] - 0.5, 0), (SC['victory'], 1.5),
    (SC['economy'], 0), (SC['bento'], 0), (SC['supercut'], 1.0), (SC['finale'], 1.0), (SC['finale'] + 0.01, 0),
    (TOTAL - 1.5, 0), (TOTAL, -30), (TOTAL + 16, -60),
]
beats = (np.arange(NB) / SR - OFF) / BEAT
gain_db = np.interp(beats, [k for k, _ in ARC], [v for _, v in ARC])
mix = mix * db(gain_db)

mix = static_filter(mix, 30, 'highpass', 4)
mix = fx(mix, pb.LowShelfFilter(cutoff_frequency_hz=70, gain_db=-2.0), pb.HighShelfFilter(cutoff_frequency_hz=4000, gain_db=1.5),
         pb.Compressor(threshold_db=-14, ratio=2.0, attack_ms=15, release_ms=180))
mix = mix[:, :N]
meter = pyln.Meter(SR)
mix *= db(-16 - meter.integrated_loudness(mix.T))
mix = lookahead_limit(mix, -1.0)
# the master filters ring for ~80 ms after a hard cut: cut the silences again, after them
silence({'mix': mix}, SC['battle'] - 0.5, SC['battle'])
silence({'mix': mix}, SC['victory'] - 0.5, SC['victory'])
silence({'mix': mix}, SC['supercut'] - 0.25, SC['supercut'])
silence({'mix': mix}, SC['finale'], SC['finale'] + 1.7)

os.makedirs(os.path.join(ROOT, 'build/stems'), exist_ok=True)
os.makedirs(os.path.join(ROOT, 'public/audio'), exist_ok=True)
for k in STEMS:
    write(os.path.join(ROOT, f'build/stems/trailer_{k}.wav'), stems[k][:, :N])
write(os.path.join(ROOT, 'public/audio/score_trailer.wav'), mix)
print(f'score_trailer.wav {N / SR:.2f} s, {meter.integrated_loudness(mix.T):.1f} LUFS, peak {20 * np.log10(np.abs(mix).max()):.1f} dBFS')
