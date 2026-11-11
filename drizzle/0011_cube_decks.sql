ALTER TABLE "decks" DROP CONSTRAINT "decks_format_check";--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "target_size" integer;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_target_size_check" CHECK ("decks"."target_size" IS NULL OR ("decks"."target_size" > 0 AND "decks"."target_size" <= 2000));--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_format_check" CHECK ("decks"."format" IN ('commander', 'cube'));