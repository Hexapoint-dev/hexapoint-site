// GET /api/admin/status -> free-plan usage across every external service
// this site depends on, for the admin panel's "System Status" tab:
//   - Zoho Invoice (invoices created this year, counted from our own DB --
//     Zoho's API has no "remaining quota" field, but we're the only thing
//     creating these invoices, so our own record is authoritative)
//   - Resend (emails sent today/this month, self-tracked -- see _shared/usage.js)
//   - OneSignal (お客様の声 request emails sent today/this month, counted from our
//     own email_log table -- same reasoning as Zoho below: OneSignal's API has
//     no "remaining quota" endpoint, but every send we make goes through
//     logEmailSend() first, so our own record is authoritative for this one
//     email type)
//   - Cloudflare D1 / KV / Pages builds (via the Cloudflare API -- see
//     _shared/cloudflare.js for the required separate API token)
//   - Oracle Object Storage (D1 backup bucket usage, via a read+list PAR --
//     see _shared/oracle.js)
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
import { onesignalConfigured } from "../../_shared/onesignal.js";
import { cloudflareConfigured, getD1Usage, getD1StorageSize, getKvUsage, getPagesBuildsThisMonth } from "../../_shared/cloudflare.js";
import { oracleConfigured, getOracleUsage } from "../../_shared/oracle.js";

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

// OneSignal's free-tier email allowance varies by account/plan (and isn't
// exposed by any API endpoint), same situation as Zoho above -- set
// ONESIGNAL_FREE_PLAN_EMAIL_LIMIT to whatever your actual plan allows (check
// OneSignal's dashboard/pricing page, since this code can't look that up).
// Counts only email_type = 'testimonial_request' -- the one email type this
// site sends through OneSignal (everything else stays on Resend).
const DEFAULT_ONESIGNAL_MONTHLY_LIMIT = 10000;

async function getOneSignalUsage(env) {
  const configured = onesignalConfigured(env);
  const limit = Number(env.ONESIGNAL_FREE_PLAN_EMAIL_LIMIT) || DEFAULT_ONESIGNAL_MONTHLY_LIMIT;
  if (!env.DB) return { configured, sentToday: 0, sentThisMonth: 0, limit, error: "db_not_configured" };

  const dayStart = `${new Date().toISOString().slice(0, 10)} 00:00:00`;
  const monthStart = `${new Date().toISOString().slice(0, 7)}-01 00:00:00`;

  const [todayRow, monthRow] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM email_log WHERE email_type = 'testimonial_request' AND sent_at >= ?`
    ).bind(dayStart).first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM email_log WHERE email_type = 'testimonial_request' AND sent_at >= ?`
    ).bind(monthStart).first(),
  ]);

  return {
    configured,
    sentToday: (todayRow && todayRow.cnt) || 0,
    sentThisMonth: (monthRow && monthRow.cnt) || 0,
    limit,
  };
}

async function loadStatus(env) {
  const [zoho, resendUsage, onesignal] = await Promise.all([
    getZohoUsage(env).catch((err) => ({ error: String(err) })),
    getResendUsage(env).catch((err) => ({ error: String(err) })),
    getOneSignalUsage(env).catch((err) => ({ error: String(err) })),
  ]);

  const resend = { ...resendUsage, limits: RESEND_FREE_LIMITS };

  const cloudflare = { configured: cloudflareConfigured(env), d1: null, d1Storage: null, kv: null, pagesBuilds: null };
  if (cloudflare.configured) {
    const [d1, d1Storage, kv, pagesBuilds] = await Promise.all([
      getD1Usage(env).catch((err) => ({ error: String(err) })),
      getD1StorageSize(env).catch((err) => ({ error: String(err) })),
      getKvUsage(env).catch((err) => ({ error: String(err) })),
      getPagesBuildsThisMonth(env).catch((err) => ({ error: String(err) })),
    ]);
    cloudflare.d1 = d1;
    cloudflare.d1Storage = d1Storage;
    cloudflare.kv = kv;
    cloudflare.pagesBuilds = pagesBuilds;
  }

  const oracle = { configured: oracleConfigured(env), usage: null };
  if (oracle.configured) {
    oracle.usage = await getOracleUsage(env).catch((err) => ({ error: String(err) }));
  }

  return { zoho, resend, onesignal, cloudflare, oracle };
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
