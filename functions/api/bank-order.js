// POST /api/bank-order
// Called by the frontend order modal when the Client chooses "Bank Transfer"
// instead of Stripe. No money moves here — this just records the intent to
// pay by bank transfer and notifies the owner, using the same plan catalog
// (and therefore the same trusted, server-side prices) as the Stripe flow.
//
// The order is logged to the same D1 `orders` table as Stripe orders via
// insertOrder(), with status "pending" so it shows up in the admin panel as
// awaiting bank-transfer confirmation, distinguishable from completed Stripe
// payments (status "paid") in the same table.

import { getPlan, jsonResponse } from "../_shared/plans.js";
import { verifyTurnstile } from "../_shared/turnstile.js";
import { sendBankOrderNotification } from "../_shared/email.js";
import { insertOrder } from "../_shared/db.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const planId = (body.planId || "").toString();
    const buyerRaw = body.buyer || {};
    const turnstileToken = (body.turnstileToken || "").toString();

    const plan = await getPlan(env, planId);
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

    // ----- Verify Cloudflare Turnstile token (same check as the other order/contact endpoints) -----
    const turnstileResult = await verifyTurnstile(env, turnstileToken, request);
    if (!turnstileResult.ok) {
      return jsonResponse({ ok: false, error: turnstileResult.error }, turnstileResult.status);
    }
    // ----------------------------------------------------------------------------------------------

    // No Stripe order ID exists for this flow, so mint our own reference so
    // the owner and the Client can refer to the same order in follow-up emails.
    const orderID = `BANK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const amount = plan.priceJPY;
    const status = "pending";

    // Never let an email or DB hiccup fail the whole request — the Client
    // has already seen the bank details, so we still want to return ok:true
    // as long as at least one of the two notifications gets through. We do
    // report the individual results though, so failures are visible in the
    // browser's Network tab instead of only in Cloudflare's server logs.
    const emailResult = await sendBankOrderNotification(env, { buyer, plan, orderID, amount });
    const emailOk = emailResult.ok;
    const emailError = emailResult.ok ? null : emailResult.error;
    if (!emailOk) {
      console.error("Bank order notification email failed:", emailError);
    }

    const dbResult = await insertOrder(env, {
      orderId: orderID,
      planId,
      planNameJa: plan.nameJa,
      planNameEn: plan.nameEn,
      amount,
      paymentMethod: "bank",
      status,
      buyer,
      notes: "",
    });

    return jsonResponse({
      ok: emailOk || dbResult.ok,
      orderID,
      email: { ok: emailOk, error: emailError },
      db: dbResult,
    });
  } catch (err) {
    console.error("bank-order error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
