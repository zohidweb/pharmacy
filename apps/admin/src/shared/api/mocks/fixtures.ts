/*
 * Synthetic data for UI development without apps/api. Not real people or credentials:
 * the demo operator exists only in the in-memory mock transport.
 */
import type { OperatorProfile } from '@pharmacy/shared-dto';

export const demoOperator: OperatorProfile = {
  id: 'op-demo-1',
  fullName: 'Демо Оператор',
  login: 'operator@example.test',
  role: 'full_access',
};

/** Mock-only password of the demo operator (apps/admin/README.md, "Моки API"). */
export const demoOperatorPassword = 'demo-password';
