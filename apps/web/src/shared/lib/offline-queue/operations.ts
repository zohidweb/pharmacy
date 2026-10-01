/*
 * Operations the POS buffers (ADR-0015): the sale and the cash operations of a shift — in one
 * queue to keep their order. Each is sent with its own id as the Idempotency-Key.
 */
import type {
  CashMovementRequest,
  CloseShiftRequest,
  CreateReceiptRequest,
  OpenShiftRequest,
} from '@pharmacy/shared-dto';
import { apiRequest } from '@/shared/api';
import type { OutboxRecord } from './db';

export type PosOperation =
  | { kind: 'receipt'; payload: CreateReceiptRequest }
  | { kind: 'shift.open'; payload: OpenShiftRequest }
  | { kind: 'shift.cash'; payload: CashMovementRequest }
  | { kind: 'shift.close'; payload: CloseShiftRequest };

export type PosOperationKind = PosOperation['kind'];

export type PosOutboxRecord = OutboxRecord<PosOperationKind> & PosOperation;

export function sendPosOperation(record: OutboxRecord): Promise<unknown> {
  const operation = record as PosOutboxRecord;
  const idempotencyKey = operation.id;
  switch (operation.kind) {
    case 'receipt':
      return apiRequest('receipts.create', {
        body: operation.payload,
        idempotencyKey,
      });
    case 'shift.open':
      return apiRequest('shifts.open', {
        body: operation.payload,
        idempotencyKey,
      });
    case 'shift.cash':
      return apiRequest('shifts.cashMovement', {
        params: { id: operation.payload.shiftId },
        body: operation.payload,
        idempotencyKey,
      });
    case 'shift.close':
      return apiRequest('shifts.close', {
        params: { id: operation.payload.shiftId },
        body: operation.payload,
        idempotencyKey,
      });
  }
}
