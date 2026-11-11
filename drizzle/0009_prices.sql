CREATE TABLE "price_snapshots" (
	"printing_id" uuid NOT NULL,
	"finish" text NOT NULL,
	"source" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"price_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_snapshots_printing_id_finish_source_snapshot_date_pk" PRIMARY KEY("printing_id","finish","source","snapshot_date"),
	CONSTRAINT "price_snapshots_price_check" CHECK ("price_snapshots"."price_cents" >= 0),
	CONSTRAINT "price_snapshots_finish_check" CHECK ("price_snapshots"."finish" IN ('nonfoil', 'foil', 'etched'))
);
--> statement-breakpoint
CREATE TABLE "value_snapshots" (
	"snapshot_date" date NOT NULL,
	"source" text NOT NULL,
	"total_cents" integer NOT NULL,
	"priced_copies" integer DEFAULT 0 NOT NULL,
	"unpriced_copies" integer DEFAULT 0 NOT NULL,
	"unpriced_items" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "value_snapshots_snapshot_date_source_pk" PRIMARY KEY("snapshot_date","source"),
	CONSTRAINT "value_snapshots_total_check" CHECK ("value_snapshots"."total_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_printing_id_printings_scryfall_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printings"("scryfall_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_snapshots_latest_idx" ON "price_snapshots" USING btree ("printing_id","finish","source","snapshot_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "price_snapshots_date_idx" ON "price_snapshots" USING btree ("snapshot_date");