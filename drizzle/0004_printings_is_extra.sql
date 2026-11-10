ALTER TABLE "printings" ADD COLUMN "is_extra" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill for rows already ingested, so the column is correct without
-- re-downloading the bulk file. Must stay in sync with isExtraCard() in
-- lib/scryfall/project.ts, which is what sets the column on future runs.
UPDATE "printings" p
   SET "is_extra" = true
 WHERE p."layout" IN (
         'art_series','token','double_faced_token','emblem',
         'scheme','planar','vanguard','augment','host'
       )
    OR EXISTS (
         SELECT 1 FROM "sets" s
          WHERE s."code" = p."set_code"
            AND s."set_type" IN ('token','memorabilia')
       );
