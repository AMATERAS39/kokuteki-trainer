/* 配信そのものは、これまでどおり静的ファイル（assets）が受け持つ。
   この Worker が受けるのは、平均回答時間の受け渡しと、受験者アンケートの受け取りだけ。

   GET  /api/avg     … 置いてある数値を返す（誰でも読める。案内ページが使う）
   POST /api/avg     … 数値を置き換える（合言葉が合うときだけ）。{clear:true} を送ると消す
   POST /api/survey  … 受験者アンケート（/survey）の回答を 1 件しまう（誰でも送れる。匿名）
   GET  /api/survey  … しまった回答をまとめて返す（?key=合言葉 が合うときだけ）

   合言葉そのものはここに書かない。SHA-256 だけを置く（公開リポジトリに合言葉を残さないため）。
   合言葉つきの URL（/?rec=…）でいちど開いた端末だけが、計測のたびに自分の記録を送る。 */

const REC_HASH = 'f75f3e9b5efeb2268581f0c208ca2f72bc16a8648f8e0d7ba6556b573f1c59d4';
const MODES = ['heading', 'attitude', 'combo', 'control'];

/* 受験者アンケート（2026-09-16）。選択肢の値はここに書いたものしか受け取らない */
/* 受験者アンケートの項目（2026-09-19 に来年度向けに作り直し。v1 の had／notHad／difficulty も受ける）。survey.html・survey-results.html・survey_tally.py と同じ定義 */
const SV_ONE = {"seen_heading": ["yes", "no", "unk"], "cnt_heading": ["c10", "c20", "c30", "c31", "unk"], "time_heading": ["spare", "just", "short", "unk"], "seen_attitude": ["yes", "no", "unk"], "cnt_attitude": ["c10", "c20", "c30", "c31", "unk"], "time_attitude": ["spare", "just", "short", "unk"], "seen_combo": ["yes", "no", "unk"], "cnt_combo": ["c10", "c20", "c30", "c31", "unk"], "time_combo": ["spare", "just", "short", "unk"], "seen_control": ["yes", "no", "unk"], "cnt_control": ["c10", "c20", "c30", "c31", "unk"], "time_control": ["spare", "just", "short", "unk"], "markNotN": ["yes", "no", "unk"], "oblique": ["yes", "no", "unk"], "vertical": ["yes", "no", "unk"], "bankOther": ["yes", "no", "unk"], "diag": ["yes", "no", "unk"], "throttle": ["yes", "no", "unk"], "initTilt": ["yes", "no", "unk"], "imgStyle": ["photo", "cg", "mono", "unk"], "timeout": ["yes", "no", "unk"], "date": ["0919", "0926", "none"], "help_heading": ["yes", "some", "no", "na"], "help_attitude": ["yes", "some", "no", "na"], "help_combo": ["yes", "some", "no", "na"], "help_control": ["yes", "some", "no", "na"], "result": ["mostly", "half", "little", "unk"], "difficulty3": ["harder", "same", "easier", "unk"], "startWhen": ["w1", "w2_4", "m1_2", "m3p"], "hours": ["h1", "h3", "h10", "h10p"], "mostUsed": ["heading", "attitude", "combo", "control", "sim"], "level": ["easy", "normal", "hard", "max"], "edition": ["trial", "ios", "android"], "price": ["cheap", "fair", "worth", "high", "notbought"], "target": ["jasdf", "jmsdf", "both"], "status": ["hs", "grad", "univ", "work", "other"], "attempts": ["first", "again"], "sex": ["m", "f", "na"]};
const SV_MANY = {"ops": ["one", "two_simul", "two_seq", "three"], "sections": ["A", "B", "C", "D", "E", "second", "none"], "timeoutIn": ["heading", "attitude", "combo", "control", "other", "none"], "source": ["search", "sns", "friend", "school", "ai", "other"], "other": ["pastq", "prep", "web", "none"]};
const SV_TEXT = ["missing", "searchWords", "trouble", "wants", "impression"];
const SV_ITEMS = ['heading', 'attitude', 'combo', 'ctrl1', 'ctrl2', 'ctrl2seq'];   /* v1 */
const SV_DIFF = ['harder', 'same', 'easier', 'unknown'];   /* v1 */
const SV_TEXT_MAX = 2000;      /* 自由記述 1 つの上限（文字数） */
const SV_BODY_MAX = 16 * 1024;  /* 本文の上限（バイト）。これより大きいものは読まずに断る */
const SV_LIST_MAX = 1000;      /* GET で返す件数の上限 */

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

/* アンケートの本文を、決めた項目だけに削る。選択肢は一覧にある値だけ、自由記述は文字数で切る */
function cleanSurvey(src) {
  if (!src || typeof src !== 'object') return null;
  const pick = (v, list) => (typeof v === 'string' && list.includes(v)) ? v : '';
  const picks = (v, list) => Array.isArray(v) ? list.filter(id => v.includes(id)) : [];
  const text = (v) => typeof v === 'string' ? v.slice(0, SV_TEXT_MAX) : '';
  const out = { v: src.v === 3 ? 3 : src.v === 2 ? 2 : 1, code: /^\d{6}$/.test(String(src.code || '')) ? String(src.code) : '' };
  for (const k of Object.keys(SV_ONE)) out[k] = pick(src[k], SV_ONE[k]);
  for (const k of Object.keys(SV_MANY)) out[k] = picks(src[k], SV_MANY[k]);
  for (const k of SV_TEXT) out[k] = text(src[k]);
  /* v1 の項目 */
  out.had = picks(src.had, SV_ITEMS); out.notHad = picks(src.notHad, SV_ITEMS); out.difficulty = pick(src.difficulty, SV_DIFF);
  return out;
}

const json = (o, s, extra) => new Response(JSON.stringify(o), {
  status: s || 200,
  headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, extra || {})
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    /* URL の入れ替え（2026-09-24、利用者の指示）: / は公式サイト、体験版（アプリ本体）は /app。
       ・/ に ?key=（Android 版 TWA の起動・全機能版の解除）か ?rec=（記録の合言葉）が付いていれば /app へ（クエリはそのまま）
       ・旧 /guide（公式サイト）と /index.html は / へ恒久的に（広告・note・ストアのリンクと検索の評価を引き継ぐ）
       この 3 つの道は静的配信より先にここへ来るよう、wrangler.jsonc の assets.run_worker_first に並べてある */
    if (request.method === 'GET' || request.method === 'HEAD') {
      const p = url.pathname;
      if (p === '/' && (url.searchParams.has('key') || url.searchParams.has('rec'))) {
        return new Response(null, { status: 302, headers: { Location: '/app' + url.search + url.hash, 'Cache-Control': 'no-store' } });
      }
      if (p === '/guide' || p === '/guide/' || p === '/guide.html' || p === '/index.html') {
        return new Response(null, { status: 301, headers: { Location: '/' + url.search + url.hash } });
      }
    }

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

    /* 受験者アンケート（/survey）。POST は誰でも送れる（匿名）。GET は合言葉が合うときだけ、全件を返す（2026-09-16） */
    if (url.pathname === '/api/survey') {
      const cors = { 'access-control-allow-origin': '*' };
      if (request.method === 'POST') {
        if (!env.STATS) return json({ error: 'no-store' }, 503, cors);
        const len = +(request.headers.get('content-length') || 0);
        if (len > SV_BODY_MAX) return json({ error: 'too-large' }, 413, cors);
        let raw = '';
        try { raw = await request.text() } catch (e) { return json({ error: 'bad-json' }, 400, cors) }
        if (raw.length > SV_BODY_MAX) return json({ error: 'too-large' }, 413, cors);
        let body = null;
        try { body = JSON.parse(raw) } catch (e) { return json({ error: 'bad-json' }, 400, cors) }
        const sv = cleanSurvey(body);
        if (!sv) return json({ error: 'bad-json' }, 400, cors);
        sv.at = Date.now();
        sv.ua = (request.headers.get('user-agent') || '').slice(0, 120);
        const rnd = [...crypto.getRandomValues(new Uint8Array(3))].map(x => x.toString(16).padStart(2, '0')).join('');
        await env.STATS.put('survey:' + sv.at + '-' + rnd, JSON.stringify(sv));
        return json({ ok: true }, 200, cors);
      }
      if (request.method === 'GET') {
        const key = url.searchParams.get('key') || '';
        if (!key || await sha256(key) !== REC_HASH) return json({ error: 'no-key' }, 403);
        if (!env.STATS) return json({ error: 'no-store' }, 503);
        const items = [];
        let cursor = undefined;
        while (items.length < SV_LIST_MAX) {                 /* 鍵を一覧して 1 件ずつ読む。1000 件で打ち切る */
          const page = await env.STATS.list({ prefix: 'survey:', limit: 1000, cursor });
          for (const k of page.keys) {
            if (items.length >= SV_LIST_MAX) break;
            const v = await env.STATS.get(k.name);
            if (!v) continue;
            try { items.push(Object.assign({ key: k.name }, JSON.parse(v))) } catch (e) {}
          }
          if (page.list_complete || !page.cursor) break;
          cursor = page.cursor;
        }
        return json({ ok: true, count: items.length, items });
      }
      return json({ error: 'method' }, 405);
    }

    /* お知らせは、アプリ版（capacitor://localhost）が本番から読む。別オリジンなので CORS の許可を付けて返す（2026-09-13）。
       ただしファイルのある道は Worker より先に静的配信が返すので、実際に効くのは `_headers` の指定（ここは念のため） */
    if (url.pathname === '/news.json' && request.method === 'GET') {
      const res = await env.ASSETS.fetch(request);
      const h = new Headers(res.headers); h.set('access-control-allow-origin', '*');
      return new Response(res.body, { status: res.status, headers: h });
    }
    return env.ASSETS.fetch(request);
  }
};
