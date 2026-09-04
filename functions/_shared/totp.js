// TOTP (RFC 6238 / RFC 4226) verification for the admin second factor.
// Pure Web Crypto — no npm libs (Workers runtime doesn't have Node's crypto
// module) — and compatible with Google Authenticator, Authy, etc. using their
// shared defaults: HMAC-SHA1, 6 digits, 30-second step.

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(input || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of clean) {
    const val = alphabet.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

function counterToBytes(counter) {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 4294967296));
  view.setUint32(4, counter % 4294967296);
  return buf;
}

async function hotp(keyBytes, counter) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, counterToBytes(counter)));

  const offset = sig[sig.length - 1] & 0x0f;
  const binCode =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);

  return String(binCode % 1000000).padStart(6, "0");
}

// Checks the submitted code against the current 30s time step and one step
// before/after, so a slightly-off phone clock or a slow typer still gets in.
export async function verifyTOTP(secretBase32, code, options) {
  const step = (options && options.step) || 30;
  const window = (options && options.window) != null ? options.window : 1;

  const cleanCode = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleanCode)) return false;

  const keyBytes = base32Decode(secretBase32);
  if (keyBytes.length === 0) return false;

  const counter = Math.floor(Date.now() / 1000 / step);
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const candidate = await hotp(keyBytes, counter + errorWindow);
    if (candidate === cleanCode) return true;
  }
  return false;
}
