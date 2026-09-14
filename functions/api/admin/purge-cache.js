// POST /api/admin/purge-cache
// Purges the entire Cloudflare edge cache for the site's custom domain --
// the same action as the "Purge Everything" button under Caching >
// Configuration in the Cloudflare dashboard. Useful right after a deploy
// when visitors are still seeing an old cached copy of the HTML/CSS/JS.
//
// Requires CLOUDFLARE_API_TOKEN to carry a Zone-scoped "Cache Purge: Purge"
// permission (a *different* permission scope than the Account-scoped ones
// used by status.js / pages-deploy-retry.js) plus CLOUDFLARE_ZONE_ID -- see
// _shared/cloudflare.js and SETUP-cloudflare.md.
//
// Protected by the admin panel's password login -- same requireAdmin()
// pattern as every other admin handler.

import { jsonResponse, logAdminAction } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";
import { purgeCache } from "../../_shared/cloudflare.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ZONE_ID) {
      return jsonResponse({ ok: false, error: "cloudflare_zone_not_configured" }, 500);
    }

    await purgeCache(env);
    await logAdminAction(env, "cache_purge", null, "purge_everything");

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("admin purge-cache error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
