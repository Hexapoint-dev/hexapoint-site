// Cloudflare Pages Function
// Endpoint: POST /api/cal-book
//
// Creates a booking on Cal.com for the free-consultation event type. Cal.com
// itself sends the confirmation email + calendar invite to both the visitor
// and the studio owner (via the owner's connected calendar), so this
// function only needs to validate input, check Turnstile, and forward the
// request with the secret CAL_API_KEY attached server-side.
//
// Requires (Cloudflare Pages -> Settings -> Environment variables):
//   CAL_API_KEY        - Cal.com API key (Settings -> Developer -> API keys)
//   CAL_EVENT_TYPE_ID   - numeric ID of the "free consultation" event type
//   TURNSTILE_SECRET_KEY - already used by /api/contact

import { verifyTurnstile } from "../_shared/turnstile.js";

const CAL_API_VERSION = "2026-02-25";

// Mirrors MIN_NOTICE_DAYS in index.html's booking widget and in
// cal-slots.js. Also set "Minimum notice" on the event type in the Cal.com
// dashboard to the same value — that's the authoritative check; this is a
// fast local rejection for requests that skip the front-end entirely.
const MIN_NOTICE_DAYS = 2;

function jstDateISO(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!env.CAL_API_KEY || !env.CAL_EVENT_TYPE_ID) {
      return json({ ok: false, error: "server_not_configured" }, 500);
    }

    const data = await request.json();
    const name = (data.name || "").toString().trim().slice(0, 200);
    const email = (data.email || "").toString().trim().slice(0, 200);
    const note = (data.note || "").toString().trim().slice(0, 2000);
    const start = (data.start || "").toString().trim();
    const attendeeTimeZone = (data.attendeeTimeZone || "Asia/Riyadh").toString().trim().slice(0, 100);
    const turnstileToken = (data.turnstileToken || "").toString();

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const startDate = new Date(start);
    if (!name || !email || !emailRe.test(email) || !start || Number.isNaN(startDate.getTime())) {
      return json({ ok: false, error: "invalid_input" }, 400);
    }
    if (startDate.getTime() < Date.now() - 60_000) {
      return json({ ok: false, error: "slot_in_past" }, 400);
    }
    const earliest = new Date(Date.now() + MIN_NOTICE_DAYS * 86400000);
    if (jstDateISO(startDate) < jstDateISO(earliest)) {
      return json({ ok: false, error: "too_soon" }, 400);
    }

    const turnstileResult = await verifyTurnstile(env, turnstileToken, request);
    if (!turnstileResult.ok) {
      return json({ ok: false, error: turnstileResult.error }, turnstileResult.status);
    }

    const calRes = await fetch("https://api.cal.com/v2/bookings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CAL_API_KEY}`,
        "cal-api-version": CAL_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        start,
        eventTypeId: Number(env.CAL_EVENT_TYPE_ID),
        attendee: { name, email, timeZone: attendeeTimeZone },
        bookingFieldsResponses: note ? { notes: note } : undefined,
      }),
    });

    const body = await calRes.json().catch(() => null);

    if (!calRes.ok || !body || body.status !== "success") {
      const message = (body && (body.error?.message || body.message)) || "";
      console.error("Cal.com booking error:", calRes.status, body);
      if (calRes.status === 409 || /no longer available|already booked/i.test(message)) {
        return json({ ok: false, error: "slot_taken" }, 409);
      }
      return json({ ok: false, error: "cal_error" }, 502);
    }

    return json({
      ok: true,
      uid: body.data.uid,
      start: body.data.start,
      end: body.data.end,
    });
  } catch (err) {
    console.error("cal-book function error:", err);
    return json({ ok: false, error: "server_error" }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
