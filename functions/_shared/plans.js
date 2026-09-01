// Shared, payment-provider-agnostic helpers used across bank-order.js and every
// stripe-*.js Function.
//
// IMPORTANT: Plan prices are resolved here on the SERVER, not trusted from the browser.
// The frontend only sends a planId ("basic" | "maintenance" | "annual", or any custom
// id an admin has added); the actual amount charged always comes from getPlan()/D1
// (migrations/0006_plans.sql), so a visitor cannot tamper with the price.

// Fallback only — used if env.DB is missing or a D1 query fails/returns nothing,
// so a database hiccup never breaks checkout. Kept in sync with the seed values
// in migrations/0006_plans.sql, but the `plans` table is the actual source of
// truth once that migration has run (admin-editable via /api/admin/plans).
export const DEFAULT_PLANS = {
  basic: { id: "basic", nameJa: "基本デザインプラン", nameEn: "Basic Design", priceJPY: 100000 },
  maintenance: { id: "maintenance", nameJa: "コンテンツ変更・保守プラン", nameEn: "Content & Maintenance", priceJPY: 50000 },
  annual: { id: "annual", nameJa: "年間無制限サブスクリプション", nameEn: "Unlimited Annual", priceJPY: 200000 },
};

function rowToPlan(row) {
  return { id: row.id, nameJa: row.name_ja, nameEn: row.name_en, priceJPY: row.price_jpy };
}

export async function getPlan(env, id) {
  if (!id) return null;
  if (env && env.DB) {
    try {
      const row = await env.DB.prepare("SELECT * FROM plans WHERE id = ?").bind(id).first();
      if (row) return rowToPlan(row);
    } catch (err) {
      console.error("getPlan D1 query failed, falling back to DEFAULT_PLANS:", err);
    }
  }
  return DEFAULT_PLANS[id] || null;
}

export async function listActivePlans(env) {
  if (env && env.DB) {
    try {
      const result = await env.DB.prepare("SELECT * FROM plans WHERE active = 1 ORDER BY sort_order ASC").all();
      if (result.results && result.results.length) return result.results.map(rowToPlan);
    } catch (err) {
      console.error("listActivePlans D1 query failed, falling back to DEFAULT_PLANS:", err);
    }
  }
  return Object.values(DEFAULT_PLANS);
}

export function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
