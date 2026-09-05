# App Store 審査（Guideline 2.1 情報要求）への返信

App Store Connect の「返信」に貼り、同じ内容を **App Review Information → Notes** にも入れる。
Notes に入れておくと、次回以降の審査でも同じ説明が読まれる。

確認した事実（コードより）:

- アプリ版（Capacitor）は `edition = 'full'` 固定。**最初から全機能が開いている**（`index.html` の
  `let edition=(DEMO_ON&&!NATIVE)?store.get('edition','demo'):'full'`）。鍵・コード入力・体験版の帯は出ない。
- 「全機能版について」のメニューは全機能版では隠れる（`menuList.querySelector('[data-go="buy"]').hidden=isFull()`）。
- アプリ内課金・購読・アカウント・ログインはない。買い切りのみ。
- 通信は要らない。three.js・3D モデル・出題の仕組み・news.json はすべて同梱（`mobile/copy-web.js`）。
- 問い合わせ（Supabase）は未設定（`SUPA_URL`/`SUPA_KEY` が空）。押すと端末のメール下書きが開くだけで、
  アプリからは何も送らない。利用者どうしが読み合う投稿の仕組みはない。
- 曲は利用者の端末にあるファイルだけを再生する。同梱もダウンロードもしない。

---

## 1. 画面録画（自分で撮る）

実機（最新 iOS）で、次の順に 1 本撮る。アプリの起動から始めること。

1. ホーム画面でアプリのアイコンを押して起動（起動の瞬間から録る）
2. ホーム: 4 種目が並ぶ。「方位」を押す
3. 「練習」を押す → 3 問答える（解説が出るところまで見せる）
4. **練習のあとは自動で計測に入る**ので、戻らずそのまま数問答え、結果の画面まで見せる
5. ホームへ戻り、「操縦操作」→「3D シミュレーターで操縦する」→「はじめる」
6. 操縦桿と方向舵を動かし、外の景色が変わるところを見せる
7. 自動操縦のボタンを 1 回押す → 演目を **課目 1 つぶんだけ**（20〜30 秒）見せる。
   もう一度押すと画面が切り替わって滑走路の待機になる → 「加速して離陸」で離陸し、
   最初の課目に入るあたりまで（30〜40 秒）。もう一度押して自動操縦を切る。
   **全演目を見せる必要はない**（1 まとまりで 6 分あり、まとまりは 8 通りから毎回選ばれる）
8. ☰ メニュー → 設定（曲の選択は「選ぶ」を押してファイル選択が開くのを見せ、**曲は選ばずに閉じる**。
   商用の曲を録画に入れない）→ お知らせ → アプリの説明 を順に開く
9. 機内モードに切り替えて、アプリを開き直し、そのまま動くところを見せる（通信が要らない証拠）

**1 本の連続録画**にする（起動から止めずに 1〜9 を通す。目安 3〜5 分）。手順 9 も同じ録画の中でできる。
容量が大きいときは 720p に落とすか、ログインなしで開けるリンクで渡す。

含めなくてよいもの（アプリにないため）: アカウント登録・ログイン・アカウント削除・アプリ内課金・
利用者どうしの投稿。録画の最後に、これらが無いことを口頭または字幕で示すとなおよい。

---

## 2〜6. App Store Connect に貼る英文

```
Thank you for the review. Here is the information requested.

2. PURPOSE AND TARGET AUDIENCE
TENRYU is an offline practice app for the aptitude test in the entrance examination of the Japan Air Self-Defense Force "Aviation Cadet" program. In that test, candidates read an aircraft's heading and attitude from instrument displays and choose the correct control input, under strict time limits. Few study materials exist for it, and paper practice reproduces neither the time pressure nor the way a control input changes the view from the cockpit.
The app provides unlimited procedurally generated questions in four categories (heading, attitude indicator, heading x attitude, control input), a timed mode recording score and average answer time, and a 3D flight simulator where the user moves the stick and rudder and sees the outside view change.
Audience: applicants preparing for that examination (typically 18-21) and anyone interested in instrument reading. The app is in Japanese.

3. SETUP AND ACCESS TO MAIN FEATURES
No account, login, credentials or sample files are required, so no account deletion flow applies. This is a one-time-purchase app and ALL features are unlocked from the first launch; nothing is gated behind a subscription, in-app purchase or unlock code.
Steps: (1) Launch the app; the home screen lists four exercises. (2) Tap one, e.g. the first, "Heading". (3) Tap the left button for practice with explanations; after three practice questions the timed measurement starts automatically and ends with a result screen. (4) From home, tap the fourth exercise "Control input", then "3D simulator", then "Start"; drag the stick at the bottom left and the rudder pedals at the bottom right, and use the icon row at the top for viewpoint, smoke, formation and the automatic display. (5) The menu button at the top right opens settings, release notes, the app description and the contact form.
The app runs completely offline and can be reviewed in airplane mode.

4. EXTERNAL SERVICES, TOOLS OR PLATFORMS
None, and the app needs no network access. It has no backend of its own, no authentication service, no analytics or tracking SDK, no advertising, no payment processor other than the App Store, no AI service, no external data provider and no cloud storage. Question generation and scoring run on the device, and every asset, including the 3D renderer (three.js) and the aircraft model, is bundled in the binary.
The optional "Requests and inquiries" screen opens the system mail composer with a pre-filled draft; the app sends nothing itself, and no user-generated content is visible to other users, so no reporting or blocking mechanism applies. An optional feature plays background music during the automatic display: only an audio file the user already has on their device and picks with the system file picker. No music is bundled or downloaded. The "About" screen carries one attribution link to the 3D model author's store page, required by that model's license; it is not a path to purchase any feature of this app. No personal data is collected or transmitted.

5. REGIONAL DIFFERENCES
None. A single Japanese-language build is distributed worldwide with identical features and content, with no region-locked content and no geolocation-dependent behaviour.

6. REGULATED INDUSTRY AND THIRD-PARTY MATERIAL
The app is an independent, unofficial study aid, not affiliated with, endorsed by or sponsored by the Japan Air Self-Defense Force or the Ministry of Defense, and it makes no such claim. It does not reproduce actual examination papers: every question is generated procedurally from publicly described formats. No official insignia, emblem or logo is used.
The only third-party asset is the 3D aircraft model (T-4 "Blue Impulse"), purchased under the author's commercial-use license from BOOTH and credited on the "About" screen as that license requires. The receipt and license can be provided on request. No copyrighted music, video or text is included.
```

**3992 文字**（4000 字の上限に収まる）。改行を含めた文字数なので、貼り付けたあと数を確認すること。

---

## 3.1.1 まわりで気をつける点

- アプリ版では「全機能版について」「体験版」の帯は出ない（`isFull()` が真のため）。
  審査員に外部の購入を促す画面は見えない。
- 「購入を復元」は残る。押すと「全機能版は有効です」と出るだけ。
- 「アプリの説明」に BOOTH（3D モデルの作者の販売ページ）への表示リンクが 1 つある。
  これはモデルのライセンスが求める出典表示で、アプリの機能を買わせるものではない。
  審査で問われたら、その旨を答える（上の英文にも書いてある）。
