-- ご要望・お問い合わせの置き場所（Supabase の SQL エディタに貼って、そのまま実行する）
-- 使う前に、下の 1 行の <ADMIN_EMAIL> を管理者のメールアドレスに書き換えること。
-- ここに書くメールはサーバー側だけに残り、アプリの配信物には入らない。
--
-- 考え方: 利用者はログインしない。送ると合言葉（token）が返り、端末に残る。
-- その合言葉を持っている人だけが、その投稿と返信を読み返せる。
-- 表そのものは利用者から見えない。触れる口は下の関数 3 本だけ。

-- ▼ 管理者のメールアドレス（ここだけ書き換える）
create or replace function public.is_feedback_admin() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') = '<ADMIN_EMAIL>';
$$;

create table if not exists public.feedback (
  id                 bigint generated always as identity primary key,
  created_at         timestamptz not null default now(),
  token              uuid not null default gen_random_uuid(),   -- 投稿者の控え（端末に残る）
  message            text not null check (char_length(message) between 1 and 4000),
  submitter_nickname text check (char_length(submitter_nickname) <= 20),
  submitter_email    text check (submitter_email is null or char_length(submitter_email) <= 120),
  attachment_name    text,
  attachment_type    text,
  attachment_data    text,          -- data URI（入れる前と出す前の両方で形式を確かめる）
  reply              text,
  replied_at         timestamptz,
  reply_mailed_at    timestamptz,   -- 返信メールを送れた時刻
  admin_read_at      timestamptz,
  user_read_at       timestamptz
);
create unique index if not exists feedback_token on public.feedback (token);
create index if not exists feedback_new on public.feedback (created_at desc);

alter table public.feedback enable row level security;

-- 表へ直接触れるのは管理者だけ。利用者（anon）には表の権限を渡さない
revoke all on public.feedback from anon, authenticated;
grant select, update, delete on public.feedback to authenticated;

drop policy if exists feedback_select on public.feedback;
create policy feedback_select on public.feedback for select using (public.is_feedback_admin());

drop policy if exists feedback_update on public.feedback;
create policy feedback_update on public.feedback for update
  using (public.is_feedback_admin()) with check (public.is_feedback_admin());

drop policy if exists feedback_delete on public.feedback;
create policy feedback_delete on public.feedback for delete using (public.is_feedback_admin());

-- ▼ 利用者が触れる口 1: 送る。合言葉を返す
create or replace function public.submit_feedback(
  p_message text, p_nickname text default null, p_email text default null,
  p_att_name text default null, p_att_type text default null, p_att_data text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_token uuid; v_recent int;
begin
  if p_message is null or char_length(btrim(p_message)) = 0 then raise exception '本文がありません'; end if;
  if char_length(p_message) > 4000 then raise exception '本文が長すぎます'; end if;
  if p_nickname is not null and char_length(p_nickname) > 20 then raise exception 'お名前が長すぎます'; end if;
  if p_email is not null and p_email <> '' and p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    then raise exception 'メールアドレスの形が違います'; end if;
  -- 添付は入れる前にも確かめる（出すときにもう一度確かめる）
  if p_att_data is not null and p_att_data <> '' then
    if char_length(p_att_data) > 3000000 then raise exception '添付が大きすぎます'; end if;
    if p_att_data !~ '^data:(image/(png|jpe?g|gif|webp)|application/pdf);base64,[A-Za-z0-9+/=]+$'
      then raise exception '添付の形式が違います'; end if;
  end if;
  -- あふれ止め（10 分に 50 件まで）
  select count(*) into v_recent from public.feedback where created_at > now() - interval '10 minutes';
  if v_recent >= 50 then raise exception 'いまは受け付けられません。しばらくしてからお試しください'; end if;

  insert into public.feedback (message, submitter_nickname, submitter_email, attachment_name, attachment_type, attachment_data)
  values (btrim(p_message), nullif(btrim(coalesce(p_nickname, '')), ''), nullif(btrim(lower(coalesce(p_email, ''))), ''),
          nullif(p_att_name, ''), nullif(p_att_type, ''), nullif(p_att_data, ''))
  returning token into v_token;
  return v_token;
end;
$$;

-- ▼ 利用者が触れる口 2: 自分の投稿と返信を読む（合言葉に一致する行だけ）
create or replace function public.get_feedback_by_tokens(p_tokens uuid[])
returns table (
  id bigint, created_at timestamptz, message text, submitter_nickname text, submitter_email text,
  attachment_name text, attachment_data text, reply text, replied_at timestamptz,
  reply_mailed_at timestamptz, admin_read_at timestamptz, user_read_at timestamptz
)
language sql security definer set search_path = public as $$
  select f.id, f.created_at, f.message, f.submitter_nickname, f.submitter_email,
         f.attachment_name, f.attachment_data, f.reply, f.replied_at,
         f.reply_mailed_at, f.admin_read_at, f.user_read_at
    from public.feedback f
   where f.token = any (p_tokens[1:50])
   order by f.created_at desc;
$$;

-- ▼ 利用者が触れる口 3: 「読んだ」を記録する唯一の経路（他の列は動かせない）
create or replace function public.mark_feedback_read(p_tokens uuid[]) returns void
language sql security definer set search_path = public as $$
  update public.feedback set user_read_at = now() where token = any (p_tokens[1:50]);
$$;

revoke all on function public.submit_feedback(text, text, text, text, text, text) from public;
revoke all on function public.get_feedback_by_tokens(uuid[]) from public;
revoke all on function public.mark_feedback_read(uuid[]) from public;
grant execute on function public.submit_feedback(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.get_feedback_by_tokens(uuid[]) to anon, authenticated;
grant execute on function public.mark_feedback_read(uuid[]) to anon, authenticated;
