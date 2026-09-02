// Shared helper: reads Cloudflare's own account-level usage (D1, KV, Pages
// builds) via the Cloudflare API, for the admin panel's "System Status" tab.
//
// This is a *different* credential than the D1/KV bindings (env.DB /
// env.ORDERS_KV) already used everywhere else -- a binding is an opaque
// runtime handle with no usage numbers attached to it. Reading usage
// requires a separate Account API Token with Analytics + Pages read
// permissions, called against Cloudflare's public REST/GraphQL API.
// See SETUP-cloudflare.md section 11.
//
// Required env vars:
//   CLOUDFLARE_API_TOKEN       Account API Token (Account Analytics:Read + Cloudflare Pages:Read)
//   CLOUDFLARE_ACCOUNT_ID      found in the dashboard sidebar of any zone/Workers overview page
// Optional -- each section below is skipped (returns null) if its ID is missing:
//   CLOUDFLARE_D1_DATABASE_ID       the `DB` binding's underlying database ID
//   CLOUDFLARE_KV_NAMESPACE_ID      the `ORDERS_KV` binding's underlying namespace ID
//   CLOUDFLARE_PAGES_PROJECT_NAME   the Pages project's slug (e.g. "hexapoint")
//
// NOTE ON RELIABILITY: the GraphQL field names below (d1AnalyticsAdaptiveGroups /
// kvOperationsAdaptiveGroups and their sub-fields) are Cloudflare's documented
// Analytics API shape as of when this was written, but Cloudflare has changed
// these before. If a section below throws, the error message includes
// Cloudflare's raw GraphQL error, which names the exact field to fix.

function cloudflareConfigured(env) {
  return !!(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID);
}

async function cfGraphQL(env, query, variables) {
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.errors) {
    throw new Error(`cf_graphql_failed: ${res.status} ${JSON.stringify((data && data.errors) || data)}`);
  }
  return data.data;
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

// Cloudflare's free-tier caps as of when this was written -- verify against
// https://developers.cloudflare.com/d1/platform/pricing/ and
// https://developers.cloudflare.com/kv/platform/pricing/ if these look stale.
const D1_FREE_LIMITS = { rowsReadPerDay: 5000000, rowsWrittenPerDay: 100000 };
const KV_FREE_LIMITS = { readsPerDay: 100000, writesPerDay: 1000, deletesPerDay: 1000, listsPerDay: 1000 };
const PAGES_FREE_LIMITS = { buildsPerMonth: 500 };

async function getD1Usage(env) {
  if (!env.CLOUDFLARE_D1_DATABASE_ID) return null;
  const date = todayUTC();
  const data = await cfGraphQL(
    env,
    `query($accountTag: string, $date: string, $databaseId: string) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          d1AnalyticsAdaptiveGroups(limit: 100, filter: { date: $date, databaseId: $databaseId }) {
            sum { rowsRead rowsWritten }
          }
        }
      }
    }`,
    { accountTag: env.CLOUDFLARE_ACCOUNT_ID, date, databaseId: env.CLOUDFLARE_D1_DATABASE_ID }
  );
  const groups = data.viewer.accounts[0].d1AnalyticsAdaptiveGroups;
  return {
    rowsRead: groups.reduce((a, g) => a + (g.sum.rowsRead || 0), 0),
    rowsWritten: groups.reduce((a, g) => a + (g.sum.rowsWritten || 0), 0),
    limits: D1_FREE_LIMITS,
    date,
  };
}

async function getKvUsage(env) {
  if (!env.CLOUDFLARE_KV_NAMESPACE_ID) return null;
  const date = todayUTC();
  const data = await cfGraphQL(
    env,
    `query($accountTag: string, $date: string, $namespaceId: string) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          kvOperationsAdaptiveGroups(limit: 100, filter: { date: $date, namespaceId: $namespaceId }) {
            sum { requests }
            dimensions { actionType }
          }
        }
      }
    }`,
    { accountTag: env.CLOUDFLARE_ACCOUNT_ID, date, namespaceId: env.CLOUDFLARE_KV_NAMESPACE_ID }
  );
  const groups = data.viewer.accounts[0].kvOperationsAdaptiveGroups;
  const byType = { read: 0, write: 0, delete: 0, list: 0 };
  groups.forEach((g) => {
    const type = String(g.dimensions.actionType || "").toLowerCase();
    if (type in byType) byType[type] += g.sum.requests || 0;
  });
  return { ...byType, limits: KV_FREE_LIMITS, date };
}

async function getPagesBuildsThisMonth(env) {
  if (!env.CLOUDFLARE_PAGES_PROJECT_NAME) return null;
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${env.CLOUDFLARE_PAGES_PROJECT_NAME}/deployments?per_page=100`,
    { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } }
  );
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.success) {
    throw new Error(`cf_pages_deployments_failed: ${res.status} ${JSON.stringify(data)}`);
  }
  const month = new Date().toISOString().slice(0, 7);
  const count = (data.result || []).filter((d) => String(d.created_on || "").slice(0, 7) === month).length;
  return { count, limits: PAGES_FREE_LIMITS, month };
}

export { cloudflareConfigured, getD1Usage, getKvUsage, getPagesBuildsThisMonth };
