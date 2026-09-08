// GET  /api/admin/plans -> every plan (active + inactive), for the admin
// panel's Plans tab table.
// POST /api/admin/plans -> create a new plan.
//
// Protected by the admin panel's password login — same requireAdmin() pattern
// as every other admin handler.

import { listPlans, createPlan, getPlanRow, logAdminAction, jsonResponse } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const plans = await listPlans(env);
    return jsonResponse({ ok: true, plans });
  } catch (err) {
    console.error("admin plans list error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const body = await request.json();
    const id = (body.id || "").toString().trim().toLowerCase().slice(0, 50);
    const nameJa = (body.nameJa || "").toString().trim().slice(0, 200);
    const nameEn = (body.nameEn || "").toString().trim().slice(0, 200);
    const priceJPY = Number(body.priceJPY);
    const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;

    if (!/^[a-z0-9_-]+$/.test(id)) {
      return jsonResponse({ ok: false, error: "invalid_id" }, 400);
    }
    if (!nameJa || !nameEn || !Number.isFinite(priceJPY) || priceJPY <= 0) {
      return jsonResponse({ ok: false, error: "invalid_plan_info" }, 400);
    }

    const existing = await getPlanRow(env, id);
    if (existing) {
      return jsonResponse({ ok: false, error: "duplicate_plan_id" }, 409);
    }

    const plan = await createPlan(env, { id, nameJa, nameEn, priceJPY, sortOrder });
    await logAdminAction(env, "plan_created", null, `${id} / ¥${priceJPY}`);

    return jsonResponse({ ok: true, plan }, 201);
  } catch (err) {
    console.error("admin create plan error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
