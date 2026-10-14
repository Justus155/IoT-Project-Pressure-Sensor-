// ============================================================
// AquaGuard — Home Owner Dashboard
// Simple tank-level view: big gauge, KPIs, trend chart, activity.
// No IDE panel, no function table — just the essentials.
// ============================================================

import { redeemPairingCode, wireCodeInputs } from "./pair.js";

let client = null;
try {
  client = window.createAquaGuardClient();
} catch (err) {
  console.error("Supabase failed to initialize — check keys in config.js", err);
}

const appRoot = document.getElementById("app-root");
const deviceSelect = document.getElementById("device-select");
const onlineBadge = document.getElementById("online-badge");
const navAlertCount = document.getElementById("nav-alert-count");

const HISTORY_POINTS = 288;

const state = {
  userId: null,
  devices: [],
  current: null,
  renderSeq: 0,
  channel: null,
  charts: [],
};

if (window.Chart) {
  Chart.defaults.color = "#93a3b5";
  Chart.defaults.borderColor = "#1e3550";
  Chart.defaults.font.family = "Inter, -apple-system, 'Segoe UI', Roboto, sans-serif";
}

// ============================================================
// ENTRY
// ============================================================
(async function init() {
  if (!client) {
    appRoot.innerHTML = `<p class="center-msg">Supabase isn't configured.</p>`;
    return;
  }

  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) {
    window.location.href = "../logins/index.html";
    return;
  }

  state.userId = user.id;

  const { data: profile } = await client
    .from("profiles")
    .select("name, role")
    .eq("id", state.userId)
    .maybeSingle();

  // Guard: admins go to admin console
  const role = String(profile?.role ?? "").trim().toLowerCase();
  if (role === "admin") {
    window.location.href = "admin.html";
    return;
  }

  // Guard: WSPs belong on the WSP dashboard
  if (role === "wsp") {
    window.location.href = "dashboard-wsp.html";
    return;
  }

  fillSidebarUser(profile, user.email);
  wireNavigation();

  if (!(await loadDevices())) {
    appRoot.innerHTML = `<p class="center-msg">Couldn't load your devices. Please refresh.</p>`;
    return;
  }

  refreshAlertCount();

  if (state.devices.length === 0) {
    renderPairingScreen();
    setText("view-title", "Pair Your Tank");
    setText("view-subtitle", "Enter the 6-digit code your admin emailed you.");
    deviceSelect?.classList.add("hidden");
    onlineBadge?.classList.add("hidden");
    return;
  }

  renderHome(state.current);
})();

// ============================================================
// SIGN OUT
// ============================================================
document.getElementById("signout-btn").addEventListener("click", async () => {
  if (client) await client.auth.signOut();
  window.location.href = "../logins/index.html";
});

// ============================================================
// NAVIGATION
// ============================================================
function wireNavigation() {
  if (deviceSelect) {
    deviceSelect.addEventListener("change", () => {
      state.current = state.devices.find((d) => d.id === deviceSelect.value) ?? state.current;
      renderHome(state.current);
    });
  }

  document.getElementById("history-nav")?.addEventListener("click", () => {
    document.querySelector(".home-chart-card")?.scrollIntoView({ behavior: "smooth" });
  });

  document.getElementById("alerts-nav")?.addEventListener("click", () => {
    document.getElementById("alert-banner")?.scrollIntoView({ behavior: "smooth" });
  });

  document.getElementById("pair-nav")?.addEventListener("click", () => {
    renderPairingScreen();
  });
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
  state.current = state.devices[0] ?? null;

  if (deviceSelect) {
    deviceSelect.innerHTML = "";
    state.devices.forEach((d) => {
      const option = document.createElement("option");
      option.value = d.id;
      option.textContent = `Pipe #${d.pipe_number}`;
      deviceSelect.appendChild(option);
    });
    if (state.current) deviceSelect.value = state.current.id;
  }
  return true;
}

async function refreshAlertCount() {
  if (!navAlertCount) return;
  const ids = state.devices.map((d) => d.id);
  if (ids.length === 0) {
    navAlertCount.classList.add("hidden");
    return;
  }

  const { count } = await client
    .from("alerts")
    .select("id", { count: "exact", head: true })
    .in("device_id", ids)
    .eq("status", "open");

  navAlertCount.textContent = String(count ?? 0);
  navAlertCount.classList.toggle("hidden", !count);
}

function fillSidebarUser(profile, email) {
  const name = profile?.name || email.split("@")[0];
  const initials = name.split(/\s+/).filter(Boolean).map((p) => p[0]).join("").slice(0, 2);
  setText("user-name", name);
  setText("user-role", "Home Owner");
  setText("user-avatar", initials.toUpperCase() || "?");
  document.getElementById("user-name")?.setAttribute("title", email);
}

// ============================================================
// PAIRING
// ============================================================
function renderPairingScreen() {
  const template = document.getElementById("pairing-template");
  if (!template) return;

  appRoot.innerHTML = "";
  appRoot.appendChild(template.content.cloneNode(true));

  const form = document.getElementById("pairing-form");
  const pairBtn = document.getElementById("pair-btn");
  const banner = document.getElementById("pairing-banner");

  const codeInputs = wireCodeInputs(form);
  codeInputs.focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await claimDeviceByCode(codeInputs.getValue(), banner, pairBtn, codeInputs);
  });
}

async function claimDeviceByCode(code, banner, btn, codeInputs) {
  btn.disabled = true;
  btn.querySelector(".btn-label").classList.add("hidden");
  btn.querySelector(".spinner").classList.remove("hidden");

  const result = await redeemPairingCode(client, code);

  btn.disabled = false;
  btn.querySelector(".btn-label").classList.remove("hidden");
  btn.querySelector(".spinner").classList.add("hidden");

  if (!result.ok) {
    banner.textContent = result.message;
    banner.className = "status-banner error";
    codeInputs.clear();
    return;
  }

  banner.textContent = "Tank paired! Loading…";
  banner.className = "status-banner success";

  await loadDevices();

  const pairedId = result.device?.device_id ?? result.device?.id;
  state.current = state.devices.find((d) => d.id === pairedId) ?? state.devices[0] ?? null;

  if (deviceSelect && state.current) deviceSelect.value = state.current.id;
  refreshAlertCount();

  setTimeout(() => renderHome(state.current), 700);
}

// ============================================================
// HOME DASHBOARD
// ============================================================
async function renderHome(device) {
  if (!device) {
    renderPairingScreen();
    return;
  }
  state.current = device;

  const seq = state.renderSeq;

  const template = document.getElementById("home-template");
  appRoot.innerHTML = "";
  appRoot.appendChild(template.content.cloneNode(true));

  setText("device-title", `Pipe #${device.pipe_number}`);
  setText("device-subtitle", `Sensor ${device.sensor_id}`);

  // Load thresholds + readings + open alerts
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

  if (seq !== state.renderSeq && seq !== 0) return;
  [thresholdsRes, readingsRes, alertsRes].forEach((r) => r.error && console.error(r.error));

  // Derive tank range from thresholds
  const thresholds = thresholdsRes.data || [];
  const leakT = thresholds.find((t) => t.parameter === "LEAK_THRESHOLD");
  const overflowT = thresholds.find((t) => t.parameter === "OVERFLOW_THRESHOLD");
  const range = {
    min: Number(leakT?.min_value ?? 0),
    max: Number(overflowT?.max_value ?? 100),
  };

  const readings = (readingsRes.data || [])
    .map((r) => ({ value: Number(r.value), timestamp: r.timestamp }))
    .reverse();
  const openAlerts = alertsRes.data || [];

  // Render everything
  updateHero(readings[readings.length - 1] ?? null, range);
  updateKPIs(readings);
  drawTrendChart(readings, range);
  renderActivity(readings, openAlerts);

  if (openAlerts.length > 0) showAlertBanner(openAlerts[0], device);

  // Live updates
  state.channel = client
    .channel(`home-${device.id}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "sensor_readings", filter: `device_id=eq.${device.id}` },
      (payload) => {
        const reading = { value: Number(payload.new.value), timestamp: payload.new.timestamp };
        readings.push(reading);
        if (readings.length > HISTORY_POINTS) readings.shift();
        updateHero(reading, range);
        updateKPIs(readings);
        pushTrendPoint(reading, range);
      }
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "alerts", filter: `device_id=eq.${device.id}` },
      (payload) => {
        if (payload.new.status !== "open") return;
        openAlerts.unshift(payload.new);
        showAlertBanner(payload.new, device);
        refreshAlertCount();
      }
    )
    .subscribe();
}

// ------------------------------------------------------------
// HERO — gauge + status
// ------------------------------------------------------------
function updateHero(reading, range) {
  const value = reading?.value ?? null;
  const pct = value === null ? 0 : toPct(value, range);

  drawHeroGauge(pct);
  setText("hero-percent", value === null ? "—" : Math.round(pct * 100));
  setText("hero-psi", value === null ? "—" : value.toFixed(1));

  const barFill = document.getElementById("tank-bar-fill");
  if (barFill) {
    barFill.style.width = `${pct * 100}%`;
    barFill.className = "tank-bar-fill";
    if (pct > 0.8) barFill.classList.add("critical");
    else if (pct > 0.6) barFill.classList.add("warning");
  }

  const statusText = document.getElementById("hero-status-text");
  const statusChip = document.getElementById("status-chip");

  let label, chipClass, message;
  if (value === null) {
    label = "Waiting for data";
    chipClass = "safe";
    message = "Waiting for the first reading from your tank sensor.";
  } else if (pct > 0.85) {
    label = "⚠ Almost full";
    chipClass = "critical";
    message = `Tank is ${Math.round(pct * 100)}% full. Turn off the pump to avoid overflow.`;
  } else if (pct > 0.6) {
    label = "● Getting full";
    chipClass = "warning";
    message = `Tank is ${Math.round(pct * 100)}% full. Consider stopping the pump soon.`;
  } else if (pct < 0.2) {
    label = "⚠ Almost empty";
    chipClass = "critical";
    message = `Tank is only ${Math.round(pct * 100)}% full. Refill soon.`;
  } else {
    label = "● Safe";
    chipClass = "safe";
    message = `Tank is ${Math.round(pct * 100)}% full. Everything is normal.`;
  }

  if (statusText) statusText.textContent = message;
  if (statusChip) {
    statusChip.textContent = label;
    statusChip.className = `status-chip ${chipClass}`;
  }

  setText(
    "last-updated",
    reading ? `Updated ${timeAgo(reading.timestamp)}` : "Waiting for reading"
  );
}

// ------------------------------------------------------------
// HERO GAUGE (canvas — 240° sweep, no library)
// ------------------------------------------------------------
function drawHeroGauge(pct) {
  const canvas = document.getElementById("hero-gauge");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const cx = canvas.width / 2;
  const cy = canvas.height - 30;
  const radius = Math.min(cx, cy) - 20;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const startAngle = Math.PI * 0.75;
  const endAngle = Math.PI * 2.25;
  const sweep = endAngle - startAngle;

  // Background arc zones: low (red) / safe (green) / high (red)
  const zones = [
    { from: 0,    to: 0.2,  color: "#ef4444" }, // low
    { from: 0.2,  to: 0.6,  color: "#22c55e" }, // safe
    { from: 0.6,  to: 0.85, color: "#eab308" }, // warning
    { from: 0.85, to: 1,    color: "#ef4444" }, // high
  ];

  zones.forEach((z) => {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle + z.from * sweep, startAngle + z.to * sweep);
    ctx.strokeStyle = z.color;
    ctx.lineWidth = 22;
    ctx.lineCap = "butt";
    ctx.stroke();
  });

  // Tick labels
  ctx.fillStyle = "#7a8fa6";
  ctx.font = "11px Inter, sans-serif";
  ctx.textAlign = "center";
  [0, 25, 50, 75, 100].forEach((tick, i) => {
    const angle = startAngle + (i / 4) * sweep;
    const x = cx + Math.cos(angle) * (radius - 42);
    const y = cy + Math.sin(angle) * (radius - 42);
    ctx.fillText(`${tick}`, x, y + 4);
  });

  // Needle
  const valueAngle = startAngle + pct * sweep;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(valueAngle) * (radius - 24), cy + Math.sin(valueAngle) * (radius - 24));
  ctx.strokeStyle = "#eef2f6";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.stroke();

  // Centre dot
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fillStyle = "#eef2f6";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#13233a";
  ctx.fill();
}

// ------------------------------------------------------------
// KPI cards
// ------------------------------------------------------------
function updateKPIs(readings) {
  if (readings.length === 0) {
    setText("kpi-current", "—");
    setText("kpi-peak", "—");
    setText("kpi-low", "—");
    setText("kpi-trend", "—");
    return;
  }

  const values = readings.map((r) => r.value);
  const current = values[values.length - 1];
  const peak = Math.max(...values);
  const low = Math.min(...values);

  // Trend: compare last 12 readings vs previous 12
  const half = Math.floor(readings.length / 2);
  const recent = readings.slice(-12);
  const earlier = readings.slice(Math.max(0, readings.length - 24), readings.length - 12);
  const recentAvg = recent.reduce((s, r) => s + r.value, 0) / (recent.length || 1);
  const earlierAvg = earlier.reduce((s, r) => s + r.value, 0) / (earlier.length || 1);
  const delta = recentAvg - earlierAvg;

  setText("kpi-current", current.toFixed(1));
  setText("kpi-peak", peak.toFixed(1));
  setText("kpi-low", low.toFixed(1));

  const trendEl = document.getElementById("kpi-trend");
  const trendSub = document.getElementById("kpi-trend-sub");
  if (trendEl && trendSub) {
    if (Math.abs(delta) < 0.5) {
      trendEl.textContent = "Stable";
      trendSub.textContent = "steady over the last hour";
    } else if (delta > 0) {
      trendEl.textContent = `+${delta.toFixed(1)}`;
      trendSub.textContent = "rising";
    } else {
      trendEl.textContent = `${delta.toFixed(1)}`;
      trendSub.textContent = "falling";
    }
  }
}

// ------------------------------------------------------------
// Trend chart (24h)
// ------------------------------------------------------------
function drawTrendChart(readings, range) {
  setText(
    "trend-range",
    readings.length
      ? `${new Date(readings[0].timestamp).toLocaleString()} → ${new Date(readings[readings.length - 1].timestamp).toLocaleString()}`
      : "No readings yet"
  );

  const el = document.getElementById("home-trend-chart");
  if (!el) return;

  const chart = new Chart(el, {
    type: "line",
    data: {
      labels: readings.map((r) => fmtTime(r.timestamp)),
      datasets: [
        {
          label: "Tank level (PSI)",
          data: readings.map((r) => r.value),
          borderColor: "#22c55e",
          backgroundColor: "rgba(34, 197, 94, 0.12)",
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 6, maxRotation: 0 }, grid: { display: false } },
        y: {
          suggestedMin: range.min,
          suggestedMax: range.max,
          title: { display: true, text: "PSI" },
        },
      },
    },
  });
  state.charts.push(chart);
}

function pushTrendPoint(reading, range) {
  const chart = state.charts.find((c) => c.canvas?.id === "home-trend-chart");
  if (!chart) return;
  chart.data.labels.push(fmtTime(reading.timestamp));
  chart.data.datasets[0].data.push(reading.value);
  if (chart.data.labels.length > HISTORY_POINTS) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }
  chart.update("none");
}

// ------------------------------------------------------------
// Activity feed
// ------------------------------------------------------------
function renderActivity(readings, openAlerts) {
  const list = document.getElementById("activity-list");
  if (!list) return;

  const items = [];

  // Add alerts
  openAlerts.forEach((a) => {
    items.push({
      icon: a.type === "OVERFLOW" ? "⚠️" : "🔔",
      text: a.type === "OVERFLOW" ? "Tank reached full capacity" : "Leak detected",
      time: a.triggered_at,
    });
  });

  // Add level-crossing events from readings
  readings.forEach((r, i) => {
    if (i === 0) return;
    const prev = readings[i - 1];
    const pctNow = r.value / 100;
    const pctPrev = prev.value / 100;
    if (pctNow > 0.8 && pctPrev <= 0.8) {
      items.push({ icon: "📈", text: "Level rose above 80%", time: r.timestamp });
    }
    if (pctNow < 0.2 && pctPrev >= 0.2) {
      items.push({ icon: "📉", text: "Level dropped below 20%", time: r.timestamp });
    }
  });

  // Sort newest first, keep 5
  items.sort((a, b) => new Date(b.time) - new Date(a.time));
  const top = items.slice(0, 5);

  if (top.length === 0) {
    list.innerHTML = `<li class="muted">No activity in the last 24 hours.</li>`;
    return;
  }

  list.innerHTML = top
    .map(
      (item) => `
      <li>
        <span class="activity-icon">${item.icon}</span>
        <span class="activity-text">${item.text}</span>
        <span class="activity-time muted">${timeAgo(item.time)}</span>
      </li>`
    )
    .join("");
}

// ------------------------------------------------------------
// Alert banner
// ------------------------------------------------------------
function showAlertBanner(alert, device) {
  const text = document.getElementById("alert-text");
  if (!text) return;
  text.textContent =
    alert.type === "OVERFLOW"
      ? `⚠ Tank is full — turn off the pump (Pipe #${device.pipe_number})`
      : `⚠ Leak detected on Pipe #${device.pipe_number}`;
  document.getElementById("alert-banner")?.classList.remove("hidden");
}

// ============================================================
// HELPERS
// ============================================================
function toPct(value, range) {
  const span = range.max - range.min || 1;
  return Math.min(Math.max((value - range.min) / span, 0), 1);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function fmtTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function timeAgo(timestamp) {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}