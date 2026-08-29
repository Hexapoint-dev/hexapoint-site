// POST /api/admin/logout
// Clears the admin session cookie. No auth check needed — logging out doesn't
// require proving you were logged in.

import { buildClearCookieHeader } from "../../_shared/admin-auth.js";

export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": buildClearCookieHeader(),
    },
  });
}
