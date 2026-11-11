CREATE TABLE "wishlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oracle_id" uuid NOT NULL,
	"printing_id" uuid,
	"finish" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlist_items_card_key" UNIQUE NULLS NOT DISTINCT("oracle_id","printing_id","finish"),
	CONSTRAINT "wishlist_items_quantity_check" CHECK ("wishlist_items"."quantity" > 0),
	CONSTRAINT "wishlist_items_finish_check" CHECK ("wishlist_items"."finish" IS NULL OR "wishlist_items"."finish" IN ('nonfoil', 'foil', 'etched'))
);
--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_oracle_id_oracle_cards_oracle_id_fk" FOREIGN KEY ("oracle_id") REFERENCES "public"."oracle_cards"("oracle_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_printing_id_printings_scryfall_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printings"("scryfall_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wishlist_items_oracle_idx" ON "wishlist_items" USING btree ("oracle_id");