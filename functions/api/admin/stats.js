// GET /api/admin/stats -> KPI tiles for the admin dashboard header.
//
// Protected by the admin panel's password login (functions/_shared/admin-auth.js)
// via requireAdmin() below — same pattern as orders.js / orders/[id].js.

import { getStats, jsonResponse } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const stats = await getStats(env);
    return jsonResponse({ ok: true, ...stats });
  } catch (err) {
    console.error("admin stats error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
