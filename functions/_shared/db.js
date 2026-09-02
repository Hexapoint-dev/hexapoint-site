// Shared D1 helpers for the `orders` table. Used by the payment flows
// (stripe-confirm-order.js, stripe-webhook.js, bank-order.js) to record every
// order, and by the admin panel (functions/api/admin/*) to list/view/edit/
// delete/create orders.
//
// D1 binding name: DB (Cloudflare Pages -> Settings -> Functions -> D1 database bindings).
// Schema: migrations/0001_orders.sql

export function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SORT_COLUMNS = new Set(["created_at", "amount", "status", "buyer_name"]);

function buildInsertStatement(env, { orderId, planId, planNameJa, planNameEn, amount, paymentMethod, status, buyer, notes }, onConflictDoNothing) {
  const sql = `
    INSERT INTO orders (
      order_id, plan_id, plan_name_ja, plan_name_en, amount, payment_method, status,
      buyer_name, buyer_phone, buyer_email, buyer_address, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ${onConflictDoNothing ? "ON CONFLICT(order_id) DO NOTHING" : ""}
  `;
  return env.DB.prepare(sql).bind(
    orderId,
    planId,
    planNameJa,
    planNameEn,
    amount,
    paymentMethod,
    status,
    buyer.name,
    buyer.phone,
    buyer.email,
    buyer.address,
    notes || ""
  );
}

// Used by the payment flows. Idempotent (a duplicate webhook/capture retry for
// the same order_id is a silent no-op, so it never clobbers a status an admin
// may have already changed) and never throws — a DB failure must not block the
// customer-facing payment flow, the same way a Sheets failure never did.
export async function insertOrder(env, data) {
  if (!env.DB) {
    console.error("D1 binding DB not configured, skipping order insert");
    return { ok: false, error: "not_configured" };
  }
  try {
    await buildInsertStatement(env, data, true).run();
    return { ok: true };
  } catch (err) {
    console.error("D1 insertOrder failed:", err);
    return { ok: false, error: String(err) };
  }
}

// Used by the admin "add order" feature. A duplicate order_id is a real error
// here (not silently ignored) since this is a direct admin action.
export async function createOrder(env, data) {
  const orderId = data.orderId || `MANUAL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const row = { ...data, orderId };
  const result = await buildInsertStatement(env, row, false).run();
  const id = result?.meta?.last_row_id;
  return getOrder(env, id);
}

// Shared WHERE-clause builder for the orders list/export/stats-adjacent queries.
// Never string-concatenates values — always returns `?` placeholders + a params array.
function buildOrderFilters({ status, search, dateFrom, dateTo, planId, paymentMethod }) {
  const where = [];
  const params = [];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (planId) {
    where.push("plan_id = ?");
    params.push(planId);
  }
  if (paymentMethod) {
    where.push("payment_method = ?");
    params.push(paymentMethod);
  }
  if (search) {
    where.push("(buyer_name LIKE ? OR buyer_email LIKE ? OR order_id LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (dateFrom) {
    where.push("created_at >= ?");
    params.push(`${dateFrom} 00:00:00`);
  }
  if (dateTo) {
    where.push("created_at <= ?");
    params.push(`${dateTo} 23:59:59`);
  }
  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export async function listOrders(env, { status, search, dateFrom, dateTo, planId, paymentMethod, sort, dir, page, limit } = {}) {
  const sortCol = SORT_COLUMNS.has(sort) ? sort : "created_at";
  const sortDir = String(dir).toLowerCase() === "asc" ? "ASC" : "DESC";
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const offset = (pageNum - 1) * limitNum;

  const { whereSql, params } = buildOrderFilters({ status, search, dateFrom, dateTo, planId, paymentMethod });

  const listSql = `SELECT * FROM orders ${whereSql} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) AS total FROM orders ${whereSql}`;
  // Grouped by payment_method (not just a single total) so the admin UI can
  // apply the Stripe fee % only to the "stripe" bucket when estimating net
  // revenue for whatever filters are currently applied — bank/manual orders
  // never pass through Stripe, so they carry no fee.
  const summarySql = `SELECT payment_method, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total FROM orders ${whereSql} GROUP BY payment_method`;

  const [listResult, countResult, summaryResult] = await Promise.all([
    env.DB.prepare(listSql).bind(...params, limitNum, offset).all(),
    env.DB.prepare(countSql).bind(...params).first(),
    env.DB.prepare(summarySql).bind(...params).all(),
  ]);

  return {
    orders: listResult.results || [],
    total: countResult ? countResult.total : 0,
    page: pageNum,
    limit: limitNum,
    summaryByMethod: summaryResult.results || [],
  };
}

// Same filters as listOrders, but no pagination — used by the CSV export, which
// needs every matching row, not one page of them.
export async function listOrdersForExport(env, { status, search, dateFrom, dateTo, planId, paymentMethod, sort, dir } = {}) {
  const sortCol = SORT_COLUMNS.has(sort) ? sort : "created_at";
  const sortDir = String(dir).toLowerCase() === "asc" ? "ASC" : "DESC";
  const { whereSql, params } = buildOrderFilters({ status, search, dateFrom, dateTo, planId, paymentMethod });
  const sql = `SELECT * FROM orders ${whereSql} ORDER BY ${sortCol} ${sortDir}`;
  const result = await env.DB.prepare(sql).bind(...params).all();
  return result.results || [];
}

// ---- Finance / Accounts tab aggregates (functions/api/admin/finance.js) ----
// getRevenueByPlan/getRevenueByMethod take an optional date range (the tab's
// custom-range picker); getMonthlyRevenue/getTopCustomers/getYearOverYear
// deliberately don't — they're fixed-window "context" views, documented as
// such in the UI, kept simple rather than plumbing the range through every query.

function buildRevenueDateFilter({ dateFrom, dateTo }) {
  const where = [];
  const params = [];
  if (dateFrom) {
    where.push("created_at >= ?");
    params.push(`${dateFrom} 00:00:00`);
  }
  if (dateTo) {
    where.push("created_at <= ?");
    params.push(`${dateTo} 23:59:59`);
  }
  return { whereSql: where.length ? `AND ${where.join(" AND ")}` : "", params };
}

export async function getRevenueByPlan(env, { dateFrom, dateTo } = {}) {
  const { whereSql, params } = buildRevenueDateFilter({ dateFrom, dateTo });
  const result = await env.DB.prepare(
    `SELECT plan_id, plan_name_ja, plan_name_en, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
     FROM orders WHERE status = 'paid' ${whereSql} GROUP BY plan_id ORDER BY total DESC`
  ).bind(...params).all();
  return result.results || [];
}

export async function getRevenueByMethod(env, { dateFrom, dateTo } = {}) {
  const { whereSql, params } = buildRevenueDateFilter({ dateFrom, dateTo });
  const result = await env.DB.prepare(
    `SELECT payment_method, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
     FROM orders WHERE status = 'paid' ${whereSql} GROUP BY payment_method ORDER BY total DESC`
  ).bind(...params).all();
  return result.results || [];
}

// This calendar month vs. the same calendar month one year ago — for the
// Finance tab's year-over-year comparison. Both figures are partial-month if
// run before the month ends, same caveat as the existing month-over-month one.
export async function getYearOverYear(env) {
  const [thisMonthRow, lastYearRow] = await Promise.all([
    env.DB.prepare(
      `SELECT COALESCE(SUM(amount),0) AS total FROM orders
       WHERE status = 'paid' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`
    ).first(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(amount),0) AS total FROM orders
       WHERE status = 'paid' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', '-1 year')`
    ).first(),
  ]);
  return {
    thisMonth: thisMonthRow ? thisMonthRow.total : 0,
    sameMonthLastYear: lastYearRow ? lastYearRow.total : 0,
  };
}

// Paid annual-plan orders, oldest first — the Renewals tab computes each
// one's renewal date (created_at + 365 days) and days-remaining client-side,
// then re-sorts by that so the soonest renewal always shows first regardless
// of creation order (paid-late edge cases, admin-added historical orders...).
export async function getUpcomingRenewals(env) {
  const result = await env.DB.prepare(
    `SELECT id, order_id, buyer_name, buyer_email, amount, created_at
     FROM orders WHERE plan_id = 'annual' AND status = 'paid' ORDER BY created_at ASC`
  ).all();
  return result.results || [];
}

// Last 12 calendar months (including the current, partial one), oldest first.
// Months with zero paid orders simply don't appear — the caller fills gaps.
export async function getMonthlyRevenue(env) {
  const result = await env.DB.prepare(
    `SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
     FROM orders
     WHERE status = 'paid' AND created_at >= date('now', 'start of month', '-11 months')
     GROUP BY month ORDER BY month ASC`
  ).all();
  return result.results || [];
}

export async function getTopCustomers(env, limit = 5) {
  const result = await env.DB.prepare(
    `SELECT buyer_name, buyer_email, COUNT(*) AS orders, COALESCE(SUM(amount),0) AS total
     FROM orders WHERE status = 'paid' GROUP BY buyer_email ORDER BY total DESC LIMIT ?`
  ).bind(Math.min(20, Math.max(1, limit))).all();
  return result.results || [];
}

// ---- Aggregated customer view (admin panel "Customers" tab) ----
// Grouped by buyer_email across ALL statuses (not just paid) — the admin
// wants to see a customer's full order history, not only completed ones.
export async function getCustomers(env, { search, page, limit } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const offset = (pageNum - 1) * limitNum;

  const where = [];
  const params = [];
  if (search) {
    where.push("(buyer_name LIKE ? OR buyer_email LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const listSql = `
    SELECT buyer_email, MAX(buyer_name) AS buyer_name, MAX(buyer_phone) AS buyer_phone,
      COUNT(*) AS order_count,
      COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS total_paid,
      MAX(created_at) AS last_order_at
    FROM orders ${whereSql}
    GROUP BY buyer_email
    ORDER BY total_paid DESC
    LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) AS total FROM (SELECT 1 FROM orders ${whereSql} GROUP BY buyer_email)`;

  const [listResult, countResult] = await Promise.all([
    env.DB.prepare(listSql).bind(...params, limitNum, offset).all(),
    env.DB.prepare(countSql).bind(...params).first(),
  ]);

  return {
    customers: listResult.results || [],
    total: countResult ? countResult.total : 0,
    page: pageNum,
    limit: limitNum,
  };
}

export async function getCustomerOrders(env, email) {
  const result = await env.DB.prepare("SELECT * FROM orders WHERE buyer_email = ? ORDER BY created_at DESC")
    .bind(email)
    .all();
  return result.results || [];
}

// KPI tiles for the admin dashboard header. All four queries are parameterless
// (no user input), run in parallel.
export async function getStats(env) {
  const [revenueRow, pendingBankRow, monthRow, customersRow] = await Promise.all([
    env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM orders WHERE status = 'paid'").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'pending' AND payment_method = 'bank'").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM orders WHERE created_at >= date('now','start of month')").first(),
    env.DB.prepare("SELECT COUNT(DISTINCT buyer_email) AS c FROM orders").first(),
  ]);
  return {
    totalRevenuePaid: revenueRow ? revenueRow.total : 0,
    pendingBankCount: pendingBankRow ? pendingBankRow.c : 0,
    ordersThisMonth: monthRow ? monthRow.c : 0,
    totalCustomers: customersRow ? customersRow.c : 0,
  };
}

// ---- order_notes (multi-entry note log, migrations/0002_order_notes.sql) ----
// Separate from the legacy single `orders.notes` column (still supported via
// updateOrder's whitelist, untouched, kept for backward compatibility).

export async function addOrderNote(env, orderId, note) {
  const trimmed = String(note || "").trim().slice(0, 2000);
  if (!trimmed) return { ok: false, error: "empty_note" };
  const result = await env.DB.prepare("INSERT INTO order_notes (order_id, note) VALUES (?, ?)")
    .bind(orderId, trimmed)
    .run();
  const id = result?.meta?.last_row_id;
  const row = await env.DB.prepare("SELECT * FROM order_notes WHERE id = ?").bind(id).first();
  return { ok: true, note: row };
}

export async function listOrderNotes(env, orderId) {
  const result = await env.DB.prepare("SELECT * FROM order_notes WHERE order_id = ? ORDER BY created_at ASC")
    .bind(orderId)
    .all();
  return result.results || [];
}

export async function getOrder(env, id) {
  if (!id) return null;
  const row = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  return row || null;
}

const UPDATABLE_COLUMNS = new Set([
  "status",
  "status_reason",
  "buyer_name",
  "buyer_phone",
  "buyer_email",
  "buyer_address",
  "notes",
  "plan_id",
  "plan_name_ja",
  "plan_name_en",
  "amount",
]);

export async function updateOrder(env, id, patch) {
  const existing = await getOrder(env, id);
  if (!existing) return null;

  const setClauses = ["updated_at = datetime('now')"];
  const params = [];
  for (const key of Object.keys(patch || {})) {
    if (!UPDATABLE_COLUMNS.has(key)) continue;
    setClauses.push(`${key} = ?`);
    params.push(patch[key]);
  }

  if (setClauses.length === 1) {
    // Nothing whitelisted to update — return the row unchanged.
    return existing;
  }

  params.push(id);
  await env.DB.prepare(`UPDATE orders SET ${setClauses.join(", ")} WHERE id = ?`).bind(...params).run();
  return getOrder(env, id);
}

export async function deleteOrder(env, id) {
  const result = await env.DB.prepare("DELETE FROM orders WHERE id = ?").bind(id).run();
  return { ok: true, deleted: result?.meta?.changes || 0 };
}

// ---- Zoho invoice status (migrations/0003_finance_features.sql) ----
// Written from two places: confirmStripeSession() right after attempting the
// invoice (success or failure, so the admin panel always has a current
// answer), and the admin panel's manual "retry" button for orders that
// failed or predate this tracking. Keyed by order_id (the Stripe session ID
// / TEXT identifier), not the numeric `id` — that's what confirmStripeSession
// has on hand, before any row necessarily exists yet.
export async function setOrderZohoStatus(env, orderId, { zohoInvoiceId, zohoStatus, zohoError }) {
  await env.DB.prepare(
    `UPDATE orders SET zoho_invoice_id = ?, zoho_status = ?, zoho_error = ?, updated_at = datetime('now') WHERE order_id = ?`
  ).bind(zohoInvoiceId || "", zohoStatus || "", String(zohoError || "").slice(0, 500), orderId).run();
}

// ---- Lookups/updates by order_id (the Stripe Checkout Session ID / TEXT
// identifier), used by the Stripe webhook handlers for refund/dispute/
// payment-failed events — those only have a Charge/PaymentIntent/Dispute
// object on hand, resolved back to our order via the checkout session (see
// findSessionByPaymentIntent in stripe.js), not the D1 numeric `id`. ----
export async function getOrderByOrderId(env, orderId) {
  if (!orderId) return null;
  const row = await env.DB.prepare("SELECT * FROM orders WHERE order_id = ?").bind(orderId).first();
  return row || null;
}

export async function updateOrderStatusByOrderId(env, orderId, status) {
  await env.DB.prepare(
    `UPDATE orders SET status = ?, updated_at = datetime('now') WHERE order_id = ?`
  ).bind(status, orderId).run();
}

// ---- Admin settings (migrations/0005_admin_settings.sql) ----
// Small key/value store — replaces the Stripe-fee-% and tax-breakdown-toggle
// settings that used to live only in the admin panel's browser localStorage.
export async function getSettings(env) {
  const result = await env.DB.prepare("SELECT key, value FROM admin_settings").all();
  const out = {};
  for (const row of result.results || []) out[row.key] = row.value;
  return out;
}

export async function setSetting(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO admin_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).bind(key, String(value)).run();
}

// ---- Admin audit log (migrations/0003_finance_features.sql) ----
// Never throws — a logging failure must not block the action being logged.
export async function logAdminAction(env, action, orderId, detail) {
  if (!env.DB) return;
  try {
    await env.DB.prepare("INSERT INTO admin_audit_log (action, order_id, detail) VALUES (?, ?, ?)")
      .bind(action, orderId || null, String(detail || "").slice(0, 500))
      .run();
  } catch (err) {
    console.error("logAdminAction failed:", err);
  }
}

export async function listAuditLog(env, { page, limit } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
  const offset = (pageNum - 1) * limitNum;

  const [listResult, countResult] = await Promise.all([
    env.DB.prepare(
      `SELECT a.id, a.action, a.order_id, a.detail, a.created_at, o.order_id AS order_ref
       FROM admin_audit_log a LEFT JOIN orders o ON o.id = a.order_id
       ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
    ).bind(limitNum, offset).all(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM admin_audit_log").first(),
  ]);

  return {
    logs: listResult.results || [],
    total: countResult ? countResult.total : 0,
    page: pageNum,
    limit: limitNum,
  };
}

export async function clearAuditLog(env) {
  await env.DB.prepare("DELETE FROM admin_audit_log").run();
}

// ---- Plans catalog (migrations/0006_plans.sql) ----
// Admin-editable plan list backing functions/_shared/plans.js's getPlan()/
// listActivePlans(). listPlans() (below) returns ALL plans including
// inactive ones, for the admin panel's Plans tab table — listActivePlans()
// in plans.js is the public/checkout-facing subset.

export async function listPlans(env) {
  const result = await env.DB.prepare("SELECT * FROM plans ORDER BY sort_order ASC").all();
  return result.results || [];
}

export async function getPlanRow(env, id) {
  if (!id) return null;
  const row = await env.DB.prepare("SELECT * FROM plans WHERE id = ?").bind(id).first();
  return row || null;
}

export async function createPlan(env, { id, nameJa, nameEn, priceJPY, sortOrder }) {
  await env.DB.prepare(
    `INSERT INTO plans (id, name_ja, name_en, price_jpy, sort_order) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, nameJa, nameEn, priceJPY, sortOrder || 0).run();
  return getPlanRow(env, id);
}

const PLAN_UPDATABLE_COLUMNS = new Set(["name_ja", "name_en", "price_jpy", "active", "sort_order"]);

export async function updatePlan(env, id, patch) {
  const existing = await getPlanRow(env, id);
  if (!existing) return null;

  const setClauses = ["updated_at = datetime('now')"];
  const params = [];
  for (const key of Object.keys(patch || {})) {
    if (!PLAN_UPDATABLE_COLUMNS.has(key)) continue;
    setClauses.push(`${key} = ?`);
    params.push(patch[key]);
  }

  if (setClauses.length === 1) return existing;

  params.push(id);
  await env.DB.prepare(`UPDATE plans SET ${setClauses.join(", ")} WHERE id = ?`).bind(...params).run();
  return getPlanRow(env, id);
}

// ---- Contact form messages (migrations/0007_contact_messages.sql) ----
// The admin panel's "お問い合わせ" inbox tab. Always sorted newest-first --
// unlike orders, there's no sortable-column UI here.

export async function insertContactMessage(env, { name, email, service, message }) {
  const result = await env.DB.prepare(
    `INSERT INTO contact_messages (name, email, service, message) VALUES (?, ?, ?, ?)`
  ).bind(name, email, service || "", message).run();
  return { id: result.meta.last_row_id };
}

function buildMessageFilters({ status, search }) {
  const where = [];
  const params = [];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (search) {
    where.push("(name LIKE ? OR email LIKE ? OR message LIKE ? OR service LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export async function listContactMessages(env, { status, search, page, limit } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const offset = (pageNum - 1) * limitNum;

  const { whereSql, params } = buildMessageFilters({ status, search });

  const listSql = `SELECT * FROM contact_messages ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) AS total FROM contact_messages ${whereSql}`;
  // Unread count ignores the current filters -- it's for the tab's badge,
  // which should always reflect the true unread total, not the filtered view.
  const unreadSql = `SELECT COUNT(*) AS total FROM contact_messages WHERE status = 'new'`;

  const [listResult, countResult, unreadResult] = await Promise.all([
    env.DB.prepare(listSql).bind(...params, limitNum, offset).all(),
    env.DB.prepare(countSql).bind(...params).first(),
    env.DB.prepare(unreadSql).first(),
  ]);

  return {
    messages: listResult.results || [],
    total: countResult ? countResult.total : 0,
    unreadCount: unreadResult ? unreadResult.total : 0,
    page: pageNum,
    limit: limitNum,
  };
}

export async function getContactMessage(env, id) {
  if (!id) return null;
  const row = await env.DB.prepare("SELECT * FROM contact_messages WHERE id = ?").bind(id).first();
  return row || null;
}

const MESSAGE_STATUSES = new Set(["new", "read", "replied", "archived"]);

export async function updateContactMessageStatus(env, id, status) {
  if (!MESSAGE_STATUSES.has(status)) return null;
  await env.DB.prepare(
    `UPDATE contact_messages SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(status, id).run();
  return getContactMessage(env, id);
}

export async function deleteContactMessage(env, id) {
  const result = await env.DB.prepare("DELETE FROM contact_messages WHERE id = ?").bind(id).run();
  return { ok: true, deleted: result?.meta?.changes || 0 };
}
