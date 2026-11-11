import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * MACHINE-OWNED TABLES (sets / oracle_cards / printings)
 *
 * Rebuilt from Scryfall bulk data by scripts/ingest-cards.ts, and never
 * written to by hand.
 *
 * The ingest UPSERTS; it must never TRUNCATE. From Phase 2 onward
 * `collection_items` references `printings.scryfall_id`, so truncating would
 * either fail on the foreign key or cascade into the collection and delete the
 * record of cards you physically own. Scryfall IDs are stable, so upserting is
 * also sufficient — a reload is a refresh, not a replacement.
 *
 * The ingest must likewise never write to human-owned tables (collection,
 * decks, locations).
 */

export const sets = pgTable(
  "sets",
  {
    /**
     * Scryfall set code, and the grouping key for set completion.
     *
     * This is what implements "cards sharing a set symbol": `blb` (Bloomburrow)
     * and `blc` (Bloomburrow Commander) are distinct codes with distinct
     * icons, which is the split we want. Note that the *icon* is NOT a unique
     * key — `pblb` (Bloomburrow Promos) reuses `blb`'s icon file — so grouping
     * on the icon would silently fold 160 promos into the main set. Grouping on
     * the code separates them, and `set_type = 'promo'` lets completion
     * targets exclude them by default.
     */
    code: text("code").primaryKey(),

    name: text("name").notNull(),

    /** core | expansion | commander | masters | promo | token | memorabilia | … */
    setType: text("set_type").notNull(),

    releasedAt: date("released_at"),

    /** Scryfall's own count — includes extras, so not a completion target. */
    cardCount: integer("card_count").notNull().default(0),

    /** e.g. `blc` and `pblb` both point at `blb`. */
    parentSetCode: text("parent_set_code"),

    iconSvgUri: text("icon_svg_uri"),

    /** Arena/MTGO-only sets. Excluded from a physical collection. */
    digital: boolean("digital").notNull().default(false),

    /** Set code as MTGJSON spells it, for the Phase 4 product join. */
    mtgjsonCode: text("mtgjson_code"),
  },
  (table) => [
    index("sets_released_at_idx").on(table.releasedAt),
    index("sets_set_type_idx").on(table.setType),
    index("sets_parent_idx").on(table.parentSetCode),
  ],
);

/**
 * The game object — "Lightning Bolt", independent of which set it was printed
 * in. Decks, legality and singleton rules operate at this level.
 */
export const oracleCards = pgTable(
  "oracle_cards",
  {
    oracleId: uuid("oracle_id").primaryKey(),

    name: text("name").notNull(),

    /** For multi-faced cards, faces joined with " // ". */
    manaCost: text("mana_cost"),
    typeLine: text("type_line"),
    oracleText: text("oracle_text"),

    cmc: doublePrecision("cmc"),

    colors: text("colors").array(),

    /**
     * The Commander constraint in Phase 5 is
     * `color_identity <@ commander_identity` — a Postgres array containment
     * test. This column is the reason that stays a one-line predicate.
     */
    colorIdentity: text("color_identity")
      .array()
      .notNull()
      .default(sql`'{}'`),

    keywords: text("keywords").array(),

    /** { commander: 'legal', modern: 'banned', … } — read for banned lists. */
    legalities: jsonb("legalities").$type<Record<string, string>>(),

    reserved: boolean("reserved").notNull().default(false),
    edhrecRank: integer("edhrec_rank"),

    /** normal | split | transform | modal_dfc | token | art_series | … */
    layout: text("layout"),
  },
  (table) => [
    // Fuzzy name search. gin_trgm_ops is what makes "lightnig bolt" find
    // Lightning Bolt; a plain btree index cannot answer a similarity query.
    index("oracle_cards_name_trgm_idx").using(
      "gin",
      sql`${table.name} gin_trgm_ops`,
    ),
    index("oracle_cards_name_idx").on(table.name),
    index("oracle_cards_color_identity_idx").using("gin", table.colorIdentity),
  ],
);

/**
 * A specific physical card: this oracle card, in this set, at this collector
 * number. Set completion, prices and images all operate at this level.
 */
export const printings = pgTable(
  "printings",
  {
    /** Scryfall card UUID. Also derives the image URL, so no URLs stored. */
    scryfallId: uuid("scryfall_id").primaryKey(),

    /**
     * Declared as real foreign keys. The ingest reloads these tables inside
     * one transaction in dependency order, so a printing referencing a set or
     * oracle card we failed to load aborts the run instead of silently
     * creating an orphan that later shows up as a card missing from a set.
     */
    oracleId: uuid("oracle_id")
      .notNull()
      .references(() => oracleCards.oracleId, { onDelete: "cascade" }),
    setCode: text("set_code")
      .notNull()
      .references(() => sets.code, { onDelete: "cascade" }),

    /** A string, not a number: "123a", "★12", "A-45" all occur. */
    collectorNumber: text("collector_number").notNull(),

    /**
     * Leading integer of collector_number, for ordering.
     * Sorting the raw string gives 1, 10, 100, 2 — useless for a
     * "what am I missing" list that should read in set order.
     */
    collectorNumberNum: integer("collector_number_num"),

    /** Denormalized: avoids a join to render a search result row. */
    name: text("name").notNull(),

    /** common | uncommon | rare | mythic | special | bonus */
    rarity: text("rarity").notNull(),

    lang: text("lang").notNull().default("en"),

    /** nonfoil | foil | etched — which finishes this printing exists in. */
    finishes: text("finishes")
      .array()
      .notNull()
      .default(sql`'{}'`),

    /**
     * The three flags that make completion scope configurable (PLAN.md §4).
     * Within `blb`, 266 cards are booster-obtainable and 75 are borderless or
     * extended-art treatments sharing the same code and icon — so "complete
     * Bloomburrow" is 266 or ~341 depending on these.
     */
    isBooster: boolean("is_booster").notNull().default(false),
    isPromo: boolean("is_promo").notNull().default(false),
    isVariation: boolean("is_variation").notNull().default(false),

    frameEffects: text("frame_effects").array(),
    borderColor: text("border_color"),
    fullArt: boolean("full_art").notNull().default(false),
    textless: boolean("textless").notNull().default(false),

    /** normal | split | transform | modal_dfc | … */
    layout: text("layout"),

    /**
     * Real cardboard that isn't a playable card: art series, tokens, emblems.
     * Kept in the database (people collect them) but ranked below playable
     * cards in search, and excluded from set completion by default — an art
     * series card named "Lightning Bolt // Lightning Bolt" should never
     * outrank Lightning Bolt.
     */
    isExtra: boolean("is_extra").notNull().default(false),

    releasedAt: date("released_at"),

    /** Cross-references for Phase 4 (products) and Phase 7 (prices). */
    mtgjsonUuid: uuid("mtgjson_uuid"),
    tcgplayerId: integer("tcgplayer_id"),

    /** missing | placeholder | lowres | highres_scan */
    imageStatus: text("image_status"),
  },
  (table) => [
    /**
     * Deliberately NOT unique. (set_code, collector_number, lang) looks like a
     * natural key, but it is Scryfall's data rather than our identity —
     * `scryfall_id` is the primary key. Asserting uniqueness here makes the
     * weekly unattended ingest abort if upstream ever reassigns a collector
     * number to a different card id, and nothing in the app depends on it:
     * collector-number entry showing two candidates is correct behavior if the
     * data really holds two.
     */
    index("printings_set_collector_lang_idx").on(
      table.setCode,
      table.collectorNumber,
      table.lang,
    ),
    index("printings_name_trgm_idx").using(
      "gin",
      sql`${table.name} gin_trgm_ops`,
    ),
    index("printings_oracle_id_idx").on(table.oracleId),
    // Covers both the completion query and collector-number entry in Phase 2.
    index("printings_set_order_idx").on(
      table.setCode,
      table.collectorNumberNum,
      table.collectorNumber,
    ),
  ],
);

/**
 * HUMAN-OWNED / OPERATIONAL
 */
export const ingestRuns = pgTable(
  "ingest_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** 'scryfall' | 'mtgjson' | 'prices' */
    source: text("source").notNull(),

    /** 'running' | 'ok' | 'failed' | 'skipped' */
    status: text("status").notNull(),

    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),

    rowCount: integer("row_count"),

    /**
     * Source versions. The ingest compares these against live bulk metadata and
     * exits early when nothing changed, so a weekly cron doesn't re-download
     * 500 MB for no reason.
     */
    scryfallBulkUpdatedAt: timestamp("scryfall_bulk_updated_at", {
      withTimezone: true,
    }),
    mtgjsonVersion: text("mtgjson_version"),

    /**
     * Rows that could not be resolved — e.g. an MTGJSON precon card with no
     * matching Scryfall printing. Recorded rather than dropped so gaps on
     * brand-new products are visible instead of silent.
     */
    warnings: jsonb("warnings").$type<unknown[]>(),

    error: text("error"),
  },
  (table) => [
    index("ingest_runs_source_started_at_idx").on(
      table.source,
      table.startedAt,
    ),
  ],
);

/**
 * HUMAN-OWNED TABLES (locations / collection_items)
 *
 * These hold the only data in this database that cannot be regenerated. The
 * card tables above can be rebuilt from Scryfall in 35 seconds; the record of
 * which cards are physically in which binder exists nowhere else.
 *
 * `collection_items.printing_id` is therefore declared ON DELETE RESTRICT,
 * not CASCADE. If anything ever tries to delete a printing somebody owns, the
 * delete must fail loudly rather than quietly taking the collection row with
 * it. Note that this makes the restriction transitive: `printings` cascades
 * from `oracle_cards` and `sets`, so deleting an oracle card whose printing is
 * owned now aborts too, which is the intent.
 */

/**
 * Domain values live in lib/collection/constants.ts and are re-exported here.
 * That module has no imports, so client components can use the same constants
 * without pulling drizzle-orm into the browser bundle.
 */
export {
  CARD_CONDITIONS,
  CARD_FINISHES,
  COMPLETION_FINISHES,
  DEFAULT_COMPLETION_SCOPE,
  DEFAULT_LOCATION_NAME,
  LOCATION_KINDS,
} from "@/lib/collection/constants";
export type {
  CardCondition,
  CardFinish,
  CompletionFinish,
  CompletionScope,
  LocationKind,
} from "@/lib/collection/constants";
export {
  DEFAULT_PRECON_BOARDS,
  DEFAULT_PRODUCT_TYPE,
  PRECON_BOARDS,
  PRECON_BOARD_LABELS,
} from "@/lib/products/constants";
export type { PreconBoard } from "@/lib/products/constants";

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    name: text("name").notNull(),

    kind: text("kind").notNull().default("box"),

    /** Hand-ordered so the places you use most sit at the top of the picker. */
    sortOrder: integer("sort_order").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Case-insensitive: "Binder A" and "binder a" are the same shelf, and
    // letting both exist would split one binder's contents across two rows.
    uniqueIndex("locations_name_lower_key").on(sql`lower(${table.name})`),
    index("locations_sort_idx").on(table.sortOrder, table.name),
    check(
      "locations_kind_check",
      sql`${table.kind} IN ('binder', 'box', 'deck', 'tradeable', 'sold')`,
    ),
  ],
);

/**
 * What I physically own: this printing, in this finish, at this condition, in
 * this place — and how many.
 *
 * Copies are aggregated rather than stored one row per card: entering a
 * playset means quantity 4, not four rows. The unique key is what makes that
 * work, and it is why `add` is an upsert that adds to `quantity` instead of an
 * insert.
 *
 * Language is deliberately NOT a column here, which is a departure from the
 * original sketch in PLAN.md §5. Scryfall models each language as its own
 * printing, so `printings.lang` already answers it; a second copy of the same
 * fact could only ever disagree with the first.
 */
export const collectionItems = pgTable(
  "collection_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    printingId: uuid("printing_id")
      .notNull()
      .references(() => printings.scryfallId, { onDelete: "restrict" }),

    finish: text("finish").notNull().default("nonfoil"),
    condition: text("condition").notNull().default("NM"),

    /**
     * Required, not nullable. Partly because "where is it" is a question this
     * app exists to answer, and partly because a nullable column cannot carry
     * the unique key: Postgres treats NULLs as distinct, so every unplaced
     * copy of a card would get its own row instead of merging. Everything
     * starts in the seeded `Unsorted` location.
     */
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),

    quantity: integer("quantity").notNull().default(1),

    acquiredAt: date("acquired_at"),

    /**
     * Set when the row is created and never overwritten by a later merge:
     * once two acquisitions at different prices have been folded into one
     * quantity, no single price is the truth. Phase 7 compares this against
     * market value, so a wrong number here is worse than a missing one.
     */
    acquiredPriceCents: integer("acquired_price_cents"),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("collection_items_identity_key").on(
      table.printingId,
      table.finish,
      table.condition,
      table.locationId,
    ),
    index("collection_items_printing_idx").on(table.printingId),
    index("collection_items_location_idx").on(table.locationId),
    // A zero-quantity row is not "I own none of these", it is a row that
    // should have been deleted. Enforced so a bad decrement cannot leave one.
    check("collection_items_quantity_check", sql`${table.quantity} > 0`),
    check(
      "collection_items_finish_check",
      sql`${table.finish} IN ('nonfoil', 'foil', 'etched')`,
    ),
    check(
      "collection_items_condition_check",
      sql`${table.condition} IN ('NM', 'LP', 'MP', 'HP', 'DMG')`,
    ),
  ],
);

/**
 * What "complete" means for one set — stored per set, because there is no
 * objectively right answer.
 *
 * Within `blb`, 281 cards are booster-obtainable (collector numbers 1-281)
 * and another 116 are Collector Booster treatments and promos sharing the
 * same code and set symbol. So "complete Bloomburrow" is 281 or 397
 * depending on what you meant, and only you can say which.
 *
 * Every completion view reads these flags at query time, so changing one
 * recalculates progress rather than invalidating a stored number.
 *
 * Unlike `collection_items`, this cascades on set deletion rather than
 * restricting it: a scope row is four re-creatable toggles, and it should
 * never be the thing that aborts a card-database refresh. The collection
 * itself is irreplaceable, which is why that one restricts.
 *
 * Two departures from PLAN.md §4, both forced by the real data:
 *
 * - **No `include_variants`.** It was specified as `NOT is_variation`, but
 *   Scryfall sets `variation` on nothing in blb, blc or pblb — the toggle
 *   would have been inert. The borderless and extended-art treatments it was
 *   meant to control are exactly the non-booster cards, so `booster_only`
 *   already draws that line. `include_extras` replaces it and does something.
 * - **Exclusions never empty a set.** `booster_only` is ignored for a set
 *   with no booster-obtainable cards at all, and the same for the other two.
 *   Of ~971 non-digital sets with cards, most have zero booster printings —
 *   every commander deck, every duel deck, 277 of 278 promo sets — so
 *   applying the flag unconditionally would report a completion target of
 *   zero cards for most of the sets someone actually owns.
 */
export const completionTargets = pgTable(
  "completion_targets",
  {
    setCode: text("set_code")
      .primaryKey()
      .references(() => sets.code, { onDelete: "cascade" }),

    boosterOnly: boolean("booster_only").notNull().default(true),
    includePromos: boolean("include_promos").notNull().default(false),
    includeExtras: boolean("include_extras").notNull().default(false),

    /** any | nonfoil | foil | etched */
    finish: text("finish").notNull().default("any"),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "completion_targets_finish_check",
      sql`${table.finish} IN ('any', 'nonfoil', 'foil', 'etched')`,
    ),
  ],
);

/**
 * SEALED PRODUCTS (precon_products / precon_cards)
 *
 * Machine-owned, from MTGJSON rather than Scryfall, and regenerable — so
 * unlike `collection_items` these cascade freely.
 *
 * **Why only precons.** PLAN.md §7 says "ingest products and precons", but a
 * booster box has no deterministic contents: "add a booster box to my
 * collection" cannot name a single card. A precon is the one sealed product
 * whose card list is fixed, which is exactly what makes adding it in one
 * action possible. So this models decks, and the two-click path is for the
 * product the user actually buys.
 *
 * **Why the catalog and the contents are separate tables, filled at different
 * times.** MTGJSON publishes no download dedicated to sealed products;
 * contents live inside `AllPrintings.json.gz` (176 MB) or `AllDeckFiles.zip`
 * (253 MB), while the catalog alone is `DeckList.json` at 0.65 MB and one
 * deck is ~0.5 MB at `/api/v5/decks/<file_name>.json`. Ingesting 3,144 decks
 * to make four of them addable would be 253 MB for a few hundred rows. So the
 * weekly job loads only the catalog, and a product's contents are fetched the
 * first time you open it and then cached here forever.
 */

/**
 * One sealed product with a known card list — mostly Commander precons.
 *
 * Rows arrive from MTGJSON's `DeckList.json`; the contents columns stay null
 * until someone opens the product.
 */
export const preconProducts = pgTable(
  "precon_products",
  {
    /**
     * MTGJSON's deck identifier (`FamilyMatters_BLC`), used as the primary key
     * and as this app's URL slug. It is stable across MTGJSON releases, unlike
     * the display name, and unique across all 3,144 decks.
     */
    fileName: text("file_name").primaryKey(),

    name: text("name").notNull(),

    /**
     * The set code as MTGJSON spells it (`BLC`), joined to
     * `sets.mtgjson_code` at query time rather than stored as a foreign key.
     *
     * Live-joined for two reasons. 298 of the 304 codes match a Scryfall set,
     * but `Q01`-`Q08` (MTGJSON's Challenger-deck codes) match nothing — so a
     * foreign key here would reject six real products. And resolving at query
     * time means a later card ingest that adds a brand-new set fixes the link
     * with no product re-ingest.
     */
    mtgjsonSetCode: text("mtgjson_set_code").notNull(),

    /** MTGJSON's own classification: "Commander Deck", "Theme Deck", … */
    productType: text("product_type").notNull(),

    releasedAt: date("released_at"),

    /** Wizards' decklist article, where MTGJSON records one. */
    source: text("source"),

    /** Total copies across every board, set when the contents are fetched. */
    cardCount: integer("card_count"),

    /** Distinct printings across every board. */
    distinctCount: integer("distinct_count"),

    /**
     * Entries MTGJSON gave us with no Scryfall id at all. A card whose id we
     * have but whose printing we have not ingested yet is NOT counted here —
     * that one resolves itself on the next card ingest, so it is computed by
     * the join instead of frozen into a column.
     */
    unidentifiedCount: integer("unidentified_count"),

    /** The MTGJSON version the contents were fetched at, for staleness. */
    contentsVersion: text("contents_version"),
    contentsFetchedAt: timestamp("contents_fetched_at", { withTimezone: true }),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("precon_products_type_idx").on(table.productType, table.releasedAt),
    index("precon_products_set_idx").on(table.mtgjsonSetCode),
    index("precon_products_name_trgm_idx").using(
      "gin",
      sql`${table.name} gin_trgm_ops`,
    ),
    index("precon_products_released_idx").on(table.releasedAt),
  ],
);

/**
 * One line of a precon's card list.
 *
 * `scryfall_id` deliberately has **no foreign key** to `printings`. The join
 * is a LEFT JOIN at query time, which makes "did this card resolve" a live
 * question instead of stored state: a card MTGJSON lists before Scryfall has
 * it shows as unresolved today and silently starts working after the next
 * card ingest, with no product re-fetch. A real foreign key would instead
 * make a brand-new product fail to insert at all.
 *
 * The name, set code and collector number are kept alongside it so an
 * unresolved line still reads as a card in the UI rather than a bare UUID.
 */
export const preconCards = pgTable(
  "precon_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    fileName: text("file_name")
      .notNull()
      .references(() => preconProducts.fileName, { onDelete: "cascade" }),

    /** commander | main | side | token | plane | scheme */
    board: text("board").notNull(),

    /** Null when MTGJSON itself has no Scryfall id for the entry. */
    scryfallId: uuid("scryfall_id"),

    cardName: text("card_name").notNull(),
    mtgjsonSetCode: text("mtgjson_set_code"),
    collectorNumber: text("collector_number"),

    quantity: integer("quantity").notNull(),

    /**
     * The finish the product ships that copy in — a precon commander is
     * usually foil. Honored when adding, but clamped to a finish the printing
     * was actually made in; see addProductToCollection.
     */
    isFoil: boolean("is_foil").notNull().default(false),
    isEtched: boolean("is_etched").notNull().default(false),
  },
  (table) => [
    index("precon_cards_file_idx").on(table.fileName, table.board),
    index("precon_cards_scryfall_idx").on(table.scryfallId),
    /**
     * Identity of a line. Duplicate entries are summed before insert rather
     * than stored twice, so this both holds and means something. NULL
     * scryfall ids are distinct in Postgres, which is the behavior we want:
     * two unidentified lines are two different cards.
     */
    uniqueIndex("precon_cards_identity_key").on(
      table.fileName,
      table.board,
      table.scryfallId,
      table.isFoil,
      table.isEtched,
    ),
    check("precon_cards_quantity_check", sql`${table.quantity} > 0`),
    check(
      "precon_cards_board_check",
      sql`${table.board} IN ('commander', 'main', 'side', 'token', 'plane', 'scheme')`,
    ),
  ],
);

export type Set = typeof sets.$inferSelect;
export type OracleCard = typeof oracleCards.$inferSelect;
export type Printing = typeof printings.$inferSelect;
export type IngestRun = typeof ingestRuns.$inferSelect;
export type NewIngestRun = typeof ingestRuns.$inferInsert;
export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;
export type CollectionItem = typeof collectionItems.$inferSelect;
export type CompletionTarget = typeof completionTargets.$inferSelect;
export type PreconProduct = typeof preconProducts.$inferSelect;
export type PreconCard = typeof preconCards.$inferSelect;
