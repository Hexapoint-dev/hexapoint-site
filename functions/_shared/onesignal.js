// Shared helper: sends the testimonial-request email through OneSignal's
// transactional Email API. Deliberately a separate provider from Resend
// (functions/_shared/email.js) -- this is the one email type the user asked
// to route through OneSignal specifically, the rest of the site's mail stays
// on Resend. See SETUP-onesignal.md for the one-time dashboard setup this
// needs (app id, REST API key, verified sending domain/address).
//
// API reference: https://documentation.onesignal.com/reference/create-notification
// `include_email_tokens` targets an email address directly (no prior
// subscribe/opt-in needed), which is what makes this usable as a one-off
// transactional send instead of a marketing blast.

import { logEmailSend } from "./db.js";

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function onesignalConfigured(env) {
  return Boolean(env.ONESIGNAL_APP_ID && env.ONESIGNAL_REST_API_KEY && env.ONESIGNAL_FROM_EMAIL);
}

// OneSignal's error body is usually { errors: [...] } or { errors: { field: [...] } }.
// Pulled out into one short string so the admin panel can show *why* a send
// failed (unverified from-address, app not yet approved for sending, etc.)
// instead of just an opaque "onesignal_400".
export function formatOneSignalErrorDetail(detail) {
  if (!detail) return "";
  const errors = detail.errors;
  if (!errors) return JSON.stringify(detail).slice(0, 500);
  if (Array.isArray(errors)) return errors.join("; ").slice(0, 500);
  if (typeof errors === "object") {
    return Object.entries(errors)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
      .join("; ")
      .slice(0, 500);
  }
  return String(errors).slice(0, 500);
}

// `link` is the full https://.../testimonial.html?token=... URL the client
// clicks through to. `projectLabel` is whatever the admin typed when sending
// the request (plan name, or a free-text description for a manually-entered
// client) -- shown in the email so the client remembers which project this
// is about.
export async function sendTestimonialRequestEmail(env, { clientName, clientEmail, projectLabel, link, testimonialId }) {
  if (!onesignalConfigured(env)) {
    console.error("OneSignal not configured, skipping testimonial request email");
    return { ok: false, error: "not_configured" };
  }

  const INK = "#0e1633";
  const PAPER = "#fbf9f6";
  const MINT = "#fff1df";
  const MINT_2 = "#ffd9b0";
  const EMERALD = "#f5912a";
  const EMERALD_DEEP = "#e8631f";
  const LINE = "#e3e0da";
  const SERIF = "'Hiragino Mincho ProN','Yu Mincho',Georgia,serif";
  const SANS = "'Hiragino Kaku Gothic ProN','Yu Gothic','Helvetica Neue',Arial,sans-serif";

  const html = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${PAPER};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
        style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid ${LINE};">

        <tr><td style="height:6px;background:linear-gradient(90deg,${EMERALD},${EMERALD_DEEP});"></td></tr>

        <tr>
          <td style="padding:40px 40px 8px 40px;text-align:center;">
            <div style="font-family:${SANS};font-size:13px;letter-spacing:.12em;color:${EMERALD_DEEP};font-weight:700;">
              HEXAPOINT
            </div>
            <div style="font-family:${SERIF};font-size:26px;color:${INK};margin-top:14px;line-height:1.5;">
              ${esc(clientName)} 様、ご感想をお聞かせください
              <span style="display:block;opacity:.5;font-size:15px;margin-top:4px;font-family:${SANS};">We'd love your feedback</span>
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:8px 40px 0 40px;">
            <div style="font-family:${SANS};font-size:14.5px;line-height:1.9;color:${INK};opacity:.85;text-align:center;">
              「<b>${esc(projectLabel || "ご依頼いただいたプロジェクト")}</b>」のご対応が完了しました。<br>
              今後の改善と、他のお客様への参考のため、1分ほどで率直なご感想をいただけますと幸いです。
              <span style="display:block;margin-top:10px;opacity:.7;font-size:13px;">
                Your project — <b>${esc(projectLabel || "your recent project")}</b> — is complete.
                A quick, honest review helps us improve and helps future clients choose with confidence.
              </span>
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:32px 40px 8px 40px;text-align:center;">
            <a href="${esc(link)}"
               style="display:inline-block;font-family:${SANS};font-size:15px;font-weight:700;color:#ffffff;
                      background:${EMERALD_DEEP};text-decoration:none;padding:15px 34px;border-radius:999px;">
              ご感想を送る / Share your feedback →
            </a>
            <div style="font-family:${SANS};font-size:11px;color:${INK};opacity:.5;margin-top:14px;">
              所要時間: 約1分 / Takes about 1 minute
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 40px 8px 40px;">
            <div style="font-family:${SANS};font-size:12px;line-height:1.8;color:${INK};background:${MINT};
                        border:1px solid ${MINT_2};border-radius:14px;padding:16px 20px;">
              このリンクはお客様専用の一度限りのリンクです。他の方と共有しないようご注意ください。<br>
              <span style="opacity:.7;">This is a private, single-use link generated just for you — please don't share it.</span>
            </div>
          </td>
        </tr>

        <tr><td style="height:1px;background:${LINE};margin-top:8px;"></td></tr>

        <tr>
          <td style="padding:18px 40px 28px 40px;">
            <div style="font-family:${SANS};font-size:11px;color:${INK};opacity:.45;line-height:1.6;text-align:center;">
              このメールは HexaPoint の管理画面からの操作により送信されました。ご不明な点があれば、このメールにご返信ください。<br>
              This message was sent by a HexaPoint team member. Reply to this email with any questions.
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const body = {
    app_id: env.ONESIGNAL_APP_ID,
    include_email_tokens: [clientEmail],
    // Bypasses OneSignal's unsubscribe suppression -- this is a one-off,
    // per-client transactional link (not a newsletter), so a prior
    // unsubscribe from marketing mail shouldn't block it. Safe to flip to
    // false if the user would rather honor unsubscribes here too.
    include_unsubscribed_emails: true,
    email_subject: `【HexaPoint】ご感想をお聞かせください / We'd love your feedback`,
    email_body: html,
    email_from_address: env.ONESIGNAL_FROM_EMAIL,
    email_from_name: env.ONESIGNAL_FROM_NAME || "HexaPoint",
  };

  try {
    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        Authorization: `Basic ${env.ONESIGNAL_REST_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const result = await res.json().catch(() => null);
    if (!res.ok || (result && result.errors)) {
      console.error("OneSignal testimonial request error:", res.status, result);
      return { ok: false, error: `onesignal_${res.status}`, detail: result };
    }

    await logEmailSend(env, {
      resendEmailId: result && result.id,
      emailType: "testimonial_request",
      relatedType: "testimonial",
      relatedId: testimonialId,
      recipient: clientEmail,
    });

    return { ok: true, id: result && result.id };
  } catch (err) {
    console.error("OneSignal testimonial request request failed:", err);
    return { ok: false, error: String(err) };
  }
}
