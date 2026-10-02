import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@pharmacy/shared-domain';

// Where the store of a request is read from: a route parameter, a query parameter or a top-level
// body field. When an option is set, the value is required and must be in the principal's scope.
export interface StoreScopeOptions {
  storeParam?: string;
  storeQuery?: string;
  storeBody?: string;
}

export interface PermissionRequirement {
  permission: Permission;
  scope?: StoreScopeOptions;
}

export const REQUIRED_PERMISSION_KEY = 'pharmacy:requiredPermission';

/**
 * One permission of the catalog (ADR-0018 p. 1) the principal must hold, and optionally the
 * request field that names the store to check against the principal's store scope.
 */
export const RequirePermission = (
  permission: Permission,
  scope?: StoreScopeOptions,
) =>
  SetMetadata<string, PermissionRequirement>(
    REQUIRED_PERMISSION_KEY,
    scope === undefined ? { permission } : { permission, scope },
  );
