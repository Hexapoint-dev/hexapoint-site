// Shared Stripe helpers used by stripe-create-checkout.js, stripe-confirm-order.js,
// stripe-webhook.js. Uses Stripe Checkout (hosted page) — the buyer is redirected to
// a Stripe-hosted payment page and back, so no Stripe.js/Elements script is loaded
// on our page at all (no CSP changes needed for this).
//
// Reuses getPlan() from _shared/plans.js rather than duplicating the plan catalog.

import { getPlan } from "./plans.js";

export function stripeApiBase() {
  return "https://api.stripe.com/v1";
}

export function stripeAuthHeader(env) {
  return "Bearer " + env.STRIPE_SECRET_KEY;
}

// Stripe's API expects application/x-www-form-urlencoded bodies using PHP-style
// bracket notation for nested objects/arrays, e.g.
// toStripeForm({ line_items: [{ quantity: 1 }] }) -> "line_items[0][quantity]=1"
export function toStripeForm(params) {
  const pairs = [];
  appendPairs(pairs, null, params);
  return pairs.join("&");
}

function appendPairs(pairs, prefix, value) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => appendPairs(pairs, prefix ? `${prefix}[${i}]` : String(i), v));
  } else if (typeof value === "object") {
    for (const key of Object.keys(value)) {
      appendPairs(pairs, prefix ? `${prefix}[${key}]` : key, value[key]);
    }
  } else {
    pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(value)}`);
  }
}

export function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function hmacSha256Hex(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Verifies the Stripe-Signature header per Stripe's documented manual-verification
// algorithm: header is "t=<unix ts>,v1=<hex hmac>[,v0=<fake, ignore>]"; the signed
// string is `${t}.${rawBody}`, HMAC-SHA256 keyed with the whsec_ secret, hex-encoded.
// Rejects stale timestamps (replay protection) using Stripe's own default 300s tolerance.
export async function verifyStripeSignature(rawBody, sigHeader, secret, toleranceSeconds = 300) {
  if (!sigHeader || !secret) return false;

  let timestamp = null;
  const v1Sigs = [];
  for (const part of sigHeader.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === "t") timestamp = v;
    else if (k === "v1") v1Sigs.push(v);
  }
  if (!timestamp || v1Sigs.length === 0) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) return false;

  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return v1Sigs.some((sig) => timingSafeEqualHex(sig, expected));
}

// Authoritative "record this paid Checkout Session" step, shared by the browser
// fast-path (stripe-confirm-order.js, which re-fetches the session fresh from
// Stripe before calling this) and the webhook fallback (stripe-webhook.js, whose
// `session` came from a signature-verified event payload). Never trust a session
// object that wasn't obtained one of those two authoritative ways.
export async function confirmStripeSession(env, session) {
  if (!session || session.payment_status !== "paid") {
    return { ok: false, status: session ? session.payment_status : "not_found" };
  }

  const orderKey = session.client_reference_id || (session.metadata && session.metadata.orderKey);
  if (!orderKey) return { ok: false, error: "missing_order_key" };

  const raw = await env.ORDERS_KV.get(`buyer:${orderKey}`);
  if (!raw) return { ok: false, error: "unknown_order" };

  const parsed = JSON.parse(raw);
  const plan = await getPlan(env, parsed.planId);
  if (!plan) return { ok: false, error: "unknown_plan" };
  const buyer = { name: parsed.name, phone: parsed.phone, email: parsed.email, address: parsed.address };

  const orderID = session.id;
  // JPY is a zero-decimal currency in Stripe: amount_total is already whole yen,
  // never divide/multiply by 100 the way you would for USD/EUR.
  const amount = session.amount_total;

  const { sendOrderConfirmation } = await import("./email.js");
  const { insertOrder, setOrderZohoStatus } = await import("./db.js");
  const { createZohoInvoiceForOrder } = await import("./zoho.js");

  const already = await env.ORDERS_KV.get(`emailed:${orderID}`);
  if (!already) {
    const emailResult = await sendOrderConfirmation(env, { buyer, plan, orderID, amount });
    await insertOrder(env, {
      orderId: orderID,
      planId: parsed.planId,
      planNameJa: plan.nameJa,
      planNameEn: plan.nameEn,
      amount,
      paymentMethod: "stripe",
      status: "paid",
      buyer,
      notes: "",
    });
    if (emailResult.ok) {
      await env.ORDERS_KV.put(`emailed:${orderID}`, "1", { expirationTtl: 60 * 60 * 24 * 7 });
    } else {
      console.error("Order confirmation email failed for order", orderID, emailResult.error);
    }
  }

  // Separate idempotency key from `emailed:` above — the two run independently
  // so a retry never creates a duplicate Zoho invoice even if the email step
  // already succeeded (or vice versa) on an earlier attempt.
  const alreadyInvoiced = await env.ORDERS_KV.get(`invoiced:${orderID}`);
  if (!alreadyInvoiced) {
    const invoiceResult = await createZohoInvoiceForOrder(env, { buyer, plan, orderID, amount });
    if (invoiceResult.ok) {
      await env.ORDERS_KV.put(`invoiced:${orderID}`, invoiceResult.invoiceId, { expirationTtl: 60 * 60 * 24 * 7 });
    }
    // Recorded either way (success or failure) so the admin panel's order
    // detail view always has a current answer, with a manual retry button
    // for the failure case, instead of silence visible only in server logs.
    await setOrderZohoStatus(env, orderID, {
      zohoInvoiceId: invoiceResult.ok ? invoiceResult.invoiceId : "",
      zohoStatus: invoiceResult.ok ? "created" : "failed",
      zohoError: invoiceResult.ok ? "" : invoiceResult.error,
    }).catch((err) => console.error("setOrderZohoStatus failed for order", orderID, err));
  }

  return { ok: true, status: "COMPLETED", orderID };
}

// ---- Post-payment event handlers (charge/dispute/payment-intent events) ----
// These don't carry our own orderKey/order_id directly the way a Checkout
// Session does — they're resolved back to the Checkout Session (and from
// there, our D1 order row) via the underlying payment_intent. Every handler
// below is wrapped in its own try/catch and never throws: a webhook handler
// failing here must not turn into a 500 that makes Stripe retry forever.

async function findSessionByPaymentIntent(env, paymentIntentId) {
  if (!paymentIntentId) return null;
  const res = await fetch(
    `${stripeApiBase()}/checkout/sessions?payment_intent=${encodeURIComponent(paymentIntentId)}`,
    { headers: { Authorization: stripeAuthHeader(env) } }
  );
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return (data && data.data && data.data[0]) || null;
}

// charge.refunded — keeps D1's order status in sync when a refund happens
// directly in the Stripe Dashboard, which our own admin panel has no way of
// knowing about otherwise. Without this, the Finance tab's revenue figures
// would silently drift from reality every time a refund is issued.
export async function handleChargeRefunded(env, charge) {
  try {
    const session = await findSessionByPaymentIntent(env, charge.payment_intent);
    if (!session) {
      console.error("charge.refunded: no matching checkout session for payment_intent", charge.payment_intent);
      return;
    }
    const orderId = session.id;

    const { getOrderByOrderId, updateOrderStatusByOrderId, logAdminAction } = await import("./db.js");
    const order = await getOrderByOrderId(env, orderId);
    if (!order) return;

    await updateOrderStatusByOrderId(env, orderId, "refunded");
    await logAdminAction(env, "stripe_refund_synced", order.id, `¥${charge.amount_refunded || charge.amount}`);

    const { sendOwnerAlert } = await import("./email.js");
    await sendOwnerAlert(env, {
      subject: `【HexaPoint】返金が処理されました / Refund processed — ${order.plan_name_ja}`,
      title: "返金が処理されました",
      titleEn: "A refund was processed",
      urgent: false,
      rows: [
        ["注文ID", "Order ID", orderId],
        ["お客様", "Customer", order.buyer_name],
        ["返金額", "Refunded amount", `¥${Number(charge.amount_refunded || charge.amount).toLocaleString("ja-JP")}`],
      ],
    });
  } catch (err) {
    console.error("handleChargeRefunded failed:", err);
  }
}

// charge.dispute.created — the highest-stakes event here: disputes have a
// strict response deadline (missing it forfeits the money automatically),
// so this fires an immediate, visually distinct ("urgent") email, and drops
// a note on the order itself so the deadline is visible right in /admin.html
// without digging through the Stripe Dashboard.
export async function handleDisputeCreated(env, dispute) {
  try {
    const session = await findSessionByPaymentIntent(env, dispute.payment_intent);
    const orderId = session ? session.id : null;

    const dueBy = dispute.evidence_details && dispute.evidence_details.due_by
      ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "long" }).format(new Date(dispute.evidence_details.due_by * 1000))
      : "不明 / Unknown";

    let order = null;
    if (orderId) {
      const { getOrderByOrderId, addOrderNote } = await import("./db.js");
      order = await getOrderByOrderId(env, orderId);
      if (order) {
        await addOrderNote(
          env,
          order.id,
          `⚠️ Stripeで異議申し立て（チャージバック）が開始されました。理由: ${dispute.reason}。金額: ¥${dispute.amount}。対応期限: ${dueBy}`
        );
      }
    }

    const { sendOwnerAlert } = await import("./email.js");
    await sendOwnerAlert(env, {
      subject: "【緊急】Stripeで異議申し立てが発生しました / URGENT: Stripe dispute opened",
      title: "至急ご対応ください：異議申し立てが発生しました",
      titleEn: "Action required: a dispute was opened",
      urgent: true,
      rows: [
        ["注文ID", "Order ID", orderId || "不明 / unknown"],
        ["お客様", "Customer", order ? order.buyer_name : "不明 / unknown"],
        ["金額", "Amount", `¥${Number(dispute.amount).toLocaleString("ja-JP")}`],
        ["理由", "Reason", dispute.reason],
        ["対応期限", "Respond by", dueBy],
      ],
    });
  } catch (err) {
    console.error("handleDisputeCreated failed:", err);
  }
}

// checkout.session.async_payment_failed — a Checkout Session's own
// client_reference_id/metadata already carries orderKey, so this doesn't
// need the payment_intent lookup the charge/dispute handlers do.
export async function handleAsyncPaymentFailed(env, session) {
  try {
    const orderKey = session.client_reference_id || (session.metadata && session.metadata.orderKey);
    if (!orderKey) return;
    const raw = await env.ORDERS_KV.get(`buyer:${orderKey}`);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const plan = await getPlan(env, parsed.planId);

    const { sendOwnerAlert } = await import("./email.js");
    await sendOwnerAlert(env, {
      subject: `【HexaPoint】お支払いが失敗しました / Payment failed — ${plan ? plan.nameJa : parsed.planId}`,
      title: "お支払いが失敗しました",
      titleEn: "A payment attempt failed",
      urgent: false,
      rows: [
        ["お客様", "Customer", parsed.name],
        ["メール", "Email", parsed.email],
        ["プラン", "Plan", plan ? `${plan.nameJa} / ${plan.nameEn}` : parsed.planId],
      ],
    });
  } catch (err) {
    console.error("handleAsyncPaymentFailed failed:", err);
  }
}

// payment_intent.payment_failed — needs orderKey copied onto the
// PaymentIntent itself at checkout-creation time (see payment_intent_data in
// stripe-create-checkout.js); Stripe doesn't propagate Checkout Session
// metadata onto the PaymentIntent automatically. Silently returns for any
// PaymentIntent that predates that change or wasn't created via our checkout.
export async function handlePaymentIntentFailed(env, paymentIntent) {
  try {
    const orderKey = paymentIntent.metadata && paymentIntent.metadata.orderKey;
    if (!orderKey) return;
    const raw = await env.ORDERS_KV.get(`buyer:${orderKey}`);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const plan = await getPlan(env, parsed.planId);
    const reason = (paymentIntent.last_payment_error && paymentIntent.last_payment_error.message) || "unknown";

    const { sendOwnerAlert } = await import("./email.js");
    await sendOwnerAlert(env, {
      subject: `【HexaPoint】カード決済が失敗しました / Card payment failed — ${plan ? plan.nameJa : parsed.planId}`,
      title: "カード決済が失敗しました",
      titleEn: "A card payment failed",
      urgent: false,
      rows: [
        ["お客様", "Customer", parsed.name],
        ["メール", "Email", parsed.email],
        ["プラン", "Plan", plan ? `${plan.nameJa} / ${plan.nameEn}` : parsed.planId],
        ["失敗理由", "Failure reason", reason],
      ],
    });
  } catch (err) {
    console.error("handlePaymentIntentFailed failed:", err);
  }
}

// checkout.session.expired — an abandoned checkout, low-stakes/high-volume
// (every browsed-but-unpaid session eventually fires this ~24h later), so
// this only logs rather than emailing the owner for every single one.
export function handleCheckoutExpired(session) {
  const orderKey = session.client_reference_id || (session.metadata && session.metadata.orderKey);
  console.log("checkout.session.expired (abandoned checkout):", orderKey || session.id);
}
