-- pg_trgm powers the fuzzy card-name search in Phase 1: a GIN index on
-- oracle_cards.name and printings.name lets "lightnig bolt" still find
-- Lightning Bolt. Verified available on Neon at version 1.6.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
