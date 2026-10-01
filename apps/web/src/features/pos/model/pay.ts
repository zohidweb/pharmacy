/*
 * «Оплатить» (ADR-0015, «Буфер кассы»): the operation gets its UUIDv7 at the press, is written to
 * the outbox in one transaction with clearing the draft, then sent. The same path works online and
 * during an outage; the cashier never waits for the network to finish a sale.
 */
import type {
  CatalogSnapshot,
  CreateReceiptRequest,
  CreatedReceipt,
  EmployeeSession,
} from '@pharmacy/shared-dto';
import { uuidv7 } from '@pharmacy/shared-util';
import type { TerminalRuntime } from '@/shared/lib/offline-queue';
import { DRAFT_KEY } from './pos-store';
import {
  lineAmount,
  paymentState,
  piecesOf,
  totals,
  type ReceiptDraft,
} from './receipt';

export interface SaleContext {
  session: EmployeeSession;
  shiftId: string;
  snapshot: CatalogSnapshot;
}

export function buildReceiptRequest(
  draft: ReceiptDraft,
  { session, shiftId, snapshot }: SaleContext,
  id: string = uuidv7(),
  occurredAt: string = new Date().toISOString(),
): CreateReceiptRequest {
  const sum = totals(draft, snapshot.discountRules);
  const payment = paymentState(draft, sum.totalMinor);
  if (payment.problem)
    throw new Error(`receipt is not payable: ${payment.problem}`);
  return {
    id,
    storeId: session.currentStoreId ?? '',
    terminalId: session.terminalId,
    employeeId: session.employee.id,
    occurredAt,
    shiftId,
    priceListVersion: snapshot.version,
    lines: draft.lines.map((line) => ({
      productId: line.productId,
      batchId: line.batchId,
      unit: line.unit,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      amountMinor: lineAmount(line),
      controlled: line.controlled,
    })),
    subtotalMinor: sum.subtotalMinor,
    discountRuleId: sum.discount.ruleId,
    discountMinor: sum.discount.amountMinor,
    totalMinor: sum.totalMinor,
    payments: payment.payments,
    cashTenderedMinor: payment.tenderedMinor,
    changeMinor: payment.changeMinor,
  };
}

/** Stock of the sold batches leaves the local snapshot at once, so FEFO stays right offline. */
export function applySaleToSnapshot(
  snapshot: CatalogSnapshot,
  request: CreateReceiptRequest,
): CatalogSnapshot {
  const sold = new Map<string, number>();
  for (const line of request.lines) {
    const product = snapshot.products.find((p) => p.id === line.productId);
    if (!product) continue;
    sold.set(
      line.batchId,
      (sold.get(line.batchId) ?? 0) +
        piecesOf(product, line.unit, line.quantity),
    );
  }
  return {
    ...snapshot,
    products: snapshot.products.map((product) =>
      product.batches.some((b) => sold.has(b.id))
        ? {
            ...product,
            batches: product.batches.map((b) =>
              sold.has(b.id)
                ? {
                    ...b,
                    quantityPieces: Math.max(
                      0,
                      b.quantityPieces - (sold.get(b.id) ?? 0),
                    ),
                  }
                : b,
            ),
          }
        : product,
    ),
  };
}

/** Enqueues the sale together with clearing the stored draft (one IndexedDB transaction). */
export async function enqueueSale(
  runtime: TerminalRuntime,
  request: CreateReceiptRequest,
): Promise<void> {
  await runtime.enqueue({ kind: 'receipt', payload: request }, async (tx) => {
    await tx.objectStore('state').delete(DRAFT_KEY);
  });
}

/** Waits briefly for the server number of the receipt; null when it stays in the buffer. */
export function awaitDelivery(
  runtime: TerminalRuntime,
  id: string,
  timeoutMs = 1_500,
): Promise<CreatedReceipt | null> {
  return new Promise((resolve) => {
    const unsubscribe = runtime.queue.onDelivered((record, response) => {
      if (record.id !== id) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(response as CreatedReceipt);
    });
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, timeoutMs);
  });
}
