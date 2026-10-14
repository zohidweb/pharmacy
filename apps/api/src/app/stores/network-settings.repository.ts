import { Injectable } from '@nestjs/common';
import type { NotificationKind } from '@pharmacy/shared-dto';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

export interface NetworkSettingsRow {
  networkName: string;
  posSessionTimeoutMinutes: number;
  minPinLength: number;
  expiryNoticeDays: number;
  warnBelowCost: boolean;
  disabledNotifications: NotificationKind[];
}

// The network settings of the owner cabinet in tenant_settings (spec 2026-10-14-owner-cabinet, E14,
// E15); the name of the network is read from tenants (the operator's). A network without its
// settings row reads the defaults of the table.
@Injectable()
export class NetworkSettingsRepository {
  async read(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<NetworkSettingsRow> {
    const result = await sql<NetworkSettingsRow>`
      select t.name as network_name,
             coalesce(ts.cashier_session_idle_min, 15) as pos_session_timeout_minutes,
             coalesce(ts.pin_min_length, 4) as min_pin_length,
             coalesce(ts.expiry_reminder_days, 30) as expiry_notice_days,
             coalesce(ts.warn_below_cost, true) as warn_below_cost,
             coalesce(ts.disabled_notifications, '{}') as disabled_notifications
      from pharmacy.tenants t
      left join pharmacy.tenant_settings ts on ts.tenant_id = t.id
      where t.id = ${tenantId}`.execute(trx);
    return result.rows[0];
  }

  async update(
    trx: TenantTransaction,
    tenantId: string,
    next: Omit<NetworkSettingsRow, 'networkName'>,
    updatedBy: string,
  ): Promise<void> {
    await sql`
      insert into pharmacy.tenant_settings
        (tenant_id, cashier_session_idle_min, pin_min_length, expiry_reminder_days,
         warn_below_cost, disabled_notifications, updated_by)
      values (${tenantId}, ${next.posSessionTimeoutMinutes}, ${next.minPinLength},
              ${next.expiryNoticeDays}, ${next.warnBelowCost},
              ${sql.val(next.disabledNotifications)}::text[], ${updatedBy})
      on conflict (tenant_id) do update set
        cashier_session_idle_min = excluded.cashier_session_idle_min,
        pin_min_length = excluded.pin_min_length,
        expiry_reminder_days = excluded.expiry_reminder_days,
        warn_below_cost = excluded.warn_below_cost,
        disabled_notifications = excluded.disabled_notifications,
        updated_by = excluded.updated_by,
        updated_at = now()`.execute(trx);
  }
}
