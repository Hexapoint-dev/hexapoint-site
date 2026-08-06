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
    return;
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

    if (!res.ok) {
      const detail = await res.text();
      console.error("Google Sheet webhook error:", res.status, detail);
    }
  } catch (err) {
    // Never let a Sheet failure break the payment flow or the email step.
    console.error("Google Sheet webhook request failed:", err);
  }
}
