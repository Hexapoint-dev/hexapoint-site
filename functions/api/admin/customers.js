// GET /api/admin/customers -> aggregated per-customer list (grouped by
// buyer_email across all orders, any status), for the admin panel's
// Customers tab. See functions/api/admin/customers/[email].js for a single
// customer's full order history.
//
// Protected by the admin panel's password login — same requireAdmin() pattern
// as every other admin handler.

import { getCustomers, jsonResponse } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const url = new URL(request.url);
    const result = await getCustomers(env, {
      search: url.searchParams.get("search") || undefined,
      page: url.searchParams.get("page") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });

    return jsonResponse({ ok: true, ...result });
  } catch (err) {
    console.error("admin customers error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
