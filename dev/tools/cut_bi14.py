# 「コックピットの向き図（14方向）」から 14 枚を切り出す。答えが分かる文字（題名・方向矢印・N/S ラベル・説明文）を空の色で塗り潰す。
from PIL import Image
SRC=r'C:\Users\kairi\.claude\uploads\fe6f95c6-b9ad-47b3-99ef-c812584385dd\3c56cc9c-image.jpg'
im=Image.open(SRC).convert('RGB')
CW=1408/5
cols=[(int(i*CW)+1,int((i+1)*CW)-1) for i in range(5)]
rows=[(74,301),(307,536),(542,768)]
BOTTOMS=[182,160,160]
# (名前, 題名枠の幅)。None は使わないパネル
grid=[[('north',100),('south',104),('east',96),('west',96),('up',96)],
      [('down',104),('ne_up',150),('nw_up',150),('se_up',150),('sw_up',150)],
      [None,('ne_down',162),('nw_down',162),('se_down',162),('sw_down',162)]]
BOTTOM=185
def is_sky(p):
    r,g,b=p
    return (b>r+25 and b>g-10) or (r>200 and g>200 and b>200)
def fill_box(px,w,h,x0,y0,x1,y1,sx0,sx1):
    """[x0,x1)×[y0,y1) を、各行の x∈[sx0,sx1) の空の色で塗る。汚染行は近傍行で補う。"""
    rowcol=[None]*(y1-y0)
    for i,y in enumerate(range(y0,y1)):
        good=[px[x,y] for x in range(sx0,sx1) if 0<=x<w and is_sky(px[x,y])]
        if len(good)>=(sx1-sx0)*0.6:
            rowcol[i]=tuple(sum(p[k] for p in good)//len(good) for k in range(3))
    idx=[i for i in range(len(rowcol)) if rowcol[i]]
    for i in range(len(rowcol)):
        if rowcol[i] is None:
            rowcol[i]=rowcol[min(idx,key=lambda k:abs(k-i))] if idx else (120,170,220)
    for i,y in enumerate(range(y0,y1)):
        for x in range(x0,x1):
            if 0<=x<w: px[x,y]=rowcol[i]
    # 縁を 5px なじませる
    for i,y in enumerate(range(y0,y1)):
        for k in range(5):
            for x in (x0-1-k,x1+k):
                if 0<=x<w:
                    a=(k+1)/6; p=px[x,y]; q=rowcol[i]
                    px[x,y]=tuple(int(p[c]*a+q[c]*(1-a)) for c in range(3))
    for x in range(x0,x1):
        for k in range(5):
            y=y1+k
            if 0<=x<w and y<h:
                a=(k+1)/6; p=px[x,y]; q=rowcol[-1]
                px[x,y]=tuple(int(p[c]*a+q[c]*(1-a)) for c in range(3))
for r,row in enumerate(grid):
    for c,cell in enumerate(row):
        if not cell: continue
        n,tw=cell; x0,x1=cols[c]; y0,y1=rows[r]
        t=im.crop((x0,y0,x1,y0+BOTTOMS[r])); px=t.load(); w,h=t.size
        fill_box(px,w,h,0,0,tw,58,tw+4,tw+16)          # 題名
        fill_box(px,w,h,w-66,0,w,68,w-80,w-68)          # 右上の方向矢印
        fill_box(px,w,h,118,0,166,24,168,180)           # 上端中央の N/S/Up
        fill_box(px,w,h,0,96,18,132,20,30)              # 左端の W（実際の方向と異なるため消す）
        fill_box(px,w,h,w-17,96,w,132,w-30,w-19)        # 右端の E
        t.save(f'app/img/bi-{n}.jpg',quality=90); print(n,t.size)
