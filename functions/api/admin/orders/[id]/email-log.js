// GET /api/admin/orders/:id/email-log -> delivery status of every email
// Resend has sent about this order (confirmation, refund/dispute alerts,
// customer status updates), for the order detail modal's "email status" row.
//
// :id here is the numeric D1 id (same as /orders/:id and /orders/:id/notes),
// but email_log rows are keyed by the order's TEXT order_id (the Stripe
// Checkout Session ID) -- see functions/_shared/email.js -- so this looks
// the order up first to get that.
//
// Protected by the admin panel's password login via requireAdmin(), same as
// every other admin handler.

import { getOrder, getEmailLogForRelated, jsonResponse } from "../../../../_shared/db.js";
import { requireAdmin } from "../../../../_shared/admin-auth.js";

export async function onRequestGet({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const order = await getOrder(env, params.id);
    if (!order) return jsonResponse({ ok: false, error: "not_found" }, 404);

    const emailLog = await getEmailLogForRelated(env, "order", order.order_id);
    return jsonResponse({ ok: true, emailLog });
  } catch (err) {
    console.error("admin get order email-log error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
