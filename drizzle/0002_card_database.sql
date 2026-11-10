CREATE TABLE "oracle_cards" (
	"oracle_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mana_cost" text,
	"type_line" text,
	"oracle_text" text,
	"cmc" double precision,
	"colors" text[],
	"color_identity" text[] DEFAULT '{}' NOT NULL,
	"keywords" text[],
	"legalities" jsonb,
	"reserved" boolean DEFAULT false NOT NULL,
	"edhrec_rank" integer,
	"layout" text
);
--> statement-breakpoint
CREATE TABLE "printings" (
	"scryfall_id" uuid PRIMARY KEY NOT NULL,
	"oracle_id" uuid NOT NULL,
	"set_code" text NOT NULL,
	"collector_number" text NOT NULL,
	"collector_number_num" integer,
	"name" text NOT NULL,
	"rarity" text NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"finishes" text[] DEFAULT '{}' NOT NULL,
	"is_booster" boolean DEFAULT false NOT NULL,
	"is_promo" boolean DEFAULT false NOT NULL,
	"is_variation" boolean DEFAULT false NOT NULL,
	"frame_effects" text[],
	"border_color" text,
	"full_art" boolean DEFAULT false NOT NULL,
	"textless" boolean DEFAULT false NOT NULL,
	"layout" text,
	"released_at" date,
	"mtgjson_uuid" uuid,
	"tcgplayer_id" integer,
	"image_status" text
);
--> statement-breakpoint
CREATE TABLE "sets" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"set_type" text NOT NULL,
	"released_at" date,
	"card_count" integer DEFAULT 0 NOT NULL,
	"parent_set_code" text,
	"icon_svg_uri" text,
	"digital" boolean DEFAULT false NOT NULL,
	"mtgjson_code" text
);
--> statement-breakpoint
ALTER TABLE "printings" ADD CONSTRAINT "printings_oracle_id_oracle_cards_oracle_id_fk" FOREIGN KEY ("oracle_id") REFERENCES "public"."oracle_cards"("oracle_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printings" ADD CONSTRAINT "printings_set_code_sets_code_fk" FOREIGN KEY ("set_code") REFERENCES "public"."sets"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oracle_cards_name_trgm_idx" ON "oracle_cards" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "oracle_cards_name_idx" ON "oracle_cards" USING btree ("name");--> statement-breakpoint
CREATE INDEX "oracle_cards_color_identity_idx" ON "oracle_cards" USING gin ("color_identity");--> statement-breakpoint
CREATE UNIQUE INDEX "printings_set_collector_lang_key" ON "printings" USING btree ("set_code","collector_number","lang");--> statement-breakpoint
CREATE INDEX "printings_name_trgm_idx" ON "printings" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "printings_oracle_id_idx" ON "printings" USING btree ("oracle_id");--> statement-breakpoint
CREATE INDEX "printings_set_order_idx" ON "printings" USING btree ("set_code","collector_number_num","collector_number");--> statement-breakpoint
CREATE INDEX "sets_released_at_idx" ON "sets" USING btree ("released_at");--> statement-breakpoint
CREATE INDEX "sets_set_type_idx" ON "sets" USING btree ("set_type");--> statement-breakpoint
CREATE INDEX "sets_parent_idx" ON "sets" USING btree ("parent_set_code");