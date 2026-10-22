import { Injectable } from '@nestjs/common';
import type {
  NetworkSettings,
  NotificationKind,
  UpdateNetworkSettingsRequest,
} from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
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
    prescriptionRetentionDays: row.prescriptionRetentionDays,
    posBufferMaxHours: row.posBufferMaxHours,
    posBufferMaxOperations: row.posBufferMaxOperations,
    posControlledMaxHours: row.posControlledMaxHours,
    posControlledMaxOperations: row.posControlledMaxOperations,
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
    prescriptionRetentionDays: settings.prescriptionRetentionDays,
    posBufferMaxHours: settings.posBufferMaxHours,
    posBufferMaxOperations: settings.posBufferMaxOperations,
    posControlledMaxHours: settings.posControlledMaxHours,
    posControlledMaxOperations: settings.posControlledMaxOperations,
  };
}

// The network settings of the owner cabinet (spec 2026-10-14-owner-cabinet, E14, E15; the POS buffer and the
// prescription retention — spec 2026-10-21-pos-offline-limits, P2, P6: the POS reads the limits with the catalog
// snapshot, the hourly purge reads the retention). A new
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
    // the ПКУ limits of the buffer are not above the general ones (P6); the bounds are the DTO's
    const above = [
      body.posControlledMaxHours > body.posBufferMaxHours &&
        'posControlledMaxHours',
      body.posControlledMaxOperations > body.posBufferMaxOperations &&
        'posControlledMaxOperations',
    ].filter((field): field is string => field !== false);
    if (above.length > 0) {
      throw new FieldProblemException(
        400,
        'validation_failed',
        above.map((field) => ({ field, code: 'max' })),
      );
    }
    const next = {
      posSessionTimeoutMinutes: body.posSessionTimeoutMinutes,
      minPinLength: body.minPinLength,
      expiryNoticeDays: body.expiryNoticeDays,
      warnBelowCost: body.warnBelowCost,
      disabledNotifications: NOTIFICATION_KINDS.filter(
        (kind) => !body.notifications[kind],
      ),
      prescriptionRetentionDays: body.prescriptionRetentionDays,
      posBufferMaxHours: body.posBufferMaxHours,
      posBufferMaxOperations: body.posBufferMaxOperations,
      posControlledMaxHours: body.posControlledMaxHours,
      posControlledMaxOperations: body.posControlledMaxOperations,
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
