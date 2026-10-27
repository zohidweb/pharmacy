'use client';

import type { Shift, ZReport } from '@pharmacy/shared-dto';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api';
import { rememberedLastShift } from '@/shared/lib/terminal-cache';

/**
 * The Z-report of the last shift of this till when a manager closed it from another computer (plan
 * 2026-10-27-shift-history, S5); null otherwise. Asked only while the till has no open shift: a newly opened shift
 * replaces the remembered one.
 */
export function useClosedElsewhere(
  storeId: string | null,
  shift: Shift | null | undefined,
): ZReport | null {
  const none = shift === null && Boolean(storeId);
  const last = useQuery({
    queryKey: ['shift', 'last', storeId],
    queryFn: async () => (await rememberedLastShift(storeId ?? '')) ?? null,
    enabled: none,
  });
  const lastId = last.data ?? null;
  const report = useQuery({
    queryKey: ['shift', 'closed-elsewhere', lastId],
    queryFn: ({ signal }) =>
      apiRequest('shifts.zReport', { params: { id: lastId ?? '' }, signal }),
    enabled: none && lastId !== null,
    retry: false,
  });
  return none && report.data?.forced ? report.data : null;
}
