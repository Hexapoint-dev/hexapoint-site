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
async function createPaidZohoInvoice(env, { contactId, plan, amount, orderID }) {
  const today = new Date().toISOString().slice(0, 10);

  const invoiceRes = await zohoFetch(env, "/invoices", {
    method: "POST",
    body: {
      customer_id: contactId,
      reference_number: orderID,
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

  if (String(env.ZOHO_AUTO_EMAIL_INVOICE).toLowerCase() === "true") {
    await zohoFetch(env, `/invoices/${invoice.invoice_id}/status/sent`, { method: "POST" }).catch((err) =>
      console.error("Zoho invoice mark-sent failed (non-fatal):", err)
    );
  }

  await zohoFetch(env, "/customerpayments", {
    method: "POST",
    body: {
      customer_id: contactId,
      payment_mode: "creditcard",
      amount,
      date: today,
      reference_number: orderID,
      invoices: [{ invoice_id: invoice.invoice_id, amount_applied: amount }],
    },
  });

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
    const invoice = await createPaidZohoInvoice(env, { contactId, plan, amount, orderID });
    return { ok: true, invoiceId: invoice.invoice_id, invoiceNumber: invoice.invoice_number };
  } catch (err) {
    console.error("Zoho invoice creation failed for order", orderID, err);
    return { ok: false, error: String(err) };
  }
}
