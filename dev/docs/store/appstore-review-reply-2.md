# App Review への返信（2 回目）: Guideline 2.1(b) 「App 内課金が見つからない」

Submission ID: 0c6b20c1-9353-4b4a-b62c-91fe252a79ab（2026-09-06、iPad Air 11-inch (M3)、3.90 (24)）

## 先に App Store Connect で確かめること（返信の前に）

この指摘は「審査に App 内課金の商品が添付されている」ときに出る。アプリ版には App 内課金がないので、添付されている商品があれば外す。

1. App Store Connect → アプリ → 左の「収益化」→「App 内課金」。商品が 1 つでもあれば、その状態を見る（「審査待ち」「準備完了」など）。
2. 同じアプリの「App Store」タブ → バージョン 3.90 のページ → 「App 内課金とサブスクリプション」の欄。ここに商品が入っていれば、右の「−」で外して「保存」。
3. 商品そのものが要らなければ「App 内課金」の一覧で削除する（審査待ちの商品は「審査から削除」→ 削除）。
4. 「ビジネス」→「契約」で「有料 App 契約（Paid Apps Agreement）」が「有効」になっているか。有料アプリなので、これは必要。

添付されていなければ、返信だけでよい。メニューに「購入を復元」が見えていたことが原因のこともあるので、返信にその旨を書く（下の文に含めてある）。

## 確認の結果（2026-09-06）

- バージョン 3.90 のページに「アプリ内購入とサブスクリプション」の欄がない → 商品は 1 つも無く、審査にも添付されていない。
- 原因はメニューの「購入を復元」「全機能版について」。v04.26 でアプリ版では出さないようにし、Codemagic でビルド **39**（版 4.26）を作った（2026-09-06、開発者のアカウントで開始）。
- 手順: App Store Connect → バージョン 3.90 → 「ビルド」でビルド 39（4.26）を選んで差し替え → 「審査内容を更新」 → 「App Review の問題およびメッセージを表示」から下の返信を送る → 「審査へ提出」。

## 返信文（App Store Connect の「やり取り」に貼る。英語、2,000 字弱。ビルド 39 を添付した前提）

```
Thank you for the review.

This app does not contain any In-App Purchases. It is a paid app, and every feature is available immediately after installation. There is nothing to unlock, no subscription, no consumable, and no account.

Why the reviewer may have expected In-App Purchases:

No In-App Purchase product exists in App Store Connect for this app, and none is attached to this version.

The app shares its code with our web edition. The web edition has a free trial and a paid "full edition" that is unlocked with a one-time code, so its menu showed "Restore purchase" and "About the full edition". In the native app the full edition is always on, so these items did nothing useful. In the newly attached build 39 (4.26) they are removed from the native app. The items never called StoreKit and never charged anything; they only re-checked a locally stored code.

How to verify the app has no purchases:

- Open the app. Every mode (Heading, Attitude indicator, Heading x Attitude, Control input) and every difficulty (Easy, Normal, Hard) is available from the home screen.
- Open the 3D simulator (Control input -> 3D simulator). Formations, smoke, photos, landing gear, lights, and the display-flight mode are all available without any purchase.
- Open the menu (top right). In build 39 there is no purchase or restore item. (In the earlier build 24 the "Restore purchase" item only showed a toast saying the full edition is already active.)
- The app does not link against StoreKit and performs no network requests.

Sandbox: because there are no In-App Purchases, there is nothing to configure in the sandbox environment. The Paid Apps Agreement is accepted so that the paid app itself can be sold.

If it helps, we are happy to provide a screen recording of the menu and the settings screen showing that no purchase flow exists.

Thank you for your time.
```

## 書かないこと

- 完全版の秘密の鍵や解除コード。
- 「体験版」の解除の仕組みの詳細（Web 版の話であり、審査対象のアプリには関係ない）。
