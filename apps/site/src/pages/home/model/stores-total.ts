/*
 * The sums of the stores calculator on the «Тарифы» panel (spec 2026-11-04-public-site-home-polish, H4): the price of
 * one store times the number of stores, and the same with VAT. Integer dirams only, no float; VAT is `vatOf`, the same
 * function the invoices and /tariffs use.
 */
import { vatOf } from '@pharmacy/shared-domain';

/** The range of the slider and its start (spec H4). */
export const CALCULATOR_STORES = { min: 1, max: 30, initial: 3 } as const;

/** A number of stores outside the range, or not a whole number, is brought to the nearest whole value inside it. */
function clampStores(stores: number): number {
  const whole = Math.round(stores);
  return Math.min(
    CALCULATOR_STORES.max,
    Math.max(CALCULATOR_STORES.min, whole),
  );
}

export function storesTotal(
  storePriceDirams: number,
  stores: number,
  vatBp: number,
): { totalDirams: number; withVatDirams: number } {
  const totalDirams = storePriceDirams * clampStores(stores);
  return {
    totalDirams,
    withVatDirams: totalDirams + vatOf(totalDirams, vatBp),
  };
}
