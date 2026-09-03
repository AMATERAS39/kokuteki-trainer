/* 配信ファイルを mobile/www に集め、three.js を同梱して importmap をローカルに書き換える。
   ねらい: アプリの中だけで完結して動くこと（審査ガイドライン 4.2 の対策と、通信なしでの動作）。
   sw.js は入れない（アプリでは使わない）。 */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), WWW = path.join(__dirname, 'www');

const FILES = ['index.html', 'engine.js', 'sim3d.js', 'viewer.js', 'news.json', 'manifest.webmanifest', 'privacy.html'];
const DIRS = ['img', 'icons', 'model'];

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(WWW, f));
for (const d of DIRS) fs.cpSync(path.join(ROOT, d), path.join(WWW, d), { recursive: true });

/* three.js を node_modules から持ってきて、CDN の importmap を差し替える */
const three = path.join(__dirname, 'node_modules', 'three');
if (!fs.existsSync(three)) { console.error('three が見つかりません。先に npm install を実行してください'); process.exit(1); }
fs.mkdirSync(path.join(WWW, 'vendor'), { recursive: true });
fs.copyFileSync(path.join(three, 'build', 'three.module.js'), path.join(WWW, 'vendor', 'three.module.js'));
fs.cpSync(path.join(three, 'examples', 'jsm'), path.join(WWW, 'vendor', 'jsm'), { recursive: true });

const idx = path.join(WWW, 'index.html');
let html = fs.readFileSync(idx, 'utf8');
const before = html;
html = html.replace(/"three":"https:\/\/cdn\.jsdelivr\.net\/npm\/three@[\d.]+\/build\/three\.module\.js"/, '"three":"./vendor/three.module.js"')
           .replace(/"three\/addons\/":"https:\/\/cdn\.jsdelivr\.net\/npm\/three@[\d.]+\/examples\/jsm\/"/, '"three/addons/":"./vendor/jsm/"');
if (html === before) { console.error('importmap を書き換えられませんでした（index.html の書式を確認）'); process.exit(1); }
/* Google Fonts は通信が要る。端末の標準フォントで代替できるよう link を外す（フォント指定側に fallback がある） */
html = html.replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\s*/, '')
           .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/[^"]*">\s*/, '');
fs.writeFileSync(idx, html);
console.log('www を作りました:', WWW);
