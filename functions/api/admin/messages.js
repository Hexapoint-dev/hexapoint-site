// GET /api/admin/messages -> list contact-form submissions (filter/search/paginate)
//
// Protected by the admin panel's password login (functions/_shared/admin-auth.js)
// via requireAdmin() below — same pattern as orders.js.

import { listContactMessages, jsonResponse } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const url = new URL(request.url);
    const result = await listContactMessages(env, {
      status: url.searchParams.get("status") || undefined,
      search: url.searchParams.get("search") || undefined,
      page: url.searchParams.get("page") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });

    return jsonResponse({ ok: true, ...result });
  } catch (err) {
    console.error("admin messages list error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
