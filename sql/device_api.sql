-- ============================================================
-- AquaGuard — Device API (run once in Supabase SQL Editor)
-- RPCs the ESP32 firmware and firmware/simulator.js call with the
-- anon key. Each call authenticates the device by sensor_id + its
-- 6-digit pairing code, so devices never need table-level write
-- access through RLS. Safe to re-run.
-- ============================================================

-- Internal: resolve a device from its credentials (not callable by clients).
create or replace function public._device_auth(p_sensor_id text, p_device_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  found_id uuid;
begin
  select id
    into found_id
    from public.devices
   where sensor_id = trim(p_sensor_id)
     and pairing_code::text = trim(p_device_code)
   limit 1;

  if found_id is null then
    raise exception 'Unknown device or wrong device code';
  end if;
  return found_id;
end;
$$;

revoke all on function public._device_auth(text, text) from public, anon, authenticated;

-- ---------- Thresholds (read once on boot) ----------
create or replace function public.device_get_thresholds(p_sensor_id text, p_device_code text)
returns table (parameter text, min_value numeric, max_value numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  dev_id uuid := public._device_auth(p_sensor_id, p_device_code);
begin
  return query
    select t.parameter::text, t.min_value::numeric, t.max_value::numeric
      from public.thresholds t
     where t.device_id = dev_id;
end;
$$;

-- ---------- Readings ----------
create or replace function public.device_insert_reading(
  p_sensor_id text, p_device_code text, p_value numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  dev_id uuid := public._device_auth(p_sensor_id, p_device_code);
begin
  if p_value is null or p_value < 0 or p_value > 1000 then
    raise exception 'Reading out of range';
  end if;

  insert into public.sensor_readings (device_id, value, timestamp)
  values (dev_id, round(p_value, 1), now());

  update public.devices
     set status = (jsonb_populate_record(null::public.devices, '{"status":"active"}')).status
   where id = dev_id and status::text is distinct from 'active';
end;
$$;

-- ---------- Alerts ----------
create or replace function public.device_raise_alert(
  p_sensor_id text, p_device_code text, p_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  dev_id uuid := public._device_auth(p_sensor_id, p_device_code);
  alert_type text := upper(trim(p_type));
  alert_user uuid;
begin
  if alert_type not in ('LEAK', 'OVERFLOW') then
    raise exception 'Unknown alert type';
  end if;

  select coalesce(owner_id, assigned_to) into alert_user
    from public.devices where id = dev_id;

  if alert_user is null then
    raise exception 'Device is not paired to an account yet';
  end if;

  -- One open alert per type per device; repeats are ignored.
  if exists (
    select 1 from public.alerts
     where device_id = dev_id and type::text = alert_type and status::text = 'open'
  ) then
    return;
  end if;

  -- jsonb_populate_record casts to the column types, which may be enums.
  insert into public.alerts (device_id, user_id, type, status, triggered_at)
  select dev_id, alert_user, r.type, r.status, now()
    from jsonb_populate_record(null::public.alerts,
           jsonb_build_object('type', alert_type, 'status', 'open')) as r;
end;
$$;

create or replace function public.device_clear_alert(
  p_sensor_id text, p_device_code text, p_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  dev_id uuid := public._device_auth(p_sensor_id, p_device_code);
begin
  update public.alerts
     set status = (jsonb_populate_record(null::public.alerts, '{"status":"cleared"}')).status
   where device_id = dev_id
     and type::text = upper(trim(p_type))
     and status::text = 'open';
end;
$$;

revoke all on function public.device_get_thresholds(text, text) from public;
revoke all on function public.device_insert_reading(text, text, numeric) from public;
revoke all on function public.device_raise_alert(text, text, text) from public;
revoke all on function public.device_clear_alert(text, text, text) from public;

grant execute on function public.device_get_thresholds(text, text) to anon, authenticated;
grant execute on function public.device_insert_reading(text, text, numeric) to anon, authenticated;
grant execute on function public.device_raise_alert(text, text, text) to anon, authenticated;
grant execute on function public.device_clear_alert(text, text, text) to anon, authenticated;
