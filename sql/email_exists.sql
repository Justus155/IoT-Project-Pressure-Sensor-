-- Run once in the Supabase SQL Editor.
-- Lets the login page check whether an email is registered without exposing auth.users.
create or replace function public.email_exists(p_email text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users where lower(email) = lower(trim(p_email))
  );
$$;

revoke all on function public.email_exists(text) from public;
grant execute on function public.email_exists(text) to anon, authenticated;
