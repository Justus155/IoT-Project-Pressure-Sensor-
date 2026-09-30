-- ============================================================
-- AquaGuard — Admin device assignment (run once in Supabase SQL Editor)
-- v2: assigning LINKS a code to an account (assigned_to) but does NOT
-- claim it. The account must still enter the code on its dashboard to
-- pair — so only whoever receives the code can activate the device.
-- Safe to re-run (idempotent column add + function replace).
-- ============================================================

-- ---------- 1. New column: which account a code is reserved for ----------
alter table public.devices
  add column if not exists assigned_to uuid;

-- ---------- 2. Admin assignment function ----------
create or replace function public.admin_assign_device(
  p_email text,
  p_pairing_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  caller_role text;
  target_user_id uuid;
  target_device public.devices%rowtype;
begin
  select role
    into caller_role
    from public.profiles
   where id = auth.uid();

  if caller_role is distinct from 'Admin' then
    raise exception 'Only administrators can assign devices';
  end if;

  select id
    into target_user_id
    from auth.users
   where lower(email) = lower(trim(p_email));

  if target_user_id is null then
    raise exception 'No account exists with that email address';
  end if;

  select *
    into target_device
    from public.devices
   where pairing_code = trim(p_pairing_code)
   for update;

  if not found then
    raise exception 'No device exists with that pairing code';
  end if;

  if target_device.owner_id is not null then
    raise exception 'That device is already paired and active';
  end if;

  if target_device.assigned_to is not null and target_device.assigned_to <> target_user_id then
    raise exception 'That code is already assigned to another account';
  end if;

  -- Link, don't claim: owner_id stays NULL until the account enters
  -- the code on the Pair New Device screen.
  update public.devices
     set assigned_to = target_user_id
   where id = target_device.id;

  return jsonb_build_object(
    'device_id', target_device.id,
    'account_id', target_user_id,
    'pipe_number', target_device.pipe_number,
    'sensor_id', target_device.sensor_id,
    'pairing_code', target_device.pairing_code
  );
end;
$$;

revoke all on function public.admin_assign_device(text, text) from public;
grant execute on function public.admin_assign_device(text, text) to authenticated;

-- ---------- 3. Claim policy: who may pair an unclaimed device ----------
-- A device can be claimed (owner_id set) only when:
--   • it is still unclaimed, AND
--   • it is not reserved for someone else (assigned_to is null, or is
--     the account doing the claim).
-- This keeps the ESP32 self-registration flow working (devices with no
-- assignment can be claimed by whoever holds the code) while making
-- admin-assigned codes exclusive to the account they were sent to.
--
-- NOTE: if your device_pairing_migration.sql created a claim policy
-- with a different name than the two dropped here, delete that older
-- policy in the Supabase dashboard (Authentication → Policies →
-- devices), otherwise the old "anyone can claim" rule stays active
-- alongside this one.

drop policy if exists "Users can claim unclaimed devices" on public.devices;
drop policy if exists "Authenticated can claim unclaimed devices" on public.devices;

drop policy if exists "Accounts can claim their assigned devices" on public.devices;
create policy "Accounts can claim their assigned devices"
  on public.devices
  for update
  to authenticated
  using (
    owner_id is null
    and (assigned_to is null or assigned_to = auth.uid())
  )
  with check (owner_id = auth.uid());
