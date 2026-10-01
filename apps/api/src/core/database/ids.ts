import { v7 } from 'uuid';

// The only id generator of the application: UUIDv7 (time-ordered, ADR-0014 §2). The database has
// no id defaults, so cloud and offline stores create rows the same way.
export function newId(): string {
  return v7();
}

// Canonical textual UUID of any version. Ids that reach set_config (tenant, operator) are checked
// with it before any database call, so a malformed value fails in the application, not in SQL.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
