// GET /api/admin/search-console?range=7d|28d|90d (or &from=YYYY-MM-DD&to=YYYY-MM-DD)
// -> Google Search Console summary for the admin panel's Analytics tab.
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
import { googleConfigured, runSearchAnalyticsQuery, listSitemaps } from "../../_shared/google.js";

const RANGE_DAYS = { "7d": 7, "28d": 28, "90d": 90 };
const CACHE_TTL_SECONDS = 1800;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Search Console data isn't final for the most recent ~2-3 days -- anchoring
// a preset range's end date there (instead of "today") avoids a misleadingly
// empty tail on the trend chart. Custom ranges are taken as given, since the
// admin picking them presumably knows what they're looking for.
const REPORTING_LAG_DAYS = 3;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

function dateRangeFor(rangeKey, customFrom, customTo) {
  if (customFrom && customTo) {
    return { startDate: customFrom, endDate: customTo };
  }
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - REPORTING_LAG_DAYS);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (RANGE_DAYS[rangeKey] - 1));
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

// The equal-length period immediately preceding {startDate, endDate} -- used
// for the "vs previous period" comparison, the same idea as the Finance
// tab's month-over-month figure.
function previousPeriodFor({ startDate, endDate }) {
  const days = Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
  const prevEnd = addDays(startDate, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  return { startDate: prevStart, endDate: prevEnd };
}

const byClicksDesc = (a, b) => (b.clicks || 0) - (a.clicks || 0);

function totalsFromRows(rows) {
  const row = rows[0];
  return row
    ? {
        clicks: row.clicks || 0,
        impressions: row.impressions || 0,
        ctr: row.ctr || 0,
        position: row.position || 0,
      }
    : { clicks: 0, impressions: 0, ctr: 0, position: 0 };
}

async function loadSearchConsole(env, { startDate, endDate }) {
  const previous = previousPeriodFor({ startDate, endDate });

  const [totalsRows, previousTotalsRows, trendRows, queryRows, pageRows, deviceRows, countryRows, sitemapRows] =
    await Promise.all([
      runSearchAnalyticsQuery(env, { startDate, endDate }),
      runSearchAnalyticsQuery(env, { startDate: previous.startDate, endDate: previous.endDate }),
      runSearchAnalyticsQuery(env, { startDate, endDate, dimensions: ["date"], rowLimit: 100 }),
      runSearchAnalyticsQuery(env, { startDate, endDate, dimensions: ["query"], rowLimit: 25 }),
      runSearchAnalyticsQuery(env, { startDate, endDate, dimensions: ["page"], rowLimit: 25 }),
      runSearchAnalyticsQuery(env, { startDate, endDate, dimensions: ["device"], rowLimit: 10 }),
      runSearchAnalyticsQuery(env, { startDate, endDate, dimensions: ["country"], rowLimit: 10 }),
      listSitemaps(env),
    ]);

  return {
    startDate,
    endDate,
    previousStartDate: previous.startDate,
    previousEndDate: previous.endDate,
    totals: totalsFromRows(totalsRows),
    previousTotals: totalsFromRows(previousTotalsRows),
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
    sitemaps: sitemapRows.map((s) => ({
      path: s.path,
      lastDownloaded: s.lastDownloaded || null,
      isPending: !!s.isPending,
      warnings: Number(s.warnings || 0),
      errors: Number(s.errors || 0),
      contents: (s.contents || []).map((c) => ({
        type: c.type,
        submitted: Number(c.submitted || 0),
        indexed: Number(c.indexed || 0),
      })),
    })),
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
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const hasCustomRange =
      ISO_DATE_RE.test(fromParam) && ISO_DATE_RE.test(toParam) && fromParam <= toParam;
    const forceRefresh = url.searchParams.get("refresh") === "1";

    const dateRange = dateRangeFor(range, hasCustomRange ? fromParam : null, hasCustomRange ? toParam : null);

    // v3: bump this if the shape of loadSearchConsole()'s return value changes
    // again, so stale KV entries from an older shape don't get served as-is.
    const cacheKey = hasCustomRange
      ? `gsc:report:v3:custom:${dateRange.startDate}:${dateRange.endDate}`
      : `gsc:report:v3:${range}`;

    if (!forceRefresh && env.ORDERS_KV) {
      const cached = await env.ORDERS_KV.get(cacheKey, "json");
      if (cached) return jsonResponse({ ok: true, range, cached: true, ...cached });
    }

    const data = await loadSearchConsole(env, dateRange);

    if (env.ORDERS_KV) {
      await env.ORDERS_KV.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL_SECONDS });
    }

    return jsonResponse({ ok: true, range, cached: false, ...data });
  } catch (err) {
    console.error("admin search-console error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
