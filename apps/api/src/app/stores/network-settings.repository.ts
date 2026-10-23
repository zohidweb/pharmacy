import { Injectable } from '@nestjs/common';
import {
  networkSettingsDefaults as defaults,
  PRESCRIPTION_RETENTION_DEFAULT_DAYS,
  posBufferDefaults,
} from '@pharmacy/shared-domain';
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
  prescriptionRetentionDays: number;
  posBufferMaxHours: number;
  posBufferMaxOperations: number;
  posControlledMaxHours: number;
  posControlledMaxOperations: number;
}

// The network settings of the owner cabinet in tenant_settings (spec 2026-10-14-owner-cabinet, E14,
// E15) and of the POS buffer and the prescription retention (spec 2026-10-21-pos-offline-limits, P2,
// P6); the name of the network is read from tenants (the operator's). A network without its settings
// row reads the defaults of the table.
@Injectable()
export class NetworkSettingsRepository {
  async read(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<NetworkSettingsRow> {
    const result = await sql<NetworkSettingsRow>`
      select t.name as network_name,
             coalesce(ts.cashier_session_idle_min, ${defaults.cashierSessionIdleMinutes})
               as pos_session_timeout_minutes,
             coalesce(ts.pin_min_length, ${defaults.pinMinLength}) as min_pin_length,
             coalesce(ts.expiry_reminder_days, ${defaults.expiryReminderDays}) as expiry_notice_days,
             coalesce(ts.warn_below_cost, ${defaults.warnBelowCost}) as warn_below_cost,
             coalesce(ts.disabled_notifications, '{}') as disabled_notifications,
             coalesce(ts.prescription_retention_days, ${PRESCRIPTION_RETENTION_DEFAULT_DAYS})
               as prescription_retention_days,
             coalesce(ts.pos_buffer_max_hours, ${posBufferDefaults.maxHours}) as pos_buffer_max_hours,
             coalesce(ts.pos_buffer_max_operations, ${posBufferDefaults.maxOperations})
               as pos_buffer_max_operations,
             coalesce(ts.pos_controlled_max_hours, ${posBufferDefaults.controlledMaxHours})
               as pos_controlled_max_hours,
             coalesce(ts.pos_controlled_max_operations, ${posBufferDefaults.controlledMaxOperations})
               as pos_controlled_max_operations
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
         warn_below_cost, disabled_notifications, prescription_retention_days,
         pos_buffer_max_hours, pos_buffer_max_operations, pos_controlled_max_hours,
         pos_controlled_max_operations, updated_by)
      values (${tenantId}, ${next.posSessionTimeoutMinutes}, ${next.minPinLength},
              ${next.expiryNoticeDays}, ${next.warnBelowCost},
              ${sql.val(next.disabledNotifications)}::text[], ${next.prescriptionRetentionDays},
              ${next.posBufferMaxHours}, ${next.posBufferMaxOperations},
              ${next.posControlledMaxHours}, ${next.posControlledMaxOperations}, ${updatedBy})
      on conflict (tenant_id) do update set
        cashier_session_idle_min = excluded.cashier_session_idle_min,
        pin_min_length = excluded.pin_min_length,
        expiry_reminder_days = excluded.expiry_reminder_days,
        warn_below_cost = excluded.warn_below_cost,
        disabled_notifications = excluded.disabled_notifications,
        prescription_retention_days = excluded.prescription_retention_days,
        pos_buffer_max_hours = excluded.pos_buffer_max_hours,
        pos_buffer_max_operations = excluded.pos_buffer_max_operations,
        pos_controlled_max_hours = excluded.pos_controlled_max_hours,
        pos_controlled_max_operations = excluded.pos_controlled_max_operations,
        updated_by = excluded.updated_by,
        updated_at = now()`.execute(trx);
  }
}
