// Shared low-level helper: authenticates as a Google Cloud Service Account
// (JWT Bearer flow, RFC 7523) against any Google API. Used by google.js
// (Search Console) and googlecalendar.js (Calendar) -- each supplies its own
// OAuth scope and a distinct cache-key suffix, so their access tokens
// (different scopes need different tokens) don't collide in ORDERS_KV.
//
// Required env vars (shared across every Google integration in this codebase):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL    the service account's "client_email" field
//   GOOGLE_SERVICE_ACCOUNT_KEY      the service account's "private_key" field (PEM).
//                                   Paste it exactly as it appears in the downloaded
//                                   JSON (including the BEGIN/END lines) -- Cloudflare's
//                                   env var textarea accepts real newlines. If pasted as
//                                   a single line with literal "\n" sequences instead,
//                                   this code un-escapes them automatically.

function base64url(bytes) {
  let str;
  if (typeof bytes === "string") {
    str = btoa(bytes);
  } else {
    str = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  }
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem) {
  const normalized = pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
  const body = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function signJwt(env, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const signingInput = base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(claims));
  const key = await importPrivateKey(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  return signingInput + "." + base64url(signature);
}

// Access tokens last 3600s; cache for 3300s (55min), same margin as Zoho's.
async function getGoogleAccessToken(env, scope, cacheKeySuffix) {
  const cacheKey = `google:access_token:${cacheKeySuffix}`;
  if (env.ORDERS_KV) {
    const cached = await env.ORDERS_KV.get(cacheKey);
    if (cached) return cached;
  }

  const assertion = await signJwt(env, scope);
  const params = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json().catch(() => null);

  if (!res.ok || !data || !data.access_token) {
    throw new Error(`google_token_failed: ${res.status} ${JSON.stringify(data)}`);
  }

  if (env.ORDERS_KV) {
    await env.ORDERS_KV.put(cacheKey, data.access_token, { expirationTtl: 3300 });
  }
  return data.access_token;
}

export { getGoogleAccessToken };
