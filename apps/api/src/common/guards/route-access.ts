import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Permission } from '@pharmacy/shared-domain';
import {
  IS_AUTHENTICATED_KEY,
  IS_PUBLIC_KEY,
  type PermissionRequirement,
  REQUIRED_PERMISSION_KEY,
  type StoreScopeOptions,
} from './decorators';

export type RouteAccess =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'permission'; permission: Permission; scope?: StoreScopeOptions }
  | { kind: 'none' };

// A route handler or a controller class: where decorators put their metadata.
type MetadataTarget =
  | ReturnType<ExecutionContext['getHandler']>
  | ReturnType<ExecutionContext['getClass']>;

// The marker of one level, or null when it has none. Several markers on one level resolve to the
// strictest (permission, then authenticated, then public), so a mistake fails closed.
function accessAt(
  reflector: Reflector,
  target: MetadataTarget,
): RouteAccess | null {
  const requirement = reflector.get<PermissionRequirement | undefined>(
    REQUIRED_PERMISSION_KEY,
    target,
  );
  if (requirement) {
    return requirement.scope === undefined
      ? { kind: 'permission', permission: requirement.permission }
      : {
          kind: 'permission',
          permission: requirement.permission,
          scope: requirement.scope,
        };
  }
  if (reflector.get<boolean | undefined>(IS_AUTHENTICATED_KEY, target)) {
    return { kind: 'authenticated' };
  }
  if (reflector.get<boolean | undefined>(IS_PUBLIC_KEY, target)) {
    return { kind: 'public' };
  }
  return null;
}

/**
 * The access rule of a route, resolved at the nearest level: a handler with any marker
 * (@Public, @Authenticated, @RequirePermission) uses its own; otherwise the class marker applies;
 * none at all is 'none' (deny by default, ADR-0018 p. 5). A class @Public() therefore never opens
 * a handler that declares a permission or @Authenticated(). AuthGuard and PermissionsGuard both
 * use this, so they cannot disagree.
 */
export function resolveRouteAccess(
  reflector: Reflector,
  context: ExecutionContext,
): RouteAccess {
  return (
    accessAt(reflector, context.getHandler()) ??
    accessAt(reflector, context.getClass()) ?? { kind: 'none' }
  );
}
