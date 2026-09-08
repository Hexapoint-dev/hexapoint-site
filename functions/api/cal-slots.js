// Cloudflare Pages Function
// Endpoint: GET /api/cal-slots?date=YYYY-MM-DD
//
// Proxies Cal.com's v2 slots endpoint so the browser never sees CAL_API_KEY.
// "date" is a calendar day in Asia/Tokyo (the studio's home timezone) — the
// function asks Cal.com for every open slot inside that JST day and returns
// their raw UTC instants. The front-end then renders each instant in both
// Asia/Tokyo and Asia/Riyadh; no timezone math happens on the server.
//
// Requires (Cloudflare Pages -> Settings -> Environment variables):
//   CAL_API_KEY        - Cal.com API key (Settings -> Developer -> API keys)
//   CAL_EVENT_TYPE_ID   - numeric ID of the "free consultation" event type

const CAL_API_VERSION = "2024-09-04";

// Mirrors the MIN_NOTICE_DAYS constant in index.html's booking widget, and
// should match the "Minimum notice" configured on the event type in the
// Cal.com dashboard (that's the authoritative check — this is a fast local
// rejection for requests that skip the front-end entirely).
const MIN_NOTICE_DAYS = 2;

function jstDateISO(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    if (!env.CAL_API_KEY || !env.CAL_EVENT_TYPE_ID) {
      return json({ ok: false, error: "server_not_configured" }, 500);
    }

    const url = new URL(request.url);
    const date = (url.searchParams.get("date") || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json({ ok: false, error: "invalid_date" }, 400);
    }

    // Requests for a date inside the minimum-notice window are treated the
    // same as a fully-booked day (empty slots) rather than an error — the
    // front-end's date strip never offers these dates in the first place.
    const earliest = new Date(Date.now() + MIN_NOTICE_DAYS * 86400000);
    if (date < jstDateISO(earliest)) {
      return json({ ok: true, slots: [] });
    }

    const start = `${date}T00:00:00+09:00`;
    const end = `${date}T23:59:59+09:00`;

    const calUrl = new URL("https://api.cal.com/v2/slots");
    calUrl.searchParams.set("eventTypeId", env.CAL_EVENT_TYPE_ID);
    calUrl.searchParams.set("start", start);
    calUrl.searchParams.set("end", end);
    calUrl.searchParams.set("timeZone", "Asia/Tokyo");
    calUrl.searchParams.set("format", "range");

    const calRes = await fetch(calUrl.toString(), {
      headers: {
        Authorization: `Bearer ${env.CAL_API_KEY}`,
        "cal-api-version": CAL_API_VERSION,
      },
    });

    const body = await calRes.json().catch(() => null);
    if (!calRes.ok || !body || body.status !== "success") {
      console.error("Cal.com slots error:", calRes.status, body);
      return json({ ok: false, error: "cal_error" }, 502);
    }

    // body.data is keyed by date ("2050-09-05": [{start,end}, ...]) — flatten,
    // since a slot near midnight JST can technically land on the adjacent key.
    const slots = Object.values(body.data || {})
      .flat()
      .map((s) => ({ start: s.start, end: s.end }))
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    return json({ ok: true, slots });
  } catch (err) {
    console.error("cal-slots function error:", err);
    return json({ ok: false, error: "server_error" }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
