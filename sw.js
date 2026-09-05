/* オフライン対応サービスワーカー。ファイルを更新したら CACHE の版数を上げる。 */
const CACHE = 'aat-v04.06';
/* 大きくて変わらないもの（3D モデル）は、版を上げても消さない入れ物に置く。
   ここを消してしまうと、更新のたびに 5.6 MB を取り直すことになり、オフラインで 3D が動かなくなる */
const BIG = 'aat-big-v1';
const BIG_RE = /\/model\/|\.glb($|\?)/;
const ASSETS = ['./', './index.html', './engine.js?v=40', './viewer.js?v=5', './feedback.js?v=2', './sim3d.js?v=102',
  './vendor/three/three.module.js', './vendor/three/addons/loaders/GLTFLoader.js', './vendor/three/addons/controls/OrbitControls.js', './vendor/three/addons/utils/BufferGeometryUtils.js', './manifest.webmanifest', './privacy.html', './news.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-64.png', './img/t4-top.webp', './img/hero.webp?v=3',
  ...['north', 'south', 'east', 'west', 'up', 'down', 'ne_up', 'nw_up', 'se_up', 'sw_up', 'ne_down', 'nw_down', 'se_down', 'sw_down'].map(n => `./img/bi-${n}.webp`),
  /* バンク付き（真上・真下を除く 12 方向 × 左右 × 30/60） */
  ...['north', 'south', 'east', 'west', 'ne_up', 'nw_up', 'se_up', 'sw_up', 'ne_down', 'nw_down', 'se_down', 'sw_down'].flatMap(n => ['r30', 'l30', 'r60', 'l60'].map(b => `./img/bi-${n}-${b}.webp`))];

/* インストールできたらすぐ有効化する（待機させると、更新ボタンのない古い版が入った端末が自分では移れなくなる）。
   ページを再読み込みするかどうかはページ側で決める（計測の途中では読み込み直さず、更新ボタンに赤い点を出す） */
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== BIG).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url), sameOrigin = url.origin === location.origin;
  /* お知らせは版を上げずに差し替えるので、通信を先に試してキャッシュを更新する（つながらないときは前回の内容） */
  if (sameOrigin && url.pathname.endsWith('/news.json')) {
    e.respondWith(fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; }).catch(() => caches.match(e.request)));
    return;
  }
  const box = sameOrigin && BIG_RE.test(url.pathname) ? BIG : CACHE;   // 3D モデルは消さない入れ物へ
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      /* 同一オリジン（3D モデル含む）と Google Fonts は、取得したらしまっておく（オフラインでも使える） */
      if (res.ok && (sameOrigin || e.request.url.startsWith('https://fonts.'))) {
        const copy = res.clone(); caches.open(box).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => e.request.mode === 'navigate' ? caches.match('./index.html') : undefined))
  );
});
