DROP INDEX "printings_set_collector_lang_key";--> statement-breakpoint
CREATE INDEX "printings_set_collector_lang_idx" ON "printings" USING btree ("set_code","collector_number","lang");