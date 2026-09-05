-- 解除コード（Supabase の SQL エディタに貼って、そのまま実行する。feedback.sql を先に入れておくこと）
--
-- 考え方: コードは 1 つにつき 1 回だけ使える。利用者は redeem_key(コード) を呼ぶだけで、表は見えない。
-- 未使用なら使用済みにして true、使用済みやまちがいなら false。
-- 管理者は issue_key() で新しいコードを 1 つ作る（アプリの受信箱の「解除コードを発行」）。
-- コードは 12 バイトの乱数（96 ビット）なので、当てずっぽうでは当たらない。

create table if not exists public.unlock_keys (
  code      text primary key,
  issued_at timestamptz not null default now(),
  used_at   timestamptz,
  note      text
);
alter table public.unlock_keys enable row level security;
revoke all on public.unlock_keys from anon, authenticated;
grant select on public.unlock_keys to authenticated;
drop policy if exists unlock_keys_admin on public.unlock_keys;
create policy unlock_keys_admin on public.unlock_keys for select to authenticated using (public.is_feedback_admin());

-- 利用者: コードを使う（未使用なら使用済みにして true）
create or replace function public.redeem_key(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_code is null or char_length(p_code) < 8 then return false; end if;
  update public.unlock_keys set used_at = now() where code = p_code and used_at is null;
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function public.redeem_key(text) from public;
grant execute on function public.redeem_key(text) to anon, authenticated;

-- 管理者: 新しいコードを 1 つ作る
create or replace function public.issue_key(p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_feedback_admin() then raise exception 'not admin'; end if;
  c := translate(encode(gen_random_bytes(12), 'base64'), '+/=', 'xyz');
  insert into public.unlock_keys (code, note) values (c, p_note);
  return c;
end $$;
revoke all on function public.issue_key(text) from public;
grant execute on function public.issue_key(text) to authenticated;
