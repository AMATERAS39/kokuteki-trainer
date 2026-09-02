# 描画した 14 枚を共通の枠で切り出し、縮尺を揃えて 256 色に減色する
from PIL import Image
names=['north','south','east','west','up','down','ne_up','nw_up','se_up','sw_up','ne_down','nw_down','se_down','sw_down']
ims={n:Image.open(f'app/img/bi-{n}.png').convert('RGBA') for n in names}
bb=None
for im in ims.values():
    b=im.getbbox(); bb=b if bb is None else (min(bb[0],b[0]),min(bb[1],b[1]),max(bb[2],b[2]),max(bb[3],b[3]))
pad=24; W,H=next(iter(ims.values())).size
box=(max(0,bb[0]-pad),max(0,bb[1]-pad),min(W,bb[2]+pad),min(H,bb[3]+pad))
for n,im in ims.items():
    im.crop(box).quantize(colors=256,method=Image.Quantize.FASTOCTREE,dither=Image.Dither.FLOYDSTEINBERG).save(f'app/img/bi-{n}.png',optimize=True)
print('done',box)
