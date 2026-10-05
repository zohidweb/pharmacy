import { SetMetadata } from '@nestjs/common';
import type { OperatorPermission } from '@pharmacy/shared-domain';
import {
  type OperatorPermissionRequirement,
  REQUIRED_OPERATOR_PERMISSION_KEY,
} from '../../../common/guards/decorators';

/**
 * One operator permission (auth design 2026-10-02, section 9) the operator must hold. Routes of
 * the operator contour carry this or @Public(); anything else is denied by default.
 */
export const RequireOperatorPermission = (permission: OperatorPermission) =>
  SetMetadata<string, OperatorPermissionRequirement>(
    REQUIRED_OPERATOR_PERMISSION_KEY,
    { permission },
  );
