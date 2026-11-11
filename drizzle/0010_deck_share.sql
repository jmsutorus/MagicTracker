ALTER TABLE "decks" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "share_created_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "decks_share_token_key" ON "decks" USING btree ("share_token") WHERE "decks"."share_token" IS NOT NULL;