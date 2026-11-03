/*
 * The payment QR of a store (spec 2026-11-03-pos-store-ideas, D37; ADR-0022, amendment 2026-11-03): the payment link
 * the bank gave the store, with the amount of the QR part and a reference of the receipt put in by the POS. One set of
 * rules for the API (the setting), the owner's form and the POS; the CHECKs of `stores` are the last line.
 */

export const PAYMENT_QR_TEMPLATE_MAX = 500;
export const PAYMENT_QR_RECIPIENT_MAX = 100;
export const PAYMENT_QR_REF_MAX = 18;

const AMOUNT = '{amount}';
const REF = '{ref}';

/**
 * Why a template is refused: `scheme` — not an `https://` link with a host, `length` — over 500 characters,
 * `characters` — a space or a control character, `placeholder` — braces other than `{amount}` and `{ref}`.
 */
export type PaymentQrTemplateProblem =
  'scheme' | 'length' | 'characters' | 'placeholder';

/** The first rule the template breaks, in the order of `PaymentQrTemplateProblem`; null — it can be saved. */
export function paymentQrTemplateProblem(
  template: string,
): PaymentQrTemplateProblem | null {
  if (!template.startsWith('https://')) return 'scheme';
  try {
    if (new URL(template).host === '') return 'scheme';
  } catch {
    return 'scheme';
  }
  if (template.length > PAYMENT_QR_TEMPLATE_MAX) return 'length';
  if (/[\s\p{Cc}]/u.test(template)) return 'characters';
  const rest = template.split(AMOUNT).join('').split(REF).join('');
  if (rest.includes('{') || rest.includes('}')) return 'placeholder';
  return null;
}

/** True when the bank receives the amount in the link; without it the buyer types the amount in. */
export function paymentQrHasAmount(template: string): boolean {
  return template.includes(AMOUNT);
}

/** The amount for the link: somoni with a point and two digits (12550 → `125.50`), integer arithmetic only. */
export function paymentQrAmount(amountMinor: number): string {
  const dirams = amountMinor % 100;
  // an exact multiple of 100: the division has no remainder to round
  const somoni = (amountMinor - dirams) / 100;
  return `${somoni}.${String(dirams).padStart(2, '0')}`;
}

/** The reference of a receipt: the store code and the receipt number of the terminal's shift (`A1-37`). */
export function paymentQrRef(storeCode: string, localNumber: number): string {
  return `${storeCode}-${localNumber}`.slice(0, PAYMENT_QR_REF_MAX);
}

/** The link of the QR: every `{amount}` and `{ref}` of the template replaced. */
export function paymentQrLink(
  template: string,
  values: { amountMinor: number; ref: string },
): string {
  return template
    .split(AMOUNT)
    .join(paymentQrAmount(values.amountMinor))
    .split(REF)
    .join(values.ref.slice(0, PAYMENT_QR_REF_MAX));
}
