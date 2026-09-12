// Public endpoints backing testimonial.html, the client-facing feedback page.
//
// GET  /api/testimonial?token=... -> validates the token, returns just enough
//      to render the form (client's first name, project label). Never
//      returns client_email.
// POST /api/testimonial            -> the client's actual submission.
//
// The token is single-use: once a row's status leaves 'sent' (i.e. the
// client already submitted), both verbs answer "already_submitted" instead
// of touching the row again -- see submitTestimonial()'s doc comment in
// _shared/db.js for why that check lives here and not in the DB helper.

import { getTestimonialByToken, submitTestimonial, jsonResponse } from "../_shared/db.js";
import { verifyTurnstile } from "../_shared/turnstile.js";
import { sendOwnerAlert } from "../_shared/email.js";

function tokenState(testimonial) {
  if (!testimonial) return "invalid";
  if (testimonial.status === "sent") return "ok";
  return "already_submitted";
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const url = new URL(request.url);
    const token = (url.searchParams.get("token") || "").trim();
    if (!token) return jsonResponse({ ok: false, error: "missing_token" }, 400);

    const testimonial = await getTestimonialByToken(env, token);
    const state = tokenState(testimonial);
    if (state !== "ok") return jsonResponse({ ok: false, error: state }, 404);

    return jsonResponse({
      ok: true,
      clientName: testimonial.client_name,
      projectLabel: testimonial.project_label,
    });
  } catch (err) {
    console.error("public testimonial GET error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return jsonResponse({ ok: false, error: "db_not_configured" }, 500);

    const body = await request.json();
    const token = String(body.token || "").trim();
    const rating = parseInt(body.rating, 10);
    const comment = String(body.comment || "").trim().slice(0, 2000);
    const displayName = String(body.displayName || "").trim().slice(0, 200);
    const turnstileToken = String(body.turnstileToken || "");

    if (!token) return jsonResponse({ ok: false, error: "missing_token" }, 400);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return jsonResponse({ ok: false, error: "invalid_rating" }, 400);
    }
    if (comment.length < 10) return jsonResponse({ ok: false, error: "comment_too_short" }, 400);

    const turnstileResult = await verifyTurnstile(env, turnstileToken, request);
    if (!turnstileResult.ok) {
      return jsonResponse({ ok: false, error: turnstileResult.error }, turnstileResult.status);
    }

    const existing = await getTestimonialByToken(env, token);
    const state = tokenState(existing);
    if (state !== "ok") return jsonResponse({ ok: false, error: state }, 409);

    const testimonial = await submitTestimonial(env, token, {
      rating,
      comment,
      displayName: displayName || existing.client_name,
    });

    // Best-effort owner notification -- the submission itself already
    // succeeded above, so a Resend hiccup here must never surface as an
    // error to the client.
    try {
      await sendOwnerAlert(env, {
        subject: `【HexaPoint】新しいお客様の声 / New testimonial — ${existing.client_name}`,
        title: "新しいお客様の声が届きました",
        titleEn: "New testimonial submitted",
        rows: [
          ["お客様", "Client", existing.client_name],
          ["プロジェクト", "Project", existing.project_label || "—"],
          ["評価", "Rating", `${rating} / 5`],
          ["コメント", "Comment", comment],
        ],
        emailType: "testimonial_submitted_alert",
        relatedType: "testimonial",
        relatedId: testimonial.id,
      });
    } catch (err) {
      console.error("testimonial owner alert failed (non-fatal):", err);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("public testimonial POST error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
