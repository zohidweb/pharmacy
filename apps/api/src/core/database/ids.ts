import { v7 } from 'uuid';

// The only id generator of the application: UUIDv7 (time-ordered, ADR-0014 §2). The database has
// no id defaults, so cloud and offline stores create rows the same way.
export function newId(): string {
  return v7();
}
