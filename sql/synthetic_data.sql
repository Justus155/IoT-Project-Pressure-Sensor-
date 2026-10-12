-- ============================================================
-- AquaGuard — Synthetic demo data
-- Run once in the Supabase SQL Editor, AFTER admin_panel_functions.sql.
-- Safe to re-run: every block skips work that is already done, so you
-- never end up with duplicate devices, codes or readings.
--
-- It seeds 8 devices with 6-digit codes, per-device thresholds,
-- ~24h of 5-minute sensor readings (288 rows per device) and two
-- live alerts. All devices start UNCLAIMED — you hand the codes out
-- from the Admin console, and the account claims them on its
-- dashboard like normal.
-- ============================================================

-- Values go through jsonb_populate_record(null::<table>, ...) so they are
-- cast to each column's real type (text or enum, e.g. device_status).

-- ---------- 1. Devices (skips codes that already exist) ----------
-- If status is an enum without an 'offline' label, fall back to its first label.
with status_labels as (
  select e.enumlabel, e.enumsortorder
    from pg_attribute a
    join pg_enum e on e.enumtypid = a.atttypid
   where a.attrelid = 'public.devices'::regclass
     and a.attname = 'status'
)
insert into public.devices (pipe_number, sensor_id, pairing_code, type, status)
select r.pipe_number, r.sensor_id, r.pairing_code, r.type, r.status
from (values
  ('B-01', 'S-01', '482913', 'pressure', 'active'),
  ('B-02', 'S-02', '731596', 'pressure', 'active'),
  ('B-03', 'S-03', '905284', 'flow',     'active'),
  ('B-04', 'S-04', '264718', 'pressure', 'offline'),
  ('B-05', 'S-05', '618342', 'flow',     'active'),
  ('B-06', 'S-06', '159273', 'pressure', 'active'),
  ('B-07', 'S-07', '840561', 'pressure', 'active'),
  ('B-08', 'S-08', '397624', 'flow',     'offline')
) as v(pipe_number, sensor_id, pairing_code, type, status)
cross join lateral jsonb_populate_record(null::public.devices, jsonb_build_object(
  'pipe_number',  v.pipe_number,
  'sensor_id',    v.sensor_id,
  'pairing_code', v.pairing_code,
  'type',         v.type,
  'status', case
              when not exists (select 1 from status_labels)
                or v.status in (select enumlabel from status_labels) then v.status
              else (select enumlabel from status_labels order by enumsortorder limit 1)
            end
)) as r
where not exists (
  select 1 from public.devices d where d.pairing_code::text = v.pairing_code
);

-- ---------- 2. Thresholds per device (skip if the device has any) ----------
insert into public.thresholds (device_id, parameter, min_value, max_value)
select d.id, r.parameter, r.min_value, r.max_value
from public.devices d
cross join (values
  ('LEAK_THRESHOLD',     0::numeric, 40::numeric),
  ('OVERFLOW_THRESHOLD', 40::numeric, 100::numeric)
) as v(parameter, min_value, max_value)
cross join lateral jsonb_populate_record(null::public.thresholds, jsonb_build_object(
  'parameter', v.parameter,
  'min_value', v.min_value,
  'max_value', v.max_value
)) as r
where not exists (
  select 1 from public.thresholds t where t.device_id = d.id
);

-- ---------- 3. Synthetic 24h readings (skip devices that already have any) ----------
-- Smooth sine-based pressure curve between 25 and 85 PSI plus a small
-- pseudo-random wobble, sampled every 5 minutes back from now.
insert into public.sensor_readings (device_id, value, timestamp)
select d.id,
       round((55 + 30 * sin(2 * pi() * (g.i % 288) / 288.0)
             + ((g.i * 37 + hashtext(d.sensor_id)) % 9 - 4))::numeric, 1),
       now() - make_interval(mins => (288 - g.i) * 5)
from public.devices d
cross join generate_series(1, 288) as g(i)
where not exists (
  select 1 from public.sensor_readings r where r.device_id = d.id
);

-- ---------- 4. Two demo alerts (skip if that device has any) ----------
-- alerts.user_id is NOT NULL, so this only seeds devices that are paired or
-- reserved for an account. Re-run after assigning 731596 / 905284 to get them.
insert into public.alerts (device_id, user_id, type, status, triggered_at)
select d.id, coalesce(d.owner_id, d.assigned_to), r.type, r.status,
       now() - v.mins * interval '1 minute'
from (values
  ('731596', 'LEAK',     45),
  ('905284', 'OVERFLOW', 110)
) as v(pairing_code, type, mins)
join public.devices d on d.pairing_code::text = v.pairing_code
cross join lateral jsonb_populate_record(null::public.alerts, jsonb_build_object(
  'type',   v.type,
  'status', 'open'
)) as r
where coalesce(d.owner_id, d.assigned_to) is not null
  and not exists (
    select 1 from public.alerts a where a.device_id = d.id
  );

-- ============================================================
-- Done. Open the Admin console: the "Device Codes" table now lists
-- all 8 codes, ready to assign to accounts by email.
-- ============================================================
