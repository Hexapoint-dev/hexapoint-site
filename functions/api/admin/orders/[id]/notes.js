// GET  /api/admin/orders/:id/notes -> chronological note log for one order
// POST /api/admin/orders/:id/notes -> append a new note
//
// Separate nested route from orders/[id].js (which handles the order record
// itself) — this path is /orders/:id/notes, distinct from /orders/:id.
// Protected by the admin panel's password login via requireAdmin(), same as
// every other admin handler.

import { addOrderNote, listOrderNotes, logAdminAction, jsonResponse } from "../../../../_shared/db.js";
import { requireAdmin } from "../../../../_shared/admin-auth.js";

export async function onRequestGet({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const notes = await listOrderNotes(env, params.id);
    return jsonResponse({ ok: true, notes });
  } catch (err) {
    console.error("admin list order notes error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}

export async function onRequestPost({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const body = await request.json();
    const result = await addOrderNote(env, params.id, body.note);
    if (!result.ok) return jsonResponse({ ok: false, error: result.error }, 400);

    await logAdminAction(env, "note_added", params.id, (body.note || "").toString().slice(0, 100));

    return jsonResponse({ ok: true, note: result.note }, 201);
  } catch (err) {
    console.error("admin add order note error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
