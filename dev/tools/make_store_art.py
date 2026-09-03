# ストアの宣伝画像（1024x500）を作る。実行: python dev/tools/make_store_art.py
# 素材は img/hero.webp（ホーム画面と同じ機体）。文字は TENRYU と説明の 2 行。
from PIL import Image, ImageDraw, ImageFont
import os
W, H = 1024, 500
BG, INK, SUB, ACC = (11, 16, 23), (233, 238, 244), (159, 173, 188), (240, 165, 58)
im = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(im)
# うっすらした方眼（アプリの背景と同じ雰囲気）
for x in range(0, W, 64):
    d.line([(x, 0), (x, H)], fill=(18, 26, 37))
for y in range(0, H, 64):
    d.line([(0, y), (W, y)], fill=(18, 26, 37))

hero = Image.open('img/hero.webp').convert('RGBA')
hw = 620
hero = hero.resize((hw, int(hero.height * hw / hero.width)), Image.LANCZOS)
im.paste(hero, (W - hw + 30, (H - hero.height) // 2 - 10), hero)

def font(path, size):
    for p in (path, 'C:/Windows/Fonts/' + path):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

f_title = font('arialbd.ttf', 96)
f_ja = font('YuGothB.ttc', 27)
f_sub = font('meiryo.ttc', 22)

# TENRYU（字の間を広げて置く）
x, y = 64, 150
for ch in 'TENRYU':
    d.text((x, y), ch, font=f_title, fill=INK)
    x += d.textlength(ch, font=f_title) + 10
d.text((66, 272), '航空学生 適性検査トレーニング', font=f_ja, fill=ACC)
d.text((66, 318), '方位・姿勢指示器・操縦操作を', font=f_sub, fill=SUB)
d.text((66, 350), '制限時間つきで反復練習', font=f_sub, fill=SUB)
im.save('dev/docs/play/feature_graphic.png')
print('feature_graphic', im.size)
