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
    window.location.href = "index.html";
    return;
  }

  const userId = sessionData.session.user.id;

  const { data: devices, error } = await client
    .from("devices")
    .select("*")
    .eq("owner_id", userId)
    .order("install_date", { ascending: false });

  if (error) {
    appRoot.innerHTML = `<p class="center-msg">Couldn't load your devices. Please refresh.</p>`;
    console.error(error);
    return;
  }

  if (!devices || devices.length === 0) {
    renderPairingScreen();
  } else {
    renderDashboard(devices[0]); // Home Owner view: first device.
    // (A WSP fleet view would loop over `devices` instead — see note
    // at the bottom of this file.)
  }
})();

// ============================================================
// SIGN OUT
// ============================================================
document.getElementById("signout-btn").addEventListener("click", async () => {
  if (client) await client.auth.signOut();
  window.location.href = "index.html";
});

// ============================================================
// PAIRING SCREEN
// ============================================================
function renderPairingScreen() {
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

    setPairBtnLoading(pairBtn, true);

    const { data: sessionData } = await client.auth.getSession();
    const userId = sessionData.session.user.id;

    // Claim the device: only succeeds if a row with this exact code
    // exists AND is still unclaimed (owner_id is null). The RLS policy
    // enforces the "unclaimed" half; the .eq("pairing_code") enforces
    // the code match itself.
    const { data, error } = await client
      .from("devices")
      .update({ owner_id: userId })
      .eq("pairing_code", code)
      .is("owner_id", null)
      .select();

    setPairBtnLoading(pairBtn, false);

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
    setTimeout(() => renderDashboard(data[0]), 700);
  });
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
// DASHBOARD SCREEN
// ============================================================
async function renderDashboard(device) {
  const template = document.getElementById("dashboard-template");
  appRoot.innerHTML = "";
  appRoot.appendChild(template.content.cloneNode(true));

  document.getElementById("device-title").textContent = `Pipe #${device.pipe_number}`;
  document.getElementById("device-subtitle").textContent = `Sensor ID: ${device.sensor_id}`;

  const badge = document.getElementById("online-badge");
  badge.textContent = device.status === "active" ? "● Online" : "● Offline";
  badge.classList.toggle("offline", device.status !== "active");

  // ---------- Thresholds (needed to scale the gauge & LEDs) ----------
  const { data: thresholds } = await client
    .from("thresholds")
    .select("*")
    .eq("device_id", device.id);

  const leakT = thresholds?.find((t) => t.parameter === "LEAK_THRESHOLD");
  const overflowT = thresholds?.find((t) => t.parameter === "OVERFLOW_THRESHOLD");
  const pMin = leakT?.min_value ?? 0;
  const pMax = overflowT?.max_value ?? 100;

  // ---------- Latest reading ----------
  const { data: latestReadings } = await client
    .from("sensor_readings")
    .select("*")
    .eq("device_id", device.id)
    .order("timestamp", { ascending: false })
    .limit(1);

  const currentValue = latestReadings?.[0]?.value ?? null;
  document.getElementById("gauge-value").textContent = currentValue !== null ? currentValue.toFixed(1) : "—";
  drawGauge(currentValue, pMin, pMax);
  updateLEDs(currentValue, pMin, pMax);

  // ---------- Peak / baseline (last 24h) ----------
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: last24h } = await client
    .from("sensor_readings")
    .select("value, timestamp")
    .eq("device_id", device.id)
    .gte("timestamp", since)
    .order("timestamp", { ascending: true });

  if (last24h && last24h.length > 0) {
    const values = last24h.map((r) => r.value);
    document.getElementById("stat-peak").textContent = `${Math.max(...values).toFixed(1)} PSI`;
    document.getElementById("stat-baseline").textContent = `${Math.min(...values).toFixed(1)} PSI`;
    drawHistoryChart(last24h);
  } else {
    document.getElementById("stat-peak").textContent = "No data yet";
    document.getElementById("stat-baseline").textContent = "No data yet";
  }

  // ---------- Open alerts ----------
  const { data: openAlerts } = await client
    .from("alerts")
    .select("*")
    .eq("device_id", device.id)
    .eq("status", "open")
    .order("triggered_at", { ascending: false })
    .limit(1);

  if (openAlerts && openAlerts.length > 0) {
    const alert = openAlerts[0];
    const banner = document.getElementById("alert-banner");
    banner.textContent = `${alert.type} detected on Pipe #${device.pipe_number}, Sensor ${device.sensor_id} — ${new Date(alert.triggered_at).toLocaleString()}`;
    banner.classList.remove("hidden");
  }

  // ---------- Live updates: re-run this function's data fetch on new readings ----------
  client
    .channel(`device-${device.id}-readings`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "sensor_readings", filter: `device_id=eq.${device.id}` },
      (payload) => {
        const value = payload.new.value;
        document.getElementById("gauge-value").textContent = value.toFixed(1);
        drawGauge(value, pMin, pMax);
        updateLEDs(value, pMin, pMax);
      }
    )
    .subscribe();
}

// ============================================================
// GAUGE (canvas semicircle, no external gauge library needed)
// ============================================================
function drawGauge(value, min, max) {
  const canvas = document.getElementById("gauge-canvas");
  const ctx = canvas.getContext("2d");
  const cx = canvas.width / 2;
  const cy = canvas.height - 10;
  const radius = 90;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background arc zones: green / yellow / red
  const zones = [
    { from: 0, to: 0.6, color: "#22c55e" },
    { from: 0.6, to: 0.85, color: "#eab308" },
    { from: 0.85, to: 1, color: "#ef4444" },
  ];
  zones.forEach((z) => {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.PI + z.from * Math.PI, Math.PI + z.to * Math.PI);
    ctx.strokeStyle = z.color;
    ctx.lineWidth = 14;
    ctx.stroke();
  });

  if (value === null || value === undefined) return;

  // Needle
  const pct = Math.min(Math.max((value - min) / (max - min), 0), 1);
  const angle = Math.PI + pct * Math.PI;
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
function updateLEDs(value, min, max) {
  const leds = document.querySelectorAll("#led-strip .led");
  if (value === null || value === undefined) {
    leds.forEach((l) => (l.className = "led"));
    return;
  }

  const pct = Math.min(Math.max((value - min) / (max - min), 0), 1);
  const litCount = Math.round(pct * 5);

  leds.forEach((led, i) => {
    led.className = "led";
    if (i < litCount) {
      led.classList.add(pct > 0.85 ? "on-red" : pct > 0.6 ? "on-yellow" : "on-green");
    }
  });
}

// ============================================================
// 24H HISTORY CHART (Chart.js)
// ============================================================
let historyChartInstance = null;

function drawHistoryChart(readings) {
  const ctx = document.getElementById("history-chart");
  const labels = readings.map((r) => new Date(r.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  const values = readings.map((r) => r.value);

  if (historyChartInstance) historyChartInstance.destroy();

  historyChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: "#22c55e",
        backgroundColor: "rgba(34, 197, 94, 0.08)",
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#93a3b5", maxTicksLimit: 6 }, grid: { display: false } },
        y: { ticks: { color: "#93a3b5" }, grid: { color: "#24405c" } },
      },
    },
  });
}

// ============================================================
// NOTE — WSP fleet view:
// This file always shows devices[0], which is correct for a
// Home Owner (one device). A WSP account with many devices needs
// a different page: loop over `devices`, render one row per device
// in a table (matching the "Fleet Overview" wireframe), and link
// each row to this same dashboard filtered by that device's id.
// That's a good next step once this single-device flow is confirmed
// working end-to-end.
// ============================================================