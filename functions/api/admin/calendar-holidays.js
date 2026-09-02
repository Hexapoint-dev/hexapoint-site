// GET /api/admin/calendar-holidays?start=ISO&end=ISO -> Japan + Saudi Arabia
// national holidays in that range, for the admin panel's Calendar tab grid.
//
// Protected by the admin panel's password login (functions/_shared/admin-auth.js).
// Reuses the same Google Calendar service-account token as calendar-events.js
// (see SETUP-cloudflare.md section 12) -- these are Google's public holiday
// calendars, so no extra sharing step is needed.
//
// `japan` and `saudi` are independent: if one calendar ID is wrong/renamed,
// that key comes back as {error} while the other still returns its list --
// a bad guess on one country's calendar ID shouldn't take down the other.
//
// NOTE: Japan's public holiday calendar ID ("ja.japanese#holiday@group.v.calendar.google.com")
// is well-established. Saudi Arabia's ("en.sa#holiday@group.v.calendar.google.com")
// is this integration's best guess at Google's naming convention -- if `saudi`
// comes back with an error, share the exact error text so the ID can be corrected.

import { jsonResponse } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";
import { googleCalendarConfigured, listJapanHolidays, listSaudiHolidays } from "../../_shared/googlecalendar.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!googleCalendarConfigured(env)) {
      return jsonResponse({ ok: false, error: "google_calendar_not_configured" }, 501);
    }

    const url = new URL(request.url);
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    if (!start || !end) {
      return jsonResponse({ ok: false, error: "missing_range" }, 400);
    }

    const [japan, saudi] = await Promise.all([
      listJapanHolidays(env, { timeMin: start, timeMax: end }).catch((err) => ({ error: String(err) })),
      listSaudiHolidays(env, { timeMin: start, timeMax: end }).catch((err) => ({ error: String(err) })),
    ]);

    return jsonResponse({ ok: true, japan, saudi });
  } catch (err) {
    console.error("admin calendar-holidays error:", err);
    return jsonResponse({ ok: false, error: "server_error", detail: String(err) }, 500);
  }
}
