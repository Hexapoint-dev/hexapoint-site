// GET  /api/admin/calendar-events?start=ISO&end=ISO -> events in that range
// POST /api/admin/calendar-events                   -> create an event (a "block")
//
// Protected by the admin panel's password login (functions/_shared/admin-auth.js),
// same pattern as stats.js / finance.js. Also sits behind Cloudflare Access at
// the edge (see SETUP-cloudflare.md), so this is a third layer, not the only one.
//
// No caching here -- the whole point of this tab is that it's the live,
// current state of the owner's actual Google Calendar.

import { jsonResponse } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";
import { googleCalendarConfigured, listEvents, createEvent } from "../../_shared/googlecalendar.js";

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

    const events = await listEvents(env, { timeMin: start, timeMax: end });
    return jsonResponse({ ok: true, events });
  } catch (err) {
    console.error("admin calendar-events list error:", err);
    return jsonResponse({ ok: false, error: "server_error", detail: String(err) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!googleCalendarConfigured(env)) {
      return jsonResponse({ ok: false, error: "google_calendar_not_configured" }, 501);
    }

    const body = await request.json();
    const summary = (body.summary || "").toString().trim().slice(0, 200) || "予定 / Block";
    const description = (body.description || "").toString().slice(0, 2000);
    const start = (body.start || "").toString();
    const end = (body.end || "").toString();
    const timeZone = (body.timeZone || "Asia/Tokyo").toString().slice(0, 100);

    if (!start || !end || Number.isNaN(new Date(start).getTime()) || Number.isNaN(new Date(end).getTime())) {
      return jsonResponse({ ok: false, error: "invalid_input" }, 400);
    }

    const event = await createEvent(env, { summary, description, start, end, timeZone });
    return jsonResponse({ ok: true, event }, 201);
  } catch (err) {
    console.error("admin calendar-events create error:", err);
    return jsonResponse({ ok: false, error: "server_error", detail: String(err) }, 500);
  }
}
