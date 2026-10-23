import { hasPermissions } from '@pharmacy/shared-domain';
import type { CreateReceiptRequest } from '@pharmacy/shared-dto';
import type { EmployeePrincipal } from '../../common/context/request-context';
import {
  type FieldError,
  FieldProblemException,
} from '../../common/errors/validation-failed.exception';
import type { ActiveTier } from '../pricing/store-prices-reader';

// The price and the discount of a receipt by the rules of the store (security review 2026-10-22, I2, decision 7.3 A;
// ADR-0015, amendment 2026-10-23). «Продажа — факт» keeps a stale price or discount of the POS snapshot; a value that
// was never the store's is refused — online and from the buffer alike, the POS puts the operation in quarantine.

/** 422 of a receipt with a price or a discount off the rules; errors[] name the lines and the discount. */
export class PriceRulesViolated extends FieldProblemException {
  constructor(errors: readonly FieldError[]) {
    super(422, 'price_rules_violated', errors);
    this.name = 'PriceRulesViolated';
  }
}

/**
 * A unit price is one of the prices allowed for its line — the current one or the one at the moment of the snapshot
 * (null — no price); any other one, higher or lower, is an error.
 */
export function priceErrors(
  lines: ReadonlyArray<{
    unitPriceMinor: number;
    allowed: ReadonlyArray<number | null>;
  }>,
): FieldError[] {
  const errors: FieldError[] = [];
  lines.forEach((line, i) => {
    if (!line.allowed.includes(line.unitPriceMinor)) {
      errors.push({
        field: `lines.${i}.unitPriceMinor`,
        code: 'price_not_allowed',
      });
    }
  });
  return errors;
}

/**
 * No discount, or a step of a rule acting at the store: the same rule, threshold and percent. A step that is not the
 * best one for the subtotal is allowed — a smaller discount is no loss of the pharmacy — and only marked.
 */
export function discountError(
  body: Pick<
    CreateReceiptRequest,
    'discountRuleId' | 'discountMinSubtotalMinor' | 'discountPercent'
  >,
  tiers: readonly ActiveTier[],
): FieldError | null {
  if (body.discountRuleId === null) return null;
  const [ruleId, threshold] = body.discountRuleId.toLowerCase().split(':');
  const allowed =
    Number(threshold) === body.discountMinSubtotalMinor &&
    tiers.some(
      (tier) =>
        tier.ruleId === ruleId &&
        tier.minSubtotalDirams === body.discountMinSubtotalMinor &&
        tier.percent === body.discountPercent,
    );
  return allowed
    ? null
    : { field: 'discountRuleId', code: 'discount_not_allowed' };
}

/**
 * «Принять расхождение» (I2): the employee of the request — never the author of the receipt — may set the prices
 * (for a price error) and the discount rules (for a discount error) of the store.
 */
export function mayAcceptDiscrepancy(
  principal: EmployeePrincipal | null,
  storeId: string,
  errors: readonly FieldError[],
): boolean {
  if (principal === null) return false;
  const inScope =
    principal.storeScope === 'all' || principal.storeScope.includes(storeId);
  const may = (
    network: 'pricing:update-network' | 'discounts:manage-network',
    store: 'pricing:update-store' | 'discounts:manage-store',
  ) =>
    hasPermissions(principal.permissions, network) ||
    (inScope && hasPermissions(principal.permissions, store));
  const prices = errors.some((e) => e.code === 'price_not_allowed');
  const discount = errors.some((e) => e.code === 'discount_not_allowed');
  return (
    (!prices || may('pricing:update-network', 'pricing:update-store')) &&
    (!discount || may('discounts:manage-network', 'discounts:manage-store'))
  );
}
