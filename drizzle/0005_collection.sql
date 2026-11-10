CREATE TABLE "collection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"printing_id" uuid NOT NULL,
	"finish" text DEFAULT 'nonfoil' NOT NULL,
	"condition" text DEFAULT 'NM' NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"acquired_at" date,
	"acquired_price_cents" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_items_quantity_check" CHECK ("collection_items"."quantity" > 0),
	CONSTRAINT "collection_items_finish_check" CHECK ("collection_items"."finish" IN ('nonfoil', 'foil', 'etched')),
	CONSTRAINT "collection_items_condition_check" CHECK ("collection_items"."condition" IN ('NM', 'LP', 'MP', 'HP', 'DMG'))
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'box' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_kind_check" CHECK ("locations"."kind" IN ('binder', 'box', 'deck', 'tradeable', 'sold'))
);
--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_printing_id_printings_scryfall_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printings"("scryfall_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collection_items_identity_key" ON "collection_items" USING btree ("printing_id","finish","condition","location_id");--> statement-breakpoint
CREATE INDEX "collection_items_printing_idx" ON "collection_items" USING btree ("printing_id");--> statement-breakpoint
CREATE INDEX "collection_items_location_idx" ON "collection_items" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_name_lower_key" ON "locations" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "locations_sort_idx" ON "locations" USING btree ("sort_order","name");--> statement-breakpoint
-- Every collection needs somewhere for cards to land before they are sorted.
-- collection_items.location_id is NOT NULL, so without this row the entry
-- screen would have nothing to default to and the first add would fail.
INSERT INTO "locations" ("name", "kind", "sort_order")
VALUES ('Unsorted', 'box', -100)
ON CONFLICT DO NOTHING;
