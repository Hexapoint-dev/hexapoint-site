-- One row per email actually sent through Resend. Written at send-time by
-- functions/_shared/email.js and functions/api/contact.js (status starts as
-- 'sent'), then updated in place by functions/api/resend-webhook.js as
-- Resend reports delivery/bounce/complaint events for that email.
--
-- related_type/related_id link back to the order or contact message this
-- email was about, so the admin panel can show "did this email actually
-- arrive?" next to the thing it was sent for. related_id is TEXT because
-- order_id (a Stripe Checkout Session ID) isn't numeric.
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resend_email_id TEXT UNIQUE,
  email_type TEXT NOT NULL,
  related_type TEXT,
  related_id TEXT,
  recipient TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  status_detail TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_log_resend_id ON email_log(resend_email_id);
CREATE INDEX IF NOT EXISTS idx_email_log_related ON email_log(related_type, related_id);
