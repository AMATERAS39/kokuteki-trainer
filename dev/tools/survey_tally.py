# 受験者アンケート（/survey）の回答を取ってきて集計する。
#   python dev/tools/survey_tally.py <合言葉> [保存先.json]
# 合言葉は平均回答時間のものと同じ（公開リポジトリには書かない。引継ぎ書にある）。
# 回答は匿名（名前・メール・端末識別子・IP は保存していない）。取ってきた JSON をそのまま控えに残せる。
import json, sys, urllib.request, urllib.parse, collections, datetime

URL = 'https://kokuteki.amaterasu-vocab.com/api/survey'
DATE = {'0919': '9 月 19 日', '0926': '9 月 26 日', 'none': '受けていない', '': '（未回答）'}
SEX = {'m': '男性', 'f': '女性', 'na': '答えない', '': '（未回答）'}
ITEMS = {'heading': '方位判読', 'attitude': '姿勢判読', 'combo': '方位×姿勢指示器', 'ctrl1': '操縦操作 1 つ', 'ctrl2': '操縦操作 2 つ（同時）', 'ctrl2seq': '操縦操作 2 つ（順番）'}
NAMES = {"date": "試験日程", "help_heading": "方位判読：本番の役に立ったか", "help_attitude": "姿勢判読：本番の役に立ったか", "help_combo": "方位×姿勢指示器：本番の役に立ったか", "help_control": "操縦操作：本番の役に立ったか", "result": "本番の手応え（この 4 種目の全体）", "timeoutIn": "時間切れがあった種目", "difficulty3": "本番とアプリ（Hard・Max）の難しさ", "missing": "アプリになかったもの・違っていたもの", "startWhen": "使い始めた時期", "hours": "合計の使用時間", "mostUsed": "いちばん使った種目", "level": "到達した難易度", "edition": "使った版", "source": "知ったきっかけ", "searchWords": "検索した言葉", "price": "価格の受け止め", "target": "志望", "status": "区分", "attempts": "受験回数", "other": "他に使った対策", "sex": "身体的性別", "trouble": "他に困ったこと（他の検査区分・二次試験など）", "wants": "来年度の受験者のために欲しい機能", "impression": "アプリの感想"}
LABELS = {"date": {"0919": "9 月 19 日", "0926": "9 月 26 日", "none": "受けていない"}, "help_heading": {"yes": "役に立った", "some": "少し役に立った", "no": "役に立たなかった", "na": "本番に出なかった・分からない"}, "help_attitude": {"yes": "役に立った", "some": "少し役に立った", "no": "役に立たなかった", "na": "本番に出なかった・分からない"}, "help_combo": {"yes": "役に立った", "some": "少し役に立った", "no": "役に立たなかった", "na": "本番に出なかった・分からない"}, "help_control": {"yes": "役に立った", "some": "少し役に立った", "no": "役に立たなかった", "na": "本番に出なかった・分からない"}, "result": {"mostly": "ほぼできた", "half": "半分くらい", "little": "あまりできなかった", "unk": "分からない"}, "timeoutIn": {"heading": "方位判読", "attitude": "姿勢判読", "combo": "方位×姿勢指示器", "control": "操縦操作", "other": "アプリにない種目", "none": "なかった"}, "difficulty3": {"harder": "本番のほうが難しい", "same": "同じくらい", "easier": "本番のほうが易しい", "unk": "分からない"}, "startWhen": {"w1": "1 週間前から", "w2_4": "2〜4 週間前から", "m1_2": "1〜2 か月前から", "m3p": "それより前から"}, "hours": {"h1": "1 時間未満", "h3": "1〜3 時間", "h10": "3〜10 時間", "h10p": "10 時間以上"}, "mostUsed": {"heading": "方位判読", "attitude": "姿勢判読", "combo": "方位×姿勢指示器", "control": "操縦操作", "sim": "3D シミュレーター"}, "level": {"easy": "Easy", "normal": "Normal", "hard": "Hard", "max": "Max"}, "edition": {"trial": "体験版だけ", "ios": "完全版（iPhone・iPad）", "android": "完全版（Android）"}, "source": {"search": "検索", "sns": "SNS・動画", "friend": "知人", "school": "学校・予備校", "ai": "AI の回答", "other": "その他"}, "price": {"cheap": "安い", "fair": "妥当", "worth": "高いが払う価値はあった", "high": "高い", "notbought": "買っていない"}, "target": {"jasdf": "航空自衛隊", "jmsdf": "海上自衛隊", "both": "両方"}, "status": {"hs": "高校在学", "grad": "高校既卒", "univ": "大学・専門在学", "work": "社会人", "other": "その他"}, "attempts": {"first": "初めて", "again": "2 回目以上"}, "other": {"pastq": "過去問集・問題集", "prep": "予備校・塾", "web": "ネットの情報", "none": "特になし"}, "sex": {"m": "男性", "f": "女性", "na": "答えない"}}
ONE = ["date", "help_heading", "help_attitude", "help_combo", "help_control", "result", "difficulty3", "startWhen", "hours", "mostUsed", "level", "edition", "price", "target", "status", "attempts", "sex"]
MANY = ["timeoutIn", "source", "other"]
TEXT = ["missing", "searchWords", "trouble", "wants", "impression"]
DIFF = {'harder': 'アプリより本番が難しかった', 'same': '同じくらい', 'easier': 'アプリより易しかった', 'unknown': '分からない', '': '（未回答）'}

def main():
    if len(sys.argv) < 2:
        print(__doc__ or 'usage: survey_tally.py <合言葉> [保存先.json]'); sys.exit(1)
    key = sys.argv[1]
    # Python 既定の User-Agent は Cloudflare に弾かれる（403）ので、ふつうのブラウザ風の UA を付ける
    req = urllib.request.Request(URL + '?' + urllib.parse.urlencode({'key': key}), headers={'User-Agent': 'Mozilla/5.0 (survey_tally)'})
    with urllib.request.urlopen(req) as r:
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
    for f in ONE:
        tally(NAMES[f], lambda x, f=f: x.get(f, ''), dict(LABELS.get(f, {}), **{'': '（未回答）'}))
    for f in MANY:
        c = collections.Counter(i for x in items for i in (x.get(f) or []))
        print(f'\n■ {NAMES[f]}（選んだ人数）')
        for k, l in LABELS[f].items():
            print(f'  {l}: {c.get(k, 0)}')
    if any(x.get('v') in (None, 1) for x in items):
        tally('（v1）難易度の印象', lambda x: x.get('difficulty', ''), DIFF)
        for title, field in [('（v1）出題されて、アプリにもあったもの', 'had'), ('（v1）アプリにあるが、出題されなかったもの', 'notHad')]:
            c = collections.Counter(i for x in items for i in (x.get(field) or []))
            print(f'\n■ {title}（選んだ人数）')
            for k in ITEMS:
                print(f'  {ITEMS[k]}: {c.get(k, 0)}')
    for f in TEXT:
        print(f'\n■ {NAMES[f]}')
        for x in items:
            s = (x.get(f) or '').strip()
            if s:
                at = datetime.datetime.fromtimestamp(x.get('at', 0) / 1000).strftime('%m/%d %H:%M')
                print(f'  [{at} {DATE.get(x.get("date", ""), "")}{" #" + x["code"] if x.get("code") else ""}] {s}')

if __name__ == '__main__':
    main()
