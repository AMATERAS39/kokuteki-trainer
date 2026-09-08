/* 配信そのものは、これまでどおり静的ファイル（assets）が受け持つ。
   この Worker が受けるのは、平均回答時間の受け渡しだけ。

   GET  /api/avg  … 置いてある数値を返す（誰でも読める。案内ページが使う）
   POST /api/avg  … 数値を置き換える（合言葉が合うときだけ）。{clear:true} を送ると消す

   合言葉そのものはここに書かない。SHA-256 だけを置く（公開リポジトリに合言葉を残さないため）。
   合言葉つきの URL（/?rec=…）でいちど開いた端末だけが、計測のたびに自分の記録を送る。 */

const REC_HASH = 'f75f3e9b5efeb2268581f0c208ca2f72bc16a8648f8e0d7ba6556b573f1c59d4';
const MODES = ['heading', 'attitude', 'combo', 'control'];

async function sha256(text) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/* 送られてきた中身を、種目ごとの {n, c, t} だけに削る。おかしな値は捨てる */
function clean(src) {
  if (!src || typeof src !== 'object') return null;
  const out = {};
  for (const m of MODES) {
    const v = src[m];
    if (!v || typeof v !== 'object') continue;
    const n = Math.round(+v.n), c = Math.round(+v.c), t = +v.t;
    if (!(n > 0) || !(t > 0) || !(c >= 0) || c > n) continue;
    if (n > 1e7 || t > n * 600) continue;      /* 1 問 10 分を超える値は受け取らない */
    out[m] = { n, c, t: +t.toFixed(2) };
  }
  return Object.keys(out).length ? out : null;
}

const json = (o, s) => new Response(JSON.stringify(o), {
  status: s || 200,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/avg') {
      if (request.method === 'GET') {
        if (!env.STATS) return json({ stats: null });
        const v = await env.STATS.get('avg');
        return new Response(v || '{"stats":null}', {
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=30' }
        });
      }
      if (request.method === 'POST') {
        if (!env.STATS) return json({ error: 'no-store' }, 503);
        let body = null;
        try { body = await request.json() } catch (e) { return json({ error: 'bad-json' }, 400) }
        if (!body || typeof body.key !== 'string') return json({ error: 'no-key' }, 403);
        if (await sha256(body.key) !== REC_HASH) return json({ error: 'no-key' }, 403);
        if (body.clear === true) {                 /* 数値を消して、既定の持ち時間の表示に戻す */
          await env.STATS.delete('avg');
          return json({ ok: true, cleared: true });
        }
        const stats = clean(body.stats);
        if (!stats) return json({ error: 'bad-stats' }, 400);
        await env.STATS.put('avg', JSON.stringify({ stats, at: Date.now() }));
        return json({ ok: true });
      }
      return json({ error: 'method' }, 405);
    }

    return env.ASSETS.fetch(request);
  }
};
