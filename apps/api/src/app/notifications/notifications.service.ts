import { Injectable } from '@nestjs/common';
import { hasPermissions } from '@pharmacy/shared-domain';
import type {
  Reminder,
  ReminderParams,
  TenantAnnouncement,
  TenantNotification,
  TenantNotificationListResponse,
} from '@pharmacy/shared-dto';
import {
  type EmployeePrincipal,
  requirePrincipal,
} from '../../common/context/request-context';
import { TenantDatabase, type TenantTransaction } from '../../core/database';
import {
  EVENT_KINDS,
  KIND_PERMISSION,
  NETWORK_SCOPE_KINDS,
  NOTIFICATION_KINDS,
} from './notification-kinds';
import { NotificationsRefresh } from './notifications-refresh';
import {
  type NotificationRow,
  NotificationsRepository,
  type VisibleFilter,
} from './notifications.repository';

const STRING_PARAMS = [
  'batchNumber',
  'expiresOn',
  'storeName',
  'supplierName',
  'dueDate',
  'documentNumber',
  'fromStore',
  'toStore',
  'shiftNumber',
  'employeeName',
  'reason',
] as const;
const NUMBER_PARAMS = ['quantity', 'positions', 'priceMinor'] as const;
const DECISIONS = ['approved', 'rejected', 'cancelled'] as const;

const dayNumber = (date: string) =>
  Date.parse(`${date}T00:00:00Z`) / 86_400_000;

function nameIn(names: unknown, locale: 'ru' | 'tg'): string | undefined {
  if (typeof names !== 'object' || names === null) return undefined;
  const map = names as Record<string, unknown>;
  for (const key of [locale === 'tg' ? 'tj' : 'ru', 'ru', 'tj']) {
    const value = map[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

/** The stores of an employee: a PIN session — its terminal's store only. */
function scopeOf(principal: EmployeePrincipal): 'all' | readonly string[] {
  if (principal.auth === 'pin') {
    return principal.currentStoreId ? [principal.currentStoreId] : [];
  }
  return principal.storeScope;
}

// The notifications of an employee (spec 2026-10-14-owner-cabinet, E10–E12): the kinds the network
// keeps on, of the areas the employee has a right to, of the stores of the scope; a notification
// of the whole network — for the network scope only. Supplier amounts only with the cost right.
@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: NotificationsRepository,
    private readonly refresh: NotificationsRefresh,
  ) {}

  /**
   * The announcements of the platform on now for the network: the scope by the modes of its open
   * stores (spec 2026-10-19-operator-notifications, N13), the nearest end first.
   */
  announcements(): Promise<TenantAnnouncement[]> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction((trx) =>
      this.repository.announcements(trx, tenantId),
    );
  }

  list(query: {
    limit?: number;
    offset?: number;
  }): Promise<TenantNotificationListResponse> {
    const principal = requirePrincipal();
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    return this.db.tenantTransaction(async (trx) => {
      const { filter, today } = await this.prepare(trx, principal);
      const { rows, total, unread } = await this.repository.list(
        trx,
        principal.tenantId,
        filter,
        { limit, offset, unreadFirst: false },
      );
      return {
        items: rows.map((row) => this.toNotification(row, today, principal)),
        total,
        limit,
        offset,
        unread,
      };
    });
  }

  readAll(): Promise<void> {
    const principal = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const { filter } = await this.prepare(trx, principal);
      await this.repository.markAllRead(trx, principal.tenantId, filter);
    });
  }

  /** The reminders of the home: the unread ones first (E12). */
  async reminders(trx: TenantTransaction, limit: number): Promise<Reminder[]> {
    const principal = requirePrincipal();
    if (!hasPermissions(principal.permissions, 'notifications:view')) return [];
    const { filter, today } = await this.prepare(trx, principal);
    const { rows } = await this.repository.list(
      trx,
      principal.tenantId,
      filter,
      { limit, offset: 0, unreadFirst: true },
    );
    return rows.map((row) => {
      const { id, kind, params } = this.toNotification(row, today, principal);
      return { id, kind, params };
    });
  }

  private async prepare(
    trx: TenantTransaction,
    principal: EmployeePrincipal,
  ): Promise<{ filter: VisibleFilter; today: string }> {
    await this.refresh.run(trx, principal.tenantId);
    const context = await this.repository.context(trx, principal.tenantId);
    const scope = scopeOf(principal);
    const kinds = NOTIFICATION_KINDS.filter(
      (kind) =>
        !context.disabled.includes(kind) &&
        hasPermissions(principal.permissions, KIND_PERMISSION[kind]) &&
        (scope === 'all' || !NETWORK_SCOPE_KINDS.includes(kind)),
    );
    return {
      today: context.today,
      filter: {
        employeeId: principal.employeeId,
        kinds,
        eventKinds: EVENT_KINDS,
        scope,
      },
    };
  }

  private toNotification(
    row: NotificationRow,
    today: string,
    principal: EmployeePrincipal,
  ): TenantNotification {
    const stored = row.params ?? {};
    const params: ReminderParams = {};
    for (const key of STRING_PARAMS) {
      const value = stored[key];
      if (typeof value === 'string') params[key] = value;
    }
    for (const key of NUMBER_PARAMS) {
      const value = stored[key];
      if (typeof value === 'number') params[key] = value;
    }
    const productName = nameIn(stored['productNames'], principal.locale);
    if (productName !== undefined) params.productName = productName;
    const serviceName = nameIn(stored['serviceNames'], principal.locale);
    if (serviceName !== undefined) params.serviceName = serviceName;
    const decision = DECISIONS.find((d) => d === stored['decision']);
    if (decision !== undefined) params.decision = decision;
    if (params.expiresOn !== undefined) {
      params.days = dayNumber(params.expiresOn) - dayNumber(today);
    }
    const amount = stored['amountMinor'];
    // a debt to a supplier is a purchase amount (finance:view-cost); a cash discrepancy is not; the
    // debt of an invoice of the platform is for whoever sees the billing of the network
    const canSeeAmount =
      row.kind === 'shift_discrepancy' ||
      (row.kind === 'invoice_overdue' &&
        hasPermissions(principal.permissions, 'billing:view')) ||
      hasPermissions(principal.permissions, 'finance:view-cost');
    if (typeof amount === 'number' && canSeeAmount) params.amountMinor = amount;
    return {
      id: row.id,
      kind: row.kind,
      storeId: row.storeId,
      params,
      createdAt: new Date(row.createdAt).toISOString(),
      read: row.read,
    };
  }
}
