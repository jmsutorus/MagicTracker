ALTER TABLE "collection_items" DROP CONSTRAINT "collection_items_finish_check";--> statement-breakpoint
ALTER TABLE "price_snapshots" DROP CONSTRAINT "price_snapshots_finish_check";--> statement-breakpoint
ALTER TABLE "wishlist_items" DROP CONSTRAINT "wishlist_items_finish_check";--> statement-breakpoint
ALTER TABLE "oracle_cards" ADD COLUMN "game" text DEFAULT 'mtg' NOT NULL;--> statement-breakpoint
ALTER TABLE "oracle_cards" ADD COLUMN "game_data" jsonb;--> statement-breakpoint
ALTER TABLE "printings" ADD COLUMN "game" text DEFAULT 'mtg' NOT NULL;--> statement-breakpoint
ALTER TABLE "printings" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "printings" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "printings" ADD COLUMN "art_url" text;--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "game" text DEFAULT 'mtg' NOT NULL;--> statement-breakpoint
CREATE INDEX "oracle_cards_game_name_idx" ON "oracle_cards" USING btree ("game","name");--> statement-breakpoint
CREATE INDEX "printings_game_name_idx" ON "printings" USING btree ("game","name");--> statement-breakpoint
CREATE INDEX "printings_game_external_idx" ON "printings" USING btree ("game","external_id");--> statement-breakpoint
CREATE INDEX "sets_game_idx" ON "sets" USING btree ("game","released_at");--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_finish_check" CHECK ("collection_items"."finish" IN ('nonfoil', 'foil', 'etched', 'reverse'));--> statement-breakpoint
ALTER TABLE "oracle_cards" ADD CONSTRAINT "oracle_cards_game_check" CHECK ("oracle_cards"."game" IN ('mtg', 'pokemon', 'onepiece'));--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_finish_check" CHECK ("price_snapshots"."finish" IN ('nonfoil', 'foil', 'etched', 'reverse'));--> statement-breakpoint
ALTER TABLE "printings" ADD CONSTRAINT "printings_game_check" CHECK ("printings"."game" IN ('mtg', 'pokemon', 'onepiece'));--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_game_check" CHECK ("sets"."game" IN ('mtg', 'pokemon', 'onepiece'));--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_finish_check" CHECK ("wishlist_items"."finish" IS NULL OR "wishlist_items"."finish" IN ('nonfoil', 'foil', 'etched', 'reverse'));--> statement-breakpoint
--
-- Backfill the image URLs for every Magic printing already in the table.
--
-- `image_url` and `art_url` become the single source every list and card page
-- reads, because no other catalog's URLs are derivable from the card's id the
-- way Scryfall's are. Written here with the same path shape as
-- cardImageUrl() in lib/scryfall/client.ts, so the 110k rows that predate the
-- columns are indistinguishable from the ones the next ingest writes.
--
-- Still hotlinks, never re-hosts: this stores where the picture is, not the
-- picture. Scryfall's ids are permanent, so the URLs are too.
--
UPDATE "printings"
   SET "image_url" = 'https://cards.scryfall.io/normal/front/'
                     || substr("scryfall_id"::text, 1, 1) || '/'
                     || substr("scryfall_id"::text, 2, 1) || '/'
                     || "scryfall_id"::text || '.jpg',
       "art_url"   = 'https://cards.scryfall.io/art_crop/front/'
                     || substr("scryfall_id"::text, 1, 1) || '/'
                     || substr("scryfall_id"::text, 2, 1) || '/'
                     || "scryfall_id"::text || '.jpg'
 WHERE "game" = 'mtg'
   AND "image_url" IS NULL;
