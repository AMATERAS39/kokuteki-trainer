# 描画した 14 方向・上面図・アイコン元画像を仕上げる。
# - 14 方向: 共通の枠で切り出して縮尺を揃え、余白 40px、WebP（品質 92・透明あり）で保存
# - 上面図: 正方形に切り出して WebP で保存
# - アイコン: 暗い地に載せて 512/192/180/64 の PNG
import os, sys
from PIL import Image, ImageDraw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, 'app', 'img'); ICO = os.path.join(ROOT, 'app', 'icons'); PKG = os.path.join(ROOT, 'package')
os.makedirs(PKG, exist_ok=True)
names = ['north','south','east','west','up','down','ne_up','nw_up','se_up','sw_up','ne_down','nw_down','se_down','sw_down']
Q = 92; PAD = 40

# --- 14 方向 ---
ims = {n: Image.open(os.path.join(IMG, f'bi-{n}.png')).convert('RGBA') for n in names}
bb = None
for im in ims.values():
    b = im.getbbox(); bb = b if bb is None else (min(bb[0], b[0]), min(bb[1], b[1]), max(bb[2], b[2]), max(bb[3], b[3]))
W, H = next(iter(ims.values())).size
box = (max(0, bb[0] - PAD), max(0, bb[1] - PAD), min(W, bb[2] + PAD), min(H, bb[3] + PAD))
for n, im in ims.items():
    im.crop(box).save(os.path.join(IMG, f'bi-{n}.webp'), 'WEBP', quality=Q, method=6)
    os.remove(os.path.join(IMG, f'bi-{n}.png'))
print('dirs', box)

# --- 上面図 ---
top_src = os.path.join(IMG, 'bi-top.png')
if os.path.exists(top_src):
    src = Image.open(top_src).convert('RGBA'); b = src.getbbox(); jet = src.crop(b)
    S = max(jet.size) + 2 * PAD; im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); im.paste(jet, ((S - jet.width) // 2, (S - jet.height) // 2), jet)
    im.save(os.path.join(IMG, 't4-top.webp'), 'WEBP', quality=Q, method=6)
    os.replace(top_src, os.path.join(PKG, 'top-src.png')); print('top', im.size)

# --- アイコン ---
icon_src = os.path.join(IMG, 'bi-icon-src.png')
if os.path.exists(icon_src):
    src = Image.open(icon_src).convert('RGBA'); b = src.getbbox(); jet = src.crop(b)
    def make(size, margin, bg, path):
        im = Image.new('RGBA', (size, size), bg); inner = int(size * (1 - 2 * margin)); j = jet.copy(); j.thumbnail((inner, inner), Image.LANCZOS)
        im.paste(j, ((size - j.width) // 2, (size - j.height) // 2), j); im.convert('RGB').save(path, optimize=True)
    BG = (11, 16, 23, 255)
    make(512, 0.12, BG, os.path.join(ICO, 'icon-512.png')); make(192, 0.12, BG, os.path.join(ICO, 'icon-192.png'))
    make(180, 0.10, BG, os.path.join(ICO, 'apple-touch-icon.png')); make(64, 0.06, BG, os.path.join(ICO, 'favicon-64.png'))
    Image.open(os.path.join(ICO, 'icon-512.png')).save(os.path.join(PKG, 'icon-preview.png'))
    os.replace(icon_src, os.path.join(PKG, 'icon-src.png')); print('icons ok')

# --- 一覧 ---
ims = [Image.open(os.path.join(IMG, f'bi-{n}.webp')).convert('RGBA') for n in names]; cell = ims[0].size
sheet = Image.new('RGB', (cell[0] * 4, cell[1] * 4), (205, 211, 218)); d = ImageDraw.Draw(sheet)
for i, (n, im) in enumerate(zip(names, ims)):
    x = (i % 4) * cell[0]; y = (i // 4) * cell[1]; sheet.paste(im, (x, y), im); d.text((x + 8, y + 6), n, fill=(200, 80, 0))
tp = os.path.join(IMG, 't4-top.webp')
if os.path.exists(tp):
    top = Image.open(tp).convert('RGBA'); top.thumbnail((cell[0] - 40, cell[1] - 40)); sheet.paste(top, (cell[0] * 2 + 20, cell[1] * 3 + 20), top); d.text((cell[0] * 2 + 26, cell[1] * 3 + 24), 't4-top', fill=(200, 80, 0))
sheet.thumbnail((2000, 2000)); sheet.save(os.path.join(PKG, 'bi14-contact.png')); print('sheet ok', cell)
