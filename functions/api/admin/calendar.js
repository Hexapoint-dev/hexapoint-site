// GET   /api/admin/calendar -> the free-consultation event type's availability
//                              schedule (working hours + date overrides)
// PATCH /api/admin/calendar -> update it
//
// Protected by the admin panel's password login (functions/_shared/admin-auth.js),
// same pattern as stats.js / finance.js. Also sits behind Cloudflare Access at
// the edge (see SETUP-cloudflare.md), so this is a third layer, not the only one.
//
// No caching here (unlike analytics/status) -- this is a low-traffic settings
// screen the owner edits directly, and showing anything but the live Cal.com
// state while editing it would be actively confusing.

import { jsonResponse } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";
import { calcomConfigured, getSchedule, updateSchedule } from "../../_shared/calcom.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!calcomConfigured(env)) {
      return jsonResponse({ ok: false, error: "calcom_not_configured" }, 501);
    }

    const schedule = await getSchedule(env);
    return jsonResponse({ ok: true, schedule });
  } catch (err) {
    console.error("admin calendar get error:", err);
    return jsonResponse({ ok: false, error: "server_error", detail: String(err) }, 500);
  }
}

export async function onRequestPatch({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!calcomConfigured(env)) {
      return jsonResponse({ ok: false, error: "calcom_not_configured" }, 501);
    }

    const body = await request.json();
    const patch = {};
    if (Array.isArray(body.availability)) patch.availability = body.availability;
    if (Array.isArray(body.overrides)) patch.overrides = body.overrides;
    if (!Object.keys(patch).length) {
      return jsonResponse({ ok: false, error: "nothing_to_update" }, 400);
    }

    const schedule = await updateSchedule(env, patch);
    return jsonResponse({ ok: true, schedule });
  } catch (err) {
    console.error("admin calendar update error:", err);
    return jsonResponse({ ok: false, error: "server_error", detail: String(err) }, 500);
  }
}
