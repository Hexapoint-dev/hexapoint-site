// POST /api/stripe-webhook
// Reliable, server-to-server fallback. Stripe calls this endpoint whenever a
// Checkout Session completes, independent of whether the buyer's browser is
// still open when payment finishes (Stripe's own docs call this a requirement
// for reliable fulfillment, not just a nice-to-have) — plus a handful of
// post-payment events (refunds, disputes, failed payments) that keep the
// admin panel and the owner's inbox in sync with what actually happened.
//
// Register this URL in the Stripe Dashboard -> Developers/Workbench -> Webhooks:
//   https://www.hexapoint-jp.com/api/stripe-webhook
// Subscribe to:
//   checkout.session.completed              (required — fulfillment)
//   checkout.session.async_payment_succeeded (delayed payment methods)
//   checkout.session.async_payment_failed    (delayed payment methods failing)
//   checkout.session.expired                 (abandoned checkout — logged only)
//   charge.refunded                          (keeps D1 order status in sync)
//   charge.dispute.created                   (urgent owner alert)
//   payment_intent.payment_failed            (card declined etc.)

import {
  verifyStripeSignature,
  confirmStripeSession,
  handleChargeRefunded,
  handleDisputeCreated,
  handleAsyncPaymentFailed,
  handlePaymentIntentFailed,
  handleCheckoutExpired,
} from "../_shared/stripe.js";

export async function onRequestPost({ request, env }) {
  try {
    const rawBody = await request.text();
    const sigHeader = request.headers.get("Stripe-Signature");

    if (!env.STRIPE_WEBHOOK_SECRET) {
      console.error("STRIPE_WEBHOOK_SECRET not configured");
      return new Response("webhook not configured", { status: 500 });
    }
    if (!env.ORDERS_KV) {
      console.error("ORDERS_KV not configured");
      return new Response("kv not configured", { status: 500 });
    }

    // ----- Verify this request genuinely came from Stripe -----
    const valid = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
    if (!valid) {
      console.error("Stripe webhook signature verification failed");
      return new Response("invalid signature", { status: 400 });
    }
    // ------------------------------------------------------------

    const event = JSON.parse(rawBody);
    const obj = event.data.object;

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const result = await confirmStripeSession(env, obj);
        if (!result.ok) {
          console.error("Stripe webhook: order not confirmable", obj.id, result.error || result.status);
        }
        break;
      }
      case "checkout.session.async_payment_failed":
        await handleAsyncPaymentFailed(env, obj);
        break;
      case "checkout.session.expired":
        handleCheckoutExpired(obj);
        break;
      case "charge.refunded":
        await handleChargeRefunded(env, obj);
        break;
      case "charge.dispute.created":
        await handleDisputeCreated(env, obj);
        break;
      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(env, obj);
        break;
      // Any other subscribed event type is a no-op here by design.
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("stripe webhook error:", err);
    return new Response("server error", { status: 500 });
  }
}
