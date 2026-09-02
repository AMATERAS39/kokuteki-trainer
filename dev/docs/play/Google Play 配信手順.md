# Google Play 有償配信の手順

Web アプリ（PWA）を Android アプリとして包む TWA（Trusted Web Activity）方式で配信します。アプリの中身は https://kokuteki.amaterasu-vocab.com/ をそのまま表示し、起動 URL に秘密キーを付けることで「全機能版」になります。Web 版（キーなし）は体験版のままです。

## 仕組み（全機能版と体験版）
- 体験版（Web）: 方位のみ、1 回 10 問まで。ほかの種目は「Play 版」の表示になり、押すと全機能版の案内画面へ。
- 全機能版（Play）: アプリの起動 URL が `https://kokuteki.amaterasu-vocab.com/?key=＜秘密キー＞`。アプリ側でキーの SHA-256 を照合し、一致したら端末に「全機能版」を記憶する。以後はキーなしで開いても全機能。
- 秘密キーはリポジトリに入れない（このファイルにも書かない）。Claude Code のメモリと、PWABuilder の設定にだけ入れる。
- 注意: 仕組み上、キーを知っている人は Web でも全機能を使えます。800 円の学習アプリとしては十分な抑止と判断しました。

## 0. 事前に用意するもの
- Google アカウント、Google Play Console の開発者登録（登録料 25 米ドル、1 回のみ）
- 有料アプリを出すには「お支払いプロファイル（Google Payments Merchant）」の設定が必要。銀行口座、住所、税務情報（日本の場合は個人でも可）。承認に数日かかることがある
- 本人確認（Play Console の指示に従う。個人の場合は身分証）

## 1. Android パッケージを作る（PWABuilder、ブラウザだけで完結）
1. https://www.pwabuilder.com/ を開き、URL に `https://kokuteki.amaterasu-vocab.com/` を入れて「Start」。
2. 「Package For Stores」→ Android → 「Generate Package」。
3. オプションを次のように設定する:
   - Package ID: `com.amaterasuvocab.kokuteki`
   - App name: TENRYU　／　Short name: TENRYU
   - Start URL: `/?key=＜秘密キー＞`（ここが全機能版の要。キーは Claude Code から受け取ったもの）
   - Display mode: standalone　／　Status bar color・Splash: 既定のまま（#141a22）
   - Signing key: 「Create new」（PWABuilder が新しい鍵を作る）。生成後に表示される鍵のパスワードと alias を必ず控える
   - 「Include source code」はオフでよい
4. zip をダウンロードして保存する。中身: `.aab`（Play にアップロードする本体）、`.apk`（手元での動作確認用）、`signing-key`（署名鍵。紛失するとアプリを更新できなくなるので必ずバックアップ）、`assetlinks.json`。

## 2. Digital Asset Links を設定する（アドレスバーを消すために必須）
1. zip の中の `assetlinks.json` を開き、`sha256_cert_fingerprints` の値（AA:BB:… の形式）をコピーする。
2. その値を Claude Code に渡す。リポジトリの `.well-known/assetlinks.json` に入れて push すると、数分で https://kokuteki.amaterasu-vocab.com/.well-known/assetlinks.json に反映される。
3. Play にアップロードしたあと、Play Console → 「アプリの署名」に表示される「アプリ署名鍵の証明書」の SHA-256 も同じファイルに追加する（Play が再署名するため、2 つのフィンガープリントを並べる）。これを忘れると、ストアから入れたアプリで画面上部にアドレスバーが出る。

## 3. Play Console でアプリを作る
1. Play Console → 「アプリを作成」。アプリ名、デフォルトの言語 日本語、アプリ／ゲーム: アプリ、無料／有料: 有料。
2. 「ダッシュボード」の「アプリのセットアップ」を上から順に埋める:
   - プライバシーポリシー: https://kokuteki.amaterasu-vocab.com/privacy（Worker は .html を省いた URL に転送するので、こちらを登録する）
   - アプリのアクセス: すべての機能が制限なしで利用可能
   - 広告: 広告を含まない
   - コンテンツのレーティング: アンケートに回答（すべて「なし」）
   - ターゲットユーザー: 13 歳以上
   - ニュースアプリ: いいえ　／　データセーフティ: 収集も共有もしない
   - アプリのカテゴリ: 教育　／　連絡先: メールアドレス
   - ストアの掲載情報: 「ストア掲載文.md」の文面、アイコン 512×512、宣伝画像 1024×500、スクリーンショット 1080×1920 を 2〜8 枚
3. 「収益化」→ 「アプリの価格」→ 有料、価格 800 円。配信国に日本を追加。
4. 「テスト」→ 「内部テスト」→ 新しいリリース → `.aab` をアップロード → リリースノートを書いて公開。テスターに自分のアカウントを追加し、実機でインストールして確認する（TWA でアドレスバーが出ないこと、キー付き起動で全機能になること、オフライン動作）。
5. 問題なければ「製品版」→ 新しいリリース → 同じ `.aab` を選んで審査に送る。初回審査は数日〜1 週間程度。

## 4. 更新のしかた
- Web 側の更新（問題・画面・機能）は、いままでどおり main に push するだけで Play 版にも反映される（アプリは Web を表示しているため）。
- Android パッケージ自体の更新（アイコン、起動 URL、Android の要件変更）が必要なときだけ、PWABuilder で同じ Package ID・同じ署名鍵で作り直し、バージョンコードを上げて再アップロードする。

## 5. よくある詰まりどころ
- アドレスバーが消えない: assetlinks.json のフィンガープリントが Play の署名鍵と一致していない（手順 2-3）。
- 「有料アプリを公開できない」: お支払いプロファイルが未承認。
- 起動しても体験版のまま: Start URL に `?key=` が付いていない。PWABuilder のオプションを確認して作り直す。
- App Store（iOS）は TWA が使えないため別の包み方（Capacitor など）が必要。Play が落ち着いてから対応する。
