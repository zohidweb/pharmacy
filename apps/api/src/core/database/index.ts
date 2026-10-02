// Public surface of the tenant data path. The pool, the settings and the root Kysely are not
// exported: application code gets a transaction from TenantDatabase only (ADR-0006 rule 1), and
// before a tenant context exists, fixed resolver calls from ContextResolvers (ADR-0013 p. 3).
export {
  ContextResolvers,
  type LoginKind,
  type ResolvedLogin,
} from './context-resolvers';
export { DatabaseModule } from './database.module';
export { TenantDatabase, type TenantTransaction } from './tenant-database';
export type { DB } from './db.generated';
export { isUuid, newId } from './ids';
