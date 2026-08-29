// GET  /api/admin/orders  -> list orders (filter/search/sort/paginate)
// POST /api/admin/orders  -> create a manual order
//
// Protected by the admin panel's password login (functions/_shared/admin-auth.js)
// via requireAdmin() below — see SETUP-cloudflare.md for the required env vars.

import { listOrders, createOrder, jsonResponse } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const url = new URL(request.url);
    const result = await listOrders(env, {
      status: url.searchParams.get("status") || undefined,
      search: url.searchParams.get("search") || undefined,
      dateFrom: url.searchParams.get("dateFrom") || undefined,
      dateTo: url.searchParams.get("dateTo") || undefined,
      sort: url.searchParams.get("sort") || undefined,
      dir: url.searchParams.get("dir") || undefined,
      page: url.searchParams.get("page") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });

    return jsonResponse({ ok: true, ...result });
  } catch (err) {
    console.error("admin orders list error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const body = await request.json();
    const buyerRaw = body.buyer || {};

    const planId = (body.planId || "").toString().trim().slice(0, 100);
    const planNameJa = (body.planNameJa || "").toString().trim().slice(0, 200);
    const planNameEn = (body.planNameEn || "").toString().trim().slice(0, 200);
    const amount = Number(body.amount);
    const paymentMethod = (body.paymentMethod || "manual").toString().trim().slice(0, 20);
    const status = (body.status || "pending").toString().trim().slice(0, 20);
    const notes = (body.notes || "").toString().slice(0, 2000);

    const buyer = {
      name: (buyerRaw.name || "").toString().trim().slice(0, 200),
      phone: (buyerRaw.phone || "").toString().trim().slice(0, 50),
      email: (buyerRaw.email || "").toString().trim().slice(0, 200),
      address: (buyerRaw.address || "").toString().trim().slice(0, 500),
    };

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!planId || !planNameJa || !planNameEn || !Number.isFinite(amount) || amount <= 0) {
      return jsonResponse({ ok: false, error: "invalid_plan_info" }, 400);
    }
    if (!buyer.name || !buyer.phone || !buyer.email || !buyer.address || !emailRe.test(buyer.email)) {
      return jsonResponse({ ok: false, error: "invalid_buyer_info" }, 400);
    }

    const order = await createOrder(env, {
      planId,
      planNameJa,
      planNameEn,
      amount,
      paymentMethod,
      status,
      buyer,
      notes,
    });

    return jsonResponse({ ok: true, order }, 201);
  } catch (err) {
    console.error("admin create order error:", err);
    const message = String(err && err.message ? err.message : err);
    const isDuplicate = message.includes("UNIQUE constraint failed");
    return jsonResponse({ ok: false, error: isDuplicate ? "duplicate_order_id" : "server_error" }, isDuplicate ? 409 : 500);
  }
}
