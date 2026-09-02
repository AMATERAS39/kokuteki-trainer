# T-4 図面シートから各視点図を切り出し、背景を透明化して PNG に保存する。
from PIL import Image
from collections import deque
import sys
SRC=r'C:\Users\kairi\.claude\uploads\fe6f95c6-b9ad-47b3-99ef-c812584385dd\8f10618a-image.jpg'
im=Image.open(SRC).convert('RGB')
W,H=im.size
# 各パネルのおおよその枠 (x0,y0,x1,y1)。ラベル帯と表題欄を避ける。
BOX={
 'front':(8,70,345,205),'rear':(358,70,695,205),
 'top':(708,70,1045,370),'bottom':(1058,70,1395,370),
 'left':(8,240,345,370),'right':(358,240,695,370),
 'iso1':(8,412,345,575),'iso2':(358,412,695,575),'iso3':(708,412,1045,575),'iso4':(1058,412,1395,575),
 'iso5':(8,605,345,765),'iso6':(358,605,695,765),'iso7':(708,605,1045,765),'iso8':(1058,605,1395,765),
}
TH=205
def process(name,box):
    tile=im.crop(box); w,h=tile.size; px=tile.load()
    bg=[[False]*w for _ in range(h)]
    def white(x,y):
        r,g,b=px[x,y]; return min(r,g,b)>TH
    q=deque()
    for x in range(w):
        for y in (0,h-1):
            if white(x,y) and not bg[y][x]: bg[y][x]=True; q.append((x,y))
    for y in range(h):
        for x in (0,w-1):
            if white(x,y) and not bg[y][x]: bg[y][x]=True; q.append((x,y))
    while q:
        x,y=q.popleft()
        for nx,ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
            if 0<=nx<w and 0<=ny<h and not bg[ny][nx] and white(nx,ny):
                bg[ny][nx]=True; q.append((nx,ny))

    fg=[[not bg[y][x] for x in range(w)] for y in range(h)]
    def thick_v(x,y):
        t=1;yy=y-1
        while yy>=0 and fg[yy][x]: t+=1;yy-=1
        yy=y+1
        while yy<h and fg[yy][x]: t+=1;yy+=1
        return t
    def thick_h(x,y):
        t=1;xx=x-1
        while xx>=0 and fg[y][xx]: t+=1;xx-=1
        xx=x+1
        while xx<w and fg[y][xx]: t+=1;xx+=1
        return t
    erase=set()
    for y in range(h):
        x=0
        while x<w:
            if fg[y][x]:
                x0=x
                while x<w and fg[y][x]: x+=1
                if x-x0>=50:
                    thin=sum(1 for xx in range(x0,x) if thick_v(xx,y)<=2)
                    if thin>=(x-x0)*0.9:
                        for xx in range(x0,x): erase.add((xx,y))
            else: x+=1
    for x in range(w):
        y=0
        while y<h:
            if fg[y][x]:
                y0=y
                while y<h and fg[y][x]: y+=1
                if y-y0>=50:
                    thin=sum(1 for yy in range(y0,y) if thick_h(x,yy)<=2)
                    if thin>=(y-y0)*0.9:
                        for yy in range(y0,y): erase.add((x,yy))
            else: y+=1
    for (x,y) in erase: bg[y][x]=True
    # 前景の連結成分を求め、最大のものだけ残す
    lab=[[0]*w for _ in range(h)]; comps=[]; cid=0
    for y in range(h):
        for x in range(w):
            if not bg[y][x] and lab[y][x]==0:
                cid+=1; lab[y][x]=cid; q=deque([(x,y)]); cnt=0; bb=[x,y,x,y]
                while q:
                    cx,cy=q.popleft(); cnt+=1
                    bb[0]=min(bb[0],cx);bb[1]=min(bb[1],cy);bb[2]=max(bb[2],cx);bb[3]=max(bb[3],cy)
                    for nx,ny in ((cx+1,cy),(cx-1,cy),(cx,cy+1),(cx,cy-1),(cx+1,cy+1),(cx-1,cy-1),(cx+1,cy-1),(cx-1,cy+1)):
                        if 0<=nx<w and 0<=ny<h and not bg[ny][nx] and lab[ny][nx]==0:
                            lab[ny][nx]=cid; q.append((nx,ny))
                comps.append((cnt,cid,bb))
    comps.sort(reverse=True)
    keep={c[1] for c in comps[:1]}
    # 主成分の bbox に十分近い小成分（ライトや脚など）も残す
    bb=comps[0][2]; main=comps[0][1]
    mainpx=set((x,y) for y in range(h) for x in range(w) if lab[y][x]==main)
    for cnt,c,b in comps[1:]:
        if cnt<40 or not (b[0]>=bb[0]-4 and b[1]>=bb[1]-4 and b[2]<=bb[2]+4 and b[3]<=bb[3]+4): continue
        pts=[(x,y) for y in range(b[1],b[3]+1) for x in range(b[0],b[2]+1) if lab[y][x]==c]
        near=any((x+dx,y+dy) in mainpx for (x,y) in pts for dx in range(-4,5) for dy in range(-4,5))
        if near: keep.add(c)
    out=Image.new('RGBA',(w,h),(0,0,0,0)); op=out.load()
    for y in range(h):
        for x in range(w):
            if lab[y][x] in keep: op[x,y]=px[x,y]+(255,)
    x0,y0,x1,y1=bb; pad=6
    out=out.crop((max(0,x0-pad),max(0,y0-pad),min(w,x1+pad+1),min(h,y1+pad+1)))
    out.save(f'app/img/t4-{name}.png'); print(name,out.size,'comps',len(comps),'main',comps[0][0])
for n,b in BOX.items(): process(n,b)
