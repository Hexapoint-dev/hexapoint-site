// GET /api/admin/status -> free-plan usage across every external service
// this site depends on, for the admin panel's "System Status" tab:
//   - Zoho Invoice (invoices created this year, counted from our own DB --
//     Zoho's API has no "remaining quota" field, but we're the only thing
//     creating these invoices, so our own record is authoritative)
//   - Resend (emails sent today/this month, self-tracked -- see _shared/usage.js)
//   - Cloudflare D1 / KV / Pages builds (via the Cloudflare API -- see
//     _shared/cloudflare.js for the required separate API token)
//
// Protected by the admin panel's password login (functions/_shared/admin-auth.js),
// same pattern as stats.js / finance.js. Also sits behind Cloudflare Access at
// the edge (see SETUP-cloudflare.md), so this is a third layer, not the only one.
//
// Each section is independent and wrapped in its own try/catch: a
// misconfigured or not-yet-set-up integration shows an error for that
// section only, instead of taking down the whole tab.

import { jsonResponse } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";
import { zohoConfigured } from "../../_shared/zoho.js";
import { getResendUsage } from "../../_shared/usage.js";
import { cloudflareConfigured, getD1Usage, getKvUsage, getPagesBuildsThisMonth } from "../../_shared/cloudflare.js";

const CACHE_TTL_SECONDS = 900; // 15 minutes -- this is an ops check, not live traffic

// Zoho Invoice's free-plan invoice cap varies by account/signup date, so it's
// configurable rather than hardcoded -- set ZOHO_FREE_PLAN_INVOICE_LIMIT to
// whatever your actual plan allows (check Zoho's pricing page or account
// settings, since this code can't look that up for you).
const DEFAULT_ZOHO_INVOICE_LIMIT = 1000;

async function getZohoUsage(env) {
  const configured = zohoConfigured(env);
  if (!env.DB) return { configured, invoicesThisYear: 0, limit: DEFAULT_ZOHO_INVOICE_LIMIT, error: "db_not_configured" };

  const yearStart = `${new Date().getUTCFullYear()}-01-01 00:00:00`;
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS cnt FROM orders WHERE zoho_status = 'created' AND created_at >= ?`
  ).bind(yearStart).first();

  const limit = Number(env.ZOHO_FREE_PLAN_INVOICE_LIMIT) || DEFAULT_ZOHO_INVOICE_LIMIT;
  return { configured, invoicesThisYear: (row && row.cnt) || 0, limit, year: new Date().getUTCFullYear() };
}

// Resend's free plan is 100 emails/day, 3,000/month as of when this was
// written -- verify against https://resend.com/pricing if this looks stale.
const RESEND_FREE_LIMITS = { dailyLimit: 100, monthlyLimit: 3000 };

async function loadStatus(env) {
  const [zoho, resendUsage] = await Promise.all([
    getZohoUsage(env).catch((err) => ({ error: String(err) })),
    getResendUsage(env).catch((err) => ({ error: String(err) })),
  ]);

  const resend = { ...resendUsage, limits: RESEND_FREE_LIMITS };

  const cloudflare = { configured: cloudflareConfigured(env), d1: null, kv: null, pagesBuilds: null };
  if (cloudflare.configured) {
    const [d1, kv, pagesBuilds] = await Promise.all([
      getD1Usage(env).catch((err) => ({ error: String(err) })),
      getKvUsage(env).catch((err) => ({ error: String(err) })),
      getPagesBuildsThisMonth(env).catch((err) => ({ error: String(err) })),
    ]);
    cloudflare.d1 = d1;
    cloudflare.kv = kv;
    cloudflare.pagesBuilds = pagesBuilds;
  }

  return { zoho, resend, cloudflare };
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const cacheKey = "status:report:v1";

    if (!forceRefresh && env.ORDERS_KV) {
      const cached = await env.ORDERS_KV.get(cacheKey, "json");
      if (cached) return jsonResponse({ ok: true, cached: true, ...cached });
    }

    const data = await loadStatus(env);

    if (env.ORDERS_KV) {
      await env.ORDERS_KV.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL_SECONDS });
    }

    return jsonResponse({ ok: true, cached: false, ...data });
  } catch (err) {
    console.error("admin status error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
