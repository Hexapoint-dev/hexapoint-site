// GET  /api/admin/line-conversations/:id -> conversation + its message thread
//      (also marks it read -- opening a thread is the read receipt, same
//      convention as messages.js's 'new' -> 'read' transition)
// POST /api/admin/line-conversations/:id -> send a reply (text only for now)
//      via LINE's Push Message API. Body: { text: "..." }
//
// Protected by the admin panel's password login.

import {
  jsonResponse,
  getLineConversationById,
  listLineMessages,
  markLineConversationRead,
  insertLineMessage,
  touchLineConversation,
  logAdminAction,
} from "../../../_shared/db.js";
import { requireAdmin } from "../../../_shared/admin-auth.js";
import { lineConfigured, sendLinePushMessage } from "../../../_shared/line.js";

export async function onRequestGet({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);
    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const conversation = await getLineConversationById(env, params.id);
    if (!conversation) return jsonResponse({ ok: false, error: "not_found" }, 404);

    const messages = await listLineMessages(env, params.id);

    if (conversation.unread_count > 0) {
      await markLineConversationRead(env, params.id);
      conversation.unread_count = 0;
    }

    return jsonResponse({ ok: true, conversation, messages });
  } catch (err) {
    console.error("admin get line conversation error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}

export async function onRequestPost({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);
    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);
    if (!lineConfigured(env)) return jsonResponse({ ok: false, error: "line_not_configured" }, 500);

    const conversation = await getLineConversationById(env, params.id);
    if (!conversation) return jsonResponse({ ok: false, error: "not_found" }, 404);

    const body = await request.json();
    const text = String(body.text || "").trim().slice(0, 2000);
    if (!text) return jsonResponse({ ok: false, error: "empty_message" }, 400);

    const sendResult = await sendLinePushMessage(env, conversation.line_user_id, [{ type: "text", text }]);
    if (!sendResult.ok) {
      return jsonResponse({ ok: false, error: sendResult.error, detail: sendResult.detail }, 502);
    }

    await insertLineMessage(env, {
      conversationId: conversation.id,
      lineMessageId: null,
      direction: "out",
      messageType: "text",
      body: text,
    });
    await touchLineConversation(env, conversation.id, text.slice(0, 120), false);
    await logAdminAction(env, "line_reply_sent", null, `#${params.id} ${conversation.display_name}`);

    const messages = await listLineMessages(env, params.id);
    return jsonResponse({ ok: true, messages });
  } catch (err) {
    console.error("admin send line reply error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
