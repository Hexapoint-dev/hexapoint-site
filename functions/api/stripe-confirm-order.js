// POST /api/stripe-confirm-order
// Called by the frontend right after the buyer is redirected back from Stripe's
// hosted Checkout page with a session_id. This is the "fast path" for confirmation —
// it never trusts the query string alone, it re-fetches the Checkout Session from
// Stripe's own API (server-to-server) before treating the order as paid.
//
// Note: stripe-webhook.js is the reliable fallback in case the buyer's browser
// closes/loses connection right after paying, before this request completes.

import { jsonResponse } from "../_shared/plans.js";
import { stripeApiBase, stripeAuthHeader, confirmStripeSession } from "../_shared/stripe.js";

export async function onRequestPost({ request, env }) {
  try {
    const { sessionId } = await request.json();
    if (!sessionId) return jsonResponse({ ok: false, error: "missing_session_id" }, 400);

    if (!env.STRIPE_SECRET_KEY) {
      return jsonResponse({ ok: false, error: "stripe_not_configured" }, 500);
    }
    if (!env.ORDERS_KV) {
      return jsonResponse({ ok: false, error: "kv_not_configured" }, 500);
    }

    const sessionRes = await fetch(`${stripeApiBase()}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: stripeAuthHeader(env) },
    });

    if (!sessionRes.ok) {
      const detail = await sessionRes.text();
      console.error("Stripe fetch session error:", sessionRes.status, detail);
      return jsonResponse({ ok: false, error: "session_lookup_failed" }, 502);
    }

    const session = await sessionRes.json();
    const result = await confirmStripeSession(env, session);

    return jsonResponse({ ok: result.ok, status: result.status || result.error });
  } catch (err) {
    console.error("stripe confirm-order error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
