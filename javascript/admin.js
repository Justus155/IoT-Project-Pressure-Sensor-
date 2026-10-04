// ============================================================
// AquaGuard — Admin Console
// Guards itself: only signed-in Admins get past init(). Everyone
// else is bounced to the sign-in page.
// ============================================================

const SUPABASE_URL = "https://vtsqsqpkatarmfsntjoi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0c3FzcXBrYXRhcm1mc250am9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MjEzMzYsImV4cCI6MjEwNTI5NzMzNn0.cQrDvMbfcA7_OPScc13LAt1OwKEEkSNubLl8_nbDNVQ";

let client = null;
try {
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
  console.error("Supabase failed to initialize — check keys in admin.js", err);
}

const appRoot = document.getElementById("app-root");
const state = {
  accounts: [],
  devices: [],
  pairingCodes: [],
  stats: { userCount: 0, deviceCount: 0, alertCount: 0, pendingCodes: 0 },
  roleFilter: "all"
};

// ------------------------------------------------------------
// Resolve the signed-in user's role.
// 1) Read the account's own profiles row. If RLS hides it (missing
//    SELECT policy) or the row is missing, .maybeSingle() returns
//    null WITHOUT an error — that silent failure is what used to
//    bounce admins off this console.
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

  const role = await fetchUserRole(client, userId);
  if (role !== "admin") {
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
  const sendEmailBox = document.getElementById("admin-send-email");
  const banner = document.getElementById("admin-banner");
  const refreshBtn = document.getElementById("admin-refresh");

  document.getElementById("role-filter").addEventListener("change", (event) => {
    state.roleFilter = event.target.value;
    renderAccountsTable();
  });

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

    if (error) {
      setAssignBtnLoading(assignBtn, false);
      console.error("Device assignment failed:", error);
      showAdminBanner(banner, error.message, "error");
      return;
    }

    if (sendEmailBox.checked) {
      const result = await sendCodeEmail(data.device_id);
      showAdminBanner(
        banner,
        result.ok
          ? `Device ${data.sensor_id} assigned and code ${code} emailed to ${result.sentTo}.`
          : `Device ${data.sensor_id} assigned to ${email}, but the email failed: ${result.message}`,
        result.ok ? "success" : "error"
      );
    } else {
      showAdminBanner(
        banner,
        `Device ${data.sensor_id} assigned to ${email}. Use ✉ Email in the Device Codes table to send the code.`,
        "success"
      );
    }

    setAssignBtnLoading(assignBtn, false);
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
  const banner = document.getElementById("admin-banner");

  // Run all fetches in parallel for speed
  const [
    accountsRes,
    devicesRes,
    codesRes,
    statsRes,
    userCountRes,
    deviceCountRes,
    alertCountRes,
    pendingCodesRes
  ] = await Promise.all([
    // 1. RPC — accounts with emails (bypasses RLS on auth.users)
    client.rpc("admin_list_accounts"),
    // 2. RPC — devices with pairing status
    client.rpc("admin_list_devices"),
    // 3. Pairing codes — full history
    client
      .from("pairing_codes")
      .select("*")
      .order("created_at", { ascending: false }),
    // 4. Combined stats RPC (optional — see SQL below)
    client.rpc("admin_system_stats").maybeSingle(),
    // 5. Exact count — total users
    client.from("profiles").select("*", { count: "exact", head: true }),
    // 6. Exact count — total devices
    client.from("devices").select("*", { count: "exact", head: true }),
    // 7. Exact count — open alerts
    client
      .from("alerts")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),
    // 8. Exact count — pending pairing codes
    client
      .from("pairing_codes")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
  ]);

  // ---------- Handle accounts ----------
  if (accountsRes.error) {
    console.error(accountsRes.error);
    showAdminBanner(
      banner,
      "Couldn't load accounts — did you run sql/admin_panel_functions.sql in Supabase?",
      "error"
    );
    return;
  }
  state.accounts = accountsRes.data || [];

  // ---------- Handle devices ----------
  if (devicesRes.error) {
    console.error(devicesRes.error);
    showAdminBanner(banner, "Couldn't load devices.", "error");
    return;
  }
  state.devices = devicesRes.data || [];

  // ---------- Handle pairing codes ----------
  if (codesRes.error) {
    console.warn("Couldn't load pairing codes:", codesRes.error.message);
    state.pairingCodes = [];
  } else {
    state.pairingCodes = codesRes.data || [];
  }

  // ---------- Handle stats ----------
  state.stats = {
    userCount: userCountRes.count || 0,
    deviceCount: deviceCountRes.count || 0,
    alertCount: alertCountRes.count || 0,
    pendingCodes: pendingCodesRes.count || 0
  };

  renderStats();
  renderCodesTable();
  renderAccountsTable();
  renderPairingCodesTable(); // Optional — see below
  fillDatalists();
}

// ============================================================
// STATS CARDS
// ============================================================
function renderStats() {
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  };
  set("stat-users", state.stats.userCount);
  set("stat-devices", state.stats.deviceCount);
  set("stat-alerts", state.stats.alertCount);
  set("stat-pending", state.stats.pendingCodes);
}

// ============================================================
// DEVICE CODES TABLE
// ============================================================
function renderCodesTable() {
  const tbody = document.getElementById("codes-tbody");

  if (state.devices.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">No devices yet — run sql/synthetic_data.sql to seed demo devices, or let an ESP32 register itself.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.devices
    .map((d) => {
      const claimed = !!d.claimed;
      const reserved = !claimed && !!d.assigned_email;
      const statusBadge = claimed
        ? `<span class="badge online">Paired</span>`
        : reserved
          ? `<span class="badge assigned">Awaiting pairing</span>`
          : `<span class="badge">Unassigned</span>`;
      const action = claimed
        ? `<span class="muted">—</span>`
        : reserved
          ? `<button type="button" class="btn-ghost btn-small" data-send="${esc(d.device_id)}" title="Email this code to ${esc(d.assigned_email)}">✉ Email code</button>`
          : `<button type="button" class="btn-ghost btn-small" data-assign-code="${esc(d.pairing_code)}">Assign</button>`;
      return `
        <tr>
          <td><span class="code-chip">${esc(d.pairing_code)}</span></td>
          <td>${esc(d.pipe_number)}</td>
          <td>${esc(d.sensor_id)}</td>
          <td>${statusBadge}</td>
          <td>${d.assigned_email ? esc(d.assigned_email) : '<span class="muted">—</span>'}</td>
          <td>${claimed ? esc(d.owner_email) : '<span class="muted">—</span>'}</td>
          <td class="td-actions">${action}</td>
        </tr>`;
    })
    .join("");

  tbody.querySelectorAll("[data-send]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const banner = document.getElementById("admin-banner");
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Sending…";
      const result = await sendCodeEmail(btn.dataset.send);
      btn.disabled = false;
      btn.textContent = label;
      showAdminBanner(
        banner,
        result.ok ? `Code emailed to ${result.sentTo}.` : `Email failed: ${result.message}`,
        result.ok ? "success" : "error"
      );
    });
  });

  tbody.querySelectorAll("[data-assign-code]").forEach((btn) => {
    btn.addEventListener("click", () => prefillAssignForm({ code: btn.dataset.assignCode }));
  });
}

// ============================================================
// OPTIONAL: PAIRING CODES HISTORY TABLE
// ============================================================
function renderPairingCodesTable() {
  const tbody = document.getElementById("pairing-codes-tbody");
  if (!tbody) return; // Table not in HTML — skip silently

  if (state.pairingCodes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">No pairing codes generated yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.pairingCodes
    .map((c) => {
      const statusClass = c.status === "used"
        ? "online"
        : c.status === "expired"
          ? "offline"
          : "assigned";
      return `
        <tr>
          <td><span class="code-chip">${esc(c.code)}</span></td>
          <td>${esc(c.recipient_email ?? "—")}</td>
          <td><span class="badge ${statusClass}">${esc(c.status)}</span></td>
          <td>${c.expires_at ? esc(new Date(c.expires_at).toLocaleString()) : "—"}</td>
          <td>${c.used_at ? esc(new Date(c.used_at).toLocaleString()) : '<span class="muted">—</span>'}</td>
          <td>${c.created_at ? esc(new Date(c.created_at).toLocaleString()) : "—"}</td>
        </tr>`;
    })
    .join("");
}

// ============================================================
// ACCOUNTS TABLE
// ============================================================
function renderAccountsTable() {
  const tbody = document.getElementById("accounts-tbody");
  const count = document.getElementById("accounts-count");
  const accounts = state.accounts.filter(
    (a) => state.roleFilter === "all" || a.role === state.roleFilter
  );
  count.textContent = String(accounts.length);

  if (accounts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">No matching accounts have signed up yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = accounts
    .map(
      (a) => `
      <tr>
        <td>${esc(a.email)}</td>
        <td>${esc(a.name ?? "—")}</td>
        <td><span class="role-chip role-${esc(a.role)}">${a.role === "WSP" ? "WSP" : "Home Owner"}</span></td>
        <td>${a.last_sign_in_at ? esc(new Date(a.last_sign_in_at).toLocaleString()) : '<span class="muted">Never</span>'}</td>
        <td>${a.pending_codes ? `<span class="code-chip">${esc(a.pending_codes)}</span>` : '<span class="muted">—</span>'}</td>
        <td>${a.device_count}</td>
        <td class="td-actions"><button type="button" class="btn-ghost btn-small" data-assign-email="${esc(a.email)}">Assign code</button></td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll("[data-assign-email]").forEach((btn) => {
    btn.addEventListener("click", () => prefillAssignForm({ email: btn.dataset.assignEmail }));
  });
}

function prefillAssignForm({ email, code }) {
  const emailInput = document.getElementById("admin-account-email");
  const codeInput = document.getElementById("admin-pairing-code");
  if (email !== undefined) emailInput.value = email;
  if (code !== undefined) codeInput.value = code;
  document.getElementById("admin-form").scrollIntoView({ behavior: "smooth", block: "center" });
  (emailInput.value ? codeInput : emailInput).focus();
}

function fillDatalists() {
  const emails = document.getElementById("account-emails");
  const codes = document.getElementById("unclaimed-codes");
  emails.innerHTML = state.accounts
    .map((a) => `<option value="${esc(a.email)}"></option>`)
    .join("");
  codes.innerHTML = state.devices
    .filter((d) => !d.claimed && !d.assigned_email)
    .map((d) => `<option value="${esc(d.pairing_code)}"></option>`)
    .join("");
}

// ============================================================
// EMAIL — calls the send-device-code Edge Function, which looks up
// the reserved account's address itself and sends via Resend.
// ============================================================
async function sendCodeEmail(deviceId) {
  const { data, error } = await client.functions.invoke("send-device-code", {
    body: { device_id: deviceId },
  });

  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json();
      if (body?.error) message = body.error;
    } catch {
      // Non-JSON error body (e.g. function not deployed) — keep the default message.
    }
    console.error("send-device-code failed:", error);
    return { ok: false, message };
  }

  return { ok: true, sentTo: data.sent_to };
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