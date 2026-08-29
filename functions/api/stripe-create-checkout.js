// POST /api/stripe-create-checkout
// Called by the frontend order modal when the buyer picks "Pay with Stripe" after
// filling in name / phone / email / address. Creates a real Stripe Checkout Session
// on the server (so the price always comes from PLANS, never from the browser) and
// stashes the buyer's info in KV, keyed by a random order key, so it can be recovered
// later in stripe-confirm-order.js / stripe-webhook.js to send the confirmation email.
//
// Uses Stripe's hosted Checkout page (redirect), not Stripe.js/Elements — the
// frontend just redirects the browser to the returned `url`.

import { PLANS, jsonResponse } from "../_shared/plans.js";
import { verifyTurnstile } from "../_shared/turnstile.js";
import { stripeApiBase, stripeAuthHeader, toStripeForm } from "../_shared/stripe.js";

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

    if (!env.STRIPE_SECRET_KEY) {
      return jsonResponse({ ok: false, error: "stripe_not_configured" }, 500);
    }
    if (!env.ORDERS_KV) {
      return jsonResponse({ ok: false, error: "kv_not_configured" }, 500);
    }

    // ----- Verify Cloudflare Turnstile token before touching KV or Stripe -----
    const turnstileResult = await verifyTurnstile(env, turnstileToken, request);
    if (!turnstileResult.ok) {
      return jsonResponse({ ok: false, error: turnstileResult.error }, turnstileResult.status);
    }
    // ----------------------------------------------------------------------------

    // Random key we control, sent to Stripe as client_reference_id/metadata so we
    // can find the buyer info again later regardless of which flow completes the
    // order (browser return vs. webhook).
    const orderKey = crypto.randomUUID();
    await env.ORDERS_KV.put(
      `buyer:${orderKey}`,
      JSON.stringify({ planId, ...buyer, createdAt: Date.now() }),
      { expirationTtl: 60 * 60 * 24 } // 24h is plenty for a checkout session
    );

    const origin = new URL(request.url).origin;

    const formBody = toStripeForm({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "jpy",
            product_data: { name: `${plan.nameEn} / ${plan.nameJa}` },
            // JPY is a zero-decimal currency in Stripe: unit_amount is the whole-yen
            // amount directly, never multiplied by 100 the way USD/EUR would be.
            unit_amount: plan.priceJPY,
          },
          quantity: 1,
        },
      ],
      // {CHECKOUT_SESSION_ID} is a literal placeholder Stripe substitutes automatically
      // after payment — must be sent exactly as-is, not interpolated ourselves.
      success_url: `${origin}/?stripe_order=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?stripe_order=cancel`,
      client_reference_id: orderKey,
      metadata: { orderKey },
      customer_email: buyer.email,
    });

    const sessionRes = await fetch(`${stripeApiBase()}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: stripeAuthHeader(env),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody,
    });

    if (!sessionRes.ok) {
      const detail = await sessionRes.text();
      console.error("Stripe create checkout session error:", sessionRes.status, detail);
      return jsonResponse({ ok: false, error: "stripe_create_failed" }, 502);
    }

    const session = await sessionRes.json();
    if (!session.url || !session.id) {
      console.error("Stripe create checkout unexpected response:", session);
      return jsonResponse({ ok: false, error: "stripe_create_failed" }, 502);
    }

    return jsonResponse({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("stripe create-checkout error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
