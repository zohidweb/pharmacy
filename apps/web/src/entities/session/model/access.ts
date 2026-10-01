/*
 * Access helpers over the session profile (ADR-0018, п. 8): they only hide or disable UI.
 * The server checks every request; a stale profile at worst shows a control that answers 403.
 */
import { hasPermissions, type Permission } from '@pharmacy/shared-domain';
import type { EmployeeSession, SessionStore } from '@pharmacy/shared-dto';
import { useSession } from '../api/session-queries';

export function can(
  session: EmployeeSession | null | undefined,
  ...required: Permission[]
): boolean {
  return (
    Boolean(session) && hasPermissions(session?.permissions ?? [], ...required)
  );
}

/** Writes are blocked in a view-only «от имени» session (ADR-0008). */
export function canWrite(
  session: EmployeeSession | null | undefined,
  ...required: Permission[]
): boolean {
  return can(session, ...required) && !session?.impersonation;
}

export function currentStoreOf(
  session: EmployeeSession | null | undefined,
): SessionStore | null {
  if (!session?.currentStoreId) return null;
  return (
    session.stores.find((store) => store.id === session.currentStoreId) ?? null
  );
}

/** `can` bound to the current session, for components. */
export function useCan() {
  const { data: session } = useSession();
  return (...required: Permission[]) => can(session, ...required);
}
