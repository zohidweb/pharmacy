import { Injectable } from '@nestjs/common';
import type {
  NetworkSettings,
  NotificationKind,
  UpdateNetworkSettingsRequest,
} from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { TenantDatabase } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import {
  NetworkSettingsRepository,
  type NetworkSettingsRow,
} from './network-settings.repository';

const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'batch_expiring',
  'low_stock',
  'supplier_payment_due',
  'transfer_in_transit',
  'shift_discrepancy',
  'negative_stock',
  'sync_conflict',
  'license_expiring',
  'service_decided',
  'invoice_overdue',
];

function toSettings(row: NetworkSettingsRow): NetworkSettings {
  const disabled = new Set(row.disabledNotifications);
  return {
    networkName: row.networkName,
    posSessionTimeoutMinutes: row.posSessionTimeoutMinutes,
    minPinLength: row.minPinLength,
    expiryNoticeDays: row.expiryNoticeDays,
    warnBelowCost: row.warnBelowCost,
    notifications: Object.fromEntries(
      NOTIFICATION_KINDS.map((kind) => [kind, !disabled.has(kind)]),
    ) as Record<NotificationKind, boolean>,
  };
}

/** The values the owner changes: the audit keeps them, not the operator's name of the network. */
function editable(settings: NetworkSettings): UpdateNetworkSettingsRequest {
  return {
    posSessionTimeoutMinutes: settings.posSessionTimeoutMinutes,
    minPinLength: settings.minPinLength,
    expiryNoticeDays: settings.expiryNoticeDays,
    warnBelowCost: settings.warnBelowCost,
    notifications: settings.notifications,
  };
}

// The network settings of the owner cabinet (spec 2026-10-14-owner-cabinet, E14, E15). A new
// timeout applies to new sessions, a new PIN length to the next PIN set; the notifications read
// the change at their next refresh (tenant_settings.updated_at, E11).
@Injectable()
export class SettingsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: NetworkSettingsRepository,
    private readonly audit: AuditService,
  ) {}

  get(): Promise<NetworkSettings> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) =>
      toSettings(await this.repository.read(trx, tenantId)),
    );
  }

  update(body: UpdateNetworkSettingsRequest): Promise<NetworkSettings> {
    const { tenantId, employeeId } = requirePrincipal();
    const next = {
      posSessionTimeoutMinutes: body.posSessionTimeoutMinutes,
      minPinLength: body.minPinLength,
      expiryNoticeDays: body.expiryNoticeDays,
      warnBelowCost: body.warnBelowCost,
      disabledNotifications: NOTIFICATION_KINDS.filter(
        (kind) => !body.notifications[kind],
      ),
    };
    return this.db.tenantTransaction(async (trx) => {
      const before = toSettings(await this.repository.read(trx, tenantId));
      await this.repository.update(trx, tenantId, next, employeeId);
      const after = toSettings(await this.repository.read(trx, tenantId));
      await this.audit.append(trx, {
        action: 'settings.updated',
        entityType: 'tenant_settings',
        entityId: tenantId,
        details: { before: editable(before), after: editable(after) },
      });
      return after;
    });
  }
}
