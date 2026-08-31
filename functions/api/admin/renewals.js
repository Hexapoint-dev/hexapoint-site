// GET /api/admin/renewals -> every paid annual-plan order, for the admin
// panel's Renewals tab. Renewal date (created_at + 365 days) and days-left
// are computed client-side, same as the existing per-row renewal badge in
// the Orders table (index.html's renewalBadgeHtml equivalent in admin.html)
// — this endpoint just narrows the query to plan_id = 'annual' server-side
// so the tab doesn't have to page through every order to find them.
//
// Protected by the admin panel's password login — same requireAdmin() pattern
// as every other admin handler.

import { getUpcomingRenewals, jsonResponse } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const renewals = await getUpcomingRenewals(env);
    return jsonResponse({ ok: true, renewals });
  } catch (err) {
    console.error("admin renewals error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
