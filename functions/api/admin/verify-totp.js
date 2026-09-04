// POST /api/admin/verify-totp
// Second step of admin login (see login.js): the client is holding the
// short-lived "pending" cookie issued after a correct password, and submits
// the current 6-digit code from their authenticator app here. Rate-limits
// failed attempts per IP the same way login.js rate-limits password attempts.
// On success, upgrades the pending cookie into a real session cookie.

import { jsonResponse, logAdminAction } from "../../_shared/db.js";
import {
  requirePending,
  buildClearPendingCookieHeader,
  signSession,
  buildSessionCookieHeader,
  SESSION_TTL_SECONDS,
} from "../../_shared/admin-auth.js";
import { verifyTOTP } from "../../_shared/totp.js";

const MAX_ATTEMPTS = 5;
const FAIL_WINDOW_SECONDS = 60 * 15;

export async function onRequestPost({ request, env }) {
  try {
    if (!env.ADMIN_SESSION_SECRET || !env.ADMIN_TOTP_SECRET) {
      return jsonResponse({ ok: false, error: "not_configured" }, 500);
    }

    const pending = await requirePending(request, env);
    if (!pending.ok) {
      return jsonResponse({ ok: false, error: "expired" }, 401);
    }

    const body = await request.json();
    const code = (body.code || "").toString();

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const failKey = `admin-totp-fail:${ip}`;

    if (env.ORDERS_KV) {
      const failCountRaw = await env.ORDERS_KV.get(failKey);
      const failCount = parseInt(failCountRaw, 10) || 0;
      if (failCount >= MAX_ATTEMPTS) {
        return jsonResponse({ ok: false, error: "too_many_attempts" }, 429);
      }
    }

    const valid = await verifyTOTP(env.ADMIN_TOTP_SECRET, code);
    if (!valid) {
      if (env.ORDERS_KV) {
        const failCountRaw = await env.ORDERS_KV.get(failKey);
        const failCount = parseInt(failCountRaw, 10) || 0;
        await env.ORDERS_KV.put(failKey, String(failCount + 1), { expirationTtl: FAIL_WINDOW_SECONDS });
      }
      await logAdminAction(env, "admin_login_failed", null, `ip: ${ip} (totp)`);
      return jsonResponse({ ok: false, error: "invalid_code" }, 401);
    }

    if (env.ORDERS_KV) {
      await env.ORDERS_KV.delete(failKey);
    }

    await logAdminAction(env, "admin_login", null, `ip: ${ip}`);

    const expiresAtMs = Date.now() + SESSION_TTL_SECONDS * 1000;
    const token = await signSession(env, expiresAtMs);

    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", buildSessionCookieHeader(token, expiresAtMs));
    headers.append("Set-Cookie", buildClearPendingCookieHeader());

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (err) {
    console.error("admin verify-totp error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
