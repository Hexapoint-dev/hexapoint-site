// GET /api/admin/finance -> aggregates for the admin panel's Accounts/Finance tab
// (revenue by plan, by payment method, last-12-months trend, top customers).
//
// Stripe's fee percentage isn't applied here — it's applied client-side in
// admin.html against these totals, since the rate is something the owner
// types in and adjusts themselves (see hp_admin_stripe_fee_pct in admin.html)
// rather than a value this app can know on its own.
//
// Protected by the admin panel's password login — same requireAdmin() pattern
// as every other admin handler.

import { getRevenueByPlan, getRevenueByMethod, getMonthlyRevenue, getTopCustomers, jsonResponse } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const [byPlan, byMethod, monthly, topCustomers] = await Promise.all([
      getRevenueByPlan(env),
      getRevenueByMethod(env),
      getMonthlyRevenue(env),
      getTopCustomers(env, 5),
    ]);

    return jsonResponse({ ok: true, byPlan, byMethod, monthly, topCustomers });
  } catch (err) {
    console.error("admin finance error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
