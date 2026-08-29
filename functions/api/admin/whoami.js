// GET /api/admin/whoami
// Used by admin.html on page load to decide whether to show the login screen
// or the dashboard, based on whether the session cookie is currently valid.

import { jsonResponse } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);
  return jsonResponse({ ok: true });
}
