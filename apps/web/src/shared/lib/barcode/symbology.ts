import { CODE128_B, code128Modules } from './code128';
import { ean8Modules, ean13Modules, isValidEan } from './ean';

/** Bars and spaces from the left, in modules: true — a bar. */
export interface LinearBarcode {
  kind: 'ean13' | 'ean8' | 'code128';
  modules: boolean[];
  /** The text under the bars. */
  text: string;
}

/**
 * The symbology of a product barcode on a price tag (plan 2026-10-28-price-tags-qr, T2): EAN-13, UPC-A as EAN-13 with
 * a leading 0 and EAN-8 when the check digit is right; other printable Latin as Code 128 when its bars take at most
 * `maxModules`; else null — no bars, the code is printed as text. Digits with a wrong check digit become Code 128,
 * never an EAN with a check digit of its own.
 */
export function tagBarcode(
  value: string,
  maxModules: number,
): LinearBarcode | null {
  const code = value.trim();
  if (isValidEan(code, 13)) {
    return { kind: 'ean13', modules: ean13Modules(code), text: code };
  }
  if (isValidEan(code, 12)) {
    const ean = `0${code}`;
    return { kind: 'ean13', modules: ean13Modules(ean), text: ean };
  }
  if (isValidEan(code, 8)) {
    return { kind: 'ean8', modules: ean8Modules(code), text: code };
  }
  if (!CODE128_B.test(code)) return null;
  const modules = code128Modules(code);
  return modules.length <= maxModules
    ? { kind: 'code128', modules, text: code }
    : null;
}
