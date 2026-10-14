import type { EmployeePrincipal } from '../../common/context/request-context';

/**
 * The stores an employee sees in the home, the reports and the expenses: 'all' for the whole
 * network, otherwise the stores of the scope; a PIN session — its terminal's store only.
 */
export function scopeOf(principal: EmployeePrincipal): 'all' | readonly string[] {
  if (principal.auth === 'pin') {
    return principal.currentStoreId ? [principal.currentStoreId] : [];
  }
  return principal.storeScope;
}
