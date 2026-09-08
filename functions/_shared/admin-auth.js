// Shared auth helpers for the admin panel (admin.html + functions/api/admin/*).
//
// Originally written when the site ran on the bare hexapoint.pages.dev domain,
// where Cloudflare Access self-hosted apps aren't available (they require a zone
// you own). Cloudflare Access was later tried on top of this once a custom
// domain was attached, then removed (2026-09-04): its Google-login redirect
// doesn't play well with a JS `fetch()`-based login form — an expired Access
// session mid-visit breaks the fetch with an opaque "Failed to fetch" instead
// of a clean re-login. TOTP (below) avoids that failure mode entirely because
// the whole flow stays same-origin, no redirects involved.
//
// Session model: a stateless, HMAC-signed cookie — no KV/D1 session table needed.
// The cookie value is `${expiresAtMs}.${signature}`, where signature = HMAC-SHA256
// (keyed with env.ADMIN_SESSION_SECRET) over the string form of expiresAtMs.
//
// Second factor: after a correct password, if env.ADMIN_TOTP_SECRET is set,
// login.js issues a short-lived "pending" cookie instead of a real session —
// same signed-cookie shape, but the signed message is prefixed with "pending."
// so it can never be replayed as a real session token. verify-totp.js checks
// it, verifies the authenticator code (see totp.js), then upgrades to a real
// session.

export const SESSION_COOKIE = "admin_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

export const PENDING_COOKIE = "admin_pending";
export const PENDING_TTL_SECONDS = 60 * 5; // 5 minutes to enter the authenticator code

async function hmacSha256Base64(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// Constant-time string comparison — used for both the password check and the
// session-signature check, so neither leaks timing information about how many
// leading characters matched.
export function timingSafeEqual(a, b) {
  a = String(a == null ? "" : a);
  b = String(b == null ? "" : b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function signSession(env, expiresAtMs) {
  return hmacSha256Base64(env.ADMIN_SESSION_SECRET, String(expiresAtMs));
}

export function buildSessionCookieHeader(token, expiresAtMs) {
  return `${SESSION_COOKIE}=${expiresAtMs}.${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function buildClearCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function signPending(env, expiresAtMs) {
  return hmacSha256Base64(env.ADMIN_SESSION_SECRET, `pending.${expiresAtMs}`);
}

export function buildPendingCookieHeader(token, expiresAtMs) {
  return `${PENDING_COOKIE}=${expiresAtMs}.${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${PENDING_TTL_SECONDS}`;
}

export function buildClearPendingCookieHeader() {
  return `${PENDING_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return part.slice(idx + 1).trim();
  }
  return null;
}

// Never throws — a missing/malformed/expired cookie is just "not authorized",
// not a server error.
export async function requireAdmin(request, env) {
  try {
    if (!env.ADMIN_SESSION_SECRET) {
      return { ok: false, status: 500, error: "not_configured" };
    }

    const raw = readCookie(request, SESSION_COOKIE);
    if (!raw) return { ok: false, status: 401, error: "unauthorized" };

    const dot = raw.indexOf(".");
    if (dot === -1) return { ok: false, status: 401, error: "unauthorized" };

    const expiresAtMs = Number(raw.slice(0, dot));
    const token = raw.slice(dot + 1);
    if (!Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs) {
      return { ok: false, status: 401, error: "unauthorized" };
    }

    const expected = await signSession(env, expiresAtMs);
    if (!timingSafeEqual(token, expected)) {
      return { ok: false, status: 401, error: "unauthorized" };
    }

    return { ok: true };
  } catch (err) {
    console.error("requireAdmin error:", err);
    return { ok: false, status: 401, error: "unauthorized" };
  }
}

// Same shape as requireAdmin, but for the short-lived pending cookie issued
// after a correct password while the authenticator step is still outstanding.
export async function requirePending(request, env) {
  try {
    if (!env.ADMIN_SESSION_SECRET) {
      return { ok: false, status: 500, error: "not_configured" };
    }

    const raw = readCookie(request, PENDING_COOKIE);
    if (!raw) return { ok: false, status: 401, error: "expired" };

    const dot = raw.indexOf(".");
    if (dot === -1) return { ok: false, status: 401, error: "expired" };

    const expiresAtMs = Number(raw.slice(0, dot));
    const token = raw.slice(dot + 1);
    if (!Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs) {
      return { ok: false, status: 401, error: "expired" };
    }

    const expected = await signPending(env, expiresAtMs);
    if (!timingSafeEqual(token, expected)) {
      return { ok: false, status: 401, error: "expired" };
    }

    return { ok: true };
  } catch (err) {
    console.error("requirePending error:", err);
    return { ok: false, status: 401, error: "expired" };
  }
}
