// Shared helper: calls the Cal.com API v2 to read/write the free-consultation
// event type's availability schedule (working hours + date-specific
// overrides), for the admin panel's "予約カレンダー / Calendar" tab. Lets the
// owner manage their schedule from our own admin panel instead of having to
// log into Cal.com's dashboard for routine changes.
//
// Uses the same CAL_API_KEY as cal-slots.js / cal-book.js. Cal.com pins a
// different API version per endpoint (compare cal-slots.js's "2024-09-04" to
// cal-book.js's "2026-02-25") -- CAL_API_VERSION below is this integration's
// best-known value for the Schedules endpoints. If Cal.com rejects a request
// citing the version header, that's the first thing to try changing.
//
// Required env var (in addition to CAL_API_KEY, already set up for booking):
//   CAL_SCHEDULE_ID   the numeric ID of the availability schedule used by the
//                     free-consultation event type -- found in the URL when
//                     editing it at Cal.com -> Availability (e.g.
//                     app.cal.com/availability/12345 -> 12345)

const CAL_API_VERSION = "2024-06-11";

function calcomConfigured(env) {
  return !!(env.CAL_API_KEY && env.CAL_SCHEDULE_ID);
}

async function calFetch(env, path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.cal.com/v2${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.CAL_API_KEY}`,
      "cal-api-version": CAL_API_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.status !== "success") {
    throw new Error(`calcom_api_failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data.data;
}

async function getSchedule(env) {
  return calFetch(env, `/schedules/${env.CAL_SCHEDULE_ID}`);
}

async function updateSchedule(env, patch) {
  return calFetch(env, `/schedules/${env.CAL_SCHEDULE_ID}`, { method: "PATCH", body: patch });
}

export { calcomConfigured, getSchedule, updateSchedule };
