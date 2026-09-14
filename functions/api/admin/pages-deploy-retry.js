// POST /api/admin/pages-deploy-retry
// Retries the most recent Cloudflare Pages deployment for this project --
// the same action as the "Retry deployment" button in the Cloudflare
// dashboard, exposed here so recovering from a failed build doesn't require
// dashboard access. Always retries the *latest* deployment (there's no
// picker in the admin panel); to retry an older one, use the dashboard.
//
// Requires CLOUDFLARE_API_TOKEN to carry "Cloudflare Pages:Edit" permission
// (the read-only token used for the System Status usage numbers is not
// enough on its own) plus CLOUDFLARE_ACCOUNT_ID and
// CLOUDFLARE_PAGES_PROJECT_NAME -- see _shared/cloudflare.js and
// SETUP-cloudflare.md section 11.
//
// Protected by the admin panel's password login -- same requireAdmin()
// pattern as every other admin handler.

import { jsonResponse, logAdminAction } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";
import { cloudflareConfigured, getLatestPagesDeployment, retryPagesDeployment } from "../../_shared/cloudflare.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!cloudflareConfigured(env) || !env.CLOUDFLARE_PAGES_PROJECT_NAME) {
      return jsonResponse({ ok: false, error: "cloudflare_not_configured" }, 500);
    }

    const latest = await getLatestPagesDeployment(env);
    if (!latest) return jsonResponse({ ok: false, error: "no_deployments_found" }, 404);

    const result = await retryPagesDeployment(env, latest.id);
    await logAdminAction(env, "pages_deploy_retry", null, `deployment ${result.id}`);

    return jsonResponse({ ok: true, deploymentId: result.id });
  } catch (err) {
    console.error("admin pages-deploy-retry error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
