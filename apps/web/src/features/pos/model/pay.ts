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
import { sealReceipt, type TerminalRuntime } from '@/shared/lib/offline-queue';
import { DRAFT_KEY, forgetStoredDraft } from './pos-store';
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
  /** Language of the printed receipt. */
  language: CreateReceiptRequest['language'];
}

export function buildReceiptRequest(
  draft: ReceiptDraft,
  { session, shiftId, snapshot, language }: SaleContext,
  id: string = uuidv7(),
  occurredAt: string = new Date().toISOString(),
): CreateReceiptRequest {
  const sum = totals(draft, snapshot.discountRules);
  const payment = paymentState(draft, sum.totalMinor);
  if (payment.problem)
    throw new Error(`receipt is not payable: ${payment.problem}`);
  // the values of the snapshot the receipt was counted by travel with it (spec 2026-10-13, E23)
  const products = new Map(snapshot.products.map((p) => [p.id, p]));
  const step = snapshot.discountRules.find(
    (rule) => rule.id === sum.discount.ruleId,
  );
  return {
    id,
    storeId: session.currentStoreId ?? '',
    terminalId: session.terminalId,
    employeeId: session.employee.id,
    occurredAt,
    shiftId,
    // the oldest snapshot a line was priced by: a line keeps its price when the snapshot is refreshed (ADR-0015,
    // amendment 2026-10-23)
    priceListVersion: Math.min(
      snapshot.version,
      ...draft.lines.map((line) => line.priceVersion ?? snapshot.version),
    ),
    lines: draft.lines.map((line) => ({
      productId: line.productId,
      batchId: line.batchId,
      unit: line.unit,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      amountMinor: lineAmount(line),
      piecesPerPack:
        line.piecesPerPack ?? products.get(line.productId)?.piecesPerPack ?? 1,
      batchChosenManually: line.manualBatch,
      controlled:
        line.prescription === 'controlled' ? (line.controlled ?? {}) : null,
    })),
    subtotalMinor: sum.subtotalMinor,
    discountRuleId: sum.discount.ruleId,
    discountPercent: step ? step.percent : 0,
    discountMinSubtotalMinor: step ? step.minSubtotalMinor : 0,
    discountMinor: sum.discount.amountMinor,
    totalMinor: sum.totalMinor,
    payments: payment.payments,
    cashTenderedMinor: payment.tenderedMinor,
    changeMinor: payment.changeMinor,
    language,
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

/**
 * Enqueues the sale together with clearing the stored draft (one IndexedDB transaction) and gives it its local
 * number within the shift (spec 2026-10-21-pos-offline-limits, P12): the sale as enqueued, with that number.
 */
export async function enqueueSale(
  runtime: TerminalRuntime,
  request: CreateReceiptRequest,
): Promise<CreateReceiptRequest> {
  // the prescription data of the ПКУ lines goes into the buffer sealed (E17)
  const payload = await sealReceipt(runtime.db, request);
  // a draft write still queued from before the payment must not bring the paid cart back
  forgetStoredDraft();
  const localNumber = await runtime.enqueueReceipt(payload, async (tx) => {
    await tx.objectStore('state').delete(DRAFT_KEY);
  });
  return { ...request, localNumber };
}

/**
 * Waits briefly for the server answer of a buffered operation (the number of a receipt, the
 * Z-report of a closing); null when it stays in the buffer.
 */
export function awaitDelivery<T = CreatedReceipt>(
  runtime: TerminalRuntime,
  id: string,
  timeoutMs = 1_500,
): Promise<T | null> {
  return new Promise((resolve) => {
    const unsubscribe = runtime.queue.onDelivered((record, response) => {
      if (record.id !== id) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(response as T);
    });
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, timeoutMs);
  });
}
