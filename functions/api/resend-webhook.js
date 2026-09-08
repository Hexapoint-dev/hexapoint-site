// POST /api/resend-webhook
// Receives delivery-status events from Resend for every email this site
// sends (order confirmations, bank-order/refund/dispute/payment-failed
// alerts, contact-form notifications, customer status updates). Two jobs:
//
//   1. email.sent is the single source of truth for the "how many emails
//      have we sent" counter on the admin panel's System Status tab
//      (functions/_shared/usage.js) -- see resend.js for why this replaced
//      the old per-call-site tracking.
//   2. Every event updates the matching email_log row (functions/_shared/db.js),
//      so the admin panel can show whether a given order/contact-message's
//      email actually got delivered, bounced, or was marked spam.
//
// Register this URL in the Resend Dashboard -> Webhooks -> Add Endpoint:
//   https://www.hexapoint-jp.com/api/resend-webhook
// Subscribe to:
//   email.sent, email.delivered, email.delivery_delayed, email.bounced, email.complained

import { verifyResendSignature, RESEND_STATUS_BY_EVENT } from "../_shared/resend.js";
import { updateEmailStatusByResendId } from "../_shared/db.js";
import { trackResendSend } from "../_shared/usage.js";

export async function onRequestPost({ request, env }) {
  try {
    const rawBody = await request.text();

    if (!env.RESEND_WEBHOOK_SECRET) {
      console.error("RESEND_WEBHOOK_SECRET not configured");
      return new Response("webhook not configured", { status: 500 });
    }

    const valid = await verifyResendSignature(rawBody, request.headers, env.RESEND_WEBHOOK_SECRET);
    if (!valid) {
      console.error("Resend webhook signature verification failed");
      return new Response("invalid signature", { status: 400 });
    }

    const event = JSON.parse(rawBody);
    const emailId = event.data && event.data.email_id;
    const status = RESEND_STATUS_BY_EVENT[event.type];

    if (event.type === "email.sent") {
      await trackResendSend(env);
    }

    if (status && emailId && env.DB) {
      const detail = event.data && (event.data.reason || (event.data.bounce && event.data.bounce.message));
      await updateEmailStatusByResendId(env, emailId, { status, statusDetail: detail });
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("resend webhook error:", err);
    return new Response("server error", { status: 500 });
  }
}
