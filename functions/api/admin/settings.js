// GET /api/admin/settings -> admin panel settings (Stripe fee % estimate,
// tax-breakdown visibility). Server-backed so they persist per-account
// instead of per-browser (previously localStorage-only, see admin.html).
// PUT  /api/admin/settings -> update one or both settings.
//
// Protected by the admin panel's password login — same requireAdmin() pattern
// as every other admin handler.

import { getSettings, setSetting, jsonResponse } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";

const DEFAULT_FEE_PCT = 3.6;

function toResponseShape(settings) {
  const feePct = Number(settings.stripe_fee_pct);
  return {
    feePct: Number.isFinite(feePct) ? feePct : DEFAULT_FEE_PCT,
    taxBreakdownShown: settings.tax_breakdown_shown !== "0",
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const settings = await getSettings(env);
    return jsonResponse({ ok: true, ...toResponseShape(settings) });
  } catch (err) {
    console.error("admin settings get error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}

export async function onRequestPut({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const body = await request.json();

    if (body.feePct !== undefined) {
      const feePct = Number(body.feePct);
      if (!Number.isFinite(feePct) || feePct < 0 || feePct > 20) {
        return jsonResponse({ ok: false, error: "invalid_fee_pct" }, 400);
      }
      await setSetting(env, "stripe_fee_pct", String(feePct));
    }

    if (body.taxBreakdownShown !== undefined) {
      await setSetting(env, "tax_breakdown_shown", body.taxBreakdownShown ? "1" : "0");
    }

    const settings = await getSettings(env);
    return jsonResponse({ ok: true, ...toResponseShape(settings) });
  } catch (err) {
    console.error("admin settings put error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
