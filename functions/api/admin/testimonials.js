// GET  /api/admin/testimonials -> list (filters: status, search, published, page, limit)
// POST /api/admin/testimonials -> create a new testimonial request and email it to the
//                                  client via OneSignal (functions/_shared/onesignal.js)
//
// Protected by the admin panel's password login, same pattern as messages.js/orders.js.

import { jsonResponse, createTestimonialRequest, listTestimonials, generateToken, logAdminAction } from "../../_shared/db.js";
import { requireAdmin } from "../../_shared/admin-auth.js";
import { sendTestimonialRequestEmail } from "../../_shared/onesignal.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);
    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const url = new URL(request.url);
    const data = await listTestimonials(env, {
      status: url.searchParams.get("status") || "",
      search: url.searchParams.get("search") || "",
      published: url.searchParams.get("published") || "",
      page: url.searchParams.get("page"),
      limit: url.searchParams.get("limit"),
    });

    return jsonResponse({ ok: true, ...data });
  } catch (err) {
    console.error("admin list testimonials error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);
    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const body = await request.json();
    const clientName = String(body.clientName || "").trim().slice(0, 200);
    const clientEmail = String(body.clientEmail || "").trim().slice(0, 200);
    const projectLabel = String(body.projectLabel || "").trim().slice(0, 200);
    const orderId = body.orderId ? String(body.orderId).trim().slice(0, 200) : null;

    if (!clientName || !clientEmail || !emailRe.test(clientEmail)) {
      return jsonResponse({ ok: false, error: "invalid_input" }, 400);
    }

    const token = generateToken();
    const testimonial = await createTestimonialRequest(env, { token, orderId, clientName, clientEmail, projectLabel });

    const url = new URL(request.url);
    const link = `${url.protocol}//${url.host}/testimonial.html?token=${encodeURIComponent(token)}`;

    const sendResult = await sendTestimonialRequestEmail(env, {
      clientName,
      clientEmail,
      projectLabel,
      link,
      testimonialId: testimonial.id,
    });

    await logAdminAction(env, "testimonial_request_sent", orderId, `${clientName} <${clientEmail}>`);

    return jsonResponse({ ok: true, testimonial, emailSent: sendResult.ok, emailError: sendResult.ok ? undefined : sendResult.error });
  } catch (err) {
    console.error("admin create testimonial error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
