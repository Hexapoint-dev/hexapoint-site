// PATCH /api/admin/plans/:id -> edit a plan's name/price/active/sort order.
//
// The plan `id` itself is never editable here (it's the primary key, and
// functions/_shared/db.js's getUpcomingRenewals() hardcodes a check on
// plan_id === 'annual' for the Renewals tab — renaming that id would silently
// break renewal tracking). There's no DELETE either: plans are deactivated
// (active=0) instead of hard-deleted, since historical orders keep their own
// snapshot of a plan's name/price regardless of what happens to the catalog
// row later.
//
// Protected by the admin panel's password login — same requireAdmin() pattern
// as every other admin handler.

import { updatePlan, logAdminAction, jsonResponse } from "../../../_shared/db.js";
import { requireAdmin } from "../../../_shared/admin-auth.js";

const UPDATABLE_FIELDS = ["nameJa", "nameEn", "priceJPY", "active", "sortOrder"];
const FIELD_TO_COLUMN = {
  nameJa: "name_ja",
  nameEn: "name_en",
  priceJPY: "price_jpy",
  active: "active",
  sortOrder: "sort_order",
};

export async function onRequestPatch({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const body = await request.json();
    const patch = {};
    for (const field of UPDATABLE_FIELDS) {
      if (body[field] === undefined) continue;
      const column = FIELD_TO_COLUMN[field];
      if (field === "priceJPY") patch[column] = Number(body[field]);
      else if (field === "active") patch[column] = body[field] ? 1 : 0;
      else if (field === "sortOrder") patch[column] = Number(body[field]);
      else patch[column] = String(body[field]).trim().slice(0, 200);
    }

    if (patch.price_jpy !== undefined && (!Number.isFinite(patch.price_jpy) || patch.price_jpy <= 0)) {
      return jsonResponse({ ok: false, error: "invalid_price" }, 400);
    }
    if ((patch.name_ja !== undefined && !patch.name_ja) || (patch.name_en !== undefined && !patch.name_en)) {
      return jsonResponse({ ok: false, error: "invalid_name" }, 400);
    }

    const plan = await updatePlan(env, params.id, patch);
    if (!plan) return jsonResponse({ ok: false, error: "not_found" }, 404);

    await logAdminAction(env, "plan_updated", null, `${params.id}: ${Object.keys(patch).filter((k) => k !== "updated_at").join(", ")}`);

    return jsonResponse({ ok: true, plan });
  } catch (err) {
    console.error("admin update plan error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
