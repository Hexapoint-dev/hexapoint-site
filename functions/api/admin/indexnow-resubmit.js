// POST /api/admin/indexnow-resubmit
// Manually resubmits pages to IndexNow-participating search engines (Bing,
// Yandex, Naver, Seznam -- and by extension ChatGPT Search, which retrieves
// from Bing's index), without needing to paste INDEXNOW_SECRET into a URL by
// hand in the browser (the manual method documented in SETUP-cloudflare.md
// section 6). Defaults to just the homepage; pass { urls: [...] } in the
// body to submit specific paths instead.
//
// Wraps the existing public /api/indexnow endpoint with an internal
// server-to-server call, authenticated with the admin session instead of
// the secret -- the actual IndexNow submission logic stays in one place
// (functions/api/indexnow.js) so there is nothing to keep in sync here.
//
// Protected by the admin panel's password login -- same requireAdmin()
// pattern as every other admin handler.

import { jsonResponse } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.INDEXNOW_SECRET) {
      return jsonResponse({ ok: false, error: "indexnow_secret_not_configured" }, 500);
    }

    let urls = ["/"];
    try {
      const body = await request.json();
      if (Array.isArray(body?.urls) && body.urls.length) urls = body.urls;
    } catch {
      // no/invalid body -- fall back to resubmitting the homepage only
    }

    const target = new URL("/api/indexnow", request.url);
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.INDEXNOW_SECRET}` },
      body: JSON.stringify({ urls }),
    });
    const data = await res.json().catch(() => null);

    return jsonResponse(data || { ok: false, error: "indexnow_unreachable" }, res.status);
  } catch (err) {
    console.error("admin indexnow-resubmit error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
