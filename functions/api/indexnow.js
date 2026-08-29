// Cloudflare Pages Function
// Endpoint: /api/indexnow   (accepts GET and POST)
//
// Notifies IndexNow-participating search engines (Bing, Yandex, Naver, Seznam —
// and by extension ChatGPT Search, which retrieves from Bing's index) that pages
// on this site have been added or updated, instead of waiting to be crawled.
//
// ----------------------------------------------------------------------------
// REQUIRED SETUP (Cloudflare dashboard -> your Pages project -> Settings ->
// Environment variables):
//
//   INDEXNOW_KEY      c96a412c5d41125143ea5fa42129051f
//                     (must match the filename of the key .txt file in the
//                      site root, and that file's contents)
//
//   INDEXNOW_SECRET   any long random string you invent
//                     (this is NOT the IndexNow key — it is a private password
//                      so that strangers cannot spam submissions on your behalf)
//
// Optional:
//   SITE_ORIGIN       https://hexapoint.pages.dev
//                     Only needed if you later attach a custom domain and want
//                     submissions to use it. Defaults to the request's own origin.
// ----------------------------------------------------------------------------
//
// USAGE
//   Submit the homepage:
//     https://hexapoint.pages.dev/api/indexnow?secret=YOUR_SECRET
//
//   Submit specific pages:
//     POST /api/indexnow?secret=YOUR_SECRET
//     { "urls": ["/", "/blog/first-post"] }
//
// Relative paths are resolved against the site origin. Absolute URLs must belong
// to this host — IndexNow rejects cross-host submissions.

const ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS = 100;

export async function onRequest(context) {
  const { request, env } = context;

  if (!["GET", "POST"].includes(request.method)) {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  // ---- config checks -------------------------------------------------------
  if (!env.INDEXNOW_KEY) {
    return json({ ok: false, error: "indexnow_key_not_configured" }, 500);
  }
  if (!env.INDEXNOW_SECRET) {
    return json({ ok: false, error: "indexnow_secret_not_configured" }, 500);
  }

  // ---- auth ----------------------------------------------------------------
  const url = new URL(request.url);
  const provided =
    url.searchParams.get("secret") ||
    (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");

  if (!timingSafeEqual(provided, env.INDEXNOW_SECRET)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // ---- work out which URLs to submit --------------------------------------
  const origin = (env.SITE_ORIGIN || url.origin).replace(/\/+$/, "");
  const host = new URL(origin).host;

  let requested = ["/"];
  if (request.method === "POST") {
    try {
      const body = await request.json();
      if (Array.isArray(body?.urls) && body.urls.length) requested = body.urls;
    } catch {
      return json({ ok: false, error: "invalid_json_body" }, 400);
    }
  } else {
    const q = url.searchParams.get("url");
    if (q) requested = q.split(",");
  }

  const urlList = [];
  const rejected = [];
  for (const raw of requested.slice(0, MAX_URLS)) {
    const item = String(raw).trim();
    if (!item) continue;
    let abs;
    try {
      abs = new URL(item, origin + "/").toString();
    } catch {
      rejected.push({ url: item, reason: "unparseable" });
      continue;
    }
    if (new URL(abs).host !== host) {
      rejected.push({ url: item, reason: "host_mismatch" });
      continue;
    }
    if (!urlList.includes(abs)) urlList.push(abs);
  }

  if (!urlList.length) {
    return json({ ok: false, error: "no_valid_urls", rejected }, 400);
  }

  // ---- submit --------------------------------------------------------------
  const payload = {
    host,
    key: env.INDEXNOW_KEY,
    keyLocation: `${origin}/${env.INDEXNOW_KEY}.txt`,
    urlList,
  };

  let status, detail;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
    status = res.status;
    detail = (await res.text()).slice(0, 500);
  } catch (err) {
    console.error("IndexNow request failed:", err);
    return json({ ok: false, error: "upstream_unreachable" }, 502);
  }

  // IndexNow returns 200 (accepted) or 202 (accepted, key validation pending).
  const accepted = status === 200 || status === 202;
  if (!accepted) console.error("IndexNow rejected:", status, detail);

  return json(
    {
      ok: accepted,
      indexnowStatus: status,
      meaning: explain(status),
      submitted: urlList,
      keyLocation: payload.keyLocation,
      ...(rejected.length ? { rejected } : {}),
      ...(accepted ? {} : { detail }),
    },
    accepted ? 200 : 502
  );
}

function explain(status) {
  switch (status) {
    case 200: return "Accepted — search engines were notified.";
    case 202: return "Accepted, key validation pending. Confirm the key .txt file is reachable in the site root.";
    case 400: return "Bad request — malformed URL list.";
    case 403: return "Forbidden — key not found or does not match the hosted key file.";
    case 422: return "Unprocessable — a URL does not belong to this host, or the key does not match.";
    case 429: return "Too many requests — slow down and retry later.";
    default:  return "Unexpected response from IndexNow.";
  }
}

// Constant-time-ish comparison so the secret can't be guessed byte by byte.
function timingSafeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
