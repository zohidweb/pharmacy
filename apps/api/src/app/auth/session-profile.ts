import type { Permission, RoleTemplateKey } from '@pharmacy/shared-domain';
import type {
  EmployeeSession,
  SessionStore as SessionStoreDto,
  UiLocale,
} from '@pharmacy/shared-dto';
import type { EmployeeProfile, ProfileStore } from './employee-auth.repository';

// Mapping of database rows and the session onto the EmployeeSession contract (libs/shared/dto
// tenant-auth.ts). The database stores Tajik as `tj`, the UI locale is `tg`.

const ROLE_TEMPLATE_KEYS: readonly string[] = [
  'owner',
  'manager',
  'cashier',
  'accountant',
] satisfies RoleTemplateKey[];

/** UI locale of an employee: their own language, else the network default. */
export function uiLocale(
  language: string | null,
  defaultLanguage: string,
): UiLocale {
  return (language ?? defaultLanguage) === 'tj' ? 'tg' : 'ru';
}

/** Database language of a UI locale: `tg` is stored as `tj`. */
export function dbLanguage(locale: UiLocale): 'ru' | 'tj' {
  return locale === 'tg' ? 'tj' : 'ru';
}

function stringAt(map: unknown, key: string): string | undefined {
  if (map === null || typeof map !== 'object') return undefined;
  const value = (map as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/** Role name in the session language, falling back to Russian. */
export function roleDisplayName(name: unknown, locale: UiLocale): string {
  return (
    stringAt(name, locale === 'tg' ? 'tj' : 'ru') ?? stringAt(name, 'ru') ?? ''
  );
}

/** `online` → `cloud`; `offline_pending` and `offline` → `offline`. */
export function sessionStoreMode(mode: string): SessionStoreDto['mode'] {
  return mode === 'online' ? 'cloud' : 'offline';
}

/** Idle timeout of the network (minutes) in seconds, clamped into [min, max]. */
export function idleTtlSeconds(
  idleMinutes: number,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, idleMinutes * 60));
}

export function toRoleTemplateKey(
  value: string | null,
): RoleTemplateKey | null {
  return value !== null && ROLE_TEMPLATE_KEYS.includes(value)
    ? (value as RoleTemplateKey)
    : null;
}

/** The session fields the profile shows (from the session record or the request principal). */
export interface SessionView {
  permissions: readonly Permission[];
  storeScope: 'all' | readonly string[];
  currentStoreId: string | null;
  auth: 'password' | 'pin';
  authenticatedAt: string;
  terminalId: string | null;
  locale: UiLocale;
}

export function buildEmployeeSession(
  profile: EmployeeProfile,
  stores: readonly ProfileStore[],
  view: SessionView,
): EmployeeSession {
  return {
    employee: {
      id: profile.employee.id,
      fullName: profile.employee.fullName,
      login: profile.employee.login,
      phone: profile.employee.phone ?? '',
    },
    tenant: { id: profile.tenant.id, name: profile.tenant.name },
    role: {
      id: profile.role.id,
      name: roleDisplayName(profile.role.name, view.locale),
      system: profile.role.isOwner,
      templateKey: toRoleTemplateKey(profile.role.templateKey),
    },
    permissions: [...view.permissions],
    scope: view.storeScope === 'all' ? 'network' : 'stores',
    stores: stores.map((store) => ({
      id: store.id,
      name: store.name,
      address: store.address,
      mode: sessionStoreMode(store.mode),
    })),
    currentStoreId: view.currentStoreId,
    auth: view.auth,
    authenticatedAt: view.authenticatedAt,
    terminalId: view.terminalId,
    impersonation: null,
    locale: view.locale,
  };
}
