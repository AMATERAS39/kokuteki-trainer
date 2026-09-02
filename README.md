# パイロット適性検査トレーニング

航空学生 適性検査対策の PWA。方位・姿勢指示器・複合・操縦操作の 4 種目を反復練習する。

- ルート直下が公開ファイル（GitHub Pages のルート配信を想定）。`index.html` / `engine.js` / `manifest.webmanifest` / `sw.js` / `img/` / `icons/`
- `dev/` に内部設計書、Claude Design 発注書、図版生成ツール（3D モデルは同梱していない。`t4model/` に `T4blue.fbx` とテクスチャを置くと `dev/render/render.html` で 14 方向を再描画できる）
- ファイルを更新したら `sw.js` の `CACHE` の版数を上げる

## 画面

- `#home` ホーム（種目カード）、`#train/<mode>` 訓練、`#about` 説明と 3D ビューア
- 3D モデル `model/t4.glb` は `dev/render/render.html?export=1&ax=90&hide=landing,front_gear,blake_op&paint=main/main/006ab0` で FBX から書き出す
