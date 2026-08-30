// Shared helper: creates a paid invoice in Zoho Invoice (free plan) after a
// Stripe payment is confirmed. Called from confirmStripeSession() in stripe.js
// — Stripe/bank-transfer orders are never blocked by this: every call is
// wrapped so a Zoho outage or misconfiguration only logs an error, exactly
// like sendOrderConfirmation()'s Resend calls.
//
// Zoho Invoice API v3 docs: https://www.zoho.com/invoice/api/v3/
//
// Auth model: a "Self Client" (server-to-server, no end-user login) created
// once in the Zoho API Console gives a long-lived refresh_token. Every
// request here exchanges that refresh_token for a short-lived access_token
// (~1h), cached in ORDERS_KV so we don't hit the token endpoint on every
// invoice. See SETUP-zoho.md for the one-time setup steps.
//
// Required env vars (Cloudflare Pages -> Settings -> Environment variables):
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORGANIZATION_ID
// Optional:
//   ZOHO_DC                 data center suffix, default "com" (use "eu"/"in"/"com.au"/"jp"/"ca"
//                            to match whichever Zoho signup region the account was created in)
//   ZOHO_AUTO_EMAIL_INVOICE "true" to also have Zoho email the invoice to the buyer
//                            (default: off, since Resend already sends our own confirmation email)

function zohoDc(env) {
  return (env.ZOHO_DC || "com").trim();
}

function zohoAccountsBase(env) {
  return `https://accounts.zoho.${zohoDc(env)}`;
}

function zohoApiBase(env) {
  return `https://www.zohoapis.${zohoDc(env)}/invoice/v3`;
}

function zohoConfigured(env) {
  return !!(env.ZOHO_CLIENT_ID && env.ZOHO_CLIENT_SECRET && env.ZOHO_REFRESH_TOKEN && env.ZOHO_ORGANIZATION_ID);
}

// Access tokens last ~3600s; cache for 3300s (55min) to stay safely inside
// that window even if there's clock drift or the request is slow.
async function getZohoAccessToken(env) {
  const cacheKey = "zoho:access_token";
  if (env.ORDERS_KV) {
    const cached = await env.ORDERS_KV.get(cacheKey);
    if (cached) return cached;
  }

  const params = new URLSearchParams({
    refresh_token: env.ZOHO_REFRESH_TOKEN,
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    grant_type: "refresh_token",
  });

  const res = await fetch(`${zohoAccountsBase(env)}/oauth/v2/token?${params.toString()}`, { method: "POST" });
  const data = await res.json().catch(() => null);

  if (!res.ok || !data || !data.access_token) {
    throw new Error(`zoho_token_refresh_failed: ${res.status} ${JSON.stringify(data)}`);
  }

  if (env.ORDERS_KV) {
    await env.ORDERS_KV.put(cacheKey, data.access_token, { expirationTtl: 3300 });
  }
  return data.access_token;
}

async function zohoFetch(env, path, { method = "GET", body } = {}) {
  const accessToken = await getZohoAccessToken(env);
  const url = `${zohoApiBase(env)}${path}${path.includes("?") ? "&" : "?"}organization_id=${encodeURIComponent(env.ZOHO_ORGANIZATION_ID)}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data || (typeof data.code === "number" && data.code !== 0)) {
    throw new Error(`zoho_api_error: ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Custom subject + HTML body for the "send invoice" email — overrides Zoho's
// own generic default template so the customer gets something that actually
// looks like it came from HexaPoint. Same color tokens / fonts as the Resend
// emails in email.js, so every email the customer receives feels consistent.
// Zoho still attaches the invoice PDF itself; this is just the wrapper.
function buildInvoiceEmailContent({ buyer, plan, orderID, amount }) {
  const INK = "#0e1633";
  const PAPER = "#fbf9f6";
  const MINT = "#fff1df";
  const MINT_2 = "#ffd9b0";
  const EMERALD = "#f5912a";
  const EMERALD_DEEP = "#e8631f";
  const LINE = "#e3e0da";
  const SERIF = "'Hiragino Mincho ProN','Yu Mincho',Georgia,serif";
  const SANS = "'Hiragino Kaku Gothic ProN','Yu Gothic','Helvetica Neue',Arial,sans-serif";

  const row = (labelJp, labelEn, value) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${LINE};">
        <div style="font-family:${SANS};font-size:11px;letter-spacing:.06em;color:${INK};opacity:.55;margin-bottom:3px;">
          ${labelJp} / ${labelEn}
        </div>
        <div style="font-family:${SANS};font-size:15px;font-weight:600;color:${INK};">
          ${esc(value)}
        </div>
      </td>
    </tr>`;

  const subject = `【HexaPoint】ご請求書送付のお知らせ / Your Invoice — ${plan.nameJa}`;

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
          <td style="padding:32px 36px 8px 36px;">
            <div style="font-family:${SANS};font-size:13px;letter-spacing:.12em;color:${EMERALD_DEEP};font-weight:700;">
              HEXAPOINT
            </div>
            <div style="font-family:${SERIF};font-size:26px;color:${INK};margin-top:8px;">
              お支払いありがとうございます<span style="opacity:.5;font-size:15px;display:block;margin-top:4px;">Thank you for your payment</span>
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:8px 36px 0 36px;">
            <div style="font-family:${SANS};font-size:14px;line-height:1.9;color:${INK};opacity:.8;">
              ${esc(buyer.name)} 様<br>
              この度は HexaPoint のサービスをご利用いただき、誠にありがとうございます。
              ご請求書（PDF）を本メールに添付しております。ご確認くださいませ。
            </div>
            <div style="font-family:${SANS};font-size:13px;line-height:1.8;color:${INK};opacity:.6;margin-top:10px;">
              Dear ${esc(buyer.name)},<br>
              Thank you for your business with HexaPoint. Your official invoice (PDF) is attached to this email.
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 36px 0 36px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${row("プラン", "Plan", `${plan.nameJa} / ${plan.nameEn}`)}
              ${row("金額", "Amount", `¥${Number(amount).toLocaleString("ja-JP")}`)}
              ${row("注文ID", "Order ID", orderID)}
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 36px 8px 36px;">
            <div style="font-family:${SANS};font-size:13px;line-height:1.9;color:${INK};background:${MINT};
                        border:1px solid ${MINT_2};border-radius:14px;padding:16px 20px;">
              ご不明な点がございましたら、いつでもお気軽にご連絡ください。<br>
              <span style="opacity:.7;">If you have any questions about this invoice, please don't hesitate to reach out.</span>
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 36px 32px 36px;">
            <a href="mailto:info@hexapoint-jp.com"
               style="display:inline-block;font-family:${SANS};font-size:14px;font-weight:700;color:#ffffff;
                      background:${EMERALD_DEEP};text-decoration:none;padding:13px 26px;border-radius:999px;">
              HexaPoint に連絡する / Contact HexaPoint →
            </a>
          </td>
        </tr>

        <tr><td style="height:1px;background:${LINE};"></td></tr>

        <tr>
          <td style="padding:18px 36px 28px 36px;">
            <div style="font-family:${SANS};font-size:11px;color:${INK};opacity:.45;line-height:1.6;">
              このメールは www.hexapoint-jp.com でのお支払い完了に伴い自動送信されました。<br>
              This message was sent automatically after your payment on www.hexapoint-jp.com.
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

// Finds a Zoho contact by the buyer's email, or creates one. Reused across
// repeat customers so they accumulate under one contact instead of a fresh
// duplicate contact per order.
async function findOrCreateZohoContact(env, buyer) {
  const search = await zohoFetch(env, `/contacts?email=${encodeURIComponent(buyer.email)}`);
  const existing = (search.contacts || [])[0];
  if (existing) return existing.contact_id;

  const created = await zohoFetch(env, "/contacts", {
    method: "POST",
    body: {
      contact_name: buyer.name,
      billing_address: { address: buyer.address },
      contact_persons: [
        {
          first_name: buyer.name,
          email: buyer.email,
          phone: buyer.phone,
          is_primary_contact: true,
        },
      ],
    },
  });
  return created.contact.contact_id;
}

// Creates the invoice, then immediately records a customer payment against
// it (payment_mode "creditcard", since it was collected via Stripe) so it
// shows as PAID in Zoho rather than sitting open/unpaid.
async function createPaidZohoInvoice(env, { contactId, plan, amount, orderID, buyer }) {
  const today = new Date().toISOString().slice(0, 10);
  // Zoho's reference_number field caps out at 50 characters — Stripe Checkout
  // Session IDs (cs_test_.../cs_live_...) routinely run 60+ chars, so they're
  // truncated here. The full orderID is still preserved everywhere else
  // (line item description below, D1 orders table, KV idempotency key).
  const referenceNumber = orderID.slice(0, 50);

  const invoiceRes = await zohoFetch(env, "/invoices", {
    method: "POST",
    body: {
      customer_id: contactId,
      reference_number: referenceNumber,
      date: today,
      line_items: [
        {
          name: `${plan.nameJa} / ${plan.nameEn}`,
          description: `HexaPoint — Order ${orderID}`,
          rate: amount,
          quantity: 1,
        },
      ],
    },
  });
  const invoice = invoiceRes.invoice;

  await zohoFetch(env, "/customerpayments", {
    method: "POST",
    body: {
      customer_id: contactId,
      payment_mode: "creditcard",
      amount,
      date: today,
      reference_number: referenceNumber,
      invoices: [{ invoice_id: invoice.invoice_id, amount_applied: amount }],
    },
  });

  // Record the payment first (above) so the invoice already shows "Paid" by
  // the time the buyer opens the emailed link — sending it before recording
  // the payment would show them a not-yet-paid invoice for a moment.
  if (String(env.ZOHO_AUTO_EMAIL_INVOICE).toLowerCase() === "true") {
    // POST /invoices/{id}/email is Zoho's actual "send this invoice by email"
    // endpoint — /status/sent (used here previously) only flips the status
    // label in the Zoho UI and never emails anything. subject/body below
    // override Zoho's own generic template with HexaPoint's branded design.
    const { subject, html } = buildInvoiceEmailContent({ buyer, plan, orderID, amount });
    await zohoFetch(env, `/invoices/${invoice.invoice_id}/email`, {
      method: "POST",
      body: { to_mail_ids: [buyer.email], subject, body: html },
    }).catch((err) => console.error("Zoho invoice email failed (non-fatal):", err));
  }

  return invoice;
}

// Entry point called from confirmStripeSession(). Never throws — a Zoho
// failure must not block the Stripe payment flow or the order-confirmation
// email, the same guarantee sendOrderConfirmation()/insertOrder() give.
export async function createZohoInvoiceForOrder(env, { buyer, plan, orderID, amount }) {
  if (!zohoConfigured(env)) {
    console.error("Zoho Invoice not configured, skipping invoice creation");
    return { ok: false, error: "not_configured" };
  }

  try {
    const contactId = await findOrCreateZohoContact(env, buyer);
    const invoice = await createPaidZohoInvoice(env, { contactId, plan, amount, orderID, buyer });
    return { ok: true, invoiceId: invoice.invoice_id, invoiceNumber: invoice.invoice_number };
  } catch (err) {
    console.error("Zoho invoice creation failed for order", orderID, err);
    return { ok: false, error: String(err) };
  }
}
