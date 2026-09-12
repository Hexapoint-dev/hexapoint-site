// Shared helpers for the LINE Official Account chat (admin panel's "LINE"
// tab). Two LINE credentials are involved and easy to mix up:
//   - LINE_CHANNEL_SECRET: verifies that an incoming webhook POST genuinely
//     came from LINE (HMAC-SHA256 over the raw body, base64-encoded).
//   - LINE_CHANNEL_ACCESS_TOKEN: a bearer token used to CALL LINE's API
//     (fetch a user's profile, download an image they sent, push a reply).
// Both come from the LINE Developers Console for the Messaging API channel
// -- see SETUP-line.md for where to find them.

export function lineConfigured(env) {
  return Boolean(env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN);
}

function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000; // avoid call-stack blowups on large arrays
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Timing-safe base64 string comparison (same principle as
// admin-auth.js's timingSafeEqual, just over raw strings instead of hex).
function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyLineSignature(rawBody, signatureHeader, channelSecret) {
  if (!signatureHeader || !channelSecret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const expected = toBase64(new Uint8Array(sig));
  return timingSafeEqualStr(expected, signatureHeader);
}

export async function getLineProfile(env, userId) {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!res.ok) return null;
    return await res.json(); // { userId, displayName, pictureUrl, statusMessage }
  } catch (err) {
    console.error("getLineProfile failed:", err);
    return null;
  }
}

// LINE's webhook payload only ever gives you a message ID for image/video/
// audio/file messages -- the actual bytes are fetched separately via this
// "content" endpoint (note the different api-data.line.me host), and only
// while the message still exists on LINE's side.
export async function getLineMessageContent(env, messageId) {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
    headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (!res.ok) return { ok: false, error: `line_content_${res.status}` };
  const contentType = res.headers.get("Content-Type") || "image/jpeg";
  const buf = new Uint8Array(await res.arrayBuffer());
  return { ok: true, contentType, base64: toBase64(buf), byteLength: buf.length };
}

// Sends a reply from the admin panel. Deliberately the Push Message API, not
// Reply API -- a LINE "reply token" is single-use and expires almost
// immediately after the webhook event that carried it, long before an admin
// has actually read the message and typed a response, so Reply API isn't
// usable here. Push messages DO count against LINE's monthly free-tier
// message quota (Reply messages don't) -- worth knowing if usage looks high.
export async function sendLinePushMessage(env, userId, messages) {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: userId, messages }),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("LINE push message error:", res.status, detail);
      return { ok: false, error: `line_push_${res.status}`, detail };
    }
    return { ok: true };
  } catch (err) {
    console.error("sendLinePushMessage failed:", err);
    return { ok: false, error: String(err) };
  }
}
