'use client';

import type { Shift } from '@pharmacy/shared-dto';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest, isUnreachable } from '@/shared/api';
import { rememberShift, rememberedShift } from '@/shared/lib/terminal-cache';

export const shiftQueryKey = (storeId: string | null) =>
  ['shift', 'current', storeId] as const;

/**
 * The open shift of the working store; null when none is open (404 no_open_shift). During an
 * outage — the shift the terminal saw last (ADR-0015, ось 3).
 */
export function useCurrentShift(storeId: string | null) {
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
          if (remembered !== undefined) return remembered;
        }
        throw error;
      }
    },
    enabled: Boolean(storeId),
    // runs during an outage too: the remembered shift answers then (not a paused query)
    networkMode: 'always',
  });
}
