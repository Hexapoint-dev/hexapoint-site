// Shared helper: verifies webhook requests from Resend.
//
// Resend delivers webhooks via Svix, not Stripe's own scheme (see
// verifyStripeSignature in stripe.js for the Stripe equivalent) -- headers
// are `svix-id` / `svix-timestamp` / `svix-signature`, the signed secret is
// base64 (after a `whsec_` prefix, stripped below), and the signature itself
// is base64 HMAC-SHA256 rather than hex. Spec: https://docs.svix.com/receiving/verifying-payloads/how-manual

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function hmacSha256Base64(keyBytes, message) {
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return bytesToBase64(new Uint8Array(sig));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyResendSignature(rawBody, headers, secret, toleranceSeconds = 300) {
  if (!secret) return false;

  const svixId = headers.get("svix-id");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixSignature = headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - Number(svixTimestamp)) > toleranceSeconds) return false;

  const secretBytes = base64ToBytes(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret);
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = await hmacSha256Base64(secretBytes, signedContent);

  // svix-signature can carry multiple space-separated "v1,<sig>" values
  // (key rotation) -- a match against any of them is valid.
  return svixSignature.split(" ").some((part) => {
    const idx = part.indexOf(",");
    if (idx === -1) return false;
    const version = part.slice(0, idx);
    const sig = part.slice(idx + 1);
    return version === "v1" && timingSafeEqual(sig, expected);
  });
}

// Maps a Resend webhook event type to the status we store on the matching
// email_log row. Events not listed here (e.g. email.clicked) are accepted
// (200'd) but don't change status -- open/click tracking isn't enabled on
// this account and isn't useful for the "did it arrive?" question anyway.
export const RESEND_STATUS_BY_EVENT = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
};
