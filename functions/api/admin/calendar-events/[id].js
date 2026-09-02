// PATCH  /api/admin/calendar-events/:id -> edit an event (time/title/notes)
// DELETE /api/admin/calendar-events/:id -> delete an event
//
// Protected by the admin panel's password login — see calendar-events.js / admin-auth.js.
// :id is the Google Calendar event ID (opaque string), not a local DB id --
// this tab has no database of its own, Google Calendar is the only store.

import { jsonResponse } from "../../../_shared/db.js";
import { requireAdmin } from "../../../_shared/admin-auth.js";
import { googleCalendarConfigured, updateEvent, deleteEvent } from "../../../_shared/googlecalendar.js";

export async function onRequestPatch({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!googleCalendarConfigured(env)) {
      return jsonResponse({ ok: false, error: "google_calendar_not_configured" }, 501);
    }

    const body = await request.json();
    const patch = {};
    if (body.summary !== undefined) patch.summary = String(body.summary).trim().slice(0, 200) || "予定 / Block";
    if (body.description !== undefined) patch.description = String(body.description).slice(0, 2000);
    if (body.start !== undefined) patch.start = String(body.start);
    if (body.end !== undefined) patch.end = String(body.end);
    if (body.timeZone !== undefined) patch.timeZone = String(body.timeZone).slice(0, 100);

    if ((patch.start !== undefined) !== (patch.end !== undefined)) {
      return jsonResponse({ ok: false, error: "start_and_end_must_be_updated_together" }, 400);
    }

    const event = await updateEvent(env, params.id, patch);
    return jsonResponse({ ok: true, event });
  } catch (err) {
    console.error("admin calendar-events update error:", err);
    return jsonResponse({ ok: false, error: "server_error", detail: String(err) }, 500);
  }
}

export async function onRequestDelete({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!googleCalendarConfigured(env)) {
      return jsonResponse({ ok: false, error: "google_calendar_not_configured" }, 501);
    }

    await deleteEvent(env, params.id);
    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("admin calendar-events delete error:", err);
    return jsonResponse({ ok: false, error: "server_error", detail: String(err) }, 500);
  }
}
