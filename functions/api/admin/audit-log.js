// GET /api/admin/audit-log -> paginated history of order-mutating admin
// actions (create / status change / edit / delete / Zoho retry), for the
// admin panel's History tab. Written by logAdminAction() calls scattered
// across the other admin/* handlers — see functions/_shared/db.js.
//
// Protected by the admin panel's password login — same requireAdmin() pattern
// as every other admin handler.

import { listAuditLog, jsonResponse } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const url = new URL(request.url);
    const result = await listAuditLog(env, {
      page: url.searchParams.get("page") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });

    return jsonResponse({ ok: true, ...result });
  } catch (err) {
    console.error("admin audit-log error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
