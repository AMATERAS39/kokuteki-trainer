/* オフライン対応サービスワーカー。ファイルを更新したら CACHE の版数を上げる。 */
const CACHE = 'aat-v53';
const ASSETS = ['./', './index.html', './engine.js?v=29', './viewer.js', './sim3d.js?v=10', './manifest.webmanifest', './privacy.html',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-64.png', './img/t4-top.webp', './img/hero.webp',
  ...['north', 'south', 'east', 'west', 'up', 'down', 'ne_up', 'nw_up', 'se_up', 'sw_up', 'ne_down', 'nw_down', 'se_down', 'sw_down'].map(n => `./img/bi-${n}.webp`),
  /* バンク付き（真上・真下を除く 12 方向 × 左右 × 30/60） */
  ...['north', 'south', 'east', 'west', 'ne_up', 'nw_up', 'se_up', 'sw_up', 'ne_down', 'nw_down', 'se_down', 'sw_down'].flatMap(n => ['r30', 'l30', 'r60', 'l60'].map(b => `./img/bi-${n}-${b}.webp`))];

/* インストール後は自動で有効化せず待機する。ページの更新ボタンから SKIP_WAITING を受けたとき（または全タブが閉じた次回起動）に有効化 */
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const sameOrigin = new URL(e.request.url).origin === location.origin;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      /* 同一オリジン（3D モデル含む）、Google Fonts、three.js の CDN は取得後にキャッシュしてオフラインでも使えるようにする */
      if (res.ok && (sameOrigin || e.request.url.startsWith('https://fonts.') || e.request.url.startsWith('https://cdn.jsdelivr.net/'))) {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => e.request.mode === 'navigate' ? caches.match('./index.html') : undefined))
  );
});
