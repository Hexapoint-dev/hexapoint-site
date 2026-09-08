// PUT /api/admin/resend-usage -> manually correct today's/this month's Resend
// send counters (functions/_shared/usage.js), for when the self-tracked
// count drifts from Resend's own dashboard (Settings -> Usage). Resend's API
// has no endpoint to read that number back automatically -- see usage.js --
// so this is a manual correction tool, not a sync.
//
// Protected by the admin panel's password login, same requireAdmin() pattern
// as every other admin handler.

import { jsonResponse } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";
import { setResendUsage } from "../../_shared/usage.js";

function validCount(n) {
  return Number.isInteger(n) && n >= 0;
}

export async function onRequestPut({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.ORDERS_KV) return jsonResponse({ ok: false, error: "kv_not_configured" }, 500);

    const body = await request.json();
    const update = {};

    if (body.sentToday !== undefined) {
      const n = Number(body.sentToday);
      if (!validCount(n)) return jsonResponse({ ok: false, error: "invalid_sent_today" }, 400);
      update.sentToday = n;
    }
    if (body.sentThisMonth !== undefined) {
      const n = Number(body.sentThisMonth);
      if (!validCount(n)) return jsonResponse({ ok: false, error: "invalid_sent_this_month" }, 400);
      update.sentThisMonth = n;
    }
    if (!("sentToday" in update) && !("sentThisMonth" in update)) {
      return jsonResponse({ ok: false, error: "nothing_to_update" }, 400);
    }

    await setResendUsage(env, update);
    return jsonResponse({ ok: true, ...update });
  } catch (err) {
    console.error("admin resend-usage put error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
