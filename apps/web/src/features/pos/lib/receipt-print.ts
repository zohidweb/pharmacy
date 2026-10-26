/*
 * Lines of the printed sale receipt (UI mockup «Предпросмотр чека»): fixed width from the paper,
 * amounts without the currency sign and with plain spaces (thermal fonts lack U+00A0/U+202F); the
 * sign is printed once, on the total. Fiscal requisites are a placeholder until the ККМ adapter is
 * chosen (stack.md, вопрос 9).
 */
import type {
  CreateReceiptRequest,
  PosStoreSettings,
  ReceiptPaymentMethod,
} from '@pharmacy/shared-dto';
import { receiptCode } from '@pharmacy/shared-domain';
import {
  CURRENCY_SIGN,
  formatDateTime,
  formatMoney,
  receiptCenter,
  receiptRow,
  receiptRule,
  receiptWrap,
} from '@pharmacy/shared-util';

const amount = (minor: number) =>
  formatMoney(minor, { withSign: false, plainSpaces: true });

export interface ReceiptLabels {
  receipt: (number: string) => string;
  pendingNumber: string;
  /** A receipt without its server number: the local number and the code (spec 2026-10-21-pos-offline-limits, P13). */
  localNumber: (number: number, code: string) => string;
  serverNumberLater: string;
  cashier: string;
  subtotal: string;
  discount: (percent: number) => string;
  total: string;
  change: string;
  tendered: string;
  method: Record<ReceiptPaymentMethod, string>;
  unit: { pack: string; piece: string };
  fiscalPlaceholder: string;
  taxId: string;
}

export interface ReceiptPrintData {
  request: CreateReceiptRequest;
  number: string | null;
  productNames: Record<string, string>;
  cashierName: string;
  settings: PosStoreSettings;
}

export function saleReceiptLines(
  { request, number, productNames, cashierName, settings }: ReceiptPrintData,
  labels: ReceiptLabels,
  cols: number,
): string[] {
  const out: string[] = [];
  out.push(...receiptCenter(settings.networkName, cols));
  out.push(
    ...receiptCenter(`${settings.storeName} · ${settings.storeAddress}`, cols),
  );
  out.push(...receiptCenter(`${labels.taxId} ${settings.taxId}`, cols));
  out.push(receiptRule(cols));
  const local = number ? null : (request.localNumber ?? null);
  out.push(
    ...receiptRow(
      number
        ? labels.receipt(number)
        : local !== null
          ? labels.localNumber(local, receiptCode(request.id))
          : labels.pendingNumber,
      formatDateTime(request.occurredAt),
      cols,
    ),
  );
  if (local !== null) out.push(...receiptWrap(labels.serverNumberLater, cols));
  out.push(...receiptRow(labels.cashier, cashierName, cols));
  out.push(receiptRule(cols));
  for (const line of request.lines) {
    out.push(
      ...receiptWrap(productNames[line.productId] ?? line.productId, cols),
    );
    out.push(
      ...receiptRow(
        `  ${line.quantity} ${labels.unit[line.unit]} × ${amount(line.unitPriceMinor)}`,
        amount(line.amountMinor),
        cols,
      ),
    );
  }
  out.push(receiptRule(cols));
  out.push(...receiptRow(labels.subtotal, amount(request.subtotalMinor), cols));
  if (request.discountMinor > 0) {
    const percent = Math.round(
      (request.discountMinor * 100) / request.subtotalMinor,
    );
    out.push(
      ...receiptRow(
        labels.discount(percent),
        `-${amount(request.discountMinor)}`,
        cols,
      ),
    );
  }
  out.push(
    ...receiptRow(
      labels.total,
      `${amount(request.totalMinor)} ${CURRENCY_SIGN}`,
      cols,
    ),
  );
  out.push(receiptRule(cols, '='));
  for (const payment of request.payments) {
    out.push(
      ...receiptRow(
        labels.method[payment.method],
        amount(payment.amountMinor),
        cols,
      ),
    );
  }
  if (request.changeMinor > 0) {
    out.push(
      ...receiptRow(labels.tendered, amount(request.cashTenderedMinor), cols),
    );
    out.push(...receiptRow(labels.change, amount(request.changeMinor), cols));
  }
  out.push(receiptRule(cols));
  out.push(...receiptCenter(labels.fiscalPlaceholder, cols));
  // the owner's line breaks are kept: each typed line is wrapped on its own
  for (const line of settings.receiptFooter.split(/\r?\n/)) {
    out.push(...receiptWrap(line, cols));
  }
  return out;
}
