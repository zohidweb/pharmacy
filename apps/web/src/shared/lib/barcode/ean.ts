/*
 * EAN-13 and EAN-8 (GS1 General Specifications, ADR-0022): the left half of EAN-13 alternates the L and G sets by the
 * first digit, the right half is the R set; guards 101 · 01010 · 101.
 */

// the L (odd) set; R is its complement, G is R reversed
const L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const R = L.map((code) =>
  [...code].map((bit) => (bit === '0' ? '1' : '0')).join(''),
);
const G = R.map((code) => [...code].reverse().join(''));
// the sets of the six left digits of EAN-13 by its first digit
const PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLG',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

const bits = (pattern: string): boolean[] =>
  [...pattern].map((bit) => bit === '1');

/** The check digit of the digits before it: weights 3 and 1 from the right, the sum up to a multiple of 10. */
export function eanCheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const fromRight = digits.length - 1 - i;
    sum += Number(digits[i]) * (fromRight % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** Digits of the length with the right check digit at the end. */
export function isValidEan(code: string, length: 8 | 12 | 13): boolean {
  if (!new RegExp(`^[0-9]{${length}}$`).test(code)) return false;
  return eanCheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/** 95 modules of a valid EAN-13. */
export function ean13Modules(code: string): boolean[] {
  const digits = [...code].map(Number);
  const parity = PARITY[digits[0]];
  let pattern = '101';
  for (let i = 1; i <= 6; i += 1) {
    pattern += (parity[i - 1] === 'L' ? L : G)[digits[i]];
  }
  pattern += '01010';
  for (let i = 7; i <= 12; i += 1) pattern += R[digits[i]];
  return bits(`${pattern}101`);
}

/** 67 modules of a valid EAN-8. */
export function ean8Modules(code: string): boolean[] {
  const digits = [...code].map(Number);
  let pattern = '101';
  for (let i = 0; i < 4; i += 1) pattern += L[digits[i]];
  pattern += '01010';
  for (let i = 4; i < 8; i += 1) pattern += R[digits[i]];
  return bits(`${pattern}101`);
}
