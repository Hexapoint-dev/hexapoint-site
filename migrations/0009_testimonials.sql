-- Client testimonial request/review flow:
--   1. Admin picks a (finished) order/customer and sends a request -> row
--      created here with status='sent', a random single-use `token`, and an
--      email is sent to the client (functions/_shared/onesignal.js) with a
--      link to /testimonial.html?token=...
--   2. Client opens that link, rates + writes their feedback -> status
--      becomes 'submitted' (functions/api/testimonial.js). The token is
--      single-use: once submitted, the public GET/POST for that token always
--      answers "already_submitted" (enforced by status != 'sent', not by
--      deleting the token).
--   3. Admin reviews the submission in the admin panel, can edit the text/
--      display name before deciding, then sets status to 'approved' or
--      'rejected' (functions/api/admin/testimonials/[id].js).
--   4. Only approved rows with published=1 are ever returned by the public
--      functions/api/testimonials.js feed that the homepage renders.
CREATE TABLE IF NOT EXISTS testimonials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  order_id TEXT,
  client_name TEXT NOT NULL,
  client_email TEXT NOT NULL,
  project_label TEXT NOT NULL DEFAULT '',
  display_name TEXT,
  rating INTEGER,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  admin_note TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  reviewed_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_testimonials_status ON testimonials(status);
CREATE INDEX IF NOT EXISTS idx_testimonials_published ON testimonials(published, display_order);
CREATE INDEX IF NOT EXISTS idx_testimonials_order_id ON testimonials(order_id);
