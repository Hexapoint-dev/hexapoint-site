// Shared PayPal helpers used by paypal-create-order.js, paypal-capture-order.js, paypal-webhook.js
//
// IMPORTANT: Plan prices are defined here on the SERVER, not trusted from the browser.
// The frontend only sends a planId ("basic" | "maintenance" | "annual"); the actual
// amount charged always comes from this table, so a visitor cannot tamper with the price.

export const PLANS = {
  basic: { id: "basic", nameJa: "基本デザインプラン", nameEn: "Basic Design", priceJPY: 100000 },
  maintenance: { id: "maintenance", nameJa: "コンテンツ変更・保守プラン", nameEn: "Content & Maintenance", priceJPY: 50000 },
  annual: { id: "annual", nameJa: "年間無制限サブスクリプション", nameEn: "Unlimited Annual", priceJPY: 200000 },
};

export function paypalApiBase(env) {
  return env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

// OAuth2 client-credentials token, required before any PayPal REST API call.
export async function getAccessToken(env) {
  const base = paypalApiBase(env);
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`);

  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`PayPal OAuth failed: ${res.status} ${detail}`);
  }

  const data = await res.json();
  return data.access_token;
}

export function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
