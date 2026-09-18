# AquaGuard — Project Workflow

Water Leakage & Overflow Prevention System — build plan.
Open this in VS Code and check items off (`[ ]` → `[x]`) as you go — the Markdown Preview (`Ctrl+Shift+V`) renders checkboxes as clickable in most themes, or use an extension like **Markdown All in One** to toggle them by clicking.

---

## Phase 0 — Design (Done)

- [x] Use case diagram
- [x] Sequence diagrams (Admin, Home Owner/WSP)
- [x] ERD (Chen notation)
- [x] Database schema
- [x] DFD Level 0 and Level 1
- [x] Wireframes (mobile + web)
- [x] Tinkercad circuit simulation

---

## Phase 1 — Supabase Backend

- [x] Create Supabase project
- [x] Run `schema.sql` (profiles, devices, thresholds, sensor_readings, alerts)
- [x] Run `auto_profile_trigger.sql` (auto-creates profile row on sign-up)
- [x] Run `device_pairing_migration.sql` (pairing_code column + claim policies)
- [ ] Turn "Confirm email" back ON before real users sign up (currently OFF for dev testing)
- [ ] Insert one manual test device row to develop against:
  ```sql
  insert into devices (pipe_number, sensor_id, pairing_code, type)
  values ('B-12', 'S-04', '842019', 'pressure');
  ```
- [ ] Insert a few fake `sensor_readings` rows for that device so the gauge/chart have something to render before real hardware is ready

---

## Phase 2 — Website: Auth & Dashboard

- [x] `index.html` / `style.css` / `auth.js` — sign in, sign up, forgot password
- [x] `dashboard.html` / `dashboard.css` / `dashboard.js` — pairing screen + live dashboard
- [ ] Paste real `SUPABASE_URL` / `SUPABASE_ANON_KEY` into **both** `auth.js` and `dashboard.js`
- [ ] Test full loop end-to-end: sign up → confirm (if enabled) → sign in → pair device with test code → see gauge/chart populate
- [ ] Build **Alerts page** (list view, matches "Incident Room" wireframe) — reads from `alerts` table, lets user mark alerts as read
- [ ] Build **Settings page** (matches "Control Hub" wireframe) — edit profile, view device info, sign out
- [ ] Build **WSP Fleet Overview page** — table of all devices a WSP manages, reusing `dashboard.html` as the per-device drill-down (see note at bottom of `dashboard.js`)
- [ ] Add a `reset-password.html` page (the "Forgot password" email link currently points to a page that doesn't exist yet)
- [ ] Move the duplicated Supabase keys in `auth.js`/`dashboard.js` into one shared `config.js` once there are 3+ pages, to avoid updating keys in multiple places

---

## Phase 3 — ESP32 Firmware

- [ ] Port Tinkercad logic (multi-stage thresholds: observe/suspect/confirm/severe/critical) from Arduino Uno to actual ESP32 board
- [ ] Add `WiFiManager` library — captive portal for WiFi credential entry on first boot
- [ ] Generate a random 6-digit pairing code on first boot; display it (LCD, or Serial Monitor if no LCD yet)
- [ ] On boot, POST an unclaimed device row to Supabase (`pipe_number`, `sensor_id`, `pairing_code`) using the `devices` table's insert policy
- [ ] Implement the 500ms sensor polling loop (`analogRead` → voltage → PSI conversion)
- [ ] Implement 5-LED pressure mapping (same 0–100% logic as `updateLEDs()` in `dashboard.js` — keep both in sync)
- [ ] Implement buzzer + alert generation when LEAK or OVERFLOW is confirmed
- [ ] POST sensor readings to Supabase (`sensor_readings` table) via HTTPS on an interval (not every single reading — decide a reasonable batch/interval, e.g. every 5–10 seconds)
- [ ] POST alert events to Supabase (`alerts` table) with `pipe_number`/`sensor_id` attached
- [ ] Read threshold values from Supabase on boot and cache locally (`D1` from the Level 1 DFD) — don't hit the network every loop iteration
- [ ] Physical reset button clears the local buzzer/LED and updates the alert's `status` to `cleared` in Supabase

---

## Phase 4 — Integration Testing

- [ ] Confirm a reading inserted via the ESP32 shows up live on the dashboard without a page refresh (tests Supabase Realtime)
- [ ] Confirm an alert triggered by the ESP32 shows the correct pipe number and sensor ID on the dashboard
- [ ] Confirm RLS actually blocks Home Owner A from seeing Home Owner B's device (test with two accounts)
- [ ] Confirm the physical reset button correctly clears the alert on the website, not just on the device
- [ ] Time the full loop: leak simulated → LED/buzzer local reaction → alert visible on dashboard (this is your "response time" metric from the report's evaluation criteria)

---

## Phase 5 — Report Alignment

- [ ] Update Chapter 3 methodology to describe Supabase (not ThingSpeak/Blynk) as the actual implementation
- [ ] Confirm delimitations section (1.8) matches what was actually built — especially the push-notification exclusion, since the web dashboard is the only alert channel
- [ ] Screenshot the finished sign-in, dashboard, and pairing screens for the report's implementation chapter
- [ ] Re-verify the ERD/DFDs in the report match the final schema (they should, but check if `pairing_code` needs to be added to the ERD/schema diagrams)

---

## Known gaps / decisions still open

- WSP fleet view is designed but not yet built (Phase 2)
- Production hardening note in `device_pairing_migration.sql`: device self-registration currently uses the public anon key — fine for a class project, not for real deployment
- No email/SMS fallback if the dashboard is unreachable — matches your delimitations, but worth a one-line acknowledgment in the report as a limitation