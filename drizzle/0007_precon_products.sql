CREATE TABLE "precon_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"board" text NOT NULL,
	"scryfall_id" uuid,
	"card_name" text NOT NULL,
	"mtgjson_set_code" text,
	"collector_number" text,
	"quantity" integer NOT NULL,
	"is_foil" boolean DEFAULT false NOT NULL,
	"is_etched" boolean DEFAULT false NOT NULL,
	CONSTRAINT "precon_cards_quantity_check" CHECK ("precon_cards"."quantity" > 0),
	CONSTRAINT "precon_cards_board_check" CHECK ("precon_cards"."board" IN ('commander', 'main', 'side', 'token', 'plane', 'scheme'))
);
--> statement-breakpoint
CREATE TABLE "precon_products" (
	"file_name" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mtgjson_set_code" text NOT NULL,
	"product_type" text NOT NULL,
	"released_at" date,
	"source" text,
	"card_count" integer,
	"distinct_count" integer,
	"unidentified_count" integer,
	"contents_version" text,
	"contents_fetched_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "precon_cards" ADD CONSTRAINT "precon_cards_file_name_precon_products_file_name_fk" FOREIGN KEY ("file_name") REFERENCES "public"."precon_products"("file_name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "precon_cards_file_idx" ON "precon_cards" USING btree ("file_name","board");--> statement-breakpoint
CREATE INDEX "precon_cards_scryfall_idx" ON "precon_cards" USING btree ("scryfall_id");--> statement-breakpoint
CREATE UNIQUE INDEX "precon_cards_identity_key" ON "precon_cards" USING btree ("file_name","board","scryfall_id","is_foil","is_etched");--> statement-breakpoint
CREATE INDEX "precon_products_type_idx" ON "precon_products" USING btree ("product_type","released_at");--> statement-breakpoint
CREATE INDEX "precon_products_set_idx" ON "precon_products" USING btree ("mtgjson_set_code");--> statement-breakpoint
CREATE INDEX "precon_products_name_trgm_idx" ON "precon_products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "precon_products_released_idx" ON "precon_products" USING btree ("released_at");