# バンク付きの描画（render.html?banks=30,60）を仕上げる。
# 14 方向（bank 0）と 12 方向 × r30/l30/r60/l60 の PNG を、全部に共通の枠で切り出して縮尺を揃え、WebP（品質 92・透明あり）に。
import os, glob
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # リポジトリ直下
IMG = os.path.join(ROOT, 'img'); PKG = os.environ.get('AAT_PKG') or os.path.join(ROOT, 'dev', 'package')   # 一覧の出力先（非公開の控えは AAT_PKG で指定）
os.makedirs(PKG, exist_ok=True)
Q = 92; PAD = 40
files = sorted(glob.glob(os.path.join(IMG, 'bi-*.png')))
files = [f for f in files if not os.path.basename(f).startswith(('bi-top', 'bi-icon', 'bi-logo', 'emblem'))]
ims = {f: Image.open(f).convert('RGBA') for f in files}
bb = None
for im in ims.values():
    b = im.getbbox(); bb = b if bb is None else (min(bb[0], b[0]), min(bb[1], b[1]), max(bb[2], b[2]), max(bb[3], b[3]))
W, H = next(iter(ims.values())).size
box = (max(0, bb[0] - PAD), max(0, bb[1] - PAD), min(W, bb[2] + PAD), min(H, bb[3] + PAD))
for f, im in ims.items():
    out = f[:-4] + '.webp'
    im.crop(box).save(out, 'WEBP', quality=Q, method=6)
    os.remove(f)
print('files', len(files), 'box', box, 'size', (box[2] - box[0], box[3] - box[1]))
# 一覧（バンク付き）
names = ['north', 'south', 'east', 'west', 'ne_up', 'nw_up', 'se_up', 'sw_up', 'ne_down', 'nw_down', 'se_down', 'sw_down']
cols = ['', '-l60', '-l30', '-r30', '-r60']
cell = Image.open(os.path.join(IMG, 'bi-north.webp')).size
T = 300; sc = T / max(cell)
sheet = Image.new('RGB', (len(cols) * T, len(names) * T), (205, 211, 218))
from PIL import ImageDraw
d = ImageDraw.Draw(sheet)
for r, n in enumerate(names):
    for c, suf in enumerate(cols):
        im = Image.open(os.path.join(IMG, f'bi-{n}{suf}.webp')).convert('RGBA'); im.thumbnail((T, T))
        sheet.paste(im, (c * T + (T - im.width) // 2, r * T + (T - im.height) // 2), im)
        d.text((c * T + 6, r * T + 4), f'{n}{suf}', fill=(200, 80, 0))
sheet.save(os.path.join(PKG, 'bi-bank-contact.jpg'), quality=85); print('sheet ok')
