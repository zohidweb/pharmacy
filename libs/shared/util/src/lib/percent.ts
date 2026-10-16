/**
 * A percentage kept in basis points (discounts, VAT: 1250 = 12.5 %) as text with the decimal comma
 * of RU and TJ: `formatPercentBp(1250)` → '12,5'. The sign is the message's: «скидка {percent}%».
 */
export function formatPercentBp(basisPoints: number): string {
  if (!Number.isSafeInteger(basisPoints)) {
    throw new RangeError('A percentage must be a whole number of basis points');
  }
  const sign = basisPoints < 0 ? '-' : '';
  const abs = Math.abs(basisPoints);
  const whole = Math.trunc(abs / 100);
  const fraction = String(abs % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return `${sign}${whole}${fraction ? `,${fraction}` : ''}`;
}
