// POST /api/admin/login
// Password login for the admin panel (see functions/_shared/admin-auth.js for
// why this exists instead of Cloudflare Access). Verifies Turnstile (reusing the
// same site-wide Turnstile setup as the order/contact forms), rate-limits failed
// attempts per IP via the existing ORDERS_KV binding, and on success issues a
// signed, HttpOnly session cookie.

import { jsonResponse, logAdminAction } from "../../_shared/db.js";
import { verifyTurnstile } from "../../_shared/turnstile.js";
import { timingSafeEqual, signSession, buildSessionCookieHeader, SESSION_TTL_SECONDS } from "../../_shared/admin-auth.js";

const MAX_ATTEMPTS = 5;
const FAIL_WINDOW_SECONDS = 60 * 15;

export async function onRequestPost({ request, env }) {
  try {
    if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) {
      return jsonResponse({ ok: false, error: "not_configured" }, 500);
    }

    const body = await request.json();
    const password = (body.password || "").toString();
    const turnstileToken = (body.turnstileToken || "").toString();

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const failKey = `admin-login-fail:${ip}`;

    if (env.ORDERS_KV) {
      const failCountRaw = await env.ORDERS_KV.get(failKey);
      const failCount = parseInt(failCountRaw, 10) || 0;
      if (failCount >= MAX_ATTEMPTS) {
        return jsonResponse({ ok: false, error: "too_many_attempts" }, 429);
      }
    }

    // ----- Verify Cloudflare Turnstile token (same helper as the order/contact forms) -----
    const turnstileResult = await verifyTurnstile(env, turnstileToken, request);
    if (!turnstileResult.ok) {
      return jsonResponse({ ok: false, error: turnstileResult.error }, turnstileResult.status);
    }
    // ----------------------------------------------------------------------------------------

    if (!timingSafeEqual(password.trim(), env.ADMIN_PASSWORD)) {
      if (env.ORDERS_KV) {
        const failCountRaw = await env.ORDERS_KV.get(failKey);
        const failCount = parseInt(failCountRaw, 10) || 0;
        await env.ORDERS_KV.put(failKey, String(failCount + 1), { expirationTtl: FAIL_WINDOW_SECONDS });
      }
      await logAdminAction(env, "admin_login_failed", null, `ip: ${ip}`);
      return jsonResponse({ ok: false, error: "invalid_password" }, 401);
    }

    if (env.ORDERS_KV) {
      await env.ORDERS_KV.delete(failKey);
    }

    await logAdminAction(env, "admin_login", null, `ip: ${ip}`);

    const expiresAtMs = Date.now() + SESSION_TTL_SECONDS * 1000;
    const token = await signSession(env, expiresAtMs);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": buildSessionCookieHeader(token, expiresAtMs),
      },
    });
  } catch (err) {
    console.error("admin login error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
