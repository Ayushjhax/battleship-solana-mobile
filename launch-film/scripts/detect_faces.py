"""Face detection over the cast stills (YuNet, Haar fallback). Writes build/cast/faces.json and
annotated previews in build/cast/annot/ for a human check. Boxes are in source-pixel units."""
import json, os, glob
import cv2, numpy as np
from PIL import Image, ImageOps
import pillow_heif
pillow_heif.register_heif_opener()

SRC = '../demo-assets/users'
os.makedirs('build/cast/annot', exist_ok=True)
det = cv2.FaceDetectorYN.create('build/yunet.onnx', '', (320, 320), 0.6, 0.3, 5000)
haar_f = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
haar_p = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_profileface.xml')
out = {}
for path in sorted(glob.glob(SRC + '/*')):
    name = os.path.basename(path)
    if name.lower().endswith('.gif'):
        continue
    im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    W, H = im.size
    s = 1600 / max(W, H)
    small = np.array(im.resize((round(W * s), round(H * s)), Image.LANCZOS))[:, :, ::-1].copy()
    h, w = small.shape[:2]
    det.setInputSize((w, h))
    _, faces = det.detect(small)
    boxes = []
    if faces is not None:
        for f in faces:
            x, y, bw, bh, score = f[0], f[1], f[2], f[3], f[-1]
            boxes.append({'x': float(x / s), 'y': float(y / s), 'w': float(bw / s), 'h': float(bh / s), 'score': float(score), 'by': 'yunet'})
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    for casc, tag in [(haar_f, 'haar-front'), (haar_p, 'haar-profile')]:
        for (x, y, bw, bh) in casc.detectMultiScale(gray, 1.1, 6, minSize=(40, 40)):
            boxes.append({'x': x / s, 'y': y / s, 'w': bw / s, 'h': bh / s, 'score': 0.5, 'by': tag})
    out[name] = {'w': W, 'h': H, 'faces': boxes}
    vis = small.copy()
    for b in boxes:
        c = (0, 255, 0) if b['by'] == 'yunet' else (0, 128, 255)
        cv2.rectangle(vis, (int(b['x'] * s), int(b['y'] * s)), (int((b['x'] + b['w']) * s), int((b['y'] + b['h']) * s)), c, 4)
    cv2.imwrite('build/cast/annot/' + os.path.splitext(name)[0].replace(' ', '_') + '.jpg', cv2.resize(vis, (w // 2, h // 2)))
    print(name, W, H, [(b['by'], round(b['score'], 2), int(b['x']), int(b['y']), int(b['w'])) for b in boxes])
json.dump(out, open('build/cast/faces.json', 'w'), indent=1)
