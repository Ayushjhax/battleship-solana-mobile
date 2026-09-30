"""Storyboard sheet: one panel per section with its source frame and beat/time. → review/storyboard.jpg"""
import json, os, subprocess
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
T = json.loads(subprocess.check_output(['node', '--experimental-strip-types', '--no-warnings', '-e',
    "import('./src/trailer45/timeline.ts').then(m=>console.log(JSON.stringify({S:m.SECTIONS,B:m.BEAT_SEC})))"]))
A = '../assets'
def vframe(src, t, out):
    subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-ss', str(t), '-i', src, '-frames:v', '1', '-vf', 'scale=640:-2', out])
P = {}
vframe('public/media/atomic.mp4', 1.45, 'build/sb/hook.jpg')
vframe('public/media/atomic.mp4', 1.1, 'build/sb/drop.jpg')
vframe('public/media/raid.mp4', 5.9, 'build/sb/victory.jpg')
vframe('public/media/build.mp4', 3.9, 'build/sb/build.jpg')
vframe('public/media/matchmaking.mp4', 3.2, 'build/sb/rival.jpg')
vframe('public/media/buy.mp4', 4.3, 'build/sb/economy.jpg')
panels = [
 ('hook', 'build/sb/hook.jpg', 'Atomic fireball, full bleed, zoom punch', '—'),
 ('cast', 'public/cast/hero/admiral.jpg', '4 hero cards, label lower-left', 'THE ADMIRAL. / TACTICIAN. / HUNTER. / CAPTAIN.'),
 ('claim', None, 'Black, two slammed lines', 'REAL PLAYERS. / REAL BATTLES.'),
 ('sting', None, 'One glowing pixel pings, bursts into a line', 'AN EMPIRE OF BITS ORIGINAL'),
 ('build', 'build/sb/build.jpg', 'Card → base: AA gun placed, Port City, defence snaps in', 'BUILD YOUR BASE.'),
 ('fleet', f'{A}/store/purple/fleet/battleship.png', 'Card → fleet whips into a lineup on 8ths', 'ASSEMBLE YOUR FLEET.'),
 ('arsenal', f'{A}/store/purple/attack/atomic-bomber.png', 'Card → 3D carousel, Atomic Bomber lands glowing', 'LOAD YOUR ARSENAL.'),
 ('rival', 'build/sb/rival.jpg', 'Card → radar → VS, rival facecam locks in', 'FIND YOUR RIVAL.'),
 ('silence', None, 'Letterbox in. Black. One click.', 'FIRE.'),
 ('drop', 'build/sb/drop.jpg', 'Flash → fireball; AA gun; bomber; split screen; grid wipes', 'HIT. / SUNK.'),
 ('victory', 'build/sb/victory.jpg', 'Card, then Victory screen in a bento of players', 'VICTORY.'),
 ('economy', 'build/sb/economy.jpg', 'Four cards + glass UI flashes', 'BUY POINTS. SELL POINTS. GEAR UP. CLIMB.'),
 ('breath', None, 'Hard black, silence, letterbox out', '—'),
 ('swarm', 'public/cast/photo/sofa.jpg', 'Wall of players flies in, builds the logo; one bit stays empty', '—'),
 ('live', 'demo-assets:logo', 'Logo eases up, dApp Store badge rises', '—'),
 ('yourMove', 'demo-assets:badge', 'Your move. — end card held to the last frame', 'Your move.'),
]
files = []
for sid, img, pic, txt in panels:
    a, b = T['S'][sid]
    t0, t1 = a * T['B'], b * T['B']
    out = f'build/sb/p_{sid}.png'
    base = ['convert', '-size', '640x360', 'xc:#07060d']
    if img == 'demo-assets:logo':
        img = f'{A}/images/brand/logo.png'
    if img == 'demo-assets:badge':
        img = '../demo-assets/solana-badge.png'
    if img:
        base = ['convert', img, '-resize', '640x360^', '-gravity', 'center', '-extent', '640x360']
    subprocess.check_call(base + ['-gravity', 'north', '-fill', '#000000a0', '-draw', 'rectangle 0,0 640,44',
        '-fill', '#F5F5F7', '-pointsize', '22', '-annotate', '+0+10', f'{sid.upper()}  ·  beats {a}–{b}  ·  {t0:.2f}–{t1:.2f} s',
        '-gravity', 'south', '-fill', '#000000b0', '-draw', 'rectangle 0,284 640,360',
        '-fill', '#B4ABEC', '-pointsize', '17', '-annotate', '+0+40', pic,
        '-fill', '#F5F5F7', '-pointsize', '19', '-annotate', '+0+12', txt, out])
    files.append(out)
subprocess.check_call(['montage'] + files + ['-tile', '4x4', '-geometry', '+6+6', '-background', '#000', 'review/storyboard.jpg'])
print('review/storyboard.jpg')
