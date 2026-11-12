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
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Imported, not just re-exported below: `decks_target_size_check` is written
// from it, so the bound in the database and the bound the forms enforce are
// the same number.
import { MAX_CUBE_SIZE } from "@/lib/decks/constants";

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

    /**
     * The current market price per finish, in cents, from the same bulk file
     * the rest of this row comes from.
     *
     * Distinct from `price_snapshots`, which is history and only ever covers
     * printings somebody owns. These three are the *list* price of any card
     * in the database, which is what a question about cards you do NOT own —
     * what would it cost to finish this set, what is this wishlist worth —
     * has to be answered from.
     *
     * Free to collect: the weekly card ingest already streams all 110k cards
     * for everything else in this table. They are therefore only as fresh as
     * the last ingest that saw a changed bulk file, and null wherever
     * Scryfall has no price for that finish, which is common for promos and
     * for printings that do not exist in that finish at all.
     */
    usdCents: integer("usd_cents"),
    usdFoilCents: integer("usd_foil_cents"),
    usdEtchedCents: integer("usd_etched_cents"),

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
export {
  COMMANDER_DECK_SIZE,
  DECK_BOARDS,
  DECK_BOARD_LABELS,
  DECK_FORMATS,
  DECK_FORMAT_LABELS,
  DEFAULT_CUBE_SIZE,
  MAX_COMMANDERS,
  MAX_CUBE_SIZE,
} from "@/lib/decks/constants";
export type { DeckBoard, DeckFormat } from "@/lib/decks/constants";

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

/**
 * DECKS (decks / deck_cards)
 *
 * Human-owned and irreplaceable, like the collection: a decklist is a record
 * of decisions, and nothing can regenerate it. So `deck_cards.oracle_id` is
 * ON DELETE RESTRICT for the same reason `collection_items.printing_id` is —
 * a card refresh that tried to remove a card somebody built a deck around
 * must fail loudly rather than quietly editing the deck.
 */

export const decks = pgTable(
  "decks",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    name: text("name").notNull(),

    /** `commander`, `standard` or `cube`; see lib/decks/constants.ts. */
    format: text("format").notNull().default("commander"),

    /**
     * How many cards the list is meant to hold, for formats where that is
     * the owner's choice rather than a rule.
     *
     * Null for Commander, which is always 100 — storing 100 in every row
     * would invite a deck that disagrees with the format's own rule.
     * Null for a cube too until one is chosen, which reads as the default
     * (360) rather than as "no target": a cube with no size is not a thing,
     * but a cube you have not thought about the size of is.
     */
    targetSize: integer("target_size"),

    notes: text("notes"),

    /**
     * The unlisted share link, when one has been handed out.
     *
     * Null until you ask for a link, and null again the moment you revoke
     * one, so a deck is private unless you did something about it. The token
     * is 16 random bytes rather than the deck's id: the id appears in your
     * own URLs and is a foreign key everywhere, so sharing it would mean
     * handing out a key you cannot change without rebuilding the deck.
     * Revoking is one UPDATE, and a new link is a new token — the old URL
     * dies rather than being re-pointed.
     */
    shareToken: text("share_token"),
    shareCreatedAt: timestamp("share_created_at", { withTimezone: true }),

    /**
     * Where the physical deck lives, if it has been built.
     *
     * Informational and nullable: a deck is a list first. ON DELETE SET NULL
     * rather than RESTRICT because deleting a binder should not be blocked by
     * a deck that merely points at it — the deck itself survives intact, it
     * just stops claiming a shelf.
     */
    locationId: uuid("location_id").references(() => locations.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Case-insensitive, like locations: two decks called "Zinnia" and
    // "zinnia" are one deck somebody typed twice.
    uniqueIndex("decks_name_lower_key").on(sql`lower(${table.name})`),
    index("decks_location_idx").on(table.locationId),
    /*
     * Partial, because most decks have no token and NULLs are not equal to
     * each other anyway: a plain unique index would work, but the partial one
     * says what is actually being enforced — two live links cannot collide —
     * and is the index the public lookup uses.
     */
    uniqueIndex("decks_share_token_key")
      .on(table.shareToken)
      .where(sql`${table.shareToken} IS NOT NULL`),
    check(
      "decks_format_check",
      sql`${table.format} IN ('commander', 'standard', 'cube')`,
    ),
    /*
     * Bounded, not just positive. The column is the owner's own number, and
     * it arrives from a form — a stray keypress asking for a 36,000-card
     * cube would otherwise be stored and then divided by, everywhere.
     */
    check(
      "decks_target_size_check",
      // sql.raw, because an interpolated number becomes a bound parameter
      // and a CHECK cannot hold one: drizzle-kit would emit `<= $1`.
      sql`${table.targetSize} IS NULL OR (${table.targetSize} > 0 AND ${table.targetSize} <= ${sql.raw(String(MAX_CUBE_SIZE))})`,
    ),
  ],
);

/**
 * One card in one deck.
 *
 * Keyed on `oracle_id`, not `printing_id`, because a decklist is a list of
 * cards rather than of printings: Commander's singleton rule is about the
 * name, color identity and legality are properties of the card, and "I want a
 * Sol Ring" does not say which Sol Ring. `printing_id` is the optional answer
 * to "which copy" — a preference, which is why it is nullable and ON DELETE
 * SET NULL while the card itself restricts.
 */
export const deckCards = pgTable(
  "deck_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    deckId: uuid("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),

    oracleId: uuid("oracle_id")
      .notNull()
      .references(() => oracleCards.oracleId, { onDelete: "restrict" }),

    printingId: uuid("printing_id").references(() => printings.scryfallId, {
      onDelete: "set null",
    }),

    /**
     * commander | main | side | maybe
     *
     * `side` is a real sideboard and `maybe` is a shortlist, which is why
     * they are two values and not one: a sideboard is bought, owned, claimed
     * and bound by the four-copy limit, and a maybeboard counts toward
     * nothing at all. Which boards a deck may use is its format's business —
     * `boardsFor` in lib/decks/constants.ts — and the mutations check that
     * before writing, so this CHECK is the union of every format's boards
     * rather than the set any one deck can hold.
     */
    board: text("board").notNull().default("main"),

    /**
     * The owner's own grouping for this card — "Ramp", "Removal", "Card
     * draw". Free text, not a foreign key to a categories table.
     *
     * This is how every other deckbuilder models it, and the reason is that
     * a category has no identity worth preserving: renaming "Removal" to
     * "Interaction" is a bulk UPDATE either way, and a category with no
     * cards in it is not a thing anyone wants kept. A table would buy
     * ordering and colours at the cost of a join on the hottest query in the
     * app, for a feature whose whole job is to put twelve rows under a
     * heading.
     *
     * Null means uncategorised, which is the honest default: the deck page
     * can group by card type or mana value without anyone having typed a
     * category, and those groupings are derived rather than stored.
     */
    category: text("category"),

    quantity: integer("quantity").notNull().default(1),

    /**
     * This deck claims a physical copy of this card.
     *
     * No `collection_items` row is moved when a deck is built. Allocation is
     * a claim recorded here, and "how many copies are free to build with" is
     * a query: owned total minus the copies other decks have claimed. That
     * keeps it reversible — unbuilding a deck is one UPDATE rather than a
     * hundred card moves that could half-fail — and it keeps the collection
     * the single record of where a card physically is.
     */
    isAllocated: boolean("is_allocated").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /**
     * One row per card per board. Copies live in `quantity`, so a playset of
     * basics is one row — and in Commander every legal row but a basic (or a
     * "any number of cards named" card) has quantity 1 anyway.
     */
    uniqueIndex("deck_cards_identity_key").on(
      table.deckId,
      table.board,
      table.oracleId,
    ),
    index("deck_cards_deck_idx").on(table.deckId, table.board),
    index("deck_cards_oracle_idx").on(table.oracleId),
    index("deck_cards_allocated_idx").on(table.isAllocated),
    check("deck_cards_quantity_check", sql`${table.quantity} > 0`),
    /*
     * A category is a heading, not a paragraph. The bound matches
     * MAX_CATEGORY_LENGTH in lib/decks/constants.ts, and the emptiness check
     * is what stops '' and '   ' becoming a category distinct from "no
     * category" — the mutation trims to null, and this is the backstop.
     */
    check(
      "deck_cards_category_check",
      sql`${table.category} IS NULL OR (length(${table.category}) BETWEEN 1 AND 40 AND btrim(${table.category}) = ${table.category})`,
    ),
    check(
      "deck_cards_board_check",
      sql`${table.board} IN ('commander', 'main', 'side', 'maybe')`,
    ),
  ],
);

/**
 * PRICES
 *
 * Two tables, because they answer two different questions and only one of
 * them can be reconstructed.
 *
 * `price_snapshots` is what a card was worth on a date. Rows exist **only for
 * (printing, finish) pairs somebody owns** — PLAN.md §6 is blunt about why:
 * 110k printings times a weekly snapshot would eat the 1 GB plan within
 * months, and nobody needs price history for a card they do not have. At this
 * collection's size that is a few hundred rows a week, which is free forever.
 *
 * `value_snapshots` is what the whole collection was worth on a date, and it
 * exists because that number cannot be recovered later. Multiplying today's
 * quantities by last month's prices answers "what would what I own now have
 * cost then" — a useful number, but not the same one, and it drifts further
 * from the truth with every card added. There is no quantity history to
 * reconstruct it from, so the total is recorded as the job sees it.
 */
export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    /*
     * RESTRICT, like collection_items: a snapshot only exists for a printing
     * somebody owns, so anything deleting that printing is already about to
     * take a collection row with it and must fail loudly instead.
     */
    printingId: uuid("printing_id")
      .notNull()
      .references(() => printings.scryfallId, { onDelete: "restrict" }),

    /** nonfoil | foil | etched — the finish actually owned. */
    finish: text("finish").notNull(),

    /**
     * Where the number came from, in the price's own currency.
     *
     * Part of the key rather than a column so a second source can be added
     * without the two overwriting each other, and so a chart can never
     * silently add dollars to euros.
     */
    source: text("source").notNull(),

    snapshotDate: date("snapshot_date").notNull(),

    priceCents: integer("price_cents").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.printingId,
        table.finish,
        table.source,
        table.snapshotDate,
      ],
    }),
    /*
     * Descending by date: every read here is "the most recent price for this
     * card", and the movers query asks it twice per card. The primary key's
     * index cannot serve that — it leads with the printing but orders the date
     * ascending, so the latest row is at the end of each group.
     */
    index("price_snapshots_latest_idx").on(
      table.printingId,
      table.finish,
      table.source,
      table.snapshotDate.desc(),
    ),
    index("price_snapshots_date_idx").on(table.snapshotDate),
    // A free card is real (plenty are worth cents); a negative price is not.
    check("price_snapshots_price_check", sql`${table.priceCents} >= 0`),
    check(
      "price_snapshots_finish_check",
      sql`${table.finish} IN ('nonfoil', 'foil', 'etched')`,
    ),
  ],
);

export const valueSnapshots = pgTable(
  "value_snapshots",
  {
    snapshotDate: date("snapshot_date").notNull(),
    source: text("source").notNull(),

    /** The collection's market value on that date, at that date's holdings. */
    totalCents: integer("total_cents").notNull(),

    /** Copies that had a price, and copies that did not. */
    pricedCopies: integer("priced_copies").notNull().default(0),
    unpricedCopies: integer("unpriced_copies").notNull().default(0),

    /**
     * Distinct (printing, finish) pairs with no price at all.
     *
     * Recorded rather than ignored because the total is only as honest as its
     * coverage: Scryfall has no price for some printings, and a foil price can
     * be missing for a printing that exists in foil. A value that quietly
     * omits a tenth of the collection is worse than one that says so.
     */
    unpricedItems: integer("unpriced_items").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotDate, table.source] }),
    check("value_snapshots_total_check", sql`${table.totalCents} >= 0`),
  ],
);

/**
 * Cards you want but do not own — the third "what am I missing" list.
 *
 * The other two are derived: a set's want list falls out of completion, a
 * deck's buy list falls out of the decklist. This one is nothing but
 * intention, so it is the only one that needs storing.
 *
 * `printing_id` is nullable on purpose and means "any printing will do",
 * which is the usual case — wanting *a* Sol Ring is a different wish from
 * wanting the Secret Lair one, and the pricing follows: a row with a
 * printing is priced at that printing, a row without is priced at the
 * cheapest printing of the card.
 */
export const wishlistItems = pgTable(
  "wishlist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    oracleId: uuid("oracle_id")
      .notNull()
      .references(() => oracleCards.oracleId, { onDelete: "cascade" }),

    /** Null = any printing. */
    printingId: uuid("printing_id").references(() => printings.scryfallId, {
      /*
       * SET NULL, not RESTRICT. A wishlist row is a wish, not a possession:
       * if the specific printing it named ever disappeared, "I still want
       * this card, any printing" remains true and is worth keeping, whereas
       * RESTRICT would block the delete over something nobody owns.
       */
      onDelete: "set null",
    }),

    /** Null = any finish. */
    finish: text("finish"),

    quantity: integer("quantity").notNull().default(1),

    note: text("note"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /*
     * NULLS NOT DISTINCT, because the nullable columns here carry meaning.
     * Under the default, "any printing, any finish" of the same card would
     * never collide with itself and you could add it ten times; Postgres 15+
     * lets the key treat those nulls as the single value they represent.
     */
    unique("wishlist_items_card_key")
      .on(table.oracleId, table.printingId, table.finish)
      .nullsNotDistinct(),
    index("wishlist_items_oracle_idx").on(table.oracleId),
    check("wishlist_items_quantity_check", sql`${table.quantity} > 0`),
    check(
      "wishlist_items_finish_check",
      sql`${table.finish} IS NULL OR ${table.finish} IN ('nonfoil', 'foil', 'etched')`,
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
export type Deck = typeof decks.$inferSelect;
export type NewDeck = typeof decks.$inferInsert;
export type DeckCard = typeof deckCards.$inferSelect;
export type PriceSnapshot = typeof priceSnapshots.$inferSelect;
export type ValueSnapshot = typeof valueSnapshots.$inferSelect;
export type WishlistItem = typeof wishlistItems.$inferSelect;
export type NewWishlistItem = typeof wishlistItems.$inferInsert;
