import { PIN_MAX_LENGTH } from '@pharmacy/shared-domain';

export const onlyDigits = (value: string) =>
  value.replace(/\D/g, '').slice(0, PIN_MAX_LENGTH);

/** The network minimum comes from the terminal (≥ 4, ADR-0008). */
export function isPinComplete(pin: string, minLength: number): boolean {
  return /^\d+$/.test(pin) && pin.length >= minLength;
}
