// POST /api/paypal-webhook
// Reliable, server-to-server fallback. PayPal calls this endpoint directly
// whenever a payment event happens (completed, refunded, denied...),
// independent of whether the buyer's browser is still open.
//
// This guarantees you never miss a completed payment even if the visitor
// closes the PayPal popup right after paying, before paypal-capture-order.js
// finishes on their end.
//
// Register this URL in PayPal Developer Dashboard -> your app -> Webhooks:
//   https://hexapoint.pages.dev/api/paypal-webhook
// Subscribe at least to: PAYMENT.CAPTURE.COMPLETED (required),
// and optionally PAYMENT.CAPTURE.REFUNDED / PAYMENT.CAPTURE.DENIED.

import { paypalApiBase, getAccessToken, PLANS } from "../_shared/paypal.js";
import { sendOrderConfirmation } from "../_shared/email.js";
import { appendOrderToSheet } from "../_shared/sheets.js";

export async function onRequestPost({ request, env }) {
  try {
    const rawBody = await request.text();
    const event = JSON.parse(rawBody);

    if (!env.PAYPAL_WEBHOOK_ID) {
      console.error("PAYPAL_WEBHOOK_ID not configured");
      return new Response("webhook not configured", { status: 500 });
    }
    if (!env.ORDERS_KV) {
      console.error("ORDERS_KV not configured");
      return new Response("kv not configured", { status: 500 });
    }

    // ----- 1. Verify this request genuinely came from PayPal -----
    const token = await getAccessToken(env);
    const base = paypalApiBase(env);

    const verifyRes = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_algo: request.headers.get("paypal-auth-algo"),
        cert_url: request.headers.get("paypal-cert-url"),
        transmission_id: request.headers.get("paypal-transmission-id"),
        transmission_sig: request.headers.get("paypal-transmission-sig"),
        transmission_time: request.headers.get("paypal-transmission-time"),
        webhook_id: env.PAYPAL_WEBHOOK_ID,
        webhook_event: event,
      }),
    });

    const verifyData = await verifyRes.json();
    if (verifyData.verification_status !== "SUCCESS") {
      console.error("Webhook signature verification failed:", verifyData);
      return new Response("invalid signature", { status: 400 });
    }

    // ----- 2. Ignore duplicate deliveries (PayPal retries webhooks) -----
    const dedupeKey = `webhook-event:${event.id}`;
    const alreadySeen = await env.ORDERS_KV.get(dedupeKey);
    if (alreadySeen) {
      return new Response("ok (duplicate)", { status: 200 });
    }
    await env.ORDERS_KV.put(dedupeKey, "1", { expirationTtl: 60 * 60 * 24 * 7 });

    // ----- 3. Handle the event -----
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const resource = event.resource || {};
      const orderID = resource?.supplementary_data?.related_ids?.order_id || null;
      let orderKey = resource.custom_id || null;

      if (!orderKey && orderID) {
        orderKey = await env.ORDERS_KV.get(`orderid:${orderID}`);
      }

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

      if (buyer && planId) {
        const emailedKey = orderID ? `emailed:${orderID}` : `emailed:${orderKey}`;
        const already = await env.ORDERS_KV.get(emailedKey);
        if (!already) {
          const plan = PLANS[planId];
          const amount = resource?.amount?.value || plan.priceJPY;
          const finalOrderID = orderID || resource.id || "N/A";
          const emailResult = await sendOrderConfirmation(env, {
            buyer,
            plan,
            orderID: finalOrderID,
            amount,
          });
          await appendOrderToSheet(env, {
            buyer,
            plan,
            orderID: finalOrderID,
            amount,
            status: "COMPLETED",
          });
          // Only mark as "emailed" once Resend actually confirmed the send —
          // leaving it unset on failure lets the other flow (the browser's
          // fast-path capture call, or a later webhook delivery) still get a
          // chance to send it, instead of the confirmation being silently lost.
          if (emailResult.ok) {
            await env.ORDERS_KV.put(emailedKey, "1", { expirationTtl: 60 * 60 * 24 * 7 });
          } else {
            console.error("Order confirmation email failed for order", finalOrderID, emailResult.error);
          }
        }
      } else {
        console.error("Webhook: no buyer info found for order", orderID, resource.custom_id);
      }
    }
    // PAYMENT.CAPTURE.REFUNDED / PAYMENT.CAPTURE.DENIED etc. can be handled
    // here later the same way if you want automatic notifications for those too.

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("webhook error:", err);
    return new Response("server error", { status: 500 });
  }
}
