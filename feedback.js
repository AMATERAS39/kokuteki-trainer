/* ご要望・お問い合わせの通信（Supabase の REST を直接たたく。SDK もビルドも使わない）。

   考え方:
   - 利用者はログインしない。送るときに合言葉（token）を 1 つ受け取り、端末に残す。
     その合言葉で自分の投稿と返信だけを読み返せる（他人の投稿は読めない）。
   - メールアドレスを書いた人には、管理者が返信したときにメールでも届く。
   - 管理者だけがログインする（メールと合言葉）。全部を読む・返信するのは管理者だけ。

   用意するもの（利用者の作業。手順は dev/docs/feedback/セットアップ.md）:
   1. Supabase でプロジェクトを作り、SQL エディタで dev/docs/feedback/feedback.sql を実行する。
   2. Project Settings → API の「Project URL」と「anon public」キーを下に書く。
   3. Authentication → Users で管理者のアカウントを 1 つ作る。
   4. そのメールアドレスの SHA-256 を ADMIN_HASH に書く（メールそのものは書かない）。
   5. 返信をメールでも届けるなら、Edge Function を置いて MAIL_ON を true にする。

   ここに書く anon キーは公開されるもので、秘密ではない。守りはデータベース側の方針（RLS）と、
   利用者が触れる口を関数 3 本だけに絞ることで行う。 */

export const SUPA_URL = '';
export const SUPA_KEY = '';
export const ADMIN_HASH = '';
export const MAIL_ON = false;          // 返信メールの送信（Edge Function）を置いたら true
export const CONFIGURED = !!(SUPA_URL && SUPA_KEY);

const TKEY = 'aat.fbtokens';           // 自分の投稿の合言葉（端末に残す）
const SKEY = 'aat.fbadmin';            // 管理者のログイン
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

export async function sha256(text) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text).trim().toLowerCase()));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/* ---------- 管理者のログイン ---------- */
let session = store.get(SKEY, null);
export function currentAdmin() { return session && session.user ? session.user : null; }
export function signOut() { session = null; store.del(SKEY); }

export async function adminLogin(email, password) {
  const r = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: SUPA_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!r.ok) throw new Error('login');
  const d = await r.json();
  if (ADMIN_HASH && (await sha256(d.user.email)) !== ADMIN_HASH) throw new Error('not-admin');
  session = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + 3500e3, user: { id: d.user.id, email: d.user.email } };
  store.set(SKEY, session);
  return session.user;
}
async function refresh() {
  if (!session || !session.refresh_token) return false;
  const r = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: SUPA_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  if (!r.ok) { signOut(); return false; }
  const d = await r.json();
  session = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + 3500e3, user: d.user ? { id: d.user.id, email: d.user.email } : session.user };
  store.set(SKEY, session);
  return true;
}

/* ---------- 下ごしらえ ---------- */
async function auth(admin) {
  if (admin && session && session.expires_at < Date.now() + 60e3) await refresh();
  const t = admin && session ? session.access_token : SUPA_KEY;
  return { apikey: SUPA_KEY, Authorization: `Bearer ${t}`, 'content-type': 'application/json' };
}
async function api(path, opts = {}, admin = false) {
  const r = await fetch(`${SUPA_URL}/rest/v1${path}`, Object.assign({}, opts, {
    headers: Object.assign(await auth(admin), opts.headers || {})
  }));
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}
const rpc = (name, body, admin) => api(`/rpc/${name}`, { method: 'POST', body: JSON.stringify(body || {}) }, admin);

/* ---------- 利用者（ログインなし） ---------- */
export function myTokens() { const t = store.get(TKEY, []); return Array.isArray(t) ? t.slice(0, 50) : []; }

/* 送る。返ってきた合言葉を端末に残す（これが自分の投稿を読み返す鍵になる） */
export async function submit({ message, nickname, email, file }) {
  const token = await rpc('submit_feedback', {
    p_message: message,
    p_nickname: nickname || null,
    p_email: email || null,
    p_att_name: file ? file.name : null,
    p_att_type: file ? file.type : null,
    p_att_data: file ? file.data : null
  });
  const t = String(token).replace(/"/g, '');
  store.set(TKEY, [t, ...myTokens()].slice(0, 50));
  return t;
}
/* 自分の投稿と返信。合言葉に一致する行だけが返る */
export async function listMine() {
  const t = myTokens();
  if (!t.length) return [];
  return (await rpc('get_feedback_by_tokens', { p_tokens: t })) || [];
}
/* 返信を読んだ印。書き込みは関数 1 本だけを通す。失敗しても画面は壊さない */
export async function markMyRead() {
  const t = myTokens();
  if (!t.length) return false;
  try { await rpc('mark_feedback_read', { p_tokens: t }); return true; } catch (e) { return false; }
}

/* ---------- 管理者 ---------- */
export async function listAll() { return api('/feedback?select=*&order=created_at.desc', {}, true); }

/* 返信する。メールの送信口があればそこへ任せ（返信の保存もその中で行う）、
   なければ行に保存して、宛先の下書きを開くための住所を返す */
export async function adminReply(id, text) {
  if (MAIL_ON) {
    const r = await fetch(`${SUPA_URL}/functions/v1/feedback-reply`, {
      method: 'POST', headers: await auth(true), body: JSON.stringify({ id, reply: text })
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();                       // {mailed:true|false}
  }
  await api(`/feedback?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ reply: text, replied_at: new Date().toISOString() })
  }, true);
  return { mailed: false };
}
export async function adminMarkRead(ids) {
  if (!ids.length) return null;
  return api(`/feedback?id=in.(${ids.map(encodeURIComponent).join(',')})`, {
    method: 'PATCH', body: JSON.stringify({ admin_read_at: new Date().toISOString() })
  }, true);
}

/* ---------- 印（赤いドット）の判定 ---------- */
/* 利用者側: 管理者が返信したか読んだ時刻が、自分が読んだ時刻より新しいとき */
export const unreadForUser = r => {
  const act = Math.max(Date.parse(r.replied_at || 0) || 0, Date.parse(r.admin_read_at || 0) || 0);
  if (!act) return false;
  return act > (Date.parse(r.user_read_at || 0) || 0);
};
/* 管理者側: まだ読んでいないか、読んだあとに投稿が来たとき */
export const unreadForAdmin = r => {
  const seen = Date.parse(r.admin_read_at || 0) || 0;
  return !seen || seen < (Date.parse(r.created_at || 0) || 0);
};

/* 添付は「表示する側」で形式を確かめる。入力の制限は守りにならない */
export const ATTACH_RE = /^data:(image\/(png|jpe?g|gif|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/;
export const attachmentOk = d => typeof d === 'string' && d.length < 3e6 && ATTACH_RE.test(d);
