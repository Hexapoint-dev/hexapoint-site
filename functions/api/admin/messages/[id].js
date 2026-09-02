// GET    /api/admin/messages/:id -> single message (marks it "read" if it was "new" --
//                                    same convention as opening an email in any inbox)
// PATCH  /api/admin/messages/:id -> change status (read/replied/archived/new)
// DELETE /api/admin/messages/:id -> delete
//
// Protected by the admin panel's password login — see messages.js / admin-auth.js.

import { getContactMessage, updateContactMessageStatus, deleteContactMessage, logAdminAction, jsonResponse } from "../../../_shared/db.js";
import { requireAdmin } from "../../../_shared/admin-auth.js";

export async function onRequestGet({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    let message = await getContactMessage(env, params.id);
    if (!message) return jsonResponse({ ok: false, error: "not_found" }, 404);

    if (message.status === "new") {
      message = await updateContactMessageStatus(env, params.id, "read");
    }

    return jsonResponse({ ok: true, message });
  } catch (err) {
    console.error("admin get message error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}

export async function onRequestPatch({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const body = await request.json();
    const status = String(body.status || "");

    const message = await updateContactMessageStatus(env, params.id, status);
    if (!message) return jsonResponse({ ok: false, error: "not_found_or_invalid_status" }, 400);

    await logAdminAction(env, "message_status_updated", null, `#${params.id} -> ${status}`);

    return jsonResponse({ ok: true, message });
  } catch (err) {
    console.error("admin update message error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}

export async function onRequestDelete({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const existing = await getContactMessage(env, params.id);
    const result = await deleteContactMessage(env, params.id);
    if (!result.deleted) return jsonResponse({ ok: false, error: "not_found" }, 404);

    if (existing) {
      await logAdminAction(env, "message_deleted", null, `${existing.name} <${existing.email}>`);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("admin delete message error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
