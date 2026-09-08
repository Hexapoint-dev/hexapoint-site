// Shared helper: tracks how many emails we've sent through Resend.
//
// Resend's API has no "how many have I sent this month" endpoint -- usage is
// dashboard-only -- so this counter is our own approximation. It used to be
// bumped directly by every call site that sent an email (contact.js, email.js's
// senders); it's now bumped exclusively by functions/api/resend-webhook.js on
// the `email.sent` event instead, so it can't drift due to a send path that
// forgets to instrument itself -- Resend's own delivery confirmation is the
// single source of truth. The admin panel's "System Status" tab reads the
// counters back with getResendUsage() to compare against Resend's free-plan
// caps.
//
// Best-effort only: a lost KV write here just means an undercount on the
// status tab, never a failed email send. bumpKvCounter's get-then-put isn't
// atomic, so concurrent sends could occasionally undercount by one -- fine
// for an approximate ops metric, not something billing depends on.

async function bumpKvCounter(env, key, ttlSeconds) {
  if (!env.ORDERS_KV) return;
  const current = await env.ORDERS_KV.get(key);
  const next = (parseInt(current, 10) || 0) + 1;
  await env.ORDERS_KV.put(key, String(next), { expirationTtl: ttlSeconds });
}

export async function trackResendSend(env) {
  try {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const month = now.toISOString().slice(0, 7);
    await Promise.all([
      bumpKvCounter(env, `usage:resend:day:${day}`, 172800), // 2 days
      bumpKvCounter(env, `usage:resend:month:${month}`, 2764800), // ~32 days
    ]);
  } catch (err) {
    console.error("trackResendSend error:", err);
  }
}

// Manual correction for when the self-tracked count drifts from Resend's own
// dashboard (Settings -> Usage) -- e.g. historical sends from before the
// webhook was set up, or a period where RESEND_WEBHOOK_SECRET was
// misconfigured. Not a sync (there's nothing to sync against, per the note
// above), just an admin override.
export async function setResendUsage(env, { sentToday, sentThisMonth } = {}) {
  if (!env.ORDERS_KV) return;
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);
  const writes = [];
  if (sentToday !== undefined) {
    writes.push(env.ORDERS_KV.put(`usage:resend:day:${day}`, String(sentToday), { expirationTtl: 172800 }));
  }
  if (sentThisMonth !== undefined) {
    writes.push(env.ORDERS_KV.put(`usage:resend:month:${month}`, String(sentThisMonth), { expirationTtl: 2764800 }));
  }
  await Promise.all(writes);
}

export async function getResendUsage(env) {
  if (!env.ORDERS_KV) return { sentToday: 0, sentThisMonth: 0, tracking: false };
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);
  const [todayCount, monthCount] = await Promise.all([
    env.ORDERS_KV.get(`usage:resend:day:${day}`),
    env.ORDERS_KV.get(`usage:resend:month:${month}`),
  ]);
  return {
    sentToday: parseInt(todayCount, 10) || 0,
    sentThisMonth: parseInt(monthCount, 10) || 0,
    tracking: true,
  };
}
