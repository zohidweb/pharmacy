// Public surface of the tenant data path. The pool, the settings and the root Kysely are not
// exported: application code gets a transaction from TenantDatabase only (ADR-0006 rule 1), and
// before a tenant context exists, fixed resolver calls from ContextResolvers (ADR-0013 p. 3).
export {
  ContextResolvers,
  type LoginKind,
  type ResolvedLicenseKey,
  type ResolvedLogin,
  type ResolvedTerminal,
} from './context-resolvers';
export { DatabaseModule } from './database.module';
export { TenantDatabase, type TenantTransaction } from './tenant-database';
export type { DB } from './db.generated';
export { isUuid, newId } from './ids';
export { escapeLike } from './like';
export {
  foreignKeyConstraint,
  isUniqueViolation,
  uniqueConstraint,
} from './unique-violation';
export {
  PLATFORM_TIME_ZONE,
  platformDate,
  platformToday,
  settingsTimeZone,
  tenantTimeZone,
  tenantToday,
} from './time-zone';
