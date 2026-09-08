// GET /api/admin/finance?dateFrom=&dateTo= -> aggregates for the admin
// panel's Accounts/Finance tab (revenue by plan, by payment method, last-12-
// months trend, top customers, year-over-year).
//
// dateFrom/dateTo (optional, YYYY-MM-DD) narrow byPlan/byMethod only — monthly
// trend, top customers, and year-over-year are deliberately fixed-window
// "context" views unaffected by the picker (see db.js for why).
//
// Stripe's fee percentage isn't applied here — it's applied client-side in
// admin.html against these totals, since the rate is something the owner
// types in and adjusts themselves (see hp_admin_stripe_fee_pct in admin.html)
// rather than a value this app can know on its own.
//
// Protected by the admin panel's password login — same requireAdmin() pattern
// as every other admin handler.

import { getRevenueByPlan, getRevenueByMethod, getMonthlyRevenue, getTopCustomers, getYearOverYear, jsonResponse } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const url = new URL(request.url);
    const range = {
      dateFrom: url.searchParams.get("dateFrom") || undefined,
      dateTo: url.searchParams.get("dateTo") || undefined,
    };

    const [byPlan, byMethod, monthly, topCustomers, yoy] = await Promise.all([
      getRevenueByPlan(env, range),
      getRevenueByMethod(env, range),
      getMonthlyRevenue(env),
      getTopCustomers(env, 5),
      getYearOverYear(env),
    ]);

    return jsonResponse({ ok: true, byPlan, byMethod, monthly, topCustomers, yoy });
  } catch (err) {
    console.error("admin finance error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
