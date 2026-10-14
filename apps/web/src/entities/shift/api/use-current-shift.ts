'use client';

import type {
  PaymentTotal,
  ReceiptPaymentMethod,
  Shift,
} from '@pharmacy/shared-dto';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest, isUnreachable } from '@/shared/api';
import { rememberShift, rememberedShift } from '@/shared/lib/terminal-cache';

export const shiftQueryKey = (storeId: string | null) =>
  ['shift', 'current', storeId] as const;

/**
 * A shift remembered before the customer returns were released has no `returnsByMethod`: no return
 * was made through it then. The totals of the drawer and of the bank terminal read it.
 */
function withReturns(shift: Shift | null): Shift | null {
  if (shift === null || (shift as Partial<Shift>).returnsByMethod) return shift;
  const none = (): PaymentTotal => ({ count: 0, amountMinor: 0 });
  const returnsByMethod: Record<ReceiptPaymentMethod, PaymentTotal> = {
    cash: none(),
    card: none(),
    qr: none(),
    nfc: none(),
  };
  return { ...shift, returnsByMethod };
}

/**
 * The open shift of the terminal of the session; null when none is open (404 no_open_shift). During
 * an outage — the shift the terminal saw last (ADR-0015, ось 3). Only a PIN session of a bound
 * terminal has a shift (spec 2026-10-13-pos-shift-sale, K6): otherwise the query stays off.
 */
export function useCurrentShift(storeId: string | null, onTerminal = true) {
  return useQuery({
    queryKey: shiftQueryKey(storeId),
    queryFn: async ({ signal }): Promise<Shift | null> => {
      const store = storeId ?? '';
      try {
        const shift = await apiRequest('shifts.current', { signal });
        void rememberShift(store, shift);
        return shift;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          void rememberShift(store, null);
          return null;
        }
        if (isUnreachable(error)) {
          const remembered = await rememberedShift(store);
          if (remembered !== undefined) return withReturns(remembered);
        }
        throw error;
      }
    },
    enabled: Boolean(storeId) && onTerminal,
    // runs during an outage too: the remembered shift answers then (not a paused query)
    networkMode: 'always',
  });
}
