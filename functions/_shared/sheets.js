// Shared helper: sends a row of order data to a Google Apps Script Web App,
// which appends it to a Google Sheet. Used by paypal-capture-order.js
// (fast path) and paypal-webhook.js (reliable fallback), the same way
// sendOrderConfirmation() is used for email.
//
// Requires two environment variables (set in Cloudflare Pages -> Settings -> Environment variables):
//   GOOGLE_SHEET_WEBHOOK_URL  - the Apps Script "Web app" URL (ends with /exec)
//   GOOGLE_SHEET_SECRET       - a random string, must match the one in the Apps Script

export async function appendOrderToSheet(env, { buyer, plan, orderID, amount, status }) {
  if (!env.GOOGLE_SHEET_WEBHOOK_URL) {
    console.error("GOOGLE_SHEET_WEBHOOK_URL not configured, skipping Google Sheet sync");
    return { ok: false, error: "not_configured" };
  }

  const receivedAt = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());

  try {
    const res = await fetch(env.GOOGLE_SHEET_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: env.GOOGLE_SHEET_SECRET || "",
        receivedAt,
        orderID,
        status: status || "COMPLETED",
        planNameJa: plan?.nameJa || "",
        planNameEn: plan?.nameEn || "",
        amount,
        name: buyer.name,
        email: buyer.email,
        phone: buyer.phone,
        address: buyer.address,
      }),
    });

    // IMPORTANT: Google Apps Script Web Apps almost always respond with
    // HTTP 200 even when the script itself reports an error (e.g. a bad
    // secret, or an exception inside doPost) — the real result is in the
    // JSON body's "ok" field, not the HTTP status. Checking res.ok alone
    // silently hides those failures, so we always parse and check the body.
    let body = null;
    try {
      body = await res.json();
    } catch (parseErr) {
      console.error("Google Sheet webhook returned non-JSON response:", parseErr);
      return { ok: false, error: "invalid_response" };
    }

    if (!res.ok || !body || body.ok !== true) {
      console.error("Google Sheet webhook reported failure:", res.status, body);
      return { ok: false, error: (body && body.error) || `http_${res.status}` };
    }

    return { ok: true };
  } catch (err) {
    // Never let a Sheet failure break the payment flow or the email step —
    // callers are free to ignore this return value entirely.
    console.error("Google Sheet webhook request failed:", err);
    return { ok: false, error: String(err) };
  }
}
