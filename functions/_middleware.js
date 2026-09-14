// Cloudflare Pages Function: root middleware, runs before every request to
// this project.
//
// Permanently redirects both the auto-assigned production alias
// (hexapoint.pages.dev) and the bare/apex domain (hexapoint-jp.com, no www)
// to the canonical custom domain, so neither stays a separately
// reachable/indexable URL and all traffic + SEO signal consolidates on
// www.hexapoint-jp.com. Without this, the apex previously served the site
// directly (byte-identical content, HTTP 200) instead of redirecting --
// a live duplicate-content surface caught by SEO audit on 2026-09-08.
//
// Deliberately narrow: only these exact hostnames match. Preview-deployment
// subdomains (e.g. <hash>.hexapoint.pages.dev, <branch>.hexapoint.pages.dev)
// are left untouched -- SETUP-cloudflare.md section 3 notes those are still
// used to preview changes before they go live, and Cloudflare Pages has no
// way to disable the pages.dev domain outright, only to redirect away from
// it like this. SETUP-cloudflare.md step 3.2/8 also documents an
// apex-to-www Cloudflare Redirect Rule as a dashboard-side alternative --
// this middleware covers the same case in code so it can't be silently
// skipped or misconfigured in the dashboard.
const REDIRECT_TO_WWW_HOSTS = new Set(["hexapoint.pages.dev", "hexapoint-jp.com"]);

// Maintenance mode: when the ORDERS_KV flag below is "1", every public page
// request gets a simple "back soon" page instead of the live site. Toggled
// from the admin panel's System Status tab (functions/api/admin/maintenance.js
// -- keep this key in sync with that file). The admin panel itself
// (/admin.html and everything under /api/) is never gated, so it's always
// possible to log in and turn this back off.
//
// Only intercepts page navigations (extensionless paths and *.html), not
// every request: static assets (images, CSS, JS, sitemap.xml, PDFs, ...)
// are left alone both because they don't need gating -- the browser never
// requests them once the page that would reference them is replaced -- and
// to avoid spending a KV read on every single asset request.
const MAINTENANCE_KV_KEY = "site:maintenance_mode";

function isPageRequest(pathname) {
  const last = pathname.split("/").pop();
  if (!last) return true; // "/" or a path ending in "/"
  if (!last.includes(".")) return true; // extensionless route
  return last.endsWith(".html");
}

const MAINTENANCE_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>メンテナンス中 / Under Maintenance — HexaPoint</title>
<style>
  :root{--ink:#0e1633;--paper:#fbf9f6;--cream:#fff;--emerald:#f5912a;--emerald-deep:#e8631f;--line:rgba(14,22,51,.12)}
  *{margin:0;padding:0;box-sizing:border-box}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic UI","Yu Gothic",Meiryo,sans-serif;padding:24px}
  .card{max-width:460px;width:100%;background:var(--cream);border:1px solid var(--line);border-radius:24px;padding:44px 36px;text-align:center;box-shadow:0 18px 50px -18px rgba(14,22,51,.18)}
  .logo{width:52px;height:52px;margin:0 auto 22px;border-radius:14px;background:linear-gradient(135deg,var(--emerald),var(--emerald-deep));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:22px}
  h1{font-size:21px;font-weight:700;margin-bottom:8px}
  .en{font-size:14px;opacity:.7;font-style:italic;margin-bottom:20px}
  p{font-size:14px;line-height:1.8;opacity:.8;margin-bottom:6px}
  a{color:var(--emerald-deep);font-weight:600;text-decoration:none}
  a:hover{text-decoration:underline}
</style>
</head>
<body>
  <div class="card">
    <div class="logo">H</div>
    <h1>ただいまメンテナンス中です</h1>
    <div class="en">We're currently performing scheduled maintenance.</div>
    <p>ご不便をおかけし申し訳ございません。まもなく通常通りご覧いただけます。</p>
    <p style="opacity:.6;font-size:13px;margin-top:14px">お急ぎのお問い合わせは <a href="mailto:info@hexapoint-jp.com">info@hexapoint-jp.com</a> まで</p>
  </div>
</body>
</html>`;

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  if (REDIRECT_TO_WWW_HOSTS.has(url.hostname)) {
    url.hostname = "www.hexapoint-jp.com";
    url.protocol = "https:";
    return Response.redirect(url.toString(), 301);
  }

  if (
    request.method === "GET" &&
    env.ORDERS_KV &&
    url.pathname !== "/admin.html" &&
    !url.pathname.startsWith("/api/") &&
    isPageRequest(url.pathname)
  ) {
    const maintenance = await env.ORDERS_KV.get(MAINTENANCE_KV_KEY);
    if (maintenance === "1") {
      return new Response(MAINTENANCE_HTML, {
        status: 503,
        headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": "1800", "Cache-Control": "no-store" },
      });
    }
  }

  return next();
}
