/**
 * Weekly backup of the data that cannot be regenerated.  `npm run backup`
 *
 * Builds the same export the download button produces, gzips it, and puts it
 * somewhere it will outlive this database:
 *
 *   BACKUP_BUCKET set   → gs://<bucket>/backups/magictracker-<timestamp>.json.gz
 *   otherwise           → ./backups/magictracker-<date>.json.gz
 *
 * The upload is a plain HTTPS POST with a token from the metadata server, so
 * this adds no dependency: `@google-cloud/storage` is 40 MB of client library
 * to make one request that fetch already makes.
 *
 * **Object names carry a timestamp, and that is deliberate.** The job's
 * service account holds `storage.objectCreator` and nothing else — it can
 * write new objects but cannot read, overwrite or delete any. A fixed name
 * would need delete permission to re-run, which is exactly the permission you
 * do not want on the identity that runs unattended every week. A lifecycle
 * rule on the bucket prunes old copies instead.
 *
 * It is the last job in the weekly run, so the file includes anything the
 * earlier jobs changed.
 */
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { config } from "dotenv";
import { sql } from "drizzle-orm";

config({ path: ".env.local" });

// The direct endpoint, like the other jobs. lib/db reads DATABASE_URL on
// first use, so this has to happen before it is imported.
if (process.env.DATABASE_URL_UNPOOLED) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
} else if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) must be set.");
} else {
  console.warn(
    "WARNING: DATABASE_URL_UNPOOLED is not set; using the pooled endpoint.",
  );
}

const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

function log(message: string): void {
  console.log(`[backup] ${message}`);
}

/** A sortable, filename-safe stamp: 2026-11-11T0917Z. */
function stamp(when = new Date()): string {
  return `${when.toISOString().slice(0, 10)}T${when
    .toISOString()
    .slice(11, 16)
    .replace(":", "")}Z`;
}

/**
 * The runtime service account's access token.
 *
 * Only on GCP. Locally there is no metadata server, so this returns null
 * quickly rather than hanging: the two-second timeout is the whole fallback
 * mechanism.
 */
async function metadataToken(): Promise<string | null> {
  try {
    const response = await fetch(METADATA_TOKEN_URL, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { access_token?: string };
    return body.access_token ?? null;
  } catch {
    return null;
  }
}

async function uploadToBucket(
  bucket: string,
  objectName: string,
  body: Buffer,
): Promise<void> {
  const token = process.env.BACKUP_TOKEN ?? (await metadataToken());
  if (!token) {
    throw new Error(
      "BACKUP_BUCKET is set but no access token is available. " +
        "On GCP that means the metadata server is unreachable; locally, pass " +
        "BACKUP_TOKEN=$(gcloud auth print-access-token).",
    );
  }

  const url =
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o` +
    `?uploadType=media&name=${encodeURIComponent(objectName)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/gzip",
    },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `upload failed: ${response.status} ${response.statusText} ${detail.slice(0, 300)}`,
    );
  }
}

async function main(): Promise<void> {
  const { getDb } = await import("../lib/db");
  const { buildExport } = await import("../lib/export/build");

  const db = getDb();

  const { rows: runRows } = await db.execute<{ id: string }>(sql`
    INSERT INTO ingest_runs (source, status)
    VALUES ('backup', 'running')
    RETURNING id::text AS id
  `);
  const runId = runRows[0].id;

  try {
    const data = await buildExport();
    const json = JSON.stringify(data, null, 2);
    const gz = gzipSync(Buffer.from(json, "utf8"), { level: 9 });

    const rows =
      data.counts.collectionItems +
      data.counts.decks +
      data.counts.deckCards +
      data.counts.locations +
      data.counts.completionTargets;

    log(
      `${data.counts.collectionItems} collection rows (${data.counts.collectionCopies} copies), ` +
        `${data.counts.decks} decks, ${data.counts.locations} locations`,
    );
    log(
      `${(json.length / 1024).toFixed(1)} KB → ${(gz.length / 1024).toFixed(1)} KB gzipped`,
    );

    const bucket = process.env.BACKUP_BUCKET;
    let destination: string;

    if (bucket) {
      const objectName = `backups/magictracker-${stamp()}.json.gz`;
      await uploadToBucket(bucket, objectName, gz);
      destination = `gs://${bucket}/${objectName}`;
    } else {
      const dir = path.resolve("backups");
      mkdirSync(dir, { recursive: true });
      const file = path.join(
        dir,
        `magictracker-${new Date().toISOString().slice(0, 10)}.json.gz`,
      );
      writeFileSync(file, gz);
      destination = file;
    }

    log(`wrote ${destination}`);

    await db.execute(sql`
      UPDATE ingest_runs
         SET status = 'ok', finished_at = now(), row_count = ${rows},
             warnings = ${JSON.stringify([{ kind: "destination", destination }])}
       WHERE id = ${runId}::uuid
    `);
  } catch (error) {
    await db.execute(sql`
      UPDATE ingest_runs
         SET status = 'failed', finished_at = now(),
             error = ${error instanceof Error ? error.message : String(error)}
       WHERE id = ${runId}::uuid
    `);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nbackup failed:", error);
    process.exit(1);
  });
