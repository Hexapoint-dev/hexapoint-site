// Shared helper: authenticates as a Google Cloud Service Account (JWT Bearer
// flow, RFC 7523) to call the Google Search Console API from the admin
// panel's Analytics tab. Same token-caching shape as zoho.js, but the token
// exchange itself is a self-signed JWT instead of a stored refresh token,
// since Google's server-to-server APIs use service accounts, not per-app
// OAuth clients.
//
// Required env vars (Cloudflare Pages -> Settings -> Environment variables):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL    the service account's "client_email" field
//   GOOGLE_SERVICE_ACCOUNT_KEY      the service account's "private_key" field (PEM).
//                                   Paste it exactly as it appears in the downloaded
//                                   JSON (including the BEGIN/END lines) -- Cloudflare's
//                                   env var textarea accepts real newlines. If pasted as
//                                   a single line with literal "\n" sequences instead,
//                                   this code un-escapes them automatically.
//   SEARCH_CONSOLE_SITE_URL         the verified property identifier exactly as it
//                                   appears in Search Console, e.g. "sc-domain:hexapoint-jp.com"
//                                   for a Domain property (the kind used by this site --
//                                   see SETUP-cloudflare.md section 7).
//
// See SETUP-cloudflare.md for the one-time Google Cloud + Search Console setup steps.

const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

function googleConfigured(env) {
  return !!(env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_KEY && env.SEARCH_CONSOLE_SITE_URL);
}

function base64url(bytes) {
  let str;
  if (typeof bytes === "string") {
    str = btoa(bytes);
  } else {
    str = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  }
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem) {
  const normalized = pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
  const body = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function signJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: SEARCH_CONSOLE_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const signingInput = base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(claims));
  const key = await importPrivateKey(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  return signingInput + "." + base64url(signature);
}

// Access tokens last 3600s; cache for 3300s (55min), same margin as Zoho's.
async function getGoogleAccessToken(env) {
  const cacheKey = "google:access_token";
  if (env.ORDERS_KV) {
    const cached = await env.ORDERS_KV.get(cacheKey);
    if (cached) return cached;
  }

  const assertion = await signJwt(env);
  const params = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json().catch(() => null);

  if (!res.ok || !data || !data.access_token) {
    throw new Error(`google_token_failed: ${res.status} ${JSON.stringify(data)}`);
  }

  if (env.ORDERS_KV) {
    await env.ORDERS_KV.put(cacheKey, data.access_token, { expirationTtl: 3300 });
  }
  return data.access_token;
}

// Runs one Search Console "searchAnalytics.query" call. Omitting `dimensions`
// returns a single aggregate row (no `keys`) covering the whole date range --
// used for the KPI totals. Returns the raw rows; callers reshape them.
async function runSearchAnalyticsQuery(env, { startDate, endDate, dimensions = [], rowLimit = 25 }) {
  const accessToken = await getGoogleAccessToken(env);
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
  const accessToken = await getGoogleAccessToken(env);
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
