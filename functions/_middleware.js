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

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  if (REDIRECT_TO_WWW_HOSTS.has(url.hostname)) {
    url.hostname = "www.hexapoint-jp.com";
    url.protocol = "https:";
    return Response.redirect(url.toString(), 301);
  }

  return next();
}
