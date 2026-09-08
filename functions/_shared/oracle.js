// Shared helper: reads Oracle Object Storage bucket usage (total size,
// object count, most recent backup timestamp) for the admin panel's "System
// Status" tab -- covers the D1 -> Oracle backup set up separately (see
// hexapoint-d1-backup-worker).
//
// Uses a bucket-level Pre-Authenticated Request (PAR) with "Permit object
// reads" + "Enable Object Listing" checked -- a plain GET, no OCI SDK / HTTP
// request signing needed. This PAR is intentionally SEPARATE from the
// write-only PAR the backup Worker uses to upload: least privilege means
// this one can list/read metadata but can never overwrite or delete a
// backup, and the backup Worker's PAR can never be used to read data back.
//
// Required env var (set on the Cloudflare Pages project, not the Worker):
//   ORACLE_STORAGE_LIST_PAR_URL   Bucket-level PAR URL for the backups
//                                  bucket, "Permit object reads" + "Enable
//                                  Object Listing", ending in .../o/

// Oracle Always Free Object Storage cap as of when this was written -- verify
// against https://www.oracle.com/cloud/free/ if this looks stale.
const ORACLE_FREE_LIMITS = { standardStorageBytes: 10 * 1024 * 1024 * 1024 };

function oracleConfigured(env) {
  return !!env.ORACLE_STORAGE_LIST_PAR_URL;
}

async function getOracleUsage(env) {
  if (!oracleConfigured(env)) return null;

  const url = `${env.ORACLE_STORAGE_LIST_PAR_URL}?fields=size,timeCreated`;
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error(`oracle_list_failed: ${res.status} ${JSON.stringify(data)}`);
  }

  const objects = data.objects || [];
  const totalBytes = objects.reduce((sum, o) => sum + (o.size || 0), 0);
  const lastBackupAt = objects.reduce((latest, o) => {
    return !latest || (o.timeCreated && o.timeCreated > latest) ? o.timeCreated : latest;
  }, null);

  return {
    objectCount: objects.length,
    totalBytes,
    lastBackupAt,
    limits: ORACLE_FREE_LIMITS,
  };
}

export { oracleConfigured, getOracleUsage };
