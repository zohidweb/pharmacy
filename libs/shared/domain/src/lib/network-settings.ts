import { PIN_MIN_LENGTH } from './pin-policy';

/**
 * Defaults of the network settings — the column defaults of tenant_settings (data model 01; migrations
 * org-foundation, customer-returns, owner-cabinet). A network gets its settings row when it is created, so the
 * API falls back to these only for a network without the row; the limits of the POS buffer and the retention of
 * the prescription data are in pos-buffer.ts.
 */
export const networkSettingsDefaults = Object.freeze({
  defaultLanguage: 'ru',
  returnPeriodDays: 14,
  cashierSessionIdleMinutes: 15,
  pinMinLength: PIN_MIN_LENGTH,
  expiryReminderDays: 30,
  supplierPaymentReminderDays: 3,
  /** The step a price of a piece is rounded up to, dirams. */
  pieceRoundingDirams: 10,
  backdatingMaxDays: 30,
  warnBelowCost: true,
  customerReturnOtc: true,
  customerReturnRx: false,
  customerReturnControlled: false,
} as const);
