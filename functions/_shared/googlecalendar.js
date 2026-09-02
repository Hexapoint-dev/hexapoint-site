// Shared helper: reads/writes events on the owner's Google Calendar for the
// admin panel's "予約カレンダー / Calendar" tab -- this is what lets the owner
// block a specific time slot (a personal appointment, anything) directly
// from the admin panel and have it (a) show up on their actual Google
// Calendar and (b) immediately stop being offered to clients, since Cal.com
// is already connected to this same calendar for conflict-checking
// (see SETUP-cloudflare.md section 12).
//
// Authenticates via the same Service Account as google.js (Search Console),
// with its own OAuth scope and cached token (see google-auth.js).
//
// Unlike Search Console/GA4 (where the service account is granted access via
// that product's own dashboard), Google Calendar access is granted by
// *sharing the calendar itself* with the service account's email:
//   Google Calendar -> Settings -> [your calendar] -> "Share with specific people"
//   -> add the service account's client_email -> permission "Make changes to events"
//
// Required env vars (in addition to the ones in google-auth.js):
//   GOOGLE_CALENDAR_ID   which calendar to read/write. Defaults to "primary"
//                        (the owner's main calendar) if unset -- set this
//                        explicitly only if a separate calendar is used for
//                        HexaPoint bookings instead of the personal one.

import { getGoogleAccessToken } from "./google-auth.js";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

function googleCalendarConfigured(env) {
  return !!(env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_KEY);
}

function calendarId(env) {
  return env.GOOGLE_CALENDAR_ID || "primary";
}

function getCalendarToken(env) {
  return getGoogleAccessToken(env, CALENDAR_SCOPE, "calendar");
}

async function calendarFetch(env, path, { method = "GET", body } = {}) {
  const accessToken = await getCalendarToken(env);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId(env))}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }
  );
  if (method === "DELETE") {
    // Google returns 204 (or 410 if it was already gone) with no body.
    if (!res.ok && res.status !== 410) {
      const data = await res.json().catch(() => null);
      throw new Error(`google_calendar_failed: ${res.status} ${JSON.stringify(data)}`);
    }
    return null;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error(`google_calendar_failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

// `timeMin`/`timeMax` are ISO instants. singleEvents expands recurring
// events into individual instances -- the admin panel only ever creates
// single (non-recurring) blocks, but the owner's calendar may already
// contain recurring personal events that still need to render correctly.
async function listEvents(env, { timeMin, timeMax }) {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const data = await calendarFetch(env, `/events?${params.toString()}`);
  return data.items || [];
}

async function createEvent(env, { summary, description, start, end, timeZone }) {
  return calendarFetch(env, "/events", {
    method: "POST",
    body: {
      summary,
      description,
      start: { dateTime: start, timeZone },
      end: { dateTime: end, timeZone },
    },
  });
}

async function updateEvent(env, eventId, { summary, description, start, end, timeZone }) {
  const patch = {};
  if (summary !== undefined) patch.summary = summary;
  if (description !== undefined) patch.description = description;
  if (start !== undefined) patch.start = { dateTime: start, timeZone };
  if (end !== undefined) patch.end = { dateTime: end, timeZone };
  return calendarFetch(env, `/events/${encodeURIComponent(eventId)}`, { method: "PATCH", body: patch });
}

async function deleteEvent(env, eventId) {
  await calendarFetch(env, `/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  return { ok: true };
}

export { googleCalendarConfigured, listEvents, createEvent, updateEvent, deleteEvent };
