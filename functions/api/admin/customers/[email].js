// GET /api/admin/customers/:email -> every order placed by one buyer_email
// (URL-encoded by the client), for the Customers tab's per-customer detail
// modal in admin.html.
//
// Protected by the admin panel's password login — same requireAdmin() pattern
// as every other admin handler.

import { getCustomerOrders, jsonResponse } from "../../../_shared/db.js";
import { requireAdmin } from "../../../_shared/admin-auth.js";

export async function onRequestGet({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const email = decodeURIComponent(params.email || "");
    if (!email) return jsonResponse({ ok: false, error: "invalid_email" }, 400);

    const orders = await getCustomerOrders(env, email);
    return jsonResponse({ ok: true, email, orders });
  } catch (err) {
    console.error("admin customer orders error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
