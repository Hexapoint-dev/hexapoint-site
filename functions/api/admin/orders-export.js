// GET /api/admin/orders-export -> download all orders matching the current
// filters as a CSV file. Named orders-export.js (not nested under orders/) so
// it never collides with the orders/[id].js dynamic route.
//
// Protected by the admin panel's password login — same requireAdmin() pattern
// as every other admin handler.

import { listOrdersForExport } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";

const CSV_HEADER = [
  "Order ID", "Plan", "Amount", "Payment Method", "Status",
  "Buyer Name", "Email", "Phone", "Address", "Notes", "Created At",
];

// Guards against CSV/formula injection: if a field would start with =, +, -, or @,
// Excel/Sheets can interpret it as a formula when the file is opened. Prefixing
// with a literal single quote forces it to be read as plain text.
function csvField(value) {
  let s = String(value == null ? "" : value);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(rows) {
  const lines = [CSV_HEADER.map(csvField).join(",")];
  for (const o of rows) {
    lines.push([
      o.order_id,
      o.plan_name_ja,
      o.amount,
      o.payment_method,
      o.status,
      o.buyer_name,
      o.buyer_email,
      o.buyer_phone,
      o.buyer_address,
      o.notes,
      o.created_at,
    ].map(csvField).join(","));
  }
  return lines.join("\r\n");
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) {
      return new Response(JSON.stringify({ ok: false, error: auth.error }), {
        status: auth.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!env.DB) {
      return new Response(JSON.stringify({ ok: false, error: "db_not_configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(request.url);
    const rows = await listOrdersForExport(env, {
      status: url.searchParams.get("status") || undefined,
      search: url.searchParams.get("search") || undefined,
      dateFrom: url.searchParams.get("dateFrom") || undefined,
      dateTo: url.searchParams.get("dateTo") || undefined,
      sort: url.searchParams.get("sort") || undefined,
      dir: url.searchParams.get("dir") || undefined,
    });

    // Prepend a UTF-8 BOM so Excel (common in Japan) renders Japanese text
    // correctly instead of mojibake when the file is double-clicked open.
    const csv = "﻿" + toCsv(rows);
    const today = new Date().toISOString().slice(0, 10);

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="orders-${today}.csv"`,
      },
    });
  } catch (err) {
    console.error("admin orders-export error:", err);
    return new Response(JSON.stringify({ ok: false, error: "server_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
