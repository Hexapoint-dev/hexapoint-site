-- Tracks whether a Zoho invoice was created for an order, so the admin panel
-- can show its status and offer a manual retry without re-querying Zoho.
ALTER TABLE orders ADD COLUMN zoho_invoice_id TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN zoho_status TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN zoho_error TEXT NOT NULL DEFAULT '';

-- Who changed what and when, for the admin panel's History tab.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  order_id INTEGER,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON admin_audit_log(created_at);
