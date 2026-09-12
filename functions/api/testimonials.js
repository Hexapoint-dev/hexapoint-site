// GET /api/testimonials -> public feed of approved + published client
// testimonials, consumed by index.html's "お客様の声" section. Returns only
// display-safe fields (never client_email or the request token) -- see
// listPublishedTestimonials() in _shared/db.js.

import { listPublishedTestimonials, jsonResponse } from "../_shared/db.js";

const CACHE_TTL_SECONDS = 300;

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) return jsonResponse({ ok: true, testimonials: [] });

    const url = new URL(request.url);
    const limit = url.searchParams.get("limit");

    const cacheKey = `testimonials:public:v1:${limit || "default"}`;
    if (env.ORDERS_KV) {
      const cached = await env.ORDERS_KV.get(cacheKey, "json");
      if (cached) return jsonResponse({ ok: true, testimonials: cached });
    }

    const testimonials = await listPublishedTestimonials(env, limit);

    if (env.ORDERS_KV) {
      await env.ORDERS_KV.put(cacheKey, JSON.stringify(testimonials), { expirationTtl: CACHE_TTL_SECONDS });
    }

    return jsonResponse({ ok: true, testimonials });
  } catch (err) {
    console.error("public testimonials feed error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
