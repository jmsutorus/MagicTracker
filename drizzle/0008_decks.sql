CREATE TABLE "deck_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deck_id" uuid NOT NULL,
	"oracle_id" uuid NOT NULL,
	"printing_id" uuid,
	"board" text DEFAULT 'main' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"is_allocated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deck_cards_quantity_check" CHECK ("deck_cards"."quantity" > 0),
	CONSTRAINT "deck_cards_board_check" CHECK ("deck_cards"."board" IN ('commander', 'main', 'maybe'))
);
--> statement-breakpoint
CREATE TABLE "decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"format" text DEFAULT 'commander' NOT NULL,
	"notes" text,
	"location_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decks_format_check" CHECK ("decks"."format" IN ('commander'))
);
--> statement-breakpoint
ALTER TABLE "deck_cards" ADD CONSTRAINT "deck_cards_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_cards" ADD CONSTRAINT "deck_cards_oracle_id_oracle_cards_oracle_id_fk" FOREIGN KEY ("oracle_id") REFERENCES "public"."oracle_cards"("oracle_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_cards" ADD CONSTRAINT "deck_cards_printing_id_printings_scryfall_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printings"("scryfall_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deck_cards_identity_key" ON "deck_cards" USING btree ("deck_id","board","oracle_id");--> statement-breakpoint
CREATE INDEX "deck_cards_deck_idx" ON "deck_cards" USING btree ("deck_id","board");--> statement-breakpoint
CREATE INDEX "deck_cards_oracle_idx" ON "deck_cards" USING btree ("oracle_id");--> statement-breakpoint
CREATE INDEX "deck_cards_allocated_idx" ON "deck_cards" USING btree ("is_allocated");--> statement-breakpoint
CREATE UNIQUE INDEX "decks_name_lower_key" ON "decks" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "decks_location_idx" ON "decks" USING btree ("location_id");