# 受験者アンケート（/survey）の回答を取ってきて集計する。
#   python dev/tools/survey_tally.py <合言葉> [保存先.json]
# 合言葉は平均回答時間のものと同じ（公開リポジトリには書かない。引継ぎ書にある）。
# 回答は匿名（名前・メール・端末識別子・IP は保存していない）。取ってきた JSON をそのまま控えに残せる。
import json, sys, urllib.request, urllib.parse, collections, datetime

URL = 'https://kokuteki.amaterasu-vocab.com/api/survey'
DATE = {'0919': '9 月 19 日', '0926': '9 月 26 日', 'none': '受けていない', '': '（未回答）'}
SEX = {'m': '男性', 'f': '女性', 'na': '答えない', '': '（未回答）'}
ITEMS = {'heading': '方位判読', 'attitude': '姿勢判読', 'combo': '方位×姿勢指示器', 'ctrl1': '操縦操作 1 つ', 'ctrl2': '操縦操作 2 つ（同時）', 'ctrl2seq': '操縦操作 2 つ（順番）'}
DIFF = {'harder': 'アプリより本番が難しかった', 'same': '同じくらい', 'easier': 'アプリより易しかった', 'unknown': '分からない', '': '（未回答）'}

def main():
    if len(sys.argv) < 2:
        print(__doc__ or 'usage: survey_tally.py <合言葉> [保存先.json]'); sys.exit(1)
    key = sys.argv[1]
    with urllib.request.urlopen(URL + '?' + urllib.parse.urlencode({'key': key})) as r:
        data = json.load(r)
    if not data.get('ok'):
        print('取れませんでした:', data); sys.exit(1)
    items = data['items']
    if len(sys.argv) > 2:
        with open(sys.argv[2], 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
    print(f'回答 {len(items)} 件')
    if not items:
        return
    def tally(title, getter, names):
        c = collections.Counter(getter(x) for x in items)
        print(f'\n■ {title}')
        for k, n in c.most_common():
            print(f'  {names.get(k, k)}: {n}')
    tally('試験日程', lambda x: x.get('date', ''), DATE)
    tally('身体的性別', lambda x: x.get('sex', ''), SEX)
    tally('難易度の印象', lambda x: x.get('difficulty', ''), DIFF)
    for title, field in [('出題されて、アプリにもあったもの', 'had'), ('アプリにあるが、出題されなかったもの', 'notHad')]:
        c = collections.Counter(i for x in items for i in (x.get(field) or []))
        print(f'\n■ {title}（選んだ人数）')
        for k in ITEMS:
            print(f'  {ITEMS[k]}: {c.get(k, 0)}')
    for title, field in [('出題されたが、アプリになかったもの（自由記述）', 'missing'), ('アプリの感想', 'impression')]:
        print(f'\n■ {title}')
        for x in items:
            t = (x.get(field) or '').strip()
            if t:
                at = datetime.datetime.fromtimestamp(x.get('at', 0) / 1000).strftime('%m/%d %H:%M')
                print(f'  [{at} {DATE.get(x.get("date", ""), "")}] {t}')

if __name__ == '__main__':
    main()
