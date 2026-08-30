// POST /api/stripe-webhook
// Reliable, server-to-server fallback. Stripe calls this endpoint whenever a
// Checkout Session completes, independent of whether the buyer's browser is
// still open when payment finishes (Stripe's own docs call this a requirement
// for reliable fulfillment, not just a nice-to-have).
//
// Register this URL in the Stripe Dashboard -> Developers/Workbench -> Webhooks:
//   https://www.hexapoint-jp.com/api/stripe-webhook
// Subscribe at least to: checkout.session.completed
// (optionally also checkout.session.async_payment_succeeded for delayed payment
// methods, and checkout.session.async_payment_failed if you want failure logging).

import { verifyStripeSignature, confirmStripeSession } from "../_shared/stripe.js";

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

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object;
      const result = await confirmStripeSession(env, session);
      if (!result.ok) {
        console.error("Stripe webhook: order not confirmable", session.id, result.error || result.status);
      }
    }
    // checkout.session.async_payment_failed / other event types can be handled
    // here later the same way if you want automatic notifications for those too.

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("stripe webhook error:", err);
    return new Response("server error", { status: 500 });
  }
}
