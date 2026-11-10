import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DATABASE_URL_UNPOOLED (or DATABASE_URL) must be set. See .env.example.",
  );
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Migrations run against the direct (unpooled) endpoint: DDL and the bulk
  // COPY in Phase 1 both behave badly through PgBouncer's transaction pooling.
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
