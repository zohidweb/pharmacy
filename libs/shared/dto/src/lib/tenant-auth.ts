/*
 * REST contract of the client-product sign-in (ADR-0008): login + password, then the working store
 * (ADR-0018, п. 3), PIN switching of cashiers on a terminal bound to a store (device-cookie).
 * Permissions come with the session profile and are used by the UI only to hide or disable
 * elements; the server decides (ADR-0018, п. 8). Shapes only — apps/api implements them as
 * class-validator DTO classes; frontends import these types with `import type` (ADR-0015).
 */
import type { Permission, RoleTemplateKey } from '@pharmacy/shared-domain';
import type { StoreMode } from './platform-tenants.js';

/**
 * POST /api/v1/sessions. `login` is a login, a phone (E.164 or 9 digits without the country code)
 * or an e-mail: all three are unique on the whole platform (ADR-0008, amendment 2026-10-02), so
 * the network is resolved from the identifier. Errors: 401 `invalid_credentials` (an unknown
 * identifier and a wrong password are indistinguishable), 429 `login_locked`.
 */
export interface EmployeeLoginRequest {
  login: string;
  password: string;
}

/**
 * POST /api/v1/activations (public, 204): the first password of an owner (or a reset) by the
 * one-time activation code the platform operator hands over. The code is single-use and lives
 * `ACTIVATION_CODE_TTL_HOURS`; sign in with POST /sessions afterwards. Errors: 401 `invalid_code`
 * (unknown, expired or used code — not distinguished), 422 `password_policy`, 429 `login_locked`.
 */
export interface ActivationRequest {
  login: string;
  code: string;
  newPassword: string;
}

export type UiLocale = 'ru' | 'tg';

export interface SessionStore {
  id: string;
  name: string;
  address: string;
  mode: StoreMode;
}

export interface SessionEmployee {
  id: string;
  fullName: string;
  login: string;
  phone: string;
}

export interface SessionRole {
  id: string;
  name: string;
  /** «Владелец»: always the whole catalog, not editable (ADR-0018, п. 2). */
  system: boolean;
  /** The template the role was copied from; null for custom roles. */
  templateKey: RoleTemplateKey | null;
}

/** Started by a platform operator «от имени» владельца: view only (ADR-0008, ADR-0013). */
export interface ImpersonationInfo {
  operatorName: string;
  startedAt: string;
}

/**
 * 201 from POST /sessions and POST /terminal-sessions, 200 from GET /sessions/current and
 * PUT /sessions/current/store.
 */
export interface EmployeeSession {
  employee: SessionEmployee;
  tenant: { id: string; name: string };
  role: SessionRole;
  permissions: Permission[];
  /** Store scope of the employee: the whole network or a list of stores. */
  scope: 'network' | 'stores';
  /** Active stores of the scope; a PIN session sees only the terminal store. */
  stores: SessionStore[];
  /** Working store; null until it is chosen (PUT /sessions/current/store). */
  currentStoreId: string | null;
  auth: 'password' | 'pin';
  /** ISO instant of the authentication (step-up age, ADR-0008). */
  authenticatedAt: string;
  terminalId: string | null;
  impersonation: ImpersonationInfo | null;
  locale: UiLocale;
}

/** PUT /api/v1/sessions/current/store — the store must be in the employee scope (403 otherwise). */
export interface SelectStoreRequest {
  storeId: string;
}

export interface TerminalCashier {
  employeeId: string;
  /** Short display name, e.g. «Зарина Р.». */
  shortName: string;
}

/**
 * GET /api/v1/terminals/current — the terminal identified by the device-cookie; 404 `not_bound`
 * on an unbound browser.
 */
export interface BoundTerminal {
  id: string;
  name: string;
  store: SessionStore;
  cashiers: TerminalCashier[];
  /** Minimum PIN length of the network (≥ 4, ADR-0008). */
  pinLength: number;
}

/**
 * POST /api/v1/terminals — binds this browser to a store as a terminal; needs `terminals:create`
 * and a fresh password session. The answer is `BoundTerminal` and the device-cookie.
 */
export interface BindTerminalRequest {
  storeId: string;
  /** Unique among the store's active terminals; 1–60 characters after trimming. */
  name: string;
}

/**
 * POST /api/v1/terminal-sessions. Errors: 401 `invalid_pin`, 423 `pin_locked` after 3 failures
 * (sign-in by password only), 423 `terminal_locked` after too many failures on the terminal (ADR-0008).
 */
export interface PinLoginRequest {
  employeeId: string;
  pin: string;
}

/** GET /api/v1/sync/status — only on an offline store (ADR-0014). */
export interface SyncStatus {
  lastSyncAt: string | null;
  /** Operations waiting to be sent to the cloud. */
  pendingOperations: number;
  licenseValidUntil: string | null;
}

/** GET /api/v1/me */
export interface EmployeeMe extends SessionEmployee {
  roleName: string;
  scope: 'network' | 'stores';
  storeNames: string[];
  lastLoginAt: string | null;
  locale: UiLocale;
  pinSet: boolean;
}

/** PATCH /api/v1/me */
export interface UpdateEmployeeMeRequest {
  locale: UiLocale;
}

/**
 * POST /api/v1/me/pin. Only in a session opened by password (step-up, ADR-0008); trivial PINs
 * (repeats, sequences) are rejected with 422 `pin_trivial`.
 */
export interface ChangePinRequest {
  currentPin: string | null;
  newPin: string;
}

/** GET /api/v1/me/terminals — terminals the employee signed in on. */
export interface MyTerminal {
  id: string;
  name: string;
  storeName: string | null;
  boundAt: string;
  lastSeenAt: string;
  /** The terminal of this browser. */
  current: boolean;
}
