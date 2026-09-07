# 使っているものの権利と、その根拠（2026-09-07）

有償配信（App Store・Google Play）を始めるにあたって、アプリに入っているもののうち自分たちで作っていないものを洗い出し、商用利用ができる根拠を一度だけ書き残す。

確かめた日: 2026-09-07。以降に部品を足したら、この表にも 1 行足す。

## 一覧

| もの | どこで使っているか | 出どころ | 許諾 | 根拠 |
| --- | --- | --- | --- | --- |
| T-4 ブルーインパルスの 3D モデル | `model/t4.glb`（3D シミュレーター・説明ページ）、`img/bi-*.webp`（機体画像はこのモデルから描いた） | BOOTH で購入（3Dえいじくん「航空自衛隊アクロバットチーム T-4ブルーインパルス」1,000 円） | 商用利用可。GLB の同梱・クレジット・購入先リンクとも、作者から明示の了承（2026-09-03） | ショップページの「素材なので商用利用は自由です」の記載（スクリーンショットを `dev/docs/attach/`）と、作者からの返信（`kokuteki-private/` に保存） |
| ホーム・更新・戻るのアイコン | `index.html` の `#i-home` / `#i-update` / `#i-back`（3 つの path だけ） | Iconify（RIKYU で選定）。`mdi:house-outline`（Material Design Icons / Pictogrammers）、`ri:refresh-line`（Remix Icon / Remix Design）、`mingcute:arrow-left-fill`（MingCute Design） | 3 つとも **Apache License 2.0**。商用利用可 | Iconify の収録情報（`https://api.iconify.design/collections?prefix=mdi` ほか）で 3 つとも `Apache-2.0` と確認（2026-09-07） |
| ほかのアイコンすべて（技の一覧 22 個、種目・操作・視点・記号など） | `index.html` の `<symbol>` 群 | こちらで描いた（v04.39 ほか） | 自分たちのもの | — |
| スモークのアイコン、エンブレムの元図 | `#i-smoke`、アプリアイコンと機体テクスチャのエンブレム | 利用者から届いた図 | 利用者のもの | — |
| three.js r160 | `vendor/three/`（3D の描画） | mrdoob/three.js | **MIT**。商用利用可 | 同梱の `vendor/three/LICENSE`。GitHub の表示も MIT |
| 書体 Noto Sans JP / Zen Kaku Gothic New / JetBrains Mono | `index.html` から Google Fonts を読み込む（**同梱していない**） | Google Fonts | **SIL Open Font License 1.1**。商用利用可 | google/fonts の `ofl/notosansjp`・`ofl/zenkakugothicnew`・`ofl/jetbrainsmono` に `OFL.txt`（2026-09-07 確認） |
| 画面の設計（配色・字づかい・部品の形） | アプリ全体 | Claude Design にこのアプリのために作らせたもの | 第三者の素材は含まない | — |

## 使っていないもの（記録）

- **航空自衛隊のエンブレム画像**: 2026-09-03 に削除した（旧 `img/bi-logo.png`）。防衛省「ウェブサイト等のコンテンツの利用について」は PDL1.0 で商用利用可としているが、「1.4 本利用ルールが適用されないコンテンツ」に「組織や特定の事業を表すシンボルマーク、キャラクターデザイン」が挙がっており、部隊のエンブレムはこれに当たるため。いま使っているエンブレムは利用者が用意した図案（龍・イルカの円形図案に T-4 を合成したもの）で、防衛省のコンテンツではない。

## 残る論点

- **「ブルーインパルス」という名称**の商標登録の有無は未確認。アプリの中とストア掲載文では、購入した 3D モデルの説明とクレジットに出てくるだけで、アプリ名（TENRYU）や見出しには使っていない。名称を前に出す使い方をするときは、先に確認する。
- 機体の**塗装**（青と白の配色）は購入したモデルのテクスチャそのもので、防衛省サイトのコンテンツではない。意匠としての扱いは確認していない。
