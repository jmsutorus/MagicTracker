import { sql, type SQL } from "drizzle-orm";

import { BULK_THRESHOLD_CENTS, BULK_VALUE_CENTS } from "./constants";

/**
 * valuedCents() from ./constants, as SQL, for the queries that sum a
 * collection's value in Postgres. Kept here rather than in constants because
 * it imports drizzle, which must not reach the browser bundle.
 *
 * NULL stays NULL: an unpriced card is reported as unpriced, never as bulk.
 */
export function valuedCentsSql(priceCents: SQL): SQL {
  return sql`(CASE WHEN ${priceCents} < ${BULK_THRESHOLD_CENTS}::int
                   THEN ${BULK_VALUE_CENTS}::int
                   ELSE ${priceCents} END)`;
}
