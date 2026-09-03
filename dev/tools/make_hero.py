# ホーム用ヒーロー画像。
# 迫力を出すため、機首をこちらへ向けた広角の絵（img/bi-hero-src2.png）に、
# 機体の後ろへ「遠ざかるほど細くなる」スモークを 2 本描いて img/hero.webp に保存する。
# 元絵の描き方（dev/tools/render_server.py を 8766 番で起動してから開く）:
#   /render/render.html?ax=90&hide=landing,front_gear,blake_op&paint=main/main/006ab0
#     &w=4400&h=2350&probe&hemi=2.4&dir=1.0&save=hero-src2&hd=235&p=-10&bk=32&elev=10&fov=68&dist=8.6
#   （hd=方位 p=ピッチ bk=バンク elev=視点の仰角 fov=画角。fov を大きく・dist を小さくするほど迫力が出る）
import math, random, os, sys
from PIL import Image, ImageFilter, ImageDraw

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO, 'img', 'bi-hero-src2.png')
OUT = os.path.join(REPO, 'img', 'hero.webp')

jet = Image.open(SRC).convert('RGBA')
jet = jet.crop(jet.getbbox())
JW, JH = jet.size

# 置き場所: 機体は左寄り。右側の余白へスモークが遠ざかっていく
CW, CH = int(JW * 1.72), int(JH * 1.24)
JX, JY = int(JW * 0.03), int(JH * 0.17)
canvas = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))

# 排気口のおおよその場所（機体の絵の中での割合）と、煙が遠ざかる向き（機首 → 尾）
tail = (JX + int(JW * 0.78), JY + int(JH * 0.36))
dirv = (0.90, -0.44)
n = math.hypot(*dirv); dirv = (dirv[0] / n, dirv[1] / n)
perp = (-dirv[1], dirv[0])
random.seed(7)

def layer(blur, count, r0, r1, amax, jit, spread0, spread1):
    """遠ざかるほど細く・薄くなる煙。r0 → r1 が粒の大きさ、spread0 → spread1 が 2 本の間隔"""
    im = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    L0 = CW * 1.05                                          # 画面の外まで伸ばす
    for k in (-1, 1):                                       # 双発ぶん 2 本
        for i in range(count):
            t = i / (count - 1)
            L = t * L0
            side = k * (spread0 + (spread1 - spread0) * t) + random.uniform(-jit, jit) * (1 - t)
            x = tail[0] + dirv[0] * L + perp[0] * side
            y = tail[1] + dirv[1] * L + perp[1] * side - CH * 0.03 * t * t   # 少しだけ上へ流れる
            r = (r0 + (r1 - r0) * t) * random.uniform(0.8, 1.15)
            a = int(amax * (1 - t) ** 0.75 * random.uniform(0.6, 1))
            if a <= 0 or r <= 0: continue
            d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, a))
    return im.filter(ImageFilter.GaussianBlur(blur))

canvas.alpha_composite(layer(30, 90, 62, 10, 92, 16, 26, 6))     # 外側のぼんやりした層
canvas.alpha_composite(layer(11, 170, 40, 5, 165, 10, 24, 5))    # 中心の濃い層
canvas.paste(jet, (JX, JY), jet)
canvas = canvas.crop(canvas.getbbox())
canvas.save(OUT, 'WEBP', quality=90, method=6)
print('hero', canvas.size)

# 確認用（暗い背景に置いたところ）。引数で保存先を渡せる
if len(sys.argv) > 1:
    prev = Image.new('RGBA', canvas.size, (24, 34, 50, 255))
    prev.alpha_composite(canvas)
    prev.convert('RGB').save(sys.argv[1])
