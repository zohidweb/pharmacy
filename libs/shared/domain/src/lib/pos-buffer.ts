/**
 * Limits of the outage buffer of the POS (spec 2026-10-21-pos-offline-limits, P6; ADR-0015, decisions of 2026-09-30):
 * parameters of the network, the same for the API that keeps them and the terminal that applies them offline.
 */
export interface PosBufferLimits {
  /** Age of the oldest operation waiting in the buffer, hours: then the POS takes no new receipts. */
  maxHours: number;
  /** Operations waiting in the buffer of the terminal. */
  maxOperations: number;
  /** Age of the oldest waiting receipt with a ПКУ line, hours: then ПКУ is not sold. */
  controlledMaxHours: number;
  /** Waiting receipts with a ПКУ line. */
  controlledMaxOperations: number;
}

export const posBufferDefaults: Readonly<PosBufferLimits> = Object.freeze({
  maxHours: 24,
  maxOperations: 500,
  controlledMaxHours: 8,
  controlledMaxOperations: 20,
});

/** Inclusive bounds; the ПКУ limits are not above the general ones. */
export const posBufferBounds: Readonly<
  Record<keyof PosBufferLimits, readonly [number, number]>
> = Object.freeze({
  maxHours: [1, 72],
  maxOperations: [50, 2000],
  controlledMaxHours: [1, 24],
  controlledMaxOperations: [1, 200],
});

/** Retention of the prescription data, days (data model 04). */
export const prescriptionRetentionBounds: readonly [number, number] =
  Object.freeze([1, 3650]) as readonly [number, number];
export const PRESCRIPTION_RETENTION_DEFAULT_DAYS = 90;

/** From this share of a limit the cashier sees a warning. */
export const BUFFER_WARN_RATIO = 0.8;

const RECEIPT_CODE = /^[0-9a-f]{8}$/i;

/**
 * The code of a receipt printed without its server number (P13): the last 8 hex digits of its UUIDv7 id (the
 * random part), upper case. The cashier finds the receipt for a return by it (P14).
 */
export function receiptCode(id: string): string {
  return id.replace(/-/g, '').slice(-8).toUpperCase();
}

export function isReceiptCode(value: string): boolean {
  return RECEIPT_CODE.test(value);
}
