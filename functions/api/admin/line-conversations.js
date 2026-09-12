// GET /api/admin/line-conversations -> list of LINE conversations, newest
// activity first, for the admin panel's "LINE" tab inbox list.
//
// Protected by the admin panel's password login, same pattern as messages.js.

import { jsonResponse, listLineConversations } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";
import { lineConfigured } from "../../_shared/line.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);
    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const url = new URL(request.url);
    const data = await listLineConversations(env, {
      page: url.searchParams.get("page"),
      limit: url.searchParams.get("limit"),
    });

    return jsonResponse({ ok: true, configured: lineConfigured(env), ...data });
  } catch (err) {
    console.error("admin list line conversations error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
