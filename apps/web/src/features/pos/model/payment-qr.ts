'use client';

/*
 * The payment QR of the receipt (spec 2026-11-03-pos-store-ideas, D37–D40; ADR-0022, amendment 2026-11-03): the link of
 * the store from the catalog snapshot with the QR part and the reference of the receipt put in — built on the PC,
 * without the network. The reference is the store code and the number the next receipt of the shift will get (R2).
 */
import {
  paymentQrHasAmount,
  paymentQrLink,
  paymentQrRef,
} from '@pharmacy/shared-domain';
import type { PosStoreSettings } from '@pharmacy/shared-dto';
import { useEffect, useMemo, useState } from 'react';
import type { DisplayQr } from '@/shared/lib/customer-display';
import { peekLocalNumber, type PosDb } from '@/shared/lib/offline-queue';

export interface PaymentQrInput {
  db: PosDb | null;
  shiftId: string | null;
  /** A snapshot stored before the payment QR has neither `storeCode` nor `paymentQr` (R7). */
  settings:
    Partial<Pick<PosStoreSettings, 'storeCode' | 'paymentQr'>> | undefined;
  /** The QR part of the receipt. */
  qrMinor: number;
}

/** The QR of the QR part; null — no QR part, no link of the store, or the number is still being read. */
export function usePaymentQr({
  db,
  shiftId,
  settings,
  qrMinor,
}: PaymentQrInput): DisplayQr | null {
  const template = settings?.paymentQr?.template ?? null;
  const recipient = settings?.paymentQr?.recipient ?? null;
  const storeCode = settings?.storeCode ?? '';
  const wanted = db !== null && shiftId !== null && template !== null;
  const shown = wanted && qrMinor > 0;
  // the number read for this shift; null value — it could not be read, the reference is the store code alone
  const [next, setNext] = useState<{
    shiftId: string;
    value: number | null;
  } | null>(null);

  useEffect(() => {
    if (!shown || db === null || shiftId === null) return;
    let live = true;
    peekLocalNumber(db, shiftId).then(
      (value) => {
        if (live) setNext({ shiftId, value });
      },
      () => {
        if (live) setNext({ shiftId, value: null });
      },
    );
    return () => {
      live = false;
      // the number belongs to this receipt: the next QR part reads it again rather than showing the old reference
      setNext(null);
    };
  }, [shown, db, shiftId]);

  return useMemo(() => {
    if (!shown || template === null || recipient === null) return null;
    if (next === null || next.shiftId !== shiftId) return null;
    return {
      link: paymentQrLink(template, {
        amountMinor: qrMinor,
        ref:
          next.value === null ? storeCode : paymentQrRef(storeCode, next.value),
      }),
      recipient,
      amountMinor: qrMinor,
      withAmount: paymentQrHasAmount(template),
    };
  }, [shown, template, recipient, storeCode, qrMinor, next, shiftId]);
}
