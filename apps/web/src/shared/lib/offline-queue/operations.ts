/*
 * Operations the POS buffers (ADR-0015): the sale and the cash operations of a shift — in one
 * queue to keep their order. Each is sent with its own id as the Idempotency-Key. The prescription
 * data of a ПКУ sale is kept encrypted in the buffer and opened only to be sent (E17).
 */
import type {
  CashMovementRequest,
  CloseShiftRequest,
  ControlledSaleData,
  CreateReceiptRequest,
  OpenShiftRequest,
  ReceiptLineInput,
} from '@pharmacy/shared-dto';
import { apiRequest } from '@/shared/api';
import {
  isSealed,
  openControlled,
  sealControlled,
  type SealedControlled,
} from './controlled-crypto';
import type { OutboxRecord, PosDb } from './db';
import type { SendOptions } from './queue';

/** A sale as the buffer keeps it: the prescription data of its lines sealed. */
export type StoredReceiptRequest = Omit<CreateReceiptRequest, 'lines'> & {
  lines: Array<
    Omit<ReceiptLineInput, 'controlled'> & {
      controlled: SealedControlled | ControlledSaleData | null;
    }
  >;
};

export type PosOperation =
  | { kind: 'receipt'; payload: StoredReceiptRequest }
  | { kind: 'shift.open'; payload: OpenShiftRequest }
  | { kind: 'shift.cash'; payload: CashMovementRequest }
  | { kind: 'shift.close'; payload: CloseShiftRequest };

export type PosOperationKind = PosOperation['kind'];

export type PosOutboxRecord = OutboxRecord<PosOperationKind> & PosOperation;

/** The sale for the buffer: every prescription data of a line sealed. */
export async function sealReceipt(
  db: PosDb,
  request: CreateReceiptRequest,
): Promise<StoredReceiptRequest> {
  return {
    ...request,
    lines: await Promise.all(
      request.lines.map(async (line) => ({
        ...line,
        controlled:
          line.controlled === null
            ? null
            : await sealControlled(db, line.controlled),
      })),
    ),
  };
}

/**
 * The sale for the server: the prescription data opened. Data that cannot be opened (sealed by a key
 * this terminal no longer has) is sent empty: the sale is a fact and its ПКУ record is created
 * without data (the fields are optional, K3) — a refused sale would hold the whole buffer behind it.
 */
async function openReceipt(
  db: PosDb,
  stored: StoredReceiptRequest,
): Promise<CreateReceiptRequest> {
  return {
    ...stored,
    lines: await Promise.all(
      stored.lines.map(async (line) => ({
        ...line,
        controlled: isSealed(line.controlled)
          ? await openControlled(db, line.controlled).catch(() => ({}))
          : line.controlled,
      })),
    ),
  };
}

export async function sendPosOperation(
  record: OutboxRecord,
  db: PosDb,
  options: SendOptions = { acceptDiscrepancy: false },
): Promise<unknown> {
  const operation = record as PosOutboxRecord;
  const idempotencyKey = operation.id;
  // the clock of the PC at the send: the server corrects `occurredAt` by its own clock (M8)
  const headers = { 'X-Client-Sent-At': new Date().toISOString() };
  switch (operation.kind) {
    case 'receipt':
      return apiRequest('receipts.create', {
        body: await openReceipt(db, operation.payload),
        idempotencyKey,
        headers: options.acceptDiscrepancy
          ? { ...headers, 'X-Accept-Discrepancy': 'true' }
          : headers,
      });
    case 'shift.open':
      return apiRequest('shifts.open', {
        body: operation.payload,
        idempotencyKey,
        headers,
      });
    case 'shift.cash':
      return apiRequest('shifts.cashMovement', {
        params: { id: operation.payload.shiftId },
        body: operation.payload,
        idempotencyKey,
        headers,
      });
    case 'shift.close':
      return apiRequest('shifts.close', {
        params: { id: operation.payload.shiftId },
        body: operation.payload,
        idempotencyKey,
        headers,
      });
  }
}
