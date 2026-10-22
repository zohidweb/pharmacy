/*
 * The local number of a receipt: its number on the terminal within the shift (spec 2026-10-21-pos-offline-limits,
 * P12; ADR-0015). Given at «Оплатить» in the transaction that writes the sale into the buffer, so two tabs of a
 * terminal never give one number twice; raised to the count of the server when the shift is read, so a browser whose
 * data was cleared counts on.
 */
import type { PosDb, PosWriteTransaction } from './db';

const MAX_LOCAL_NUMBER = 999_999;

const seqKey = (shiftId: string) => `receipt-seq:${shiftId}`;

export async function nextLocalNumber(
  tx: PosWriteTransaction,
  shiftId: string,
): Promise<number> {
  const state = tx.objectStore('state');
  const current = await state.get(seqKey(shiftId));
  const next = Math.min(
    (typeof current === 'number' ? current : 0) + 1,
    MAX_LOCAL_NUMBER,
  );
  await state.put(next, seqKey(shiftId));
  return next;
}

/** The numbers of the shift go on after `atLeast` (the receipts of the shift the server has). */
export async function raiseReceiptSeq(
  db: PosDb,
  shiftId: string,
  atLeast: number,
): Promise<void> {
  const tx = db.transaction('state', 'readwrite');
  const current = await tx.store.get(seqKey(shiftId));
  if (typeof current !== 'number' || current < atLeast) {
    await tx.store.put(Math.min(atLeast, MAX_LOCAL_NUMBER), seqKey(shiftId));
  }
  await tx.done;
}
