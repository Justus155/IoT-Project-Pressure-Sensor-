-- ============================================================
-- AquaGuard — Pairing code redemption (run once in Supabase SQL Editor)
-- Called by javascript/pair.js. Claims an unclaimed device for the
-- calling account in one atomic step. Safe to re-run.
-- ============================================================

create or replace function public.redeem_pairing_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  target_device public.devices%rowtype;
begin
  if caller_id is null then
    raise exception 'You must be signed in to pair a device';
  end if;

  if trim(coalesce(p_code, '')) !~ '^[0-9]{6}$' then
    raise exception 'Enter a 6-digit code.';
  end if;

  select *
    into target_device
    from public.devices
   where pairing_code::text = trim(p_code)
   for update;

  -- Same message for "no such code" and "reserved for someone else" so
  -- codes can't be probed for existence.
  if not found
     or (target_device.assigned_to is not null and target_device.assigned_to <> caller_id) then
    raise exception 'Invalid code, or this device is already paired to another account.';
  end if;

  if target_device.owner_id is not null then
    if target_device.owner_id = caller_id then
      raise exception 'This device is already paired to your account.';
    end if;
    raise exception 'Invalid code, or this device is already paired to another account.';
  end if;

  update public.devices
     set owner_id = caller_id
   where id = target_device.id
  returning * into target_device;

  return to_jsonb(target_device);
end;
$$;

revoke all on function public.redeem_pairing_code(text) from public;
grant execute on function public.redeem_pairing_code(text) to authenticated;
