// Shared helper: calls the Google Search Console API from the admin panel's
// Analytics tab, authenticating via the Google Cloud Service Account set up
// in google-auth.js.
//
// Required env vars (in addition to the ones in google-auth.js):
//   SEARCH_CONSOLE_SITE_URL   the verified property identifier exactly as it
//                             appears in Search Console, e.g. "sc-domain:hexapoint-jp.com"
//                             for a Domain property (the kind used by this site --
//                             see SETUP-cloudflare.md section 7).
//
// See SETUP-cloudflare.md for the one-time Google Cloud + Search Console setup steps.

import { getGoogleAccessToken } from "./google-auth.js";

const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

function googleConfigured(env) {
  return !!(env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_KEY && env.SEARCH_CONSOLE_SITE_URL);
}

function getSearchConsoleToken(env) {
  return getGoogleAccessToken(env, SEARCH_CONSOLE_SCOPE, "search-console");
}

// Runs one Search Console "searchAnalytics.query" call. Omitting `dimensions`
// returns a single aggregate row (no `keys`) covering the whole date range --
// used for the KPI totals. Returns the raw rows; callers reshape them.
async function runSearchAnalyticsQuery(env, { startDate, endDate, dimensions = [], rowLimit = 25 }) {
  const accessToken = await getSearchConsoleToken(env);
  const siteUrl = encodeURIComponent(env.SEARCH_CONSOLE_SITE_URL);
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${siteUrl}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ startDate, endDate, dimensions, rowLimit }),
    }
  );
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error(`search_console_query_failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data.rows || [];
}

// Lists the sitemaps submitted for the property, each with its last-read
// date and submitted/indexed counts -- used by the admin Analytics tab to
// show whether Google actually picked up sitemap.xml (see SETUP-cloudflare.md
// section 7) rather than just guessing from the search traffic numbers.
async function listSitemaps(env) {
  const accessToken = await getSearchConsoleToken(env);
  const siteUrl = encodeURIComponent(env.SEARCH_CONSOLE_SITE_URL);
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${siteUrl}/sitemaps`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error(`search_console_sitemaps_failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data.sitemap || [];
}

export { googleConfigured, runSearchAnalyticsQuery, listSitemaps };
