-- Plan catalog, moved from the hardcoded PLANS object in
-- functions/_shared/plans.js into D1 so prices can be edited from the admin
-- panel instead of requiring a code deploy. Seeded with the exact values
-- that were hardcoded before this migration, so behavior is unchanged the
-- moment it runs. functions/_shared/plans.js keeps the old object as
-- DEFAULT_PLANS, a fallback used only if this table is ever unreachable —
-- checkout must never hard-fail because of a D1 hiccup.
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name_ja TEXT NOT NULL,
  name_en TEXT NOT NULL,
  price_jpy INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO plans (id, name_ja, name_en, price_jpy, sort_order) VALUES
  ('basic', '基本デザインプラン', 'Basic Design', 100000, 1),
  ('maintenance', 'コンテンツ変更・保守プラン', 'Content & Maintenance', 50000, 2),
  ('annual', '年間無制限サブスクリプション', 'Unlimited Annual', 200000, 3);
