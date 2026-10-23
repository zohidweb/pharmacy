import { APP_TIME_ZONE } from '@pharmacy/shared-util';
import { type RawBuilder, sql } from 'kysely';

/**
 * The calendar of the platform: of the operator contour (invoices, statistics, the operators' journal) and the
 * time zone of a network without its settings row (the default of tenant_settings.timezone).
 */
export const PLATFORM_TIME_ZONE = APP_TIME_ZONE;

// A literal, not a parameter: the expressions stay equal in select and group by and match expression indexes.
const PLATFORM_ZONE = sql.lit(PLATFORM_TIME_ZONE);

/** The time zone of a network from its settings row joined as `alias`; the platform's without the row. */
export function settingsTimeZone(alias = 'ts'): RawBuilder<string> {
  return sql<string>`coalesce(${sql.ref(`${alias}.timezone`)}, ${PLATFORM_ZONE})`;
}

/** The time zone of the network `tenantId` (a value or a column reference), read by a subquery. */
export function tenantTimeZone(
  tenantId: string | RawBuilder<unknown>,
): RawBuilder<string> {
  return sql<string>`coalesce(
    (select ts.timezone from pharmacy.tenant_settings ts where ts.tenant_id = ${tenantId}),
    ${PLATFORM_ZONE})`;
}

/** Today in the time zone of the network `tenantId`, a date. */
export function tenantToday(
  tenantId: string | RawBuilder<unknown>,
): RawBuilder<string> {
  return sql<string>`(now() at time zone ${tenantTimeZone(tenantId)})::date`;
}

/** The calendar day of a moment in the time zone of the platform, a date. */
export function platformDate(moment: RawBuilder<unknown>): RawBuilder<string> {
  return sql<string>`(${moment} at time zone ${PLATFORM_ZONE})::date`;
}

/** Today in the time zone of the platform, a date. */
export function platformToday(): RawBuilder<string> {
  return platformDate(sql`now()`);
}
