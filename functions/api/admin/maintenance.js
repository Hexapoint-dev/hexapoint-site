// GET  /api/admin/maintenance -> current maintenance-mode state
// POST /api/admin/maintenance { enabled: true|false } -> turns it on/off
//
// Backs the admin panel's "Maintenance Mode" toggle. When enabled,
// functions/_middleware.js serves a simple "back soon" page for every
// public page request instead of the live site -- for taking the site down
// briefly during risky changes without touching DNS, Cloudflare Access, or
// deployments. The admin panel itself (/admin.html and everything under
// /api/) is never gated, so it's always possible to log in and turn this
// back off.
//
// State is a single flag in ORDERS_KV (key below must match
// MAINTENANCE_KV_KEY in functions/_middleware.js) -- no D1 table needed for
// one boolean.
//
// Protected by the admin panel's password login -- same requireAdmin()
// pattern as every other admin handler.

import { jsonResponse, logAdminAction } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";

const KV_KEY = "site:maintenance_mode";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);
    if (!env.ORDERS_KV) return jsonResponse({ ok: false, error: "kv_not_configured" }, 500);

    const value = await env.ORDERS_KV.get(KV_KEY);
    return jsonResponse({ ok: true, enabled: value === "1" });
  } catch (err) {
    console.error("admin maintenance GET error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);
    if (!env.ORDERS_KV) return jsonResponse({ ok: false, error: "kv_not_configured" }, 500);

    const body = await request.json().catch(() => ({}));
    const enabled = !!body.enabled;

    if (enabled) {
      await env.ORDERS_KV.put(KV_KEY, "1");
    } else {
      await env.ORDERS_KV.delete(KV_KEY);
    }
    await logAdminAction(env, "maintenance_mode", null, enabled ? "enabled" : "disabled");

    return jsonResponse({ ok: true, enabled });
  } catch (err) {
    console.error("admin maintenance POST error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
