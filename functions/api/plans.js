// GET /api/plans -> active plans (id, nameJa, nameEn, priceJPY), sorted for
// display. Public, unauthenticated — plan names and prices are already shown
// on the public marketing page (index.html), which fetches this on load to
// stay in sync with whatever an admin has set in the Plans tab, instead of
// duplicating hardcoded price text that can drift out of date.

import { listActivePlans, jsonResponse } from "../_shared/plans.js";

export async function onRequestGet({ env }) {
  try {
    const plans = await listActivePlans(env);
    return jsonResponse({ ok: true, plans });
  } catch (err) {
    console.error("public plans error:", err);
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
}
