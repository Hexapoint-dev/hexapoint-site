// Shared, payment-provider-agnostic helpers used across bank-order.js and every
// stripe-*.js Function.
//
// IMPORTANT: Plan prices are defined here on the SERVER, not trusted from the browser.
// The frontend only sends a planId ("basic" | "maintenance" | "annual"); the actual
// amount charged always comes from this table, so a visitor cannot tamper with the price.

export const PLANS = {
  basic: { id: "basic", nameJa: "基本デザインプラン", nameEn: "Basic Design", priceJPY: 100000 },
  maintenance: { id: "maintenance", nameJa: "コンテンツ変更・保守プラン", nameEn: "Content & Maintenance", priceJPY: 50000 },
  annual: { id: "annual", nameJa: "年間無制限サブスクリプション", nameEn: "Unlimited Annual", priceJPY: 200000 },
};

export function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
