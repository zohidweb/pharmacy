import { LoginLimiter, type LoginLimiterOptions } from './login-limiter';

// The budget of password attempts of one account (security review 2026-10-22, A2; ADR-0008,
// amendment 2026-10-23): the identifier limit holds per login, phone and e-mail, so without it an
// account had three budgets. A daily ceiling of about 50 attempts: 10 within a day, then 1 h
// locked, a repeat within a day 6 h; the window is a day, so a slow guesser meets the lock (and the
// owner's notification) too. Constants, not environment variables.
export const ACCOUNT_LIMITER_OPTIONS: Readonly<LoginLimiterOptions> = {
  maxFailures: 10,
  windowSeconds: 86400,
  lockSeconds: 3600,
  repeatLockSeconds: 21600,
  repeatWindowSeconds: 86400,
};

/** Limiter key of an employee's account: ids only, no personal data. */
export function accountLimiterKey(
  tenantId: string,
  employeeId: string,
): string {
  return `account:${tenantId}:${employeeId}`;
}

// DI token of the limiter with the account policy: the same implementations as LoginLimiter
// (Redis in the cloud, process memory on an offline store) with ACCOUNT_LIMITER_OPTIONS.
export abstract class AccountLimiter extends LoginLimiter {}
