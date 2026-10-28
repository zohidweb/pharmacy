/*
 * Synthetic data of the system screens (notifications, announcements, operators' audit log,
 * settings, operator team, profile). Fictional people and texts only.
 */
import type {
  Announcement,
  NotificationPreferences,
  OperatorAuditEntry,
  OperatorMe,
  OperatorSessionInfo,
  PlatformNotification,
  PlatformOperator,
  PlatformSettings,
} from '@pharmacy/shared-dto';
import { DEFAULT_VAT_RATE_PERCENT, PRICE_PER_STORE_MINOR } from './db-billing';
import { demoOperator, demoOperatorPassword } from './fixtures';
import { auditEntry } from './operator-audit';

export interface SystemDb {
  notifications: PlatformNotification[];
  announcements: Announcement[];
  preferences: NotificationPreferences;
  operatorAudit: OperatorAuditEntry[];
  settings: PlatformSettings;
  operators: PlatformOperator[];
  me: OperatorMe;
  password: string;
  sessions: OperatorSessionInfo[];
}

export function seedSystem(): SystemDb {
  const second = {
    id: 'op-demo-2',
    fullName: 'Второй Оператор',
    login: 'operator2@example.test',
    role: 'full_access' as const,
  };
  return {
    notifications: [
      {
        id: 'n-1',
        topic: 'billing',
        kind: 'invoice_overdue',
        params: { tenantName: 'Пример Мед', invoiceNumber: 'СЧ-2026-09-003' },
        target: { screen: 'tenant', id: 't-2' },
        createdAt: '2026-09-30T03:00:00Z',
        read: false,
      },
      {
        id: 'n-2',
        topic: 'keys',
        kind: 'key_expiring',
        params: { tenantName: 'Демо Фарм', storeName: 'Демо Фарм №3', days: 7 },
        target: { screen: 'tenant', id: 't-1' },
        createdAt: '2026-10-01T03:00:00Z',
        read: false,
      },
      {
        id: 'n-3',
        topic: 'services',
        kind: 'service_requested',
        params: {
          tenantName: 'Тест Аптека',
          serviceName: 'Перенос данных из прежней системы',
        },
        target: { screen: 'services' },
        createdAt: '2026-09-30T11:40:00Z',
        read: false,
      },
      {
        id: 'n-4',
        topic: 'sync',
        kind: 'sync_stale',
        params: { tenantName: 'Демо Фарм', storeName: 'Демо Фарм №4', days: 9 },
        target: { screen: 'tenant', id: 't-1' },
        createdAt: '2026-09-30T22:00:00Z',
        read: false,
      },
      {
        id: 'n-5',
        topic: 'keys',
        kind: 'key_revoked',
        params: { tenantName: 'Пример Мед', storeName: 'Пример Мед №2' },
        target: { screen: 'tenant', id: 't-2' },
        createdAt: '2026-08-20T10:00:00Z',
        read: true,
      },
      {
        id: 'n-6',
        topic: 'billing',
        kind: 'payment_recorded',
        params: { tenantName: 'Демо Фарм', amountMinor: 195_730 },
        target: { screen: 'tenant', id: 't-1' },
        createdAt: '2026-09-05T09:10:00Z',
        read: true,
      },
    ],
    announcements: [
      {
        id: 'an-1',
        title: 'Технические работы 05.10',
        text: 'Облачные точки будут недоступны с 01:00 до 03:00; офлайн-точки работают как обычно.',
        startsAt: '2026-10-04T20:00:00Z',
        endsAt: '2026-10-04T22:00:00Z',
        scope: 'cloud',
        status: 'scheduled',
      },
      {
        id: 'an-2',
        title: 'Вышла версия 2.4.0',
        text: 'Офлайн-точкам доступно обновление: ускорена синхронизация больших очередей.',
        startsAt: '2026-09-18T04:00:00Z',
        endsAt: '2026-10-18T04:00:00Z',
        scope: 'offline',
        status: 'published',
      },
    ],
    preferences: { billing: true, keys: true, services: true, sync: false, leads: true },
    operatorAudit: [
      auditEntry(
        'oa-1',
        '2026-09-30T06:42:00Z',
        demoOperator,
        'payment.recorded',
        {
          tenant: { id: 't-1', name: 'Демо Фарм' },
        },
      ),
      auditEntry('oa-2', '2026-09-29T10:15:00Z', second, 'license.issued', {
        tenant: { id: 't-1', name: 'Демо Фарм' },
        store: { id: 's-104', name: 'Демо Фарм №4' },
      }),
      auditEntry(
        'oa-3',
        '2026-09-28T08:05:00Z',
        demoOperator,
        'auth.operator-login-succeeded',
        {
          operator: { id: demoOperator.id, name: demoOperator.fullName },
        },
      ),
      auditEntry(
        'oa-4',
        '2026-09-27T12:30:00Z',
        second,
        'service.request-approved',
        {
          tenant: { id: 't-1', name: 'Демо Фарм' },
        },
      ),
      auditEntry(
        'oa-5',
        '2026-09-25T07:00:00Z',
        demoOperator,
        'settings.updated',
      ),
      auditEntry(
        'oa-6',
        '2026-09-20T09:45:00Z',
        demoOperator,
        'tenant.created',
        {
          tenant: { id: 't-3', name: 'Тест Аптека' },
        },
      ),
      auditEntry('oa-7', '2026-09-15T11:20:00Z', second, 'license.revoked', {
        tenant: { id: 't-2', name: 'Пример Мед' },
        store: { id: 's-203', name: 'Пример Мед №2' },
      }),
      auditEntry('oa-8', '2026-09-14T08:00:00Z', second, 'access.denied', {
        details: {
          reason: 'missing_permission',
          permission: 'operators:manage',
        },
      }),
      {
        // a platform job, not an operator: the script that creates operators
        ...auditEntry(
          'oa-9',
          '2026-09-10T05:00:00Z',
          second,
          'operator.code-issued',
          {
            operator: { id: second.id, name: second.fullName },
            details: { created: 'true' },
          },
        ),
        actor: { kind: 'system', job: 'create-operator' },
      },
    ],
    settings: {
      pricePerStoreMinor: PRICE_PER_STORE_MINOR,
      vatRatePercent: DEFAULT_VAT_RATE_PERCENT,
      supplier: {
        name: 'ООО «Платформа» (демо)',
        inn: '000000000',
        bankAccount: '00000000000000000000',
        bankName: 'Демо-банк',
        bankBik: '000000000',
        bankCorrAccount: '00000000000000000000',
        paymentPurposeTemplate:
          'Оплата по счёту № {number} за обслуживание точек',
      },
    },
    operators: [
      {
        ...demoOperator,
        lastLoginAt: '2026-10-01T04:12:00Z',
        status: 'active',
      },
      { ...second, lastLoginAt: '2026-09-29T10:00:00Z', status: 'active' },
    ],
    me: {
      ...demoOperator,
      locale: 'ru',
      lastLoginAt: '2026-10-01T04:12:00Z',
    },
    password: demoOperatorPassword,
    sessions: [
      {
        id: 'ses-1',
        device: 'Chrome · Windows',
        lastSeenAt: '2026-10-01T06:00:00Z',
        current: true,
      },
      {
        id: 'ses-2',
        device: 'Edge · Windows',
        lastSeenAt: '2026-09-29T15:20:00Z',
        current: false,
      },
    ],
  };
}
