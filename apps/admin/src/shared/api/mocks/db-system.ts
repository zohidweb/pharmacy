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
import { demoOperator, demoOperatorPassword } from './fixtures';

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
        params: { storeName: 'Демо Фарм №3', days: 7 },
        target: { screen: 'store', id: 's-103' },
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
        params: { storeName: 'Демо Фарм №4', days: 3 },
        target: { screen: 'store', id: 's-104' },
        createdAt: '2026-09-30T22:00:00Z',
        read: false,
      },
      {
        id: 'n-5',
        topic: 'keys',
        kind: 'key_revoked',
        params: { storeName: 'Пример Мед №2' },
        target: { screen: 'licenses' },
        createdAt: '2026-08-20T10:00:00Z',
        read: true,
      },
      {
        id: 'n-6',
        topic: 'billing',
        kind: 'payment_recorded',
        params: { tenantName: 'Демо Фарм', amountMinor: 195_730 },
        target: { screen: 'billing' },
        createdAt: '2026-09-05T09:10:00Z',
        read: true,
      },
      {
        id: 'n-7',
        topic: 'sync',
        kind: 'update_available',
        params: { version: '2.4.0' },
        target: { screen: 'installations' },
        createdAt: '2026-09-18T08:00:00Z',
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
    preferences: { billing: true, keys: true, services: true, sync: false },
    operatorAudit: [
      {
        id: 'oa-1',
        at: '2026-09-30T06:42:00Z',
        operatorId: demoOperator.id,
        operatorName: demoOperator.fullName,
        type: 'payment',
        targetLabel: 'Демо Фарм',
        description: 'Зафиксирован платёж по счёту СЧ-2026-09-001',
      },
      {
        id: 'oa-2',
        at: '2026-09-29T10:15:00Z',
        operatorId: second.id,
        operatorName: second.fullName,
        type: 'key',
        targetLabel: 'Демо Фарм №4',
        description: 'Выдан лицензионный ключ на год',
      },
      {
        id: 'oa-3',
        at: '2026-09-28T08:05:00Z',
        operatorId: demoOperator.id,
        operatorName: demoOperator.fullName,
        type: 'impersonation',
        targetLabel: 'Пример Мед',
        description: 'Сеанс «от имени» владельца: проверка обращения',
      },
      {
        id: 'oa-4',
        at: '2026-09-27T12:30:00Z',
        operatorId: second.id,
        operatorName: second.fullName,
        type: 'service',
        targetLabel: 'Демо Фарм',
        description: 'Подтверждена услуга «Расширенная аналитика»',
      },
      {
        id: 'oa-5',
        at: '2026-09-25T07:00:00Z',
        operatorId: demoOperator.id,
        operatorName: demoOperator.fullName,
        type: 'settings',
        targetLabel: 'Платформа',
        description: 'Изменено уведомление об окончании ключа: 7 дней',
      },
      {
        id: 'oa-6',
        at: '2026-09-20T09:45:00Z',
        operatorId: demoOperator.id,
        operatorName: demoOperator.fullName,
        type: 'company',
        targetLabel: 'Тест Аптека',
        description: 'Создана компания и первая точка',
      },
      {
        id: 'oa-7',
        at: '2026-09-15T11:20:00Z',
        operatorId: second.id,
        operatorName: second.fullName,
        type: 'key',
        targetLabel: 'Пример Мед №2',
        description: 'Отозван лицензионный ключ: замена при переустановке',
      },
    ],
    settings: {
      pricePerStoreMinor: 12_000,
      vatRatePercent: 15,
      prorateByDays: true,
      keyExpiryNoticeDays: 7,
      defaultSyncSchedule: 'daily',
      acceptLegacyVersionSync: true,
      supplier: {
        name: 'ООО «Платформа» (демо)',
        inn: '000000000',
        bankAccount: '00000000000000000000',
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
      phone: '+992 00 000 00 90',
      position: 'Оператор платформы',
      locale: 'ru',
      lastLoginAt: '2026-10-01T04:12:00Z',
      impersonationReminder: true,
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
