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
4. 戻って「計測」を押す → 数問答え、結果の画面まで見せる
5. ホームへ戻り、「操縦操作」→「3D シミュレーターで操縦する」→「はじめる」
6. 操縦桿と方向舵を動かし、外の景色が変わるところを見せる
7. 自動操縦のボタンを 1 回押す（演目が始まる）→ もう一度押す（通し）→ 「加速して離陸」で離陸
8. ☰ メニュー → 設定 → お知らせ → アプリの説明 を順に開く
9. 機内モードに切り替えて、アプリを開き直し、そのまま動くところを見せる（通信が要らない証拠）

含めなくてよいもの（アプリにないため）: アカウント登録・ログイン・アカウント削除・アプリ内課金・
利用者どうしの投稿。録画の最後に、これらが無いことを口頭または字幕で示すとなおよい。

---

## 2〜6. App Store Connect に貼る英文

```
Thank you for the review. Below is the information requested.

--- 2. Purpose and target audience ---

TENRYU is an offline practice app for the aptitude test used in the entrance
examination of the Japan Air Self-Defense Force "Aviation Cadet" (Kokukugakusei)
program.

Problem it solves: in that test, candidates must read an aircraft's heading and
attitude from instrument displays and identify the correct control input, under
strict time limits. Very few study materials exist for this specific test, and
paper practice can reproduce neither the time pressure nor the way a control
input actually changes the view from the cockpit.

Value it provides:
- Unlimited, procedurally generated questions in four categories: heading,
  attitude indicator, heading x attitude, and control input.
- A timed measurement mode that records score and average answer time, so the
  user can see progress over time.
- A 3D flight simulator in which the user moves the stick and rudder and sees
  how the outside view changes, plus an automatic display mode that flies
  aerobatic maneuvers.

Target audience: applicants preparing for that examination (typically 18-21
years old), and anyone interested in instrument reading and basic flight
attitude. The app is in Japanese.

--- 3. How to set up and access the main features ---

No account, no login, no credentials and no sample files are required.
This is a one-time-purchase app: ALL features are unlocked from the first
launch. Nothing is gated behind a subscription, an in-app purchase, or an
unlock code, and the app never asks the reviewer to obtain anything elsewhere.

Steps to reach every main feature:
1. Launch the app. The home screen lists the four exercises.
2. Tap any exercise (for example the first one, "Heading").
3. Tap the left button for practice with explanations, or the right button for
   the timed measurement. Answer by tapping one of the choices. The result
   screen appears at the end of a measurement.
4. Back on the home screen, tap the fourth exercise ("Control input"), then
   "3D simulator", then "Start" to open the simulator. Drag the stick at the
   bottom left and the rudder pedals at the bottom right; the view changes
   accordingly. The icon row at the top switches viewpoint, smoke, formation
   and the automatic display.
5. The menu button at the top right opens settings, release notes, the app
   description and the contact form.

The app works completely offline; it can be reviewed in airplane mode.

--- 4. External services, tools or platforms ---

None. The app has no backend of its own and requires no network access for any
of its functionality.

- No authentication service, no analytics or tracking SDK, no advertising, no
  payment processor other than the App Store itself, no AI service, no external
  data provider, no cloud storage.
- All question generation and scoring is performed on the device.
- The 3D renderer (three.js), the aircraft model and all other assets are
  bundled in the app binary. Nothing is downloaded at runtime.
- The optional "Requests and inquiries" screen opens the system mail composer
  with a pre-filled draft. The app itself sends nothing, and there is no
  user-generated content that other users can see; therefore no reporting or
  blocking mechanism is applicable.
- The optional background-music feature plays only audio files that the user
  already has on their own device and selects with the system file picker. No
  music is bundled with the app or downloaded by it.
- The "About" screen contains one attribution link to the store page of the
  author of the 3D model, which the model's license requires. It is not a path
  to purchase any feature of this app.

Data collection: none. The app collects no personal data and transmits no user
information. Settings and score history are stored only in local storage on the
device and are deleted with the app.

--- 5. Regional differences ---

There are none. A single Japanese-language build is distributed worldwide, with
identical features and content in every region. The app has no region-locked
content, no geolocation-dependent behaviour and no server that could vary by
region.

--- 6. Regulated industry and third-party material ---

The app is an independent, unofficial study aid. It is not affiliated with,
endorsed by, or sponsored by the Japan Air Self-Defense Force or the Japanese
Ministry of Defense, and it makes no claim to be. It does not reproduce actual
examination papers: every question is generated procedurally by the app from the
publicly described question formats. No official insignia, emblem or logo is
used. The app does not operate in a regulated industry: it provides no medical,
financial, legal or gambling functionality, and it does not enrol anyone in, or
apply on anyone's behalf to, any program.

Third-party material: the only third-party asset is the 3D aircraft model
(T-4 "Blue Impulse"), purchased under the author's commercial-use license from
BOOTH. The author is credited on the "About" screen inside the app, as the
license requires. The purchase receipt and license terms can be provided on
request. No copyrighted music, video or text is included in the app.

--- Additional notes ---

- There is no account creation in the app, so no account deletion flow is
  required.
- There is no user-generated content shared between users, so no content
  reporting or blocking mechanism is required.
- There are no in-app purchases; the app is a one-time purchase and every
  feature is available immediately after installation.
```

---

## 3.1.1 まわりで気をつける点

- アプリ版では「全機能版について」「体験版」の帯は出ない（`isFull()` が真のため）。
  審査員に外部の購入を促す画面は見えない。
- 「購入を復元」は残る。押すと「全機能版は有効です」と出るだけ。
- 「アプリの説明」に BOOTH（3D モデルの作者の販売ページ）への表示リンクが 1 つある。
  これはモデルのライセンスが求める出典表示で、アプリの機能を買わせるものではない。
  審査で問われたら、その旨を答える（上の英文にも書いてある）。
