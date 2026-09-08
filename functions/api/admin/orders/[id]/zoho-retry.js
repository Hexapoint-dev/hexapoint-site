// POST /api/admin/orders/:id/zoho-retry
// Manually re-attempts Zoho invoice creation for one order — for orders that
// failed the first time (rate limit, misconfiguration at the time, etc.) or
// predate Zoho tracking entirely (migrations/0003_finance_features.sql).
//
// Reconstructs the buyer/plan/amount inputs createZohoInvoiceForOrder() needs
// straight from the stored order row, so it works even for bank-transfer or
// manually-added orders an admin now wants invoiced.
//
// Protected by the admin panel's password login — same requireAdmin() pattern
// as every other admin handler.

import { getOrder, setOrderZohoStatus, logAdminAction, jsonResponse } from "../../../../_shared/db.js";
import { requireAdmin } from "../../../../_shared/admin-auth.js";
import { createZohoInvoiceForOrder } from "../../../../_shared/zoho.js";

export async function onRequestPost({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const order = await getOrder(env, params.id);
    if (!order) return jsonResponse({ ok: false, error: "not_found" }, 404);

    const buyer = { name: order.buyer_name, phone: order.buyer_phone, email: order.buyer_email, address: order.buyer_address };
    const plan = { nameJa: order.plan_name_ja, nameEn: order.plan_name_en };

    const result = await createZohoInvoiceForOrder(env, { buyer, plan, orderID: order.order_id, amount: order.amount });

    await setOrderZohoStatus(env, order.order_id, {
      zohoInvoiceId: result.ok ? result.invoiceId : "",
      zohoStatus: result.ok ? "created" : "failed",
      zohoError: result.ok ? "" : result.error,
    });
    await logAdminAction(env, "zoho_retry", order.id, result.ok ? `invoice ${result.invoiceId}` : `failed: ${result.error}`);

    if (!result.ok) return jsonResponse({ ok: false, error: result.error }, 502);
    return jsonResponse({ ok: true, invoiceId: result.invoiceId, invoiceNumber: result.invoiceNumber });
  } catch (err) {
    console.error("admin zoho-retry error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
