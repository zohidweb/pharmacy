/*
 * PIN policy of terminal sign-in (ADR-0008): at least 4 digits by default (a network may raise the
 * minimum), no trivial PINs — one digit repeated or a straight sequence (1111, 1234, 9876).
 */
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 12;

export function isTrivialPin(pin: string): boolean {
  if (!/^\d+$/.test(pin)) return false;
  const digits = [...pin].map(Number);
  if (digits.every((digit) => digit === digits[0])) return true;
  const step = digits[1] - digits[0];
  return (
    Math.abs(step) === 1 &&
    digits.every((digit, i) => i === 0 || digit - digits[i - 1] === step)
  );
}

export type PinProblem = 'format' | 'length' | 'trivial';

/** First rule the PIN breaks, or null when it is acceptable. */
export function checkPin(
  pin: string,
  minLength: number = PIN_MIN_LENGTH,
): PinProblem | null {
  if (!/^\d*$/.test(pin)) return 'format';
  if (pin.length < Math.max(minLength, PIN_MIN_LENGTH)) return 'length';
  if (pin.length > PIN_MAX_LENGTH) return 'length';
  if (isTrivialPin(pin)) return 'trivial';
  return null;
}
