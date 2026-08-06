// POST /api/paypal-create-order
// Called by the frontend (paypal.Buttons -> createOrder) after the buyer fills in
// name / phone / email / address. Creates a real PayPal order on the server
// (so the price always comes from PLANS, never from the browser) and stashes
// the buyer's info in KV, keyed by a random order key, so it can be recovered
// later in paypal-capture-order.js and paypal-webhook.js to send the confirmation email.

import { PLANS, paypalApiBase, getAccessToken, jsonResponse } from "../_shared/paypal.js";
import { verifyTurnstile } from "../_shared/turnstile.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const planId = (body.planId || "").toString();
    const buyerRaw = body.buyer || {};
    const turnstileToken = (body.turnstileToken || "").toString();

    const plan = PLANS[planId];
    if (!plan) return jsonResponse({ ok: false, error: "invalid_plan" }, 400);

    const buyer = {
      name: (buyerRaw.name || "").toString().trim().slice(0, 200),
      phone: (buyerRaw.phone || "").toString().trim().slice(0, 50),
      email: (buyerRaw.email || "").toString().trim().slice(0, 200),
      address: (buyerRaw.address || "").toString().trim().slice(0, 500),
    };

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!buyer.name || !buyer.phone || !buyer.email || !buyer.address || !emailRe.test(buyer.email)) {
      return jsonResponse({ ok: false, error: "invalid_buyer_info" }, 400);
    }

    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_SECRET) {
      return jsonResponse({ ok: false, error: "paypal_not_configured" }, 500);
    }
    if (!env.ORDERS_KV) {
      return jsonResponse({ ok: false, error: "kv_not_configured" }, 500);
    }

    // ----- Verify Cloudflare Turnstile token before touching KV or PayPal -----
    const turnstileResult = await verifyTurnstile(env, turnstileToken, request);
    if (!turnstileResult.ok) {
      return jsonResponse({ ok: false, error: turnstileResult.error }, turnstileResult.status);
    }
    // ---------------------------------------------------------------------------

    // Random key we control, stored as PayPal's custom_id so we can find the
    // buyer info again later regardless of which flow completes the order
    // (browser capture vs. webhook).
    const orderKey = crypto.randomUUID();
    await env.ORDERS_KV.put(
      `buyer:${orderKey}`,
      JSON.stringify({ planId, ...buyer, createdAt: Date.now() }),
      { expirationTtl: 60 * 60 * 24 } // 24h is plenty for a checkout session
    );

    const token = await getAccessToken(env);
    const base = paypalApiBase(env);

    const orderRes = await fetch(`${base}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            custom_id: orderKey,
            description: `${plan.nameEn} / ${plan.nameJa}`,
            amount: {
              currency_code: "JPY",
              value: String(plan.priceJPY), // JPY has no decimal places
            },
          },
        ],
      }),
    });

    if (!orderRes.ok) {
      const detail = await orderRes.text();
      console.error("PayPal create order error:", orderRes.status, detail);
      return jsonResponse({ ok: false, error: "paypal_create_failed" }, 502);
    }

    const orderData = await orderRes.json();

    // Also index by PayPal's own order id, so the webhook (which may only
    // have the order id, not our custom_id, depending on the event) can look it up too.
    await env.ORDERS_KV.put(`orderid:${orderData.id}`, orderKey, { expirationTtl: 60 * 60 * 24 });

    return jsonResponse({ id: orderData.id });
  } catch (err) {
    console.error("create-order error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
