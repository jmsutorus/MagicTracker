ALTER TABLE "deck_cards" DROP CONSTRAINT "deck_cards_board_check";--> statement-breakpoint
ALTER TABLE "decks" DROP CONSTRAINT "decks_format_check";--> statement-breakpoint
ALTER TABLE "deck_cards" ADD CONSTRAINT "deck_cards_board_check" CHECK ("deck_cards"."board" IN ('commander', 'main', 'side', 'maybe'));--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_format_check" CHECK ("decks"."format" IN ('commander', 'standard', 'cube'));