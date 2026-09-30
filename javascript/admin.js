// ============================================================
// AquaGuard — Admin Console
// Guards itself: only signed-in Admins get past init(). Everyone
// else is bounced to the sign-in page.
// ============================================================

const SUPABASE_URL = "https://vtsqsqpkatarmfsntjoi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0c3FxcXBrYXRhcm1mc250am9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MjEzMzYsImV4cCI6MjEwNTI5NzMzNn0.cQrDvMbfcA7_OPScc13LAt1OwKEEkSNubLl8_nbDNVQ";

let client = null;
try {
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
  console.error("Supabase failed to initialize — check keys in admin.js", err);
}

const appRoot = document.getElementById("app-root");
const state = { accounts: [], devices: [] };

// ============================================================
// ENTRY POINT — admin-only guard
// ============================================================
(async function init() {
  if (!client) {
    appRoot.innerHTML = `<p class="center-msg">Supabase isn't configured. Set your keys in admin.js.</p>`;
    return;
  }

  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) {
    window.location.href = "../logins/index.html";
    return;
  }

  const userId = sessionData.session.user.id;
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    appRoot.innerHTML = `<p class="center-msg">Couldn't load your account. Please refresh.</p>`;
    console.error(profileError);
    return;
  }

  if (profile?.role !== "Admin") {
    // Signed in, but not an admin — they belong on the normal dashboard.
    window.location.href = "dashboard.html";
    return;
  }

  renderAdminConsole();
  await refreshData();
})();

// ============================================================
// RENDER + WIRING
// ============================================================
function renderAdminConsole() {
  const template = document.getElementById("admin-console-template");
  appRoot.innerHTML = "";
  appRoot.appendChild(template.content.cloneNode(true));

  const form = document.getElementById("admin-form");
  const emailInput = document.getElementById("admin-account-email");
  const codeInput = document.getElementById("admin-pairing-code");
  const assignBtn = document.getElementById("admin-assign-btn");
  const banner = document.getElementById("admin-banner");
  const refreshBtn = document.getElementById("admin-refresh");

  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.replace(/[^0-9]/g, "").slice(0, 6);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailInput.value.trim();
    const code = codeInput.value.trim();

    if (!/^[0-9]{6}$/.test(code)) {
      showAdminBanner(banner, "Enter a valid 6-digit device code.", "error");
      return;
    }

    setAssignBtnLoading(assignBtn, true);
    const { data, error } = await client.rpc("admin_assign_device", {
      p_email: email,
      p_pairing_code: code,
    });
    setAssignBtnLoading(assignBtn, false);

    if (error) {
      console.error("Device assignment failed:", error);
      showAdminBanner(banner, error.message, "error");
      return;
    }

    showAdminBanner(
      banner,
      `Device ${data.sensor_id} assigned to ${email}. They can now enter the code on their dashboard to pair it.`,
      "success"
    );
    form.reset();
    await refreshData();
  });

  refreshBtn.addEventListener("click", refreshData);

  document.getElementById("signout-btn").addEventListener("click", async () => {
    if (client) await client.auth.signOut();
    window.location.href = "../logins/index.html";
  });
}

// ============================================================
// DATA LOAD + TABLES
// ============================================================
async function refreshData() {
  const [accountsRes, devicesRes] = await Promise.all([
    client.rpc("admin_list_accounts"),
    client.rpc("admin_list_devices"),
  ]);

  const banner = document.getElementById("admin-banner");

  if (accountsRes.error) {
    console.error(accountsRes.error);
    showAdminBanner(banner, "Couldn't load accounts — did you run sql/admin_panel_functions.sql in Supabase?", "error");
    return;
  }
  if (devicesRes.error) {
    console.error(devicesRes.error);
    showAdminBanner(banner, "Couldn't load devices.", "error");
    return;
  }

  state.accounts = accountsRes.data || [];
  state.devices = devicesRes.data || [];
  renderCodesTable();
  renderAccountsTable();
  fillDatalists();
}

function renderCodesTable() {
  const tbody = document.getElementById("codes-tbody");

  if (state.devices.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">No devices yet — run sql/synthetic_data.sql to seed demo devices, or let an ESP32 register itself.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.devices
    .map((d) => {
      const claimed = !!d.claimed;
      const statusBadge = claimed
        ? `<span class="badge online">Claimed</span>`
        : `<span class="badge">Unclaimed</span>`;
      const mailBtn = claimed
        ? `<span class="muted">—</span>`
        : `<button type="button" class="btn-ghost btn-small" data-mailto="${esc(d.pairing_code)}" title="Send this code by email">✉ Send</button>`;
      return `
        <tr>
          <td><span class="code-chip">${esc(d.pairing_code)}</span></td>
          <td>${esc(d.pipe_number)}</td>
          <td>${esc(d.sensor_id)}</td>
          <td>${statusBadge}</td>
          <td>${claimed ? esc(d.owner_email) : '<span class="muted">—</span>'}</td>
          <td class="td-actions">${mailBtn}</td>
        </tr>`;
    })
    .join("");

  tbody.querySelectorAll("[data-mailto]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.dataset.mailto;
      const device = state.devices.find((x) => x.pairing_code === code) || {};
      const subject = encodeURIComponent("Your AquaGuard device code");
      const body = encodeURIComponent(
        `Hi,\n\nYour AquaGuard device code is ${code} (pipe ${device.pipe_number ?? "?"}, sensor ${device.sensor_id ?? "?"}).\n\n` +
          `To activate your dashboard:\n` +
          `1. Sign in at ${window.location.origin}/logins/index.html\n` +
          `2. Enter the code on the Pair New Device screen.\n\n` +
          `— AquaGuard Admin`
      );
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
    });
  });
}

function renderAccountsTable() {
  const tbody = document.getElementById("accounts-tbody");
  const count = document.getElementById("accounts-count");
  count.textContent = String(state.accounts.length);

  if (state.accounts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">No accounts have signed up yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.accounts
    .map(
      (a) => `
      <tr>
        <td>${esc(a.email)}</td>
        <td>${esc(a.name ?? "—")}</td>
        <td><span class="role-chip role-${esc(a.role)}">${esc(a.role)}</span></td>
        <td>${a.device_count}</td>
        <td>${a.assigned_codes ? `<span class="code-chip">${esc(a.assigned_codes)}</span>` : '<span class="muted">—</span>'}</td>
      </tr>`
    )
    .join("");
}

function fillDatalists() {
  const emails = document.getElementById("account-emails");
  const codes = document.getElementById("unclaimed-codes");
  emails.innerHTML = state.accounts
    .filter((a) => a.role !== "Admin")
    .map((a) => `<option value="${esc(a.email)}"></option>`)
    .join("");
  codes.innerHTML = state.devices
    .filter((d) => !d.claimed)
    .map((d) => `<option value="${esc(d.pairing_code)}"></option>`)
    .join("");
}

// ============================================================
// HELPERS
// ============================================================
function showAdminBanner(banner, message, type) {
  banner.textContent = message;
  banner.className = `status-banner ${type}`;
}

function setAssignBtnLoading(btn, isLoading) {
  btn.disabled = isLoading;
  btn.querySelector(".btn-label").classList.toggle("hidden", isLoading);
  btn.querySelector(".spinner").classList.toggle("hidden", !isLoading);
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
