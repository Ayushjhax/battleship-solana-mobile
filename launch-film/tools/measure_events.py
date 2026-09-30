"""Measure event frames directly in the prepared media (file time → source time)."""
import subprocess, numpy as np
def frames(path, w, h, t=None):
    args = ['ffmpeg', '-v', 'error', '-i', path]
    if t: args += ['-t', str(t)]
    args += ['-vf', f'scale={w}:{h}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    b = subprocess.run(args, capture_output=True).stdout
    return np.frombuffer(b, np.uint8).reshape(-1, h, w, 3).astype(np.float32)
def reg(fr, u0, v0, u1, v1):
    h, w = fr.shape[1:3]
    return fr[:, int(v0*h):int(v1*h), int(u0*w):int(u1*w)]
M = 'public/media/'
out = {}
# arsenal: white flash over the enemy board (brightest frame), fireball (orange)
A = frames(M + 'arsenal_x4.mp4', 640, 288, 3.4)
br = reg(A, 0.58, 0.2, 0.92, 0.95).mean((1, 2, 3))
orange = lambda R: ((R[..., 0] > 200) & (R[..., 1] > 90) & (R[..., 1] < 190) & (R[..., 2] < 90)).mean((1, 2))
print('arsenal brightness', np.round(br[20:40], 1))
out['arsenal.flash'] = int(np.argmax(br[:60]))
o = orange(reg(A, 0.6, 0.3, 0.85, 0.8)); print('arsenal orange', np.round(o[25:60] * 100, 1))
# fire marks: orange appears again after smoke, bottom of target area
o2 = orange(reg(A, 0.66, 0.5, 0.8, 0.75)); print('arsenal fireMarks orange', np.round(o2[70:100] * 100, 1))
# defense: red stamp "Shot down!"
D = frames(M + 'defense_x4.mp4', 640, 288, 2.8)
red = lambda R: ((R[..., 0] > 170) & (R[..., 1] < 90) & (R[..., 2] < 90)).mean((1, 2))
r = red(reg(D, 0.22, 0.62, 0.34, 0.72)); print('defense red', np.round(r * 100, 1))
out['defense.shotDown'] = int(np.argmax(r > r.max() * 0.5))
# base (file starts at source 1.5): last hit orange near (0.754, 0.243); victory cut (scene change)
B = frames(M + 'base_x4.mp4', 640, 288, 5.2)
ob = orange(reg(B, 0.7, 0.15, 0.8, 0.35)); print('base orange', np.round(ob[30:60] * 100, 1))
out['base.lastHit'] = int(np.argmax(ob > 0.01))
d = np.abs(np.diff(B.mean((1, 2, 3))))
out['base.victoryCut'] = int(np.argmax(d)) + 1
# counting: points gained "+0 → +24" digits region (victory screen, ~ (0.66..0.7, 0.3..0.36))
dig = reg(B, 0.62, 0.28, 0.71, 0.37)
dd = np.abs(np.diff(dig.mean((1, 2, 3))))
print('base victory digits change', np.round(dd[100:150], 2))
# phone clips (2670x1200 → 534x240)
P = lambda n, t=None: frames(M + n + '.mp4', 534, 240, t)
bb = P('buildyourbase', 8.4)
d = np.abs(np.diff(bb.mean((1, 2, 3)))); out['build.placement'] = int(np.argmax(d[:60])) + 1
aa = reg(bb, 0.2, 0.74, 0.28, 0.84).std((1, 2, 3)); print('build AA region std', np.round(aa[100:170], 1))
mn = reg(bb, 0.25, 0.68, 0.3, 0.77).std((1, 2, 3)); print('build mine region std', np.round(mn[170:240], 1))
mm = P('matchmaking', 4.0)
rv = red(reg(mm, 0.4, 0.35, 0.62, 0.72)); print('match VS red', np.round(rv[80:110] * 100, 1))
out['match.vs'] = int(np.argmax(rv > 0.01))
d = np.abs(np.diff(mm.mean((1, 2, 3)))); print('match scene diffs >2:', [i + 1 for i, x in enumerate(d) if x > 2])
for n in ('buy_points', 'sell_points'):
    X = P(n, 5.0)
    c = reg(X, 0.23, 0.3, 0.37, 0.45).mean((1, 2, 3)); dc = np.abs(np.diff(c))
    out[n + '.counter'] = int(np.argmax(dc)) + 1
st = P('store', 3.0)
d = np.abs(np.diff(st.mean((1, 2, 3)))); print('store diffs >0.5:', [(i + 1, round(float(x), 2)) for i, x in enumerate(d) if x > 0.5])
for k, v in out.items():
    print(f'{k}: file frame {v} = file {v / 30:.3f} s')
