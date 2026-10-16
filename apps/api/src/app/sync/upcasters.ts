import type { SyncOperation, SyncOperationType } from '@pharmacy/shared-dto';
import { SyncApplyError } from '../../core/sync';

// Upcasters of store operations (ADR-0014 §5; spec 2026-10-16-offline-sync, E7): `type@N` → `type@N+1`, pure
// functions with fixtures of real envelopes. Protocol 1 knows version 1 of every type, so the chain is empty;
// a newer version from a newer store waits in quarantine until this API learns it.
type Upcaster = (payload: unknown) => unknown;

const LATEST_VERSION = 1;
const UPCASTERS: ReadonlyMap<string, Upcaster> = new Map();

export function upcast(operation: SyncOperation): SyncOperation {
  let { payload, typeVersion } = operation;
  if (typeVersion > LATEST_VERSION) {
    throw new SyncApplyError('unsupported_version');
  }
  while (typeVersion < LATEST_VERSION) {
    const next = UPCASTERS.get(
      `${operation.type as SyncOperationType}@${typeVersion}`,
    );
    if (!next) throw new SyncApplyError('unsupported_version');
    payload = next(payload);
    typeVersion += 1;
  }
  return { ...operation, typeVersion, payload };
}
