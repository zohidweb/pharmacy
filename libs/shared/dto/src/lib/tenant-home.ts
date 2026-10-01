/*
 * REST contract of the client-product home: dashboard and notifications. Amounts are integer
 * dirams (TJS, ADR-0016). Texts of reminders and notifications are built on the client from
 * `kind` + `params` (RU/TJ), the server sends no ready-made sentences.
 */
import type { Page, StoreMode } from './platform-tenants.js';

export type DashboardPeriod = 'today' | 'week' | 'month';

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
  /** Of them — expiring within 7 days. */
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

export type ReminderKind =
  | 'batch_expiring'
  | 'supplier_payment_due'
  | 'transfer_in_transit'
  | 'low_stock'
  | 'license_expiring'
  | 'impersonation';

export interface ReminderParams {
  productName?: string;
  batchNumber?: string;
  days?: number;
  quantity?: number;
  storeName?: string;
  supplierName?: string;
  /** YYYY-MM-DD */
  dueDate?: string;
  amountMinor?: number;
  documentNumber?: string;
  fromStore?: string;
  toStore?: string;
  positions?: number;
  operatorName?: string;
}

export interface Reminder {
  id: string;
  kind: ReminderKind;
  params: ReminderParams;
}

export interface ActivityEntry {
  id: string;
  at: string;
  actorName: string;
  storeName: string | null;
  /** Audit description as recorded on the server. */
  description: string;
}

/** GET /api/v1/dashboard?period= — over the stores of the employee scope. */
export interface TenantDashboard {
  period: DashboardPeriod;
  kpi: DashboardKpi;
  stores: DashboardStoreRow[];
  /** The last 7 days up to today. */
  revenueByDay: DailyRevenue[];
  reminders: Reminder[];
  recentActivity: ActivityEntry[];
}

export interface TenantNotification extends Reminder {
  createdAt: string;
  read: boolean;
}

/** GET /api/v1/notifications?limit=&offset= */
export interface TenantNotificationListResponse extends Page<TenantNotification> {
  unread: number;
}
