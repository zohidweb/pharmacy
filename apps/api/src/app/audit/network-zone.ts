import { sql } from 'kysely';

/** The time zone of the network, as the business date of its receipts (PosRepository.businessDate). */
export const zoneOf = (tenantId: string) => sql`coalesce(
  (select ts.timezone from pharmacy.tenant_settings ts where ts.tenant_id = ${tenantId}), 'Asia/Dushanbe')`;
