// ============================================================
// AquaGuard — Dashboard
// Same Supabase keys as auth.js. In a larger app these would live
// in one shared config file; kept duplicated here for simplicity.
// ============================================================

const SUPABASE_URL = "https://vtsqsqpkatarmfsntjoi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0c3FzcXBrYXRhcm1mc250am9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MjEzMzYsImV4cCI6MjEwNTI5NzMzNn0.cQrDvMbfcA7_OPScc13LAt1OwKEEkSNubLl8_nbDNVQ";

let client = null;
try {
  const { createClient } = supabase;
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
  console.error("Supabase failed to initialize — check keys in dashboard.js", err);
}

const appRoot = document.getElementById("app-root");
const deviceSelect = document.getElementById("device-select");
const onlineBadge = document.getElementById("online-badge");
const navAlertCount = document.getElementById("nav-alert-count");
const navItems = document.querySelectorAll(".nav-item[data-view]");

const HISTORY_POINTS = 288; // 24h of 5-minute readings
const ZONE_COLORS = { normal: "#22c55e", warning: "#eab308", critical: "#ef4444" };
const ZONE_LABELS = { normal: "Normal", warning: "Warning", critical: "Critical" };
const VIEW_TEXT = {
  monitor: ["Primary Monitoring", "Live pressure and 24h analytics for the selected pipe"],
  incidents: ["Incident Room", "Leak and overflow alerts across all your devices"],
  pair: ["Pair New Device", "Enter the 6-digit code your admin emailed you"],
};

const state = {
  userId: null,
  devices: [],
  current: null,
  view: "monitor",
  renderSeq: 0, // bumps on every view change so stale async renders bail out
  channel: null,
  charts: [],
};

if (window.Chart) {
  Chart.defaults.color = "#93a3b5";
  Chart.defaults.borderColor = "#1e3550";
  Chart.defaults.font.family = "Inter, -apple-system, 'Segoe UI', Roboto, sans-serif";
}

// ------------------------------------------------------------
// Resolve the signed-in user's role.
// 1) Read the account's own profiles row. If RLS hides it (missing
//    SELECT policy) or the row is missing, .maybeSingle() returns
//    null WITHOUT an error — that silent failure is what used to
//    let admins onto this homeowner dashboard.
// 2) Fall back to the SECURITY DEFINER is_admin() RPC, which bypasses
//    RLS on profiles.
// The role is compared case-insensitively everywhere, so 'admin',
// 'ADMIN' or ' Admin ' in the table can never break routing again.
// ------------------------------------------------------------
async function fetchUserRole(client, userId) {
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    console.error("Could not read your profile row:", profileError);
  } else if (!profile) {
    console.warn(
      "No profiles row could be read for your account. " +
        "Run sql/fix_admin_routing.sql in the Supabase SQL Editor."
    );
  }

  const role = String(profile?.role ?? "").trim().toLowerCase();
  if (role) return role;

  const { data: isAdmin, error: rpcError } = await client.rpc("is_admin");
  if (rpcError) {
    console.warn("is_admin() fallback unavailable:", rpcError.message);
    return null;
  }
  return isAdmin ? "admin" : null;
}

// ============================================================
// ENTRY POINT
// ============================================================
(async function init() {
  if (!client) {
    appRoot.innerHTML = `<p class="center-msg">Supabase isn't configured. Set your keys in dashboard.js.</p>`;
    return;
  }

  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) {
    window.location.href = "../logins/index.html";
    return;
  }

  state.userId = sessionData.session.user.id;

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("name, role")
    .eq("id", state.userId)
    .maybeSingle();

  if (profileError) {
    appRoot.innerHTML = `<p class="center-msg">Couldn't load your account. Please refresh.</p>`;
    console.error(profileError);
    return;
  }

  const role = await fetchUserRole(client, state.userId);
  if (role === "admin") {
    // Admins have a dedicated console — never the homeowner dashboard.
    window.location.href = "admin.html";
    return;
  }

  fillSidebarUser(profile, sessionData.session.user.email);
  wireNavigation();

  if (!(await loadDevices())) {
    appRoot.innerHTML = `<p class="center-msg">Couldn't load your devices. Please refresh.</p>`;
    return;
  }

  // No device yet → the account still has to enter the code it was emailed.
  refreshAlertCount();
  showView(state.devices.length ? "monitor" : "pair");
})();

// ============================================================
// SIGN OUT
// ============================================================
document.getElementById("signout-btn").addEventListener("click", async () => {
  if (client) await client.auth.signOut();
  window.location.href = "../logins/index.html";
});

// ============================================================
// NAVIGATION + SHARED STATE
// ============================================================
function wireNavigation() {
  navItems.forEach((btn) => btn.addEventListener("click", () => showView(btn.dataset.view)));

  deviceSelect.addEventListener("change", () => {
    state.current = state.devices.find((d) => d.id === deviceSelect.value) ?? state.current;
    showView("monitor");
  });

  appRoot.addEventListener("click", (event) => {
    const target = event.target.closest("[data-goto]");
    if (target) showView(target.dataset.goto);
  });
}

function showView(view) {
  if (view !== "pair" && !state.current) view = "pair";
  state.view = view;
  state.renderSeq += 1;
  teardownLiveView();

  navItems.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
    if (btn.dataset.view !== "pair") btn.disabled = state.devices.length === 0;
  });

  const [title, subtitle] = VIEW_TEXT[view];
  setText("view-title", title);
  setText("view-subtitle", subtitle);
  deviceSelect.classList.toggle("hidden", view !== "monitor" || state.devices.length < 2);
  onlineBadge.classList.toggle("hidden", view !== "monitor");

  if (view === "pair") renderPairingScreen(true);
  else if (view === "incidents") renderIncidents();
  else renderDashboard(state.current);
}

function teardownLiveView() {
  if (state.channel) {
    client.removeChannel(state.channel);
    state.channel = null;
  }
  state.charts.forEach((chart) => chart.destroy());
  state.charts = [];
}

async function loadDevices() {
  const { data, error } = await client
    .from("devices")
    .select("*")
    .eq("owner_id", state.userId)
    .order("install_date", { ascending: false });

  if (error) {
    console.error(error);
    return false;
  }

  state.devices = data || [];
  if (!state.devices.some((d) => d.id === state.current?.id)) {
    state.current = state.devices[0] ?? null;
  }

  deviceSelect.innerHTML = "";
  state.devices.forEach((d) => {
    const option = document.createElement("option");
    option.value = d.id;
    option.textContent = `Pipe #${d.pipe_number} · ${d.sensor_id}`;
    deviceSelect.appendChild(option);
  });
  if (state.current) deviceSelect.value = state.current.id;
  return true;
}

async function refreshAlertCount() {
  const ids = state.devices.map((d) => d.id);
  if (ids.length === 0) {
    navAlertCount.classList.add("hidden");
    return;
  }

  const { count, error } = await client
    .from("alerts")
    .select("id", { count: "exact", head: true })
    .in("device_id", ids)
    .eq("status", "open");

  if (error) {
    console.error(error);
    return;
  }
  navAlertCount.textContent = String(count ?? 0);
  navAlertCount.classList.toggle("hidden", !count);
}

function fillSidebarUser(profile, email) {
  const name = profile?.name || email.split("@")[0];
  const initials = name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2);
  setText("user-name", name);
  const userRole = String(profile?.role ?? "").trim().toLowerCase();
  setText("user-role", userRole === "wsp" ? "Water Service Provider" : "Home Owner");
  setText("user-avatar", initials.toUpperCase() || "?");
}

// ============================================================
// PAIRING SCREEN
// ============================================================
function renderPairingScreen(showManualFallback = false) {
  const template = document.getElementById("pairing-template");
  appRoot.innerHTML = "";
  appRoot.appendChild(template.content.cloneNode(true));

  const digits = document.querySelectorAll(".code-digit");
  digits.forEach((input, i) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/[^0-9]/g, "");
      if (input.value && digits[i + 1]) digits[i + 1].focus();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !input.value && digits[i - 1]) {
        digits[i - 1].focus();
      }
    });
  });
  digits[0].focus();

  const form = document.getElementById("pairing-form");
  const pairBtn = document.getElementById("pair-btn");
  const banner = document.getElementById("pairing-banner");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = Array.from(digits).map((d) => d.value).join("");

    if (code.length !== 6) {
      showPairingBanner(banner, "Enter the full 6-digit code.", "error");
      return;
    }

    await claimDeviceByCode(code, banner, pairBtn);
  });

  // ---------- Manual fallback (admin assigned the code already) ----------
  const manualToggle = document.getElementById("manual-pair-toggle");
  const manualForm = document.getElementById("manual-pair-form");

  if (showManualFallback && manualToggle && manualForm) {
    manualToggle.parentElement.classList.remove("hidden");

    manualToggle.addEventListener("click", (e) => {
      e.preventDefault();
      manualForm.classList.toggle("hidden");
    });

    manualForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = document.getElementById("manual-pair-code").value.trim();

      if (!/^[0-9]{6}$/.test(code)) {
        showPairingBanner(banner, "Enter the full 6-digit code.", "error");
        return;
      }

      await claimDeviceByCode(code, banner, document.getElementById("manual-pair-btn"));
    });
  }
}

// Shared claim logic for both the digit-box form and the manual
// fallback form. Only succeeds if a device row with this exact code
// exists AND is still unclaimed (owner_id is null) — the RLS policy
// enforces the "unclaimed" half; .eq("pairing_code") enforces the
// code match itself.
async function claimDeviceByCode(code, banner, btn) {
  setPairBtnLoading(btn, true);

  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData.session.user.id;

  const { data, error } = await client
    .from("devices")
    .update({ owner_id: userId })
    .eq("pairing_code", code)
    .is("owner_id", null)
    .select();

  setPairBtnLoading(btn, false);

  if (error) {
    showPairingBanner(banner, "Something went wrong. Please try again.", "error");
    console.error(error);
    return;
  }

  if (!data || data.length === 0) {
    showPairingBanner(banner, "Invalid code, or this device is already paired to another account.", "error");
    return;
  }

  showPairingBanner(banner, "Device paired! Loading your dashboard…", "success");
  await loadDevices();
  state.current = state.devices.find((d) => d.id === data[0].id) ?? data[0];
  deviceSelect.value = state.current.id;
  refreshAlertCount();
  setTimeout(() => showView("monitor"), 700);
}

function showPairingBanner(banner, message, type) {
  banner.textContent = message;
  banner.className = `status-banner ${type}`;
}

function setPairBtnLoading(btn, isLoading) {
  btn.disabled = isLoading;
  btn.querySelector(".btn-label").classList.toggle("hidden", isLoading);
  btn.querySelector(".spinner").classList.toggle("hidden", !isLoading);
}

// ============================================================
// MONITORING DASHBOARD
// ============================================================
async function renderDashboard(device) {
  const seq = state.renderSeq;
  mount("dashboard-template");

  setText("device-title", `Pipe #${device.pipe_number}`);
  setText("device-subtitle", `Sensor ${device.sensor_id} · ${device.type ?? "pressure"} sensor`);

  const isOnline = device.status === "active";
  onlineBadge.textContent = isOnline ? "Online" : "Offline";
  onlineBadge.className = `badge ${isOnline ? "online" : "offline"}`;

  // Latest 288 readings rather than "since 24h ago", so seeded demo
  // data still draws a full day even if it was inserted days earlier.
  const [thresholdsRes, readingsRes, alertsRes] = await Promise.all([
    client.from("thresholds").select("*").eq("device_id", device.id),
    client
      .from("sensor_readings")
      .select("value, timestamp")
      .eq("device_id", device.id)
      .order("timestamp", { ascending: false })
      .limit(HISTORY_POINTS),
    client
      .from("alerts")
      .select("*")
      .eq("device_id", device.id)
      .eq("status", "open")
      .order("triggered_at", { ascending: false }),
  ]);

  if (seq !== state.renderSeq) return;
  [thresholdsRes, readingsRes, alertsRes].forEach((res) => res.error && console.error(res.error));

  const thresholds = thresholdsRes.data || [];
  const leakT = thresholds.find((t) => t.parameter === "LEAK_THRESHOLD");
  const overflowT = thresholds.find((t) => t.parameter === "OVERFLOW_THRESHOLD");
  const range = { min: Number(leakT?.min_value ?? 0), max: Number(overflowT?.max_value ?? 100) };

  const readings = (readingsRes.data || [])
    .map((r) => ({ value: Number(r.value), timestamp: r.timestamp }))
    .reverse();
  const openAlerts = alertsRes.data || [];

  updateLiveReading(readings[readings.length - 1] ?? null, range);
  updateStats(readings, openAlerts.length);
  if (openAlerts.length > 0) showAlertBanner(openAlerts[0], device);

  const trendChart = drawTrendChart(readings, range);
  drawHourlyChart(readings, range);
  drawZoneChart(readings, range);

  // ---------- Live updates ----------
  state.channel = client
    .channel(`device-${device.id}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "sensor_readings", filter: `device_id=eq.${device.id}` },
      (payload) => {
        const reading = { value: Number(payload.new.value), timestamp: payload.new.timestamp };
        readings.push(reading);
        if (readings.length > HISTORY_POINTS) readings.shift();
        updateLiveReading(reading, range);
        updateStats(readings, openAlerts.length);
        pushTrendPoint(trendChart, reading);
      }
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "alerts", filter: `device_id=eq.${device.id}` },
      (payload) => {
        if (payload.new.status !== "open") return;
        openAlerts.unshift(payload.new);
        updateStats(readings, openAlerts.length);
        showAlertBanner(payload.new, device);
        refreshAlertCount();
      }
    )
    .subscribe();
}

function updateLiveReading(reading, range) {
  const value = reading?.value ?? null;
  setText("gauge-value", value === null ? "—" : value.toFixed(1));
  drawGauge(value, range);
  updateLEDs(value, range);

  const zone = value === null ? null : zoneOf(value, range);
  const chip = document.getElementById("zone-chip");
  if (chip) {
    chip.textContent = zone ? ZONE_LABELS[zone] : "No data";
    chip.className = `zone-chip ${zone ?? ""}`;
  }
  setText(
    "last-updated",
    reading ? `Last reading ${new Date(reading.timestamp).toLocaleString()}` : "Waiting for the first reading from this device"
  );
}

function updateStats(readings, openAlertCount) {
  const values = readings.map((r) => r.value);
  const fmt = (v) => `${v.toFixed(1)} PSI`;
  const hasData = values.length > 0;

  setText("kpi-peak", hasData ? fmt(Math.max(...values)) : "No data");
  setText("kpi-baseline", hasData ? fmt(Math.min(...values)) : "No data");
  setText("kpi-average", hasData ? fmt(values.reduce((a, b) => a + b, 0) / values.length) : "No data");
  setText("kpi-alerts", String(openAlertCount));
  document.getElementById("kpi-alerts")?.classList.toggle("stat-red", openAlertCount > 0);
}

function showAlertBanner(alert, device) {
  setText(
    "alert-text",
    `⚠ ${alert.type} detected on Pipe #${device.pipe_number}, Sensor ${device.sensor_id} — ${new Date(alert.triggered_at).toLocaleString()}`
  );
  document.getElementById("alert-banner")?.classList.remove("hidden");
}

// Same 60% / 85% bands as the gauge, LEDs and ESP32 firmware.
function toPct(value, range) {
  const span = range.max - range.min || 1;
  return Math.min(Math.max((value - range.min) / span, 0), 1);
}

function zoneOf(value, range) {
  const pct = toPct(value, range);
  return pct > 0.85 ? "critical" : pct > 0.6 ? "warning" : "normal";
}

function zoneLimit(range, pct) {
  return range.min + (range.max - range.min) * pct;
}

// ============================================================
// INCIDENT ROOM
// ============================================================
const ALERT_HINTS = {
  LEAK: "Pressure fell into the leak range — inspect the pipe and fittings.",
  OVERFLOW: "Pressure exceeded the overflow limit — check tank levels and valves.",
};

async function renderIncidents() {
  const seq = state.renderSeq;
  mount("incidents-template");
  const list = document.getElementById("incident-list");
  list.innerHTML = `<p class="muted">Loading alerts…</p>`;

  const { data, error } = await client
    .from("alerts")
    .select("*")
    .in("device_id", state.devices.map((d) => d.id))
    .order("triggered_at", { ascending: false })
    .limit(200);

  if (seq !== state.renderSeq) return;
  if (error) {
    console.error(error);
    list.innerHTML = `<p class="muted">Couldn't load alerts. Please refresh.</p>`;
    return;
  }

  const alerts = data || [];
  const devicesById = new Map(state.devices.map((d) => [d.id, d]));
  const openCount = alerts.filter((a) => a.status === "open").length;
  setText("incident-summary", `${openCount} open · ${alerts.length} total`);
  drawAlertsChart(alerts);

  const renderList = (filter) => {
    const shown = alerts.filter(
      (a) => filter === "all" || (filter === "open" ? a.status === "open" : a.status !== "open")
    );
    list.innerHTML = shown.length
      ? shown.map((a) => incidentCard(a, devicesById.get(a.device_id))).join("")
      : `<p class="panel muted">No ${filter === "all" ? "" : `${filter} `}alerts — all clear.</p>`;
  };

  const tabs = appRoot.querySelectorAll("[data-filter]");
  tabs.forEach((tab) =>
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      renderList(tab.dataset.filter);
    })
  );
  renderList("all");
}

function incidentCard(alert, device) {
  const isOpen = alert.status === "open";
  const typeClass = alert.type === "OVERFLOW" ? "overflow" : "leak";
  return `
    <article class="panel incident-card ${isOpen ? "" : "cleared"}">
      <div>
        <span class="incident-type ${typeClass}">${esc(alert.type)}</span>
        <h3>Pipe #${esc(device?.pipe_number ?? "?")} · Sensor ${esc(device?.sensor_id ?? "?")}</h3>
        <p class="muted">${esc(ALERT_HINTS[alert.type] ?? "The sensor reported an abnormal reading.")}</p>
      </div>
      <div class="incident-meta">
        <p>${esc(new Date(alert.triggered_at).toLocaleString())}</p>
        <p class="incident-status ${isOpen ? "open" : "cleared"}">${isOpen ? "● Open" : `✓ ${esc(alert.status)}`}</p>
      </div>
    </article>`;
}

// ============================================================
// GAUGE (canvas semicircle, no external gauge library needed)
// ============================================================
function drawGauge(value, range) {
  const canvas = document.getElementById("gauge-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const cx = canvas.width / 2;
  const cy = canvas.height - 18;
  const radius = Math.min(cx, cy) - 12;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background arc zones: green / yellow / red
  const zones = [
    { from: 0, to: 0.6, color: ZONE_COLORS.normal },
    { from: 0.6, to: 0.85, color: ZONE_COLORS.warning },
    { from: 0.85, to: 1, color: ZONE_COLORS.critical },
  ];
  zones.forEach((z) => {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.PI + z.from * Math.PI, Math.PI + z.to * Math.PI);
    ctx.strokeStyle = z.color;
    ctx.lineWidth = 14;
    ctx.stroke();
  });

  ctx.fillStyle = "#93a3b5";
  ctx.font = "12px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(String(range.min), cx - radius, cy + 16);
  ctx.fillText(String(range.max), cx + radius, cy + 16);

  if (value === null || value === undefined) return;

  // Needle
  const angle = Math.PI + toPct(value, range) * Math.PI;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(angle) * (radius - 20), cy + Math.sin(angle) * (radius - 20));
  ctx.strokeStyle = "#eef2f6";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#eef2f6";
  ctx.fill();
}

// ============================================================
// 5-LED STRIP
// Mirrors the same pct-of-range logic the ESP32 uses for its
// physical LEDs, so the web view and the hardware always agree.
// ============================================================
function updateLEDs(value, range) {
  const leds = document.querySelectorAll("#led-strip .led");
  const hasValue = value !== null && value !== undefined;
  const pct = hasValue ? toPct(value, range) : 0;
  const litCount = hasValue ? Math.round(pct * 5) : 0;
  const colour = pct > 0.85 ? "red" : pct > 0.6 ? "amber" : null;

  leds.forEach((led, i) => {
    led.className = "led";
    if (i < litCount) {
      led.classList.add("on");
      if (colour) led.classList.add(colour);
    }
  });
}

// ============================================================
// CHARTS (Chart.js)
// ============================================================
function addChart(canvasId, config) {
  const chart = new Chart(document.getElementById(canvasId), config);
  state.charts.push(chart);
  return chart;
}

function limitLine(label, value, color, length) {
  return {
    label,
    limitValue: value,
    data: Array(length).fill(value),
    borderColor: color,
    borderDash: [6, 4],
    borderWidth: 1,
    pointRadius: 0,
    fill: false,
  };
}

function drawTrendChart(readings, range) {
  const n = readings.length;
  setText(
    "trend-range",
    n ? `${new Date(readings[0].timestamp).toLocaleString()} → ${new Date(readings[n - 1].timestamp).toLocaleString()}` : "No readings yet"
  );

  return addChart("trend-chart", {
    type: "line",
    data: {
      labels: readings.map((r) => fmtTime(r.timestamp)),
      datasets: [
        {
          label: "Pressure (PSI)",
          data: readings.map((r) => r.value),
          borderColor: ZONE_COLORS.normal,
          backgroundColor: "rgba(34, 197, 94, 0.10)",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        },
        limitLine("Warning", zoneLimit(range, 0.6), ZONE_COLORS.warning, n),
        limitLine("Critical", zoneLimit(range, 0.85), ZONE_COLORS.critical, n),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { boxWidth: 12, boxHeight: 2 } } },
      scales: {
        x: { ticks: { maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } },
        y: { suggestedMin: range.min, suggestedMax: range.max, title: { display: true, text: "PSI" } },
      },
    },
  });
}

function pushTrendPoint(chart, reading) {
  chart.data.labels.push(fmtTime(reading.timestamp));
  chart.data.datasets.forEach((ds) => ds.data.push(ds.limitValue ?? reading.value));
  if (chart.data.labels.length > HISTORY_POINTS) {
    chart.data.labels.shift();
    chart.data.datasets.forEach((ds) => ds.data.shift());
  }
  chart.update("none");
}

function drawHourlyChart(readings, range) {
  const buckets = new Map();
  readings.forEach((r) => {
    const hour = new Date(r.timestamp);
    hour.setMinutes(0, 0, 0);
    const bucket = buckets.get(hour.getTime()) ?? { sum: 0, count: 0 };
    bucket.sum += r.value;
    bucket.count += 1;
    buckets.set(hour.getTime(), bucket);
  });

  const hours = [...buckets.keys()].sort((a, b) => a - b);
  const averages = hours.map((h) => Number((buckets.get(h).sum / buckets.get(h).count).toFixed(1)));

  addChart("hourly-chart", {
    type: "bar",
    data: {
      labels: hours.map((h) => fmtTime(h)),
      datasets: [{
        label: "Avg PSI",
        data: averages,
        backgroundColor: averages.map((v) => ZONE_COLORS[zoneOf(v, range)]),
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, maxTicksLimit: 12 } },
        y: { suggestedMin: range.min, suggestedMax: range.max },
      },
    },
  });
}

function drawZoneChart(readings, range) {
  const counts = { normal: 0, warning: 0, critical: 0 };
  readings.forEach((r) => counts[zoneOf(r.value, range)]++);
  const total = readings.length || 1;
  const zones = Object.keys(counts);

  addChart("zone-chart", {
    type: "doughnut",
    data: {
      labels: zones.map((z) => ZONE_LABELS[z]),
      datasets: [{
        data: zones.map((z) => counts[z]),
        backgroundColor: zones.map((z) => ZONE_COLORS[z]),
        borderColor: "#13233a",
        borderWidth: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: { label: (ctx) => ` ${ctx.label}: ${((ctx.raw / total) * 100).toFixed(1)}% of readings` },
        },
      },
    },
  });
}

function drawAlertsChart(alerts) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);
    days.push(day);
  }
  const countFor = (type) =>
    days.map((day) =>
      alerts.filter((a) => a.type === type && new Date(a.triggered_at).toDateString() === day.toDateString()).length
    );

  addChart("alerts-chart", {
    type: "bar",
    data: {
      labels: days.map((d) => d.toLocaleDateString([], { weekday: "short", day: "numeric" })),
      datasets: [
        { label: "Leak", data: countFor("LEAK"), backgroundColor: ZONE_COLORS.critical, borderRadius: 4 },
        { label: "Overflow", data: countFor("OVERFLOW"), backgroundColor: ZONE_COLORS.warning, borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

// ============================================================
// HELPERS
// ============================================================
function mount(templateId) {
  appRoot.innerHTML = "";
  appRoot.appendChild(document.getElementById(templateId).content.cloneNode(true));
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function fmtTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}