# App Store 有償配信の手順

Web アプリ（PWA）を iOS アプリとして包んで配信します。中身は https://kokuteki.amaterasu-vocab.com/ を表示しますが、**そのまま Web を表示するだけの包み方は審査で落ちます**（審査ガイドライン 4.2 最低限の機能）。対策は「5. 審査対策」を読んでください。

Google Play 側の手順は `dev/docs/play/Google Play 配信手順.md`。全機能版と体験版の仕組みは Play と共通です。

## 0. 事前に用意するもの

| もの | 内容 | 費用・期間 |
|---|---|---|
| Apple ID | 二要素認証を有効にしておく | 無料 |
| Apple Developer Program | 個人または法人で登録。個人なら本人確認あり | 年 12,980 円、審査 1〜3 日 |
| Mac | Xcode 15 以上が動く macOS。実機ビルドと申請に必要 | — |
| iPhone または iPad | 実機確認用（シミュレーターだけでも申請はできるが確認が甘くなる） | — |
| 銀行口座と税務情報 | 有料アプリの売上を受け取るため、App Store Connect の「契約、税金、口座情報」で設定 | — |

- 有料アプリは「有料アプリケーション契約」への同意が必要。これが済むまで価格を設定できない。
- 日本の個人の場合、マイナンバーの提出を求められる（税務情報）。

## 1. パッケージの作り方（2 案）

### 案 A: Capacitor（推奨）
ネイティブの機能を足しやすく、審査対策（4.2）に必要な「アプリらしさ」を作りやすい。

1. Mac で Node.js を入れる。
2. 空のフォルダで `npm init -y` → `npm i @capacitor/core @capacitor/cli @capacitor/ios`
3. `npx cap init TENRYU com.amaterasuvocab.kokuteki --web-dir=www`
4. リポジトリの配信ファイル（index.html、engine.js、sim3d.js、viewer.js、img/、model/、icons/、news.json、manifest.webmanifest、privacy.html）を `www/` にコピーする。**sw.js は入れない**（アプリ内では不要で、更新の扱いが二重になる）。
5. `npx cap add ios` → `npx cap open ios` で Xcode が開く。
6. 全機能版の扱い: アプリ内は常に全機能版にする。`index.html` の `DEMO_ON` は Web 版のためのもので、アプリに入れるファイルでは `edition='full'` 固定にするか、起動 URL の `?key=` と同じ判定を通す。

### 案 B: PWABuilder の iOS パッケージ
ブラウザだけで作れるが、中身は WKWebView で URL を表示するだけなので 4.2 で落ちやすい。急ぐとき以外は勧めない。

## 2. Xcode での設定

- Bundle Identifier: `com.amaterasuvocab.kokuteki`（Play と同じ）
- Display Name: TENRYU
- Version 1.0、Build 1（以後、申請のたびに Build を上げる）
- Deployment Target: iOS 15.0 以上
- Device Orientation: Portrait のみ（アプリは縦向き固定）
- App Icons: `icons/icon-512.png` から 1024×1024 を作って設定する（角丸と透明は不可。白地の四角い画像にする）
- Launch Screen: 背景 #141a22 に中央アイコン
- Signing: Automatically manage signing、Team に開発者アカウントを選ぶ
- 3D（three.js）は CDN から読み込んでいる。オフラインでも動くよう、`three` と `OrbitControls`・`GLTFLoader` をローカルに置いて `importmap` を書き換えることを検討する（審査でオフライン動作を見られることがある）

## 3. App Store Connect でアプリを作る

1. https://appstoreconnect.apple.com → 「マイ App」→ 「＋」→ 新規 App
   - プラットフォーム: iOS、名前: TENRYU、プライマリ言語: 日本語、バンドル ID: 上記、SKU: `tenryu-001`
2. 「App 情報」
   - カテゴリ: 教育（第 2 カテゴリ: 参考書）
   - 年齢制限: 4+（暴力・その他すべて「なし」）
   - プライバシーポリシー URL: https://kokuteki.amaterasu-vocab.com/privacy
3. 「価格および配信状況」
   - 価格: Tier 相当の 800 円（日本）。ほかの国は自動換算のままでよい
   - 配信国: 日本のみ、または全世界（日本語だけなので日本のみで十分）
4. 「App のプライバシー」
   - データを収集しない（No, we do not collect data）を選ぶ。設定と記録は端末内の localStorage だけで、外部に送らない
5. 「バージョン情報」: 掲載文は `dev/docs/appstore/ストア掲載文.md` から貼る
6. スクリーンショット: 6.7 インチ（1290×2796）と 6.5 インチ（1242×2688）が必須。`dev/docs/play/screenshots/` の 1080×1920 は使い回せないので、iPhone の実機かシミュレーターで撮り直す

## 4. 提出

1. Xcode → Product → Archive → Distribute App → App Store Connect → Upload
2. App Store Connect でビルドを選び、輸出コンプライアンス（暗号化）に回答する。**HTTPS 通信だけなら「いいえ」**（`ITSAppUsesNonExemptEncryption` を `false` で Info.plist に入れておくと毎回聞かれない）
3. 「審査へ提出」。初回は 1〜3 日で結果が来る

## 5. 審査対策（ここが要）

- **4.2 最低限の機能**: 「Web サイトを表示するだけ」と判断されると落ちる。次を満たしておく。
  - アプリ内で完結して動く（通信なしで出題・採点・3D 練習ができる）。CDN 依存を減らし、モデルと three.js を同梱する
  - iOS らしい振る舞い: 縦向き固定、セーフエリア対応、スワイプで戻らない画面での確認、ハプティクス（`@capacitor/haptics` で正誤に軽い振動）を入れると強い
  - Web ブラウザに見える要素を出さない（アドレスバー、外部リンクの多用）。BOOTH へのクレジットのリンクは Safari で開く形にする
- **3.1.1 アプリ内課金**: 買い切り 800 円の「有料アプリ」として出すなら課金は不要。アプリ内で「Web 版の全機能版コード」を売る形にすると App 内課金の対象になるので、**アプリ自体を有料にする**のが簡単
- **5.1.1 データ収集**: 収集なしなので追跡許可（ATT）のダイアログは不要
- **著作権**: 機体の 3D モデルは作者の許諾済み（BOOTH、クレジット掲載）。ブルーインパルスのエンブレムは使っていない（自作の紋章に差し替え済み）。審査で問われたら「モデルは購入品で作者の許諾あり」と回答する
- **試験との関係**: 「航空学生の適性検査」を扱うが、公式・非公式の別を掲載文に明記する（非公式の学習アプリ）

## 6. 公開後

- Web 版を体験版にする（`DEMO_ON=true`）タイミングは、Play と App Store の両方が公開されてから。片方だけ先に出さない（利用者の決め事）
- `PLAY_URL` と同様に App Store の URL を `index.html` に足し、「全機能版について」の画面に両方を並べる
- 版を上げるたびに Xcode の Build 番号を上げて再提出する。Web 版と違い、審査があるので即時反映はできない

## 7. 今わかっている未確定事項

- Apple Developer Program の登録（利用者の作業）。登録後に Team ID が決まる
- Mac の有無。なければ、Mac を借りる、または Xcode Cloud / 代行ビルドの検討が要る
- スクリーンショットの撮り直し（6.7 インチと 6.5 インチ）
- three.js とモデルの同梱（オフライン動作の担保）
