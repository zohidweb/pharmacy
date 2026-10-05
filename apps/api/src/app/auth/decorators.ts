import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@pharmacy/shared-domain';
import {
  type PermissionRequirement,
  REQUIRED_PERMISSION_KEY,
  type StoreScopeOptions,
} from '../../common/guards/decorators';

export type { PermissionRequirement, StoreScopeOptions };

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
