# App Store 有償配信の手順

Web アプリ（PWA）を iOS アプリとして包んで配信します。中身は https://kokuteki.amaterasu-vocab.com/ を表示しますが、**そのまま Web を表示するだけの包み方は審査で落ちます**（審査ガイドライン 4.2 最低限の機能）。対策は「5. 審査対策」を読んでください。

Google Play 側の手順は `dev/docs/play/Google Play 配信手順.md`。全機能版と体験版の仕組みは Play と共通です。

## 0. 事前に用意するもの

| もの | 内容 | 費用・期間 |
|---|---|---|
| Apple ID | 二要素認証を有効にしておく | 無料 |
| Apple Developer Program | **登録済み（2026-09-04 に承認）** | 年 12,980 円 |
| Mac | **不要**。持っていないので、クラウドの macOS（Codemagic）でビルドする。下の「1. パッケージの作り方」を参照 | Codemagic 無料枠 月 500 分 |
| iPhone | 実機確認とスクリーンショットの撮影に使う（TestFlight で配信して確認する） | — |
| 銀行口座と税務情報 | 有料アプリの売上を受け取るため、App Store Connect の「契約、税金、口座情報」で設定 | — |

- 有料アプリは「有料アプリケーション契約」への同意が必要。これが済むまで価格を設定できない。
- 日本の個人の場合、マイナンバーの提出を求められる（税務情報）。

## 1. パッケージの作り方（Mac なし・Capacitor + Codemagic）

リポジトリの `mobile/` に用意済み。Mac は要らず、Codemagic（クラウドの macOS）がビルドして TestFlight まで上げる。

| ファイル | 役割 |
|---|---|
| `mobile/package.json` | Capacitor と three.js の依存 |
| `mobile/capacitor.config.json` | アプリ ID `com.amaterasuvocab.kokuteki`、名前 TENRYU、www を読む |
| `mobile/copy-web.js` | 配信ファイルを `mobile/www` に集め、three.js を同梱して importmap をローカルに書き換える（sw.js と Google Fonts は入れない） |
| `codemagic.yaml`（リポジトリ直下） | クラウドでのビルドと TestFlight への配信。Codemagic は直下しか見ないので、ここに置く |

アプリ側の作りは対応済み: Capacitor で動いているときはサービスワーカーを登録せず、版は常に全機能版になる（`index.html` の `NATIVE`）。

### 手順
1. **Apple Developer Program に登録**（年 12,980 円）。登録が済んだら App Store Connect にログインできる。
2. **App Store Connect の API キーを作る**: ユーザとアクセス → 統合 → App Store Connect API → 「キーを生成」。アクセス権は App Manager。`.p8` ファイル、Key ID、Issuer ID を控える（`.p8` は 1 回しかダウンロードできない）。
3. **Codemagic に登録**（https://codemagic.io）。GitHub でログインし、`AMATERAS39/kokuteki-trainer` を選ぶ。
4. Codemagic の Teams → Integrations → App Store Connect に、上の Key ID・Issuer ID・`.p8` を登録する。
5. Codemagic のアプリ設定で、ビルド設定に `mobile/codemagic.yaml` を使うよう指定し、環境変数グループ `appstore` を作る。
6. ビルドを実行する。成功すると TestFlight にビルドが上がる。iPhone の TestFlight アプリで実機確認する。
7. 問題なければ `codemagic.yaml` の `submit_to_app_store` を true にするか、App Store Connect の画面から審査に提出する。

### 代わりの方法
- **クラウドの Mac を借りる**: MacinCloud（月 30 ドル前後）や Scaleway の Mac mini（時間貸し）。画面越しに Xcode を使う。CI に慣れていないときはこちら。
- **PWABuilder の iOS パッケージ**: ブラウザだけで Xcode プロジェクトは作れるが、結局ビルドに macOS が要る。中身も URL を表示するだけなので審査 4.2 で落ちやすい。勧めない。

## 2. Xcode での設定（Codemagic 上で自動。手で直すときの控え）

- Bundle Identifier: `com.amaterasuvocab.kokuteki`（Play と同じ）
- Display Name: TENRYU
- Version 1.0、Build 1（以後、申請のたびに Build を上げる）
- Deployment Target: iOS 15.0 以上
- Device Orientation: **縦・横の両方**（横画面では視界が画面いっぱいになる作りなので、横を止めてはいけない）。`mobile/patch-ios.js` が Info.plist に入れる
- App Icons: `mobile/assets/icon.png`（1024×1024・不透明・角丸なし）から `npx capacitor-assets generate --ios` が各サイズを作る
- Launch Screen: `mobile/assets/splash.png`（2732×2732）から同じコマンドが作る
- Signing: Automatically manage signing、Team に開発者アカウントを選ぶ
- 3D（three.js）は `copy-web.js` が `node_modules` から `www/vendor` にコピーし、`importmap` をローカル参照に書き換える。Google Fonts の link も外すので、通信なしで動く

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
6. スクリーンショット: **用意済み**。`dev/docs/appstore/screenshots/iphone-6.7/`（1290×2796・6 枚）と `ipad-12.9/`（2732×2048・4 枚、横向き）をそのまま上げる。
   iPad に対応させない場合は `patch-ios.js` に `TARGETED_DEVICE_FAMILY=1` を足して iPhone 専用にし、iPad のぶんは上げない

## 4. 提出

1. Codemagic のビルドが TestFlight まで上げる（Mac があるときは Xcode → Product → Archive → Distribute App）
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

- Web 版を体験版にする（`DEMO_ON=true`）タイミング: **App Store 版が公開された時点**に変更（2026-09-04、利用者の判断）。
  Play は 12 人・14 日のテストが要るため後になる。App Store が先に出る見込み。
  そのとき Android の人が完全版を買えないので、**Web 版の鍵を自分で売る口**（BOOTH か note の有料記事）を用意するか、
  「Android 版は準備中」と案内するかを決めておく
- `PLAY_URL` と同様に App Store の URL を `index.html` に足し、「全機能版について」の画面に両方を並べる
- 版を上げるたびに Xcode の Build 番号を上げて再提出する。Web 版と違い、審査があるので即時反映はできない

## 7. いまの状態と残っていること

済み
- Apple Developer Program の登録（2026-09-04 承認）
- Mac なしのビルド一式（`mobile/`。Capacitor + Codemagic）。`copy-web.js` は three.js と 3D モデルを同梱し、外の CDN を指していたら止める
- アイコン（1024）と起動画面（2732）の素材、Info.plist の手当て（向き・輸出コンプライアンス・表示名）
- スクリーンショット（iPhone 6.7 インチ 6 枚、iPad 12.9 インチ 横 4 枚）
- 掲載文（`ストア掲載文.md`）とプライバシーポリシー

利用者の作業（この順）
1. App Store Connect で **App Store Connect API キー**を作る（ユーザとアクセス → 統合 → キーを生成。権限は App Manager。`.p8` は 1 回だけダウンロードできる）
2. **バンドル ID を登録**（Certificates, Identifiers & Profiles → Identifiers → `com.amaterasuvocab.kokuteki`）
3. App Store Connect で **アプリを作る**（名前 TENRYU、SKU `tenryu-001`）
4. Codemagic に GitHub でログインし、`AMATERAS39/kokuteki-trainer` を追加
5. そのアプリの **Environment variables** で、グループ `appstore` に 3 つ入れる（Integrations の画面は触らなくてよい）
   | 変数名 | 値 | Secure |
   |---|---|---|
   | `APP_STORE_CONNECT_ISSUER_ID` | Issuer ID | しなくてよい |
   | `APP_STORE_CONNECT_KEY_IDENTIFIER` | Key ID | しなくてよい |
   | `APP_STORE_CONNECT_PRIVATE_KEY` | `.p8` の中身を全部（`-----BEGIN` の行から `-----END` の行まで） | **する** |
   | `CERTIFICATE_PRIVATE_KEY` | 配布証明書を作るための RSA 秘密鍵（`kokuteki-private/appstore/certificate-private-key.pem` の中身） | **する** |
   この名前のままにすると `app-store-connect` コマンドと TestFlight への配信が自動で読む
6. ビルドを実行 → TestFlight に上がる → iPhone で確認
   - `Cannot save Signing Certificates without certificate private key` で落ちたら `CERTIFICATE_PRIVATE_KEY` が入っていない
   - `"App" requires a provisioning profile` で落ちたら、バンドル ID の食い違い（`patch-ios.js` が直す）
7. 掲載文・スクリーンショット・価格（800 円）・「App のプライバシー（収集なし）」を入れて審査へ提出

決めておくこと
- iPad に対応させるか（対応するなら iPad のスクリーンショットも上げる。しないなら iPhone 専用にする）
- 有料アプリケーション契約と税務情報（マイナンバー）の登録。これが済むまで価格を設定できない
