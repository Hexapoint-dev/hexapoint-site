// Shared helper: verifies a Cloudflare Turnstile token against Cloudflare's
// siteverify endpoint. Used by any Function that needs to confirm a request
// came from a real browser session (contact.js, paypal-create-order.js).
//
// Returns { ok: true } on success, or { ok: false, status, error } on failure.
// The caller decides how to turn that into an HTTP response.

export async function verifyTurnstile(env, token, request) {
  if (!env.TURNSTILE_SECRET_KEY) {
    return { ok: false, status: 500, error: "turnstile_not_configured" };
  }
  if (!token) {
    return { ok: false, status: 400, error: "turnstile_missing" };
  }

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const verifyForm = new FormData();
  verifyForm.append("secret", env.TURNSTILE_SECRET_KEY);
  verifyForm.append("response", token);
  if (ip) verifyForm.append("remoteip", ip);

  const verifyRes = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: verifyForm }
  );
  const verifyData = await verifyRes.json();

  if (!verifyData.success) {
    console.error("Turnstile failed:", verifyData["error-codes"]);
    return { ok: false, status: 403, error: "turnstile_failed" };
  }

  return { ok: true };
}
