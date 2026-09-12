// POST /api/line-webhook
// Register this URL in LINE Developers Console -> your Messaging API channel
// -> Messaging API tab -> Webhook URL, then enable "Use webhook". See
// SETUP-line.md for the full one-time setup.
//
// LINE POSTs a batch of `events` per request and expects a fast 200 back --
// it retries the whole batch on any non-2xx/timeout, which is exactly why
// insertLineMessage() is idempotent on line_message_id (a retry must never
// duplicate a message) and why each event is wrapped in its own try/catch
// below (one bad event must not fail the ack for the rest of the batch,
// which would just cause LINE to retry and re-process the ones that already
// succeeded).
//
// MVP scope: 1:1 chats only (group/room source events are ignored), text +
// image messages (other types are stored as a short placeholder so the
// conversation thread still shows *something* happened).

import { upsertLineConversation, getLineConversationByUserId, insertLineMessage, touchLineConversation } from "../_shared/db.js";
import { lineConfigured, verifyLineSignature, getLineProfile, getLineMessageContent } from "../_shared/line.js";

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

const OTHER_TYPE_LABELS = {
  video: "[動画]",
  audio: "[音声]",
  file: "[ファイル]",
  location: "[位置情報]",
  sticker: "[スタンプ]",
};

export async function onRequestPost({ request, env }) {
  const rawBody = await request.text();

  if (!lineConfigured(env)) {
    console.error("LINE webhook received but LINE_CHANNEL_SECRET/LINE_CHANNEL_ACCESS_TOKEN not configured");
    return new Response("not configured", { status: 500 });
  }

  const signature = request.headers.get("x-line-signature");
  const valid = await verifyLineSignature(rawBody, signature, env.LINE_CHANNEL_SECRET);
  if (!valid) {
    console.error("LINE webhook signature verification failed");
    return new Response("invalid signature", { status: 401 });
  }

  if (!env.DB) {
    console.error("LINE webhook received but DB not configured");
    return new Response("db not configured", { status: 500 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    return new Response("bad json", { status: 400 });
  }

  const events = payload.events || [];
  for (const event of events) {
    try {
      await handleEvent(env, event);
    } catch (err) {
      console.error("LINE webhook event handling failed (continuing batch):", err, JSON.stringify(event));
    }
  }

  // LINE only cares about the status code -- body content is ignored.
  return new Response("OK", { status: 200 });
}

async function handleEvent(env, event) {
  const userId = event.source && event.source.userId;
  if (!userId) return; // group/room events -- not supported in this MVP

  if (event.type === "follow") {
    await ensureConversation(env, userId);
    return;
  }

  if (event.type !== "message") return;

  const conversation = await ensureConversation(env, userId);
  const message = event.message || {};
  const lineMessageId = message.id ? String(message.id) : null;

  if (message.type === "text") {
    const body = String(message.text || "").slice(0, 2000);
    const result = await insertLineMessage(env, {
      conversationId: conversation.id,
      lineMessageId,
      direction: "in",
      messageType: "text",
      body,
    });
    if (result.inserted) await touchLineConversation(env, conversation.id, body.slice(0, 120), true);
    return;
  }

  if (message.type === "image") {
    const content = await getLineMessageContent(env, message.id);
    if (content.ok && content.byteLength <= MAX_IMAGE_BYTES) {
      const imageData = `data:${content.contentType};base64,${content.base64}`;
      const result = await insertLineMessage(env, {
        conversationId: conversation.id,
        lineMessageId,
        direction: "in",
        messageType: "image",
        body: "[画像]",
        imageData,
      });
      if (result.inserted) await touchLineConversation(env, conversation.id, "[画像]", true);
    } else {
      // Too large to store, or the content fetch failed -- still record that
      // *something* arrived so the thread isn't silently missing a message.
      const result = await insertLineMessage(env, {
        conversationId: conversation.id,
        lineMessageId,
        direction: "in",
        messageType: "other",
        body: content.ok ? "[画像（サイズが大きいため保存できませんでした）]" : "[画像の取得に失敗しました]",
      });
      if (result.inserted) await touchLineConversation(env, conversation.id, "[画像]", true);
    }
    return;
  }

  // Any other message type (sticker, video, audio, file, location) -- store
  // a short label so the thread shows the event happened, no content fetch.
  const label = OTHER_TYPE_LABELS[message.type] || `[${message.type}]`;
  const result = await insertLineMessage(env, {
    conversationId: conversation.id,
    lineMessageId,
    direction: "in",
    messageType: "other",
    body: label,
  });
  if (result.inserted) await touchLineConversation(env, conversation.id, label, true);
}

async function ensureConversation(env, userId) {
  const existing = await getLineConversationByUserId(env, userId);
  if (existing) return existing;

  // First time we've seen this user -- fetch their profile once so the
  // conversation list shows a real name/photo instead of just a raw user ID.
  const profile = await getLineProfile(env, userId);
  return upsertLineConversation(env, {
    lineUserId: userId,
    displayName: profile ? profile.displayName : "",
    pictureUrl: profile ? profile.pictureUrl : "",
  });
}
