'use client';

import type { Shift } from '@pharmacy/shared-dto';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest } from '@/shared/api';

export const shiftQueryKey = (storeId: string | null) =>
  ['shift', 'current', storeId] as const;

/** The open shift of the working store; null when none is open (404 no_open_shift). */
export function useCurrentShift(storeId: string | null) {
  return useQuery({
    queryKey: shiftQueryKey(storeId),
    queryFn: async ({ signal }): Promise<Shift | null> => {
      try {
        return await apiRequest('shifts.current', { signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: Boolean(storeId),
  });
}
