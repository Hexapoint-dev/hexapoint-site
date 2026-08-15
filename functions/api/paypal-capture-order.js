// POST /api/paypal-capture-order
// Called by the frontend (paypal.Buttons -> onApprove) right after the buyer
// approves the payment inside PayPal's popup. Captures the payment on PayPal's
// server (the real money-moving step), then sends the confirmation email.
//
// Note: this is the "fast path" for confirmation. paypal-webhook.js is the
// reliable fallback in case the browser closes/loses connection right after
// approval, before this request completes.

import { paypalApiBase, getAccessToken, jsonResponse, PLANS } from "../_shared/paypal.js";
import { sendOrderConfirmation } from "../_shared/email.js";
import { appendOrderToSheet } from "../_shared/sheets.js";

export async function onRequestPost({ request, env }) {
  try {
    const { orderID } = await request.json();
    if (!orderID) return jsonResponse({ ok: false, error: "missing_order_id" }, 400);

    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_SECRET) {
      return jsonResponse({ ok: false, error: "paypal_not_configured" }, 500);
    }
    if (!env.ORDERS_KV) {
      return jsonResponse({ ok: false, error: "kv_not_configured" }, 500);
    }

    const token = await getAccessToken(env);
    const base = paypalApiBase(env);

    const capRes = await fetch(`${base}/v2/checkout/orders/${orderID}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!capRes.ok) {
      const detail = await capRes.text();
      console.error("PayPal capture error:", capRes.status, detail);
      return jsonResponse({ ok: false, error: "capture_failed" }, 502);
    }

    const capData = await capRes.json();
    const status = capData.status; // "COMPLETED" on success

    // Recover the buyer info we stored during create-order.
    const orderKey = await env.ORDERS_KV.get(`orderid:${orderID}`);
    let buyer = null;
    let planId = null;
    if (orderKey) {
      const raw = await env.ORDERS_KV.get(`buyer:${orderKey}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        planId = parsed.planId;
        buyer = { name: parsed.name, phone: parsed.phone, email: parsed.email, address: parsed.address };
      }
    }

    if (status === "COMPLETED" && buyer && planId) {
      const already = await env.ORDERS_KV.get(`emailed:${orderID}`);
      if (!already) {
        const plan = PLANS[planId];
        const capture = capData?.purchase_units?.[0]?.payments?.captures?.[0];
        const amount = capture?.amount?.value || plan.priceJPY;
        const emailResult = await sendOrderConfirmation(env, { buyer, plan, orderID, amount });
        await appendOrderToSheet(env, { buyer, plan, orderID, amount, status });
        // Only mark as "emailed" once Resend actually confirmed the send —
        // otherwise the webhook's later delivery (or a retry) never gets a
        // chance to send the confirmation the buyer is still missing.
        if (emailResult.ok) {
          await env.ORDERS_KV.put(`emailed:${orderID}`, "1", { expirationTtl: 60 * 60 * 24 * 7 });
        } else {
          console.error("Order confirmation email failed for order", orderID, emailResult.error);
        }
      }
    } else if (status === "COMPLETED") {
      console.error("Capture completed but buyer info missing for order", orderID);
    }

    return jsonResponse({ ok: status === "COMPLETED", status });
  } catch (err) {
    console.error("capture-order error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
