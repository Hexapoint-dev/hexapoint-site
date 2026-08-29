// GET    /api/admin/orders/:id -> single order
// PATCH  /api/admin/orders/:id -> edit (status, buyer fields, notes, plan/amount)
// DELETE /api/admin/orders/:id -> delete
//
// Protected by the admin panel's password login — see orders.js / admin-auth.js.

import { getOrder, updateOrder, deleteOrder, jsonResponse } from "../../../_shared/db.js";
import { requireAdmin } from "../../../_shared/admin-auth.js";

const UPDATABLE_FIELDS = [
  "status",
  "buyer_name",
  "buyer_phone",
  "buyer_email",
  "buyer_address",
  "notes",
  "plan_id",
  "plan_name_ja",
  "plan_name_en",
  "amount",
];

export async function onRequestGet({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);
    const order = await getOrder(env, params.id);
    if (!order) return jsonResponse({ ok: false, error: "not_found" }, 404);
    return jsonResponse({ ok: true, order });
  } catch (err) {
    console.error("admin get order error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}

export async function onRequestPatch({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const body = await request.json();
    const patch = {};
    for (const field of UPDATABLE_FIELDS) {
      if (body[field] === undefined) continue;
      patch[field] = field === "amount" ? Number(body[field]) : String(body[field]).slice(0, 2000);
    }

    if (patch.buyer_email !== undefined) {
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRe.test(patch.buyer_email)) {
        return jsonResponse({ ok: false, error: "invalid_email" }, 400);
      }
    }
    if (patch.amount !== undefined && (!Number.isFinite(patch.amount) || patch.amount <= 0)) {
      return jsonResponse({ ok: false, error: "invalid_amount" }, 400);
    }

    const order = await updateOrder(env, params.id, patch);
    if (!order) return jsonResponse({ ok: false, error: "not_found" }, 404);
    return jsonResponse({ ok: true, order });
  } catch (err) {
    console.error("admin update order error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}

export async function onRequestDelete({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);
    const result = await deleteOrder(env, params.id);
    if (!result.deleted) return jsonResponse({ ok: false, error: "not_found" }, 404);
    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("admin delete order error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
