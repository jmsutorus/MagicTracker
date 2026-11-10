CREATE TABLE "ingest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"row_count" integer,
	"scryfall_bulk_updated_at" timestamp with time zone,
	"mtgjson_version" text,
	"warnings" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "ingest_runs_source_started_at_idx" ON "ingest_runs" USING btree ("source","started_at");