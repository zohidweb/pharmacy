import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { type TenantTransaction, tenantTimeZone } from '../../core/database';

/** The sign-in locks of an employee on one day of the network. */
export interface LoginLocksOfDay {
  employeeId: string;
  /** YYYY-MM-DD in the time zone of the network, as ReceiptRefusals. */
  day: string;
  /** Every lock of that employee on that day. */
  locks: number;
  employeeName: string;
}

// The sign-in locks of the network for the owner's notification (security review 2026-10-22, A2,
// decision 7.5): `auth.login-locked` is written once per lock (SignInLocks.record), so the count of
// a day is the count of its rows. Read in the caller's transaction, by audit_log_recorded_idx.
@Injectable()
export class LoginLocks {
  /**
   * The employee × days with a lock recorded after `after`, each with every lock of that day: a
   * later lock the same day grows the count of the same notification.
   */
  async lockedDays(
    trx: TenantTransaction,
    tenantId: string,
    after: Date,
  ): Promise<LoginLocksOfDay[]> {
    const zone = tenantTimeZone(tenantId);
    const result = await sql<LoginLocksOfDay>`
      with affected as (
        select distinct a.entity_id as employee_id, (a.recorded_at at time zone ${zone})::date as day
        from pharmacy.audit_log a
        where a.tenant_id = ${tenantId} and a.recorded_at > ${after}
          and a.action = 'auth.login-locked' and a.entity_type = 'employee'
      ),
      bounds as (select min(day) as first_day, max(day) as last_day from affected)
      select a.entity_id::text as employee_id, f.day::text as day, count(*)::integer as locks,
             e.full_name as employee_name
      from pharmacy.audit_log a
      cross join bounds b
      join affected f on f.employee_id = a.entity_id
        and f.day = (a.recorded_at at time zone ${zone})::date
      join pharmacy.employees e on e.tenant_id = a.tenant_id and e.id = a.entity_id
      where a.tenant_id = ${tenantId} and a.action = 'auth.login-locked'
        and a.entity_type = 'employee'
        and a.recorded_at >= b.first_day - interval '1 day'
        and a.recorded_at < b.last_day + interval '2 days'
      group by a.entity_id, f.day, e.full_name`.execute(trx);
    return result.rows;
  }
}
