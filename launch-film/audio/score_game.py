"""
The film's music, built only from the game's own audio (assets/audio):

  music_menu.mp3    106.6 BPM, E minor theme → time-stretched to 120 BPM (Rubber Band, pitch kept)
  music_battle.mp3  120 BPM drone + 8th-note pulse (already on the film's grid)
  sfx/*.mp3         the drum kit and the big moments: mine = kick, explosion = snare,
                    splash = hats, nuke / ship_sink = hits, reversed nuke = risers, mine = heartbeat

Arranged bar by bar onto the scene grid in src/config/timeline.ts (build/timeline.json):
  cold open  near-silence: the battle drone, low-passed, very quiet; reversed nuke into the hit
  title      HIT, the menu theme enters (filter opening)
  journey    the theme (12-bar loop), the game's splash/mine joining as percussion
  match      breakdown: the theme sinks under a closing filter, reversed-nuke riser, suck
  battle     THE DROP: the battle track + the game-SFX kit
  heartbeat  the battle track under water, a mine heartbeat
  victory    the theme returns
  economy    the theme + the kit, rising
  bento      riser, explosion-snare roll
  supercut   the battle track + kit at full; hard cut to silence
  finale     a reverb-frozen chord from the theme (the soft tone), the theme as a memory, fading

Run: python3 audio/score_game.py → public/audio/score_game.wav
"""
import json, os
import numpy as np
import librosa
import pedalboard as pb
from synth import SR, db, fx, load, place, static_filter, sweep_filter, write, stereo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = json.load(open(os.path.join(ROOT, 'build/timeline.json')))
BPM, OFF = T['bpm'], T['beatOffset']
SC = {k: v['start'] for k, v in T['scenes'].items()}
TOTAL = T['totalBeats']
BEAT = 60 / BPM
BAR = 4 * BEAT
N = int((OFF + TOTAL * BEAT + 3.0) * SR)
MUSIC = '/home/user/battleship-solana-mobile/assets/audio/music/'


def tb(b):
    return OFF + b * BEAT


def trim_onset(x):
    a = np.abs(x).max(0)
    return x[:, int(np.argmax(a > a.max() * 0.05)):]


def lufs_norm(x, target=-18.0):
    import pyloudnorm as pyln
    L = pyln.Meter(SR).integrated_loudness(x.T)
    return x * db(target - L)


# ── the two themes, on the 120 BPM grid ──────────────────────────────────────
menu_raw, _ = librosa.load(MUSIC + 'music_menu.mp3', sr=SR, mono=False)
MENU_RATE = BPM / 106.61  # measured by tools/beats.py
menu = pb.time_stretch(menu_raw.astype(np.float32), SR, stretch_factor=MENU_RATE, high_quality=True).astype(np.float64)
menu = lufs_norm(menu, -18)
MENU_BAR0 = 0.5399 / MENU_RATE  # first downbeat, stretched
MENU_BARS = 12  # 12-bar loop: bar 12 ≈ bar 0 harmonically (measured)

battle, _ = librosa.load(MUSIC + 'music_battle.mp3', sr=SR, mono=False)
battle = lufs_norm(battle.astype(np.float64), -18)
BATTLE_BAR0 = 0.029  # tools/beats.py: 119.99 BPM, first beat 0.029 s
BATTLE_BARS = 14  # 60 beats = 15 bars; keep 14 whole bars clear of the file end


def bar_slice(src, bar0, bar, xfade=0.012):
    """one bar of a theme (plus a short tail for the crossfade)"""
    s = int((bar0 + bar * BAR) * SR)
    e = int((bar0 + (bar + 1) * BAR + xfade) * SR)
    x = src[:, s:e].copy()
    fl = int(xfade * SR)
    x[:, :fl] *= np.linspace(0, 1, fl)
    x[:, -fl:] *= np.linspace(1, 0, fl)
    return x


def lay(bus, src, bar0, nbars_loop, film_bar0, film_bar1, start_bar=0, gain=0.0):
    """lay theme bars on film bars [film_bar0, film_bar1), looping the theme"""
    for k, fb in enumerate(range(film_bar0, film_bar1)):
        b = (start_bar + k) % nbars_loop
        place(bus, bar_slice(src, bar0, b), tb(fb * 4) - 0.012, gain)


stems = {k: np.zeros((2, N)) for k in ('theme', 'battle', 'kit', 'fx')}
fb = lambda scene, rel=0: SC[scene] // 4 + rel  # film bar of a scene

# theme: title → match (with the breakdown handled by a filter below)
lay(stems['theme'], menu, MENU_BAR0, MENU_BARS, fb('title'), fb('battle'), start_bar=0)
# theme returns at victory, through the bento
lay(stems['theme'], menu, MENU_BAR0, MENU_BARS, fb('victory'), fb('supercut'), start_bar=0)
# battle: the drop and the heartbeat, then the supercut
lay(stems['battle'], battle, BATTLE_BAR0, BATTLE_BARS, fb('battle'), fb('victory'), start_bar=0)
lay(stems['battle'], battle, BATTLE_BAR0, BATTLE_BARS, fb('supercut'), fb('finale'), start_bar=4)
# cold open: the battle drone, far away
drone = np.zeros((2, N))
lay(drone, battle, BATTLE_BAR0, BATTLE_BARS, 0, fb('title'), start_bar=8)
drone = static_filter(drone, 260, 'lowpass', order=4)
env = np.clip((np.arange(N) / SR - 0.5) / 6.0, 0, 1) ** 2
stems['fx'] += fx(drone * env * db(-19), pb.Reverb(room_size=0.9, wet_level=0.5, dry_level=0.6))

# ── filters and levels on the themes ─────────────────────────────────────────
t = np.arange(N) / SR
beat_at = (t - OFF) / BEAT


def ramp(b0, b1, v0, v1):
    return np.clip((beat_at - b0) / (b1 - b0), 0, 1) * (v1 - v0) + v0


# title: the theme opens up from a low-pass as the beat enters
cut = np.full(N, 18000.0)
m = (beat_at >= SC['title']) & (beat_at < SC['wallet'])
cut[m] = (900 * (18000 / 900) ** ramp(SC['title'], SC['wallet'], 0, 1))[m]
# match: breakdown, the theme sinks under a closing filter
m = (beat_at >= SC['match']) & (beat_at < SC['battle'])
cut[m] = (3500 * (300 / 3500) ** ramp(SC['match'], SC['battle'] - 1, 0, 1))[m]
# bento: the theme brightens and lifts into the peak
stems['theme'] = sweep_filter(stems['theme'], cut, 'lowpass', q=0.8)

# heartbeat: the battle track under water
hb = (beat_at >= SC['battle'] + 40) & (beat_at < SC['victory'])
under = static_filter(stems['battle'], 320, 'lowpass', order=4)
stems['battle'][:, hb] = under[:, hb] * db(-21)

# ── the kit: the game's own sounds ───────────────────────────────────────────
MINE = trim_onset(load('mine.mp3'))
EXPL = trim_onset(load('explosion.mp3')) * db(18)
SPL = trim_onset(load('splash.mp3')) * db(10)
SHOT = trim_onset(load('shot_fire.mp3')) * db(12)
NUKE = trim_onset(load('nuke.mp3'))
SINK = trim_onset(load('ship_sink.mp3'))


def shape(x, dur, fade=0.03):
    n = min(x.shape[1], int(dur * SR))
    y = x[:, :n].copy()
    fl = min(n, int(fade * SR))
    y[:, n - fl:] *= np.linspace(1, 0, fl)
    return y


KICK = shape(static_filter(MINE, 220, 'lowpass', order=2) * db(6), 0.42)
KICK_TOP = shape(static_filter(SHOT, 900, 'lowpass'), 0.2)
SNARE = shape(static_filter(EXPL, 350, 'highpass'), 0.26)
SNARE = fx(SNARE, pb.Compressor(threshold_db=-20, ratio=4, attack_ms=1, release_ms=80), pb.Reverb(room_size=0.3, wet_level=0.18))
HAT = shape(static_filter(SPL, 5500, 'highpass'), 0.09, 0.02)
HEART = shape(static_filter(MINE, 120, 'lowpass', order=4) * db(10), 0.35)

kit = np.zeros((2, N))
for b in range(SC['title'], SC['finale']):
    bb = b % 4
    battle_drop = SC['battle'] <= b < SC['battle'] + 40
    supercut = SC['supercut'] <= b < SC['finale'] - 2
    heavy = battle_drop or supercut
    if SC['battle'] + 40 <= b < SC['victory']:
        continue  # heartbeat section (below)
    if SC['match'] <= b < SC['battle']:
        continue  # breakdown: no kit
    if b < SC['wallet']:
        if bb in (0, 2):
            place(kit, KICK, tb(b), -8)  # the beat enters, half-time
        continue
    if SC['victory'] <= b < SC['victory'] + 4:
        continue  # let the victory sting speak
    # kick
    if heavy:
        place(kit, KICK, tb(b), -2)
        place(kit, KICK_TOP, tb(b), -14)
        if bb == 3:
            place(kit, KICK, tb(b + 0.5), -8)
    elif b >= SC['fleet'] or b >= SC['economy']:
        if bb in (0, 2) or (SC['economy'] <= b and bb in (0, 1, 2, 3)):
            place(kit, KICK, tb(b), -7)
    elif b >= SC['build'] and bb in (0, 2):
        place(kit, KICK, tb(b), -11)
    # snare on 2 and 4
    if bb in (1, 3) and (heavy or b >= SC['fleet']):
        place(kit, SNARE, tb(b), -4 if heavy else -10)
    # hats
    if heavy:
        for k in range(2):
            place(kit, HAT, tb(b + k * 0.5 + 0.25), -12)
            place(kit, HAT, tb(b + k * 0.5), -16)
    elif b >= SC['build']:
        place(kit, HAT, tb(b + 0.5), -15)
# explosion-snare rolls into the two drops
for start in (SC['battle'] - 4, SC['supercut'] - 4):
    for k in range(28):
        bb = start + k / 8
        place(kit, SNARE, tb(bb), -26 + 18 * (k / 28) ** 1.5)
# the heartbeat: lub-dub every two beats
for b in np.arange(SC['battle'] + 40, SC['victory'] - 1, 2):
    place(kit, HEART, tb(b), -17)
    place(kit, HEART, tb(b + 0.36), -22)
stems['kit'] += kit

# ── the big moments and the risers (the game's nuke, sink, explosion) ────────
fxb = np.zeros((2, N))


def hit(b, gain=0.0, sink=True):
    place(fxb, static_filter(NUKE, 180, 'lowpass', order=2) * db(6), tb(b), gain)  # the low body
    if sink:
        place(fxb, SINK, tb(b), gain - 6)


def riser(b_end, beats, gain=-8.0):
    """a reversed, reverb-smeared nuke building into b_end"""
    n = int(beats * BEAT * SR)
    wet = fx(NUKE, pb.Reverb(room_size=0.97, damping=0.3, wet_level=1.0, dry_level=0.2))
    rev = wet[:, ::-1]
    rev = rev[:, -n:] if rev.shape[1] >= n else np.pad(rev, ((0, 0), (n - rev.shape[1], 0)))
    rev = rev * np.linspace(0, 1, rev.shape[1]) ** 2.2
    rev = sweep_filter(rev, np.geomspace(300, 9000, rev.shape[1]), 'lowpass', q=1.0)
    place(fxb, rev * db(8), tb(b_end) - n / SR, gain)


riser(SC['title'], 4, -10)
hit(SC['title'], -2)
riser(SC['battle'] - 0.5, 6, -6)
hit(SC['battle'], -1)
hit(SC['victory'], 0)
riser(SC['supercut'] - 0.25, 8, -6)
hit(SC['supercut'], -2)
stems['fx'] += fxb

# ── finale: a frozen chord from the theme (the soft tone), then the theme as a memory ─
fin = np.zeros((2, N))
chord = menu[:, int((MENU_BAR0 + 4 * BAR) * SR):int((MENU_BAR0 + 4 * BAR + 0.35) * SR)]
chord = chord * np.hanning(chord.shape[1])
frozen = fx(np.pad(chord, ((0, 0), (0, int(9 * SR)))), pb.Reverb(room_size=1.0, damping=0.5, wet_level=1.0, dry_level=0.0, freeze_mode=1.0, width=1.0))
frozen = static_filter(frozen, [180, 2400], 'bandpass')
n = frozen.shape[1]
env = np.minimum(1, np.arange(n) / (0.5 * SR)) * np.clip(1 - (np.arange(n) / SR - 4.0) / 2.5, 0, 1)
place(fin, frozen * env, tb(SC['finale'] + 2), -17)
memory = np.zeros((2, N))
lay(memory, menu, MENU_BAR0, MENU_BARS, fb('finale', 1), fb('finale', 5), start_bar=0)
memory = fx(static_filter(memory, 900, 'lowpass', order=2), pb.Reverb(room_size=0.95, wet_level=0.7, dry_level=0.4))
env = np.clip(ramp(SC['finale'] + 5, SC['finale'] + 9, 0, 1), 0, 1) * np.clip(ramp(SC['finale'] + 14, SC['finale'] + 20, 1, 0), 0, 1)
fin += memory * env * db(-22)
stems['fx'] += fin

# ── macro-dynamics (dB by beat), hard silences ───────────────────────────────
KEYS = [
    (0, 0), (SC['title'], 0), (SC['wallet'], 0.5), (SC['build'], 1), (SC['fleet'], 1.5), (SC['match'], 1.5),
    (SC['match'] + 0.01, -1), (SC['battle'] - 0.01, 0), (SC['battle'], 1), (SC['battle'] + 40, 1),
    (SC['battle'] + 40.01, -2), (SC['victory'], 1), (SC['victory'] + 4, 1), (SC['economy'], 1),
    (SC['bento'], 2), (SC['supercut'], 1.5), (SC['finale'], 1.5), (SC['finale'] + 0.01, 0), (TOTAL + 8, 0),
]
g = np.interp(beat_at, [k for k, _ in KEYS], [v for _, v in KEYS])
levels = {'theme': -1, 'battle': 0, 'kit': 0, 'fx': 0}
mix = sum(stems[k] * db(levels[k]) for k in stems) * db(g)


def gate(b0, b1, fade_ms=8):
    s0, s1 = int(tb(b0) * SR), int(tb(b1) * SR)
    fl = int(fade_ms / 1000 * SR)
    mix[:, s0 + fl:s1] = 0
    mix[:, s0:s0 + fl] *= np.linspace(1, 0, fl)


gate(SC['battle'] - 0.5, SC['battle'])
gate(SC['victory'] - 0.5, SC['victory'])
gate(SC['supercut'] - 0.25, SC['supercut'])
# peak → hard cut to silence; only the finale's own layers after it
fs = int(tb(SC['finale']) * SR)
mix[:, fs:] = fin[:, fs:] * db(g[fs:])
mix = fx(mix, pb.HighpassFilter(cutoff_frequency_hz=28), pb.Compressor(threshold_db=-10, ratio=1.6, attack_ms=25, release_ms=250))
mix = mix / np.abs(mix).max() * db(-1.0)
os.makedirs(os.path.join(ROOT, 'build/stems'), exist_ok=True)
for k, s in stems.items():
    write(os.path.join(ROOT, f'build/stems/game_{k}.wav'), s)
write(os.path.join(ROOT, 'public/audio/score_game.wav'), mix, peak_db=-3.0)
print('score_game.wav', round(mix.shape[1] / SR, 2), 's')
