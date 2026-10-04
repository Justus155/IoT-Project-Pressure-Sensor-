// ============================================================
// AquaGuard — send-device-code (Supabase Edge Function)
// Emails a device pairing code to the account it is reserved for.
// The browser only sends a device_id; the recipient, code and pipe
// details are read from the database, and only Admins may call it.
//
// Secrets (supabase secrets set ...):
//   RESEND_API_KEY  — API key from https://resend.com
//   EMAIL_FROM      — e.g. "AquaGuard <alerts@your-verified-domain.com>"
//   SITE_URL        — e.g. "https://your-site.example" (sign-in link base)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return json({ error: "Email is not configured: set the RESEND_API_KEY secret." }, 500);

  const emailFrom = Deno.env.get("EMAIL_FROM") ?? "AquaGuard <onboarding@resend.dev>";
  const siteUrl = (Deno.env.get("SITE_URL") ?? req.headers.get("origin") ?? "").replace(/\/+$/, "");

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // ---------- Caller must be a signed-in Admin ----------
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller.user) return json({ error: "You must be signed in." }, 401);

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", caller.user.id)
    .maybeSingle();
  if (profile?.role !== "Admin") return json({ error: "Only administrators can send device codes." }, 403);

  // ---------- Device + recipient come from the database ----------
  let deviceId: unknown;
  try {
    ({ device_id: deviceId } = await req.json());
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  if (typeof deviceId !== "string" || deviceId.length === 0) {
    return json({ error: "device_id is required." }, 400);
  }

  const { data: device, error: deviceError } = await admin
    .from("devices")
    .select("id, pipe_number, sensor_id, pairing_code, owner_id, assigned_to")
    .eq("id", deviceId)
    .maybeSingle();

  if (deviceError || !device) return json({ error: "Device not found." }, 404);
  if (device.owner_id) return json({ error: "That device is already paired." }, 409);
  if (!device.assigned_to) return json({ error: "Assign this code to an account before emailing it." }, 409);

  const { data: target, error: targetError } = await admin.auth.admin.getUserById(device.assigned_to);
  const recipient = target?.user?.email;
  if (targetError || !recipient) return json({ error: "The assigned account has no email address." }, 404);

  const { data: targetProfile } = await admin
    .from("profiles")
    .select("name")
    .eq("id", device.assigned_to)
    .maybeSingle();

  // ---------- Compose + send ----------
  const greetingName = targetProfile?.name || recipient.split("@")[0];
  const signInUrl = siteUrl ? `${siteUrl}/logins/index.html` : "";
  const subject = `Your AquaGuard device code: ${device.pairing_code}`;

  const text = [
    `Hi ${greetingName},`,
    "",
    `Your AquaGuard device code is ${device.pairing_code} (Pipe #${device.pipe_number}, Sensor ${device.sensor_id}).`,
    "",
    "To open your dashboard:",
    `1. Sign in${signInUrl ? ` at ${signInUrl}` : ""} with this email address.`,
    "2. Enter the 6-digit code on the Pair New Device screen.",
    "",
    "The code only works for your account. If you did not expect this email, you can ignore it.",
    "",
    "— AquaGuard Admin",
  ].join("\n");

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;padding:24px;background:#0f1b2d;color:#eef2f6;border-radius:12px">
      <h2 style="margin:0 0 4px;color:#22c55e">AquaGuard</h2>
      <p style="margin:0 0 20px;color:#93a3b5">Water leak &amp; overflow monitoring</p>
      <p>Hi ${esc(greetingName)},</p>
      <p>Your device code for <strong>Pipe #${esc(device.pipe_number)}</strong> (Sensor ${esc(device.sensor_id)}) is:</p>
      <p style="font-size:32px;font-weight:800;letter-spacing:10px;text-align:center;background:#16263b;border:1px solid #24405c;border-radius:10px;padding:16px;margin:16px 0;color:#eef2f6">${esc(device.pairing_code)}</p>
      <ol style="color:#c9d4df;padding-left:20px">
        <li>Sign in with this email address.</li>
        <li>Enter the code on the <strong>Pair New Device</strong> screen.</li>
      </ol>
      ${signInUrl ? `<p style="text-align:center;margin:24px 0"><a href="${esc(signInUrl)}" style="background:#22c55e;color:#04121f;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:8px">Open AquaGuard</a></p>` : ""}
      <p style="color:#93a3b5;font-size:13px">This code only works for your account. If you did not expect this email, you can ignore it.</p>
    </div>`;

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: emailFrom, to: [recipient], subject, text, html }),
  });

  if (!resendRes.ok) {
    const detail = await resendRes.text();
    console.error("Resend rejected the email:", resendRes.status, detail);
    return json({ error: `Email provider rejected the message (${resendRes.status}): ${detail}` }, 502);
  }

  return json({ sent_to: recipient });
});
