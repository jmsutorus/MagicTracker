CREATE TABLE "completion_targets" (
	"set_code" text PRIMARY KEY NOT NULL,
	"booster_only" boolean DEFAULT true NOT NULL,
	"include_promos" boolean DEFAULT false NOT NULL,
	"include_extras" boolean DEFAULT false NOT NULL,
	"finish" text DEFAULT 'any' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "completion_targets_finish_check" CHECK ("completion_targets"."finish" IN ('any', 'nonfoil', 'foil', 'etched'))
);
--> statement-breakpoint
ALTER TABLE "completion_targets" ADD CONSTRAINT "completion_targets_set_code_sets_code_fk" FOREIGN KEY ("set_code") REFERENCES "public"."sets"("code") ON DELETE cascade ON UPDATE no action;