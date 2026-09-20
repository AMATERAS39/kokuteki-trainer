/* 配信ファイルを mobile/www に集める。
   ねらい: アプリの中だけで完結して動くこと（審査ガイドライン 4.2 の対策と、通信なしでの動作）。
   - three.js はリポジトリの vendor/three をそのまま持っていく（index.html の importmap が最初からローカル参照）
   - sw.js は入れない（アプリでは使わない。index.html 側も Capacitor では登録しない）
   - Google Fonts の link は外す（通信が要るため。font-family 側に端末標準のフォールバックがある） */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), WWW = path.join(__dirname, 'www');

/* index.html が読むスクリプトは全部ここに入れる。1 つでも欠けると、アプリの中でその機能がまるごと動かない。
   2026-09-14 の v05.13 で flight.js（飛行モデル）を足したとき、ここに加え忘れたため、App Store の 5.31〜5.45 では
   操縦操作の出題・解説・「動きで見る」・シミュレーターが動かなかった（ブラウザ版は sw.js が別に配るので無事だった）。
   同じ事故を繰り返さないよう、下で index.html の <script src> と import() を読み取って、欠けがあればビルドを止める */
const FILES = ['index.html', 'engine.js', 'flight.js', 'sim3d.js', 'viewer.js', 'feedback.js', 'attshot.js', 'news.json', 'manifest.webmanifest', 'privacy.html'];   // attshot.js: 空間認識・複合 Max の絵をその場で描く（v06.11）
const DIRS = ['img', 'icons', 'model', 'vendor'];

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });
for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { console.error('見つかりません:', f); process.exit(1); }
  fs.copyFileSync(src, path.join(WWW, f));
}
for (const d of DIRS) {
  const src = path.join(ROOT, d);
  if (!fs.existsSync(src)) { console.error('見つかりません:', d + '/'); process.exit(1); }
  fs.cpSync(src, path.join(WWW, d), { recursive: true });
}

const idx = path.join(WWW, 'index.html');
let html = fs.readFileSync(idx, 'utf8');

/* 外の CDN を指したままだと、通信なしでは 3D が動かない（審査 4.2 の対策にもならない）ので止める */
if (/cdn\.jsdelivr\.net|unpkg\.com|esm\.sh/.test(html)) {
  console.error('index.html が外の CDN を指しています。importmap をローカル参照にしてください');
  process.exit(1);
}
if (!fs.existsSync(path.join(WWW, 'vendor', 'three', 'three.module.js'))) {
  console.error('vendor/three/three.module.js がありません');
  process.exit(1);
}

/* index.html が読む同一オリジンのファイル（<script src>・import()・importmap の値）が www に全部あるか確かめる。
   1 つでも欠けていたらビルドを止める（欠けたまま App Store に出した事故の再発防止。上の FILES の注記を見る） */
{
  const refs = new Set();
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) refs.add(m[1]);
  for (const m of html.matchAll(/import\((?:'|")(\.\/[^'"]+)(?:'|")\)/g)) refs.add(m[1]);
  for (const m of html.matchAll(/"(\.\/[^"]+\.js)"/g)) refs.add(m[1]);   // importmap の値
  const missing = [...refs].filter(r => !/^https?:/.test(r)).map(r => r.replace(/^\.\//, '').replace(/[?#].*$/, ''))
    .filter(r => !fs.existsSync(path.join(WWW, r)));
  if (missing.length) {
    console.error('index.html が読むファイルが www にありません（copy-web.js の FILES / DIRS に足してください）:', missing.join(', '));
    process.exit(1);
  }
  console.log('index.html が読むファイルの同梱を確認:', [...refs].length, '件');
}

/* Google Fonts の link を外す */
const before = html;
html = html.replace(/<link rel="preconnect" href="https:\/\/fonts\.[^"]*"[^>]*>\s*/g, '')
           .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/[^"]*">\s*/g, '');
if (html === before) console.warn('注意: Google Fonts の link が見つかりませんでした（書式が変わった可能性）');
fs.writeFileSync(idx, html);

const mb = p => (fs.statSync(p).size / 1048576).toFixed(2) + ' MB';
console.log('www を作りました:', WWW);
console.log('  model/t4.glb', mb(path.join(WWW, 'model', 't4.glb')), '/ vendor/three', mb(path.join(WWW, 'vendor', 'three', 'three.module.js')));
