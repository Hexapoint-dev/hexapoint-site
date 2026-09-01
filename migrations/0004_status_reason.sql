-- Structured reason text for status changes (esp. refund/cancel), shown in
-- the admin panel's order detail modal and threaded into the audit log.
ALTER TABLE orders ADD COLUMN status_reason TEXT NOT NULL DEFAULT '';
