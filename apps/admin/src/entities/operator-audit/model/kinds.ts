import type { OperatorActionType } from '@pharmacy/shared-dto';
import type { StatusTone } from '@pharmacy/ui';

/** Kinds of the operator audit log, in the order of the filter. */
export const operatorActionTypes: readonly OperatorActionType[] = [
  'access',
  'company',
  'payment',
  'key',
  'service',
  'settings',
];

export const operatorActionTone: Record<OperatorActionType, StatusTone> = {
  access: 'attention',
  company: 'info',
  payment: 'success',
  key: 'warning',
  service: 'info',
  settings: 'neutral',
};
