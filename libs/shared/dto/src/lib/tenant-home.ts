/*
 * REST contract of the client-product home: dashboard and notifications. Amounts are integer
 * dirams (TJS, ADR-0016). Texts of reminders and notifications are built on the client from
 * `kind` + `params` (RU/TJ), the server sends no ready-made sentences.
 */
import type { Page, StoreMode } from './platform-tenants.js';
import type { TenantAuditEntry } from './tenant-staff.js';

/** `custom` — `from`…`to` inclusive, not longer than 92 days (spec 2026-10-14-owner-cabinet, E1). */
export type DashboardPeriod = 'today' | 'week' | 'month' | 'custom';

/** GET /api/v1/dashboard?period=&from=&to= — `from` and `to` (YYYY-MM-DD) only with `custom`. */
export interface DashboardQuery {
  period: DashboardPeriod;
  from?: string;
  to?: string;
}

export interface DashboardKpi {
  revenueMinor: number;
  /** Change against the previous period of the same length, %; null without data. */
  revenueChangePercent: number | null;
  receipts: number;
  averageReceiptMinor: number;
  /** Products below the minimum stock. */
  lowStockItems: number;
  /** Batches within the expiry threshold of the network settings. */
  expiringBatches: number;
  /** Of them — expiring within 7 days (the expired ones included). */
  expiringCritical: number;
}

export interface DashboardStoreRow {
  storeId: string;
  name: string;
  mode: StoreMode;
  /** Offline stores only: data is as fresh as the last sync (ADR-0014). */
  lastSyncAt: string | null;
  receipts: number;
  revenueMinor: number;
}

export interface DailyRevenue {
  /** YYYY-MM-DD in Asia/Dushanbe. */
  date: string;
  revenueMinor: number;
}

/**
 * One list of kinds for the notifications and for their switches in the network settings (spec
 * 2026-10-14-owner-cabinet, 6.3). `sync_conflict` and `license_expiring` are not created until the
 * synchronisation and the tariffs exist.
 */
export type NotificationKind =
  | 'batch_expiring'
  | 'low_stock'
  | 'supplier_payment_due'
  | 'transfer_in_transit'
  | 'shift_discrepancy'
  | 'negative_stock'
  | 'sync_conflict'
  | 'license_expiring'
  /** The operator approved (with a price), rejected or cancelled a service of the network (event). */
  | 'service_decided'
  /**
   * An invoice of the network is past its due date with a remainder (state: gone when it is paid):
   * `documentNumber` — the number, `amountMinor` — the remainder, `dueDate` (spec
   * 2026-10-15-billing-services, A17).
   */
  | 'invoice_overdue';

export interface ReminderParams {
  productName?: string;
  batchNumber?: string;
  days?: number;
  quantity?: number;
  storeName?: string;
  supplierName?: string;
  /** YYYY-MM-DD */
  dueDate?: string;
  /** YYYY-MM-DD — the expiry of the batch; `days` is counted from it on read. */
  expiresOn?: string;
  amountMinor?: number;
  documentNumber?: string;
  fromStore?: string;
  toStore?: string;
  positions?: number;
  operatorName?: string;
  shiftNumber?: string;
  /** `service_decided`: the service, the decision and its price or reason. */
  serviceName?: string;
  decision?: 'approved' | 'rejected' | 'cancelled';
  priceMinor?: number;
  reason?: string;
}

export interface Reminder {
  id: string;
  kind: NotificationKind;
  params: ReminderParams;
}

/** GET /api/v1/dashboard — over the stores of the employee scope. */
export interface TenantDashboard {
  period: DashboardPeriod;
  /** The dates of the period (YYYY-MM-DD, inclusive). */
  from: string;
  to: string;
  kpi: DashboardKpi;
  stores: DashboardStoreRow[];
  /** `today` and `week` — the last 7 days; `month` and `custom` — every day of the period (E6). */
  revenueByDay: DailyRevenue[];
  reminders: Reminder[];
  /** The last entries of the journal of the scope, without sign-ins and denials (E7). */
  recentActivity: TenantAuditEntry[];
}

/**
 * GET /api/v1/nav-counters?storeId= — any signed-in employee (cloud only). `storeId` must be in the
 * scope (403 `store_not_in_scope`); without it — every active store of the scope; a PIN session —
 * always the store of its terminal.
 */
export interface NavCountersQuery {
  storeId?: string;
}

/** Numbers of the side menu; a field is absent without its permission. */
export interface NavCounters {
  /** Products below the minimum (`inventory:view`) — «Остатки». */
  lowStock?: number;
  /** Transfers in transit to the stores (`inventory:receive`) — «Перемещения и заявки». */
  incomingTransfers?: number;
  /** Product × pharmacy pairs with a price problem (`pricing:view`) — «Цены и скидки». */
  priceProblems?: number;
}

export interface TenantNotification extends Reminder {
  /** null — a notification of the whole network. */
  storeId: string | null;
  createdAt: string;
  read: boolean;
}

/** GET /api/v1/notifications?limit=&offset= */
export interface TenantNotificationListResponse extends Page<TenantNotification> {
  unread: number;
}
