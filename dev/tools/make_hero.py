# ホーム用ヒーロー画像: 描画した機体（package/hero-src.png）の後方に白いスモークを描き、app/img/hero.webp に保存する
import math, random
from PIL import Image, ImageFilter, ImageDraw
jet=Image.open('package/hero-src.png').convert('RGBA'); jet=jet.crop(jet.getbbox())
padL,padT=int(jet.width*0.6),int(jet.height*0.4)
# 機体が画像の中央に来るよう左右の余白を同じにする（スモークは左側の余白に描く）
size=(jet.width+padL*2,jet.height+padT+40)
canvas=Image.new('RGBA',size,(0,0,0,0))
tail=(padL+int(jet.width*0.30), padT+int(jet.height*0.46))   # 排気口のおおよその位置
dirv=(-1.0,-0.40); n=math.hypot(*dirv); dirv=(dirv[0]/n,dirv[1]/n); perp=(-dirv[1],dirv[0])
random.seed(11)
def layer(blur, count, rmax, amax, jit):
    im=Image.new('RGBA',size,(0,0,0,0)); d=ImageDraw.Draw(im)
    for k in (-1,1):                                   # 双発: 左右にずらした 2 本
        for i in range(count):
            t=i/(count-1); L=t*(padL+jet.width*0.30+80)
            side=k*(7+22*t)+random.uniform(-jit,jit)*t
            x=tail[0]+dirv[0]*L+perp[0]*side; y=tail[1]+dirv[1]*L+perp[1]*side
            r=(5+rmax*t)*random.uniform(0.7,1.2); a=int(amax*(1-t)**0.6*random.uniform(0.55,1))
            d.ellipse([x-r,y-r,x+r,y+r],fill=(255,255,255,a))
    return im.filter(ImageFilter.GaussianBlur(blur))
canvas.alpha_composite(layer(26,60,46,90,14))    # 外側のぼんやりした層
canvas.alpha_composite(layer(9,120,30,150,10))   # 中心の濃い層
canvas.paste(jet,(padL,padT),jet)
top=canvas.getbbox()[1]; canvas=canvas.crop((0,top,canvas.width,canvas.height))
canvas.save('app/img/hero.webp','WEBP',quality=90,method=6); print('hero',canvas.size)
logo=Image.open('app/img/bi-logo.png').convert('RGBA')
bg=Image.new('RGBA',(canvas.width,canvas.height+int(canvas.height*0.3)),(17,26,39,255)); bg.alpha_composite(canvas)
lw=int(canvas.width*0.24); lg=logo.resize((lw,int(logo.height*lw/logo.width)),Image.LANCZOS); bg.alpha_composite(lg,(bg.width-lw-24,bg.height-lg.height-20))
bg.convert('RGB').save('package/hero-preview.png')
