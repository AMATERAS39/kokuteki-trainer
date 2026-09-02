# テクスチャ（右側面）からブルーインパルスのエンブレムと筆記体ロゴを切り出し、細いパネル線を除いて app/img/bi-logo.png を作る
from PIL import Image
from collections import deque
tex=Image.open('t4model/side_r2.jpg').convert('RGB')
def cut(box, th=228, min_px=300, largest_only=False):
    t=tex.crop(box).convert('RGBA'); w,h=t.size; px=t.load()
    # パネル線の除去: 灰色（低彩度・中明度）の画素が列／行の 45% 以上を占める線を見つけ、線幅 ±3px を隣の色で埋める
    import colorsys
    def gray(p):
        r,g,b=[v/255 for v in p[:3]]; hh,ss,vv=colorsys.rgb_to_hsv(r,g,b); return ss<0.18 and 0.25<vv<0.85
    cols=[x for x in range(w) if sum(gray(px[x,y]) for y in range(h))>=h*0.45]
    rows=[y for y in range(h) if sum(gray(px[x,y]) for x in range(w))>=w*0.45]
    def fill_col(x):
        for y in range(h):
            l=px[max(0,x-5),y]; r=px[min(w-1,x+5),y]; px[x,y]=tuple((l[i]+r[i])//2 for i in range(4))
    def fill_row(y):
        for x in range(w):
            u=px[x,max(0,y-5)]; d=px[x,min(h-1,y+5)]; px[x,y]=tuple((u[i]+d[i])//2 for i in range(4))
    for x in sorted(set(c+dx for c in cols for dx in range(-3,4)) & set(range(w))): fill_col(x)
    for y in sorted(set(r+dy for r in rows for dy in range(-3,4)) & set(range(h))): fill_row(y)
    print('  lines removed cols',cols,'rows',rows)
    white=lambda x,y: min(px[x,y][:3])>th
    bg=[[False]*w for _ in range(h)]; q=deque()
    for x in range(w):
        for y in (0,h-1):
            if white(x,y) and not bg[y][x]: bg[y][x]=True; q.append((x,y))
    for y in range(h):
        for x in (0,w-1):
            if white(x,y) and not bg[y][x]: bg[y][x]=True; q.append((x,y))
    while q:
        x,y=q.popleft()
        for nx,ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
            if 0<=nx<w and 0<=ny<h and not bg[ny][nx] and white(nx,ny): bg[ny][nx]=True; q.append((nx,ny))
    # 細い直線（パネル線）を消す: 長さ 25px 以上で厚み 3px 以下の横・縦の連続を背景扱いにする
    fg=[[not bg[y][x] for x in range(w)] for y in range(h)]
    def tv(x,y):
        t=1;yy=y-1
        while yy>=0 and fg[yy][x]: t+=1;yy-=1
        yy=y+1
        while yy<h and fg[yy][x]: t+=1;yy+=1
        return t
    def th_(x,y):
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
                if x-x0>=25 and sum(1 for xx in range(x0,x) if tv(xx,y)<=3)>=(x-x0)*0.85:
                    for xx in range(x0,x): erase.add((xx,y))
            else: x+=1
    for x in range(w):
        y=0
        while y<h:
            if fg[y][x]:
                y0=y
                while y<h and fg[y][x]: y+=1
                if y-y0>=25 and sum(1 for yy in range(y0,y) if th_(x,yy)<=3)>=(y-y0)*0.85:
                    for yy in range(y0,y): erase.add((x,yy))
            else: y+=1
    for (x,y) in erase: bg[y][x]=True
    # 前景の連結成分を数え、小さいもの（パネル線）を捨てる
    lab=[[0]*w for _ in range(h)]; cid=0; sizes={}; bbs={}
    for y in range(h):
        for x in range(w):
            if not bg[y][x] and lab[y][x]==0:
                cid+=1; lab[y][x]=cid; q=deque([(x,y)]); c=0; bb=[x,y,x,y]
                while q:
                    cx,cy=q.popleft(); c+=1; bb=[min(bb[0],cx),min(bb[1],cy),max(bb[2],cx),max(bb[3],cy)]
                    for nx,ny in ((cx+1,cy),(cx-1,cy),(cx,cy+1),(cx,cy-1),(cx+1,cy+1),(cx-1,cy-1),(cx+1,cy-1),(cx-1,cy+1)):
                        if 0<=nx<w and 0<=ny<h and not bg[ny][nx] and lab[ny][nx]==0: lab[ny][nx]=cid; q.append((nx,ny))
                sizes[cid]=c; bbs[cid]=bb
    # 残す成分: 最大のみ（エンブレム）、または十分な大きさで細線でないもの
    big=max(sizes,key=sizes.get) if sizes else 0
    def keep(c):
        if largest_only: return c==big
        b=bbs[c]; return sizes[c]>=min_px and (b[2]-b[0])>4 and (b[3]-b[1])>4
    for y in range(h):
        for x in range(w):
            if bg[y][x] or not keep(lab[y][x]): px[x,y]=(0,0,0,0)
    return t.crop(t.getbbox())
emblem=cut((2160,1020,2330,1160),largest_only=True)
script=cut((860,1070,1220,1150),min_px=120)
S=3
emblem=emblem.resize((emblem.width*S,emblem.height*S),Image.LANCZOS); script=script.resize((script.width*S,script.height*S),Image.LANCZOS)
W=max(emblem.width,script.width); H=emblem.height+script.height+10*S
logo=Image.new('RGBA',(W,H),(0,0,0,0)); logo.paste(emblem,((W-emblem.width)//2,0),emblem); logo.paste(script,((W-script.width)//2,emblem.height+10*S),script)
logo.save('app/img/bi-logo.png',optimize=True); print('logo',logo.size,'emblem',emblem.size,'script',script.size)
