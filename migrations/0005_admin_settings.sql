-- Small key/value store for admin-panel settings (Stripe fee % estimate, tax
-- breakdown visibility) that previously lived only in the browser's
-- localStorage, so they now persist per-account instead of per-browser.
CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
