// Cloudflare Pages Function: root middleware, runs before every request to
// this project.
//
// Permanently redirects the auto-assigned production alias
// (hexapoint.pages.dev) to the canonical custom domain, so it stops being a
// separately reachable/indexable URL and all traffic + SEO signal
// consolidates on www.hexapoint-jp.com.
//
// Deliberately narrow: only the exact `hexapoint.pages.dev` hostname matches.
// Preview-deployment subdomains (e.g. <hash>.hexapoint.pages.dev,
// <branch>.hexapoint.pages.dev) are left untouched -- SETUP-cloudflare.md
// section 3 notes those are still used to preview changes before they go
// live, and Cloudflare Pages has no way to disable the pages.dev domain
// outright, only to redirect away from it like this.
const PAGES_DEV_PRODUCTION_HOST = "hexapoint.pages.dev";

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  if (url.hostname === PAGES_DEV_PRODUCTION_HOST) {
    url.hostname = "www.hexapoint-jp.com";
    url.protocol = "https:";
    return Response.redirect(url.toString(), 301);
  }

  return next();
}
