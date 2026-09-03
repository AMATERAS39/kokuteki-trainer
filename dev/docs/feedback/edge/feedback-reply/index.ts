// 返信をメールで届ける（Supabase Edge Function）。管理者だけが呼べる。
// 置き方は dev/docs/feedback/セットアップ.md の「5」を見ること。
// 必要な秘密: ADMIN_EMAIL, RESEND_KEY, MAIL_FROM
// （SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で入れる）

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS'
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const URL_ = Deno.env.get('SUPABASE_URL')!;
  const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ADMIN = Deno.env.get('ADMIN_EMAIL') ?? '';
  const RESEND = Deno.env.get('RESEND_KEY') ?? '';
  const FROM = Deno.env.get('MAIL_FROM') ?? '';

  // 呼んだ人が管理者かどうか
  const authz = req.headers.get('authorization') ?? '';
  const me = await fetch(`${URL_}/auth/v1/user`, {
    headers: { authorization: authz, apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? SRV }
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!me || !me.email || me.email.toLowerCase() !== ADMIN.toLowerCase()) return json({ error: 'forbidden' }, 403);

  const { id, reply } = await req.json().catch(() => ({}));
  if (!id || !reply || String(reply).length > 4000) return json({ error: 'bad request' }, 400);

  const srv = { apikey: SRV, authorization: `Bearer ${SRV}`, 'content-type': 'application/json' };
  const rows = await fetch(`${URL_}/rest/v1/feedback?id=eq.${encodeURIComponent(String(id))}&select=*`, { headers: srv })
    .then((r) => r.json());
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return json({ error: 'not found' }, 404);

  // 返信を先に残す（メールが送れなくても、アプリの中では読める）
  await fetch(`${URL_}/rest/v1/feedback?id=eq.${encodeURIComponent(String(id))}`, {
    method: 'PATCH', headers: srv,
    body: JSON.stringify({ reply, replied_at: new Date().toISOString() })
  });

  if (!row.submitter_email || !RESEND || !FROM) return json({ mailed: false });

  const text = [
    `${row.submitter_nickname || 'お問い合わせいただいた方'} 様`, '',
    'TENRYU へのご連絡ありがとうございます。返信いたします。', '',
    String(reply), '', '---', 'いただいた内容:',
    String(row.message).slice(0, 1000), '', 'TENRYU / AMATERAS'
  ].join('\n');
  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${RESEND}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [row.submitter_email], subject: 'TENRYU お問い合わせへの返信', text })
  });
  if (sent.ok) {
    await fetch(`${URL_}/rest/v1/feedback?id=eq.${encodeURIComponent(String(id))}`, {
      method: 'PATCH', headers: srv, body: JSON.stringify({ reply_mailed_at: new Date().toISOString() })
    });
    return json({ mailed: true });
  }
  return json({ mailed: false, error: await sent.text() });
});
