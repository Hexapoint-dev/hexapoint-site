// GET    /api/admin/testimonials/:id -> single testimonial + its email log
// PATCH  /api/admin/testimonials/:id -> admin actions + field edits, see below
// DELETE /api/admin/testimonials/:id -> delete
//
// PATCH body shapes (one of):
//   { action: "approve", comment?, displayName?, projectLabel?, rating? } -- optionally
//     edits the client's wording before approving (typos, clarity, anonymizing a detail)
//   { action: "reject", adminNote? }
//   { action: "publish" }    -- only meaningful once status === "approved"
//   { action: "unpublish" }
//   { action: "resend" }     -- rotates the token and re-sends the request email;
//                                only valid while status === "sent" (client hasn't answered)
//   { displayName?, projectLabel?, rating?, comment?, adminNote?, displayOrder? } -- plain field edit, no status change
//
// Protected by the admin panel's password login.

import {
  jsonResponse,
  getTestimonialById,
  updateTestimonialFields,
  setTestimonialReviewStatus,
  setTestimonialPublished,
  rotateTestimonialToken,
  deleteTestimonial,
  generateToken,
  logAdminAction,
  getEmailLogForRelated,
} from "../../../_shared/db.js";
import { requireAdmin } from "../../../_shared/admin-auth.js";
import { sendTestimonialRequestEmail, formatOneSignalErrorDetail } from "../../../_shared/onesignal.js";

export async function onRequestGet({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);
    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const testimonial = await getTestimonialById(env, params.id);
    if (!testimonial) return jsonResponse({ ok: false, error: "not_found" }, 404);

    const emailLog = await getEmailLogForRelated(env, "testimonial", params.id);
    return jsonResponse({ ok: true, testimonial, emailLog });
  } catch (err) {
    console.error("admin get testimonial error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}

export async function onRequestPatch({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);
    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const existing = await getTestimonialById(env, params.id);
    if (!existing) return jsonResponse({ ok: false, error: "not_found" }, 404);

    const body = await request.json();
    const action = String(body.action || "");

    if (action === "approve") {
      const fieldPatch = {};
      if (body.comment != null) fieldPatch.comment = String(body.comment).trim().slice(0, 2000);
      if (body.displayName != null) fieldPatch.display_name = String(body.displayName).trim().slice(0, 200);
      if (body.projectLabel != null) fieldPatch.project_label = String(body.projectLabel).trim().slice(0, 200);
      if (body.rating != null) fieldPatch.rating = clampRating(body.rating);
      if (body.logoUrl != null) {
        const logo = validateLogoUrl(body.logoUrl);
        if (!logo.ok) return jsonResponse({ ok: false, error: logo.error }, 400);
        fieldPatch.logo_url = logo.value;
      }
      if (Object.keys(fieldPatch).length) await updateTestimonialFields(env, params.id, fieldPatch);

      const testimonial = await setTestimonialReviewStatus(env, params.id, "approved", body.adminNote);
      await logAdminAction(env, "testimonial_approved", existing.order_id, `#${params.id} ${existing.client_name}`);
      return jsonResponse({ ok: true, testimonial });
    }

    if (action === "reject") {
      const testimonial = await setTestimonialReviewStatus(env, params.id, "rejected", body.adminNote);
      await logAdminAction(env, "testimonial_rejected", existing.order_id, `#${params.id} ${existing.client_name}`);
      return jsonResponse({ ok: true, testimonial });
    }

    if (action === "publish") {
      if (existing.status !== "approved") return jsonResponse({ ok: false, error: "not_approved" }, 400);
      const testimonial = await setTestimonialPublished(env, params.id, true);
      await invalidatePublicTestimonialsCache(env);
      await logAdminAction(env, "testimonial_published", existing.order_id, `#${params.id} ${existing.client_name}`);
      return jsonResponse({ ok: true, testimonial });
    }

    if (action === "unpublish") {
      const testimonial = await setTestimonialPublished(env, params.id, false);
      await invalidatePublicTestimonialsCache(env);
      await logAdminAction(env, "testimonial_unpublished", existing.order_id, `#${params.id} ${existing.client_name}`);
      return jsonResponse({ ok: true, testimonial });
    }

    if (action === "resend") {
      if (existing.status !== "sent") return jsonResponse({ ok: false, error: "not_awaiting_client" }, 400);
      const token = generateToken();
      const testimonial = await rotateTestimonialToken(env, params.id, token);

      const url = new URL(request.url);
      const link = `${url.protocol}//${url.host}/testimonial.html?token=${encodeURIComponent(token)}`;
      const sendResult = await sendTestimonialRequestEmail(env, {
        clientName: testimonial.client_name,
        clientEmail: testimonial.client_email,
        projectLabel: testimonial.project_label,
        link,
        testimonialId: testimonial.id,
      });

      await logAdminAction(env, "testimonial_request_resent", existing.order_id, `#${params.id} ${existing.client_name}`);
      return jsonResponse({
        ok: true,
        testimonial,
        emailSent: sendResult.ok,
        emailError: sendResult.ok ? undefined : sendResult.error,
        emailErrorDetail: sendResult.ok ? undefined : formatOneSignalErrorDetail(sendResult.detail),
      });
    }

    // Plain field edit, no status change.
    const fieldPatch = {};
    if (body.displayName != null) fieldPatch.display_name = String(body.displayName).trim().slice(0, 200);
    if (body.projectLabel != null) fieldPatch.project_label = String(body.projectLabel).trim().slice(0, 200);
    if (body.rating != null) fieldPatch.rating = clampRating(body.rating);
    if (body.comment != null) fieldPatch.comment = String(body.comment).trim().slice(0, 2000);
    if (body.adminNote != null) fieldPatch.admin_note = String(body.adminNote).trim().slice(0, 1000);
    if (body.displayOrder != null) fieldPatch.display_order = parseInt(body.displayOrder, 10) || 0;
    if (body.logoUrl != null) {
      const logo = validateLogoUrl(body.logoUrl);
      if (!logo.ok) return jsonResponse({ ok: false, error: logo.error }, 400);
      fieldPatch.logo_url = logo.value;
    }

    const testimonial = await updateTestimonialFields(env, params.id, fieldPatch);
    return jsonResponse({ ok: true, testimonial });
  } catch (err) {
    console.error("admin update testimonial error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}

export async function onRequestDelete({ request, env, params }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);
    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const existing = await getTestimonialById(env, params.id);
    const result = await deleteTestimonial(env, params.id);
    if (!result.deleted) return jsonResponse({ ok: false, error: "not_found" }, 404);

    if (existing) {
      await logAdminAction(env, "testimonial_deleted", existing.order_id, `#${params.id} ${existing.client_name}`);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("admin delete testimonial error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}

// The public feed (functions/api/testimonials.js) caches its default (no
// ?limit) response in KV for 5 minutes for homepage performance -- without
// this, an admin publishing/unpublishing here would see the homepage lag
// behind by up to that long, which reads as "it's broken" rather than "it's
// cached". index.html never passes ?limit, so the default key is the only
// one that matters in practice.
async function invalidatePublicTestimonialsCache(env) {
  if (!env.ORDERS_KV) return;
  try {
    await env.ORDERS_KV.delete("testimonials:public:v1:default");
  } catch (err) {
    console.error("invalidatePublicTestimonialsCache failed (non-fatal):", err);
  }
}

// Logos are stored as a base64 data: URI directly in the `testimonials` row
// (see migrations/0010_testimonial_logo.sql for why -- no R2/Images binding
// exists for this project). Capped well under D1's per-value limit so one
// oversized upload can't bloat the row or the public feed response.
const MAX_LOGO_BYTES = 350 * 1024;

function validateLogoUrl(value) {
  const s = String(value || "").trim();
  if (!s) return { ok: true, value: "" }; // empty string clears the logo
  if (!/^data:image\/(png|jpe?g|webp|svg\+xml);base64,/.test(s)) {
    return { ok: false, error: "invalid_logo_format" };
  }
  const base64Part = s.slice(s.indexOf(",") + 1);
  const approxBytes = Math.floor((base64Part.length * 3) / 4);
  if (approxBytes > MAX_LOGO_BYTES) {
    return { ok: false, error: "logo_too_large" };
  }
  return { ok: true, value: s };
}

function clampRating(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(5, Math.max(1, n));
}
