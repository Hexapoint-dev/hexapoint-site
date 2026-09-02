// GET /api/admin/search-console?range=7d|28d|90d -> Google Search Console
// summary for the admin panel's Analytics tab.
//
// Protected by the admin panel's password login (functions/_shared/admin-auth.js),
// same pattern as stats.js / finance.js. Also sits behind Cloudflare Access at
// the edge (see SETUP-cloudflare.md), so this is a third layer, not the only one.
//
// Results are cached in ORDERS_KV for 30 minutes per range -- Search Console
// data already lags 2-3 days behind real time, so there's no benefit to
// fetching it more often, and it keeps us well inside the API's query quota.

import { jsonResponse } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";
import { googleConfigured, runSearchAnalyticsQuery } from "../../_shared/google.js";

const RANGE_DAYS = { "7d": 7, "28d": 28, "90d": 90 };
const CACHE_TTL_SECONDS = 1800;

// Search Console data isn't final for the most recent ~2-3 days -- anchoring
// the range's end date there (instead of "today") avoids a misleadingly
// empty tail on the trend chart.
const REPORTING_LAG_DAYS = 3;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function dateRangeFor(rangeKey) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - REPORTING_LAG_DAYS);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (RANGE_DAYS[rangeKey] - 1));
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

const byClicksDesc = (a, b) => (b.clicks || 0) - (a.clicks || 0);

async function loadSearchConsole(env, rangeKey) {
  const { startDate, endDate } = dateRangeFor(rangeKey);

  const [totalsRows, trendRows, queryRows, pageRows, deviceRows, countryRows] = await Promise.all([
    runSearchAnalyticsQuery(env, { startDate, endDate }),
    runSearchAnalyticsQuery(env, { startDate, endDate, dimensions: ["date"], rowLimit: 100 }),
    runSearchAnalyticsQuery(env, { startDate, endDate, dimensions: ["query"], rowLimit: 25 }),
    runSearchAnalyticsQuery(env, { startDate, endDate, dimensions: ["page"], rowLimit: 25 }),
    runSearchAnalyticsQuery(env, { startDate, endDate, dimensions: ["device"], rowLimit: 10 }),
    runSearchAnalyticsQuery(env, { startDate, endDate, dimensions: ["country"], rowLimit: 10 }),
  ]);

  const totalsRow = totalsRows[0];
  const totals = totalsRow
    ? {
        clicks: totalsRow.clicks || 0,
        impressions: totalsRow.impressions || 0,
        ctr: totalsRow.ctr || 0,
        position: totalsRow.position || 0,
      }
    : { clicks: 0, impressions: 0, ctr: 0, position: 0 };

  return {
    startDate,
    endDate,
    totals,
    trend: trendRows
      .map((r) => ({ date: r.keys[0], clicks: r.clicks || 0 }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
    topQueries: queryRows
      .sort(byClicksDesc)
      .slice(0, 10)
      .map((r) => ({ query: r.keys[0], clicks: r.clicks || 0, impressions: r.impressions || 0 })),
    topPages: pageRows
      .sort(byClicksDesc)
      .slice(0, 10)
      .map((r) => ({ page: r.keys[0], clicks: r.clicks || 0, impressions: r.impressions || 0 })),
    devices: deviceRows
      .sort(byClicksDesc)
      .map((r) => ({ device: String(r.keys[0]).toLowerCase(), clicks: r.clicks || 0 })),
    countries: countryRows
      .sort(byClicksDesc)
      .slice(0, 10)
      .map((r) => ({ country: r.keys[0], clicks: r.clicks || 0 })),
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!googleConfigured(env)) {
      return jsonResponse({ ok: false, error: "google_not_configured" }, 501);
    }

    const url = new URL(request.url);
    const range = RANGE_DAYS[url.searchParams.get("range")] ? url.searchParams.get("range") : "28d";
    const forceRefresh = url.searchParams.get("refresh") === "1";

    const cacheKey = `gsc:report:${range}`;
    if (!forceRefresh && env.ORDERS_KV) {
      const cached = await env.ORDERS_KV.get(cacheKey, "json");
      if (cached) return jsonResponse({ ok: true, range, cached: true, ...cached });
    }

    const data = await loadSearchConsole(env, range);

    if (env.ORDERS_KV) {
      await env.ORDERS_KV.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL_SECONDS });
    }

    return jsonResponse({ ok: true, range, cached: false, ...data });
  } catch (err) {
    console.error("admin search-console error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
