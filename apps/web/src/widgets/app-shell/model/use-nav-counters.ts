'use client';

import type { NavCounters } from '@pharmacy/shared-dto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useSession } from '@/entities/session';
import { apiRequest } from '@/shared/api';
import { activeRoute } from '../config/navigation';
import { navCountersKey } from './nav-counters';

/**
 * Menu counters of the working store (E2, E9): a minute old at most, refreshed at once after any own change (the
 * mutation cache of the app invalidates navCountersKey); an error keeps the last numbers silently. The sidebar and the
 * phone menu share one query (ADR-0007, amendment 2026-11-10): the sidebar is mounted whenever the menu is (hidden by
 * CSS on a phone) and owns the refresh; the phone menu reads with `refresh: false`.
 */
export function useNavCounters({
  refresh = true,
}: { refresh?: boolean } = {}): {
  counters: NavCounters | undefined;
  storeId: string | null;
} {
  const pathname = usePathname();
  const onPos = activeRoute(pathname ?? '/') === 'pos';
  const { data: session } = useSession();
  const storeId = session?.currentStoreId ?? null;
  const queryClient = useQueryClient();
  const { data: counters } = useQuery({
    queryKey: [...navCountersKey, storeId],
    queryFn: ({ signal }) =>
      apiRequest('navCounters.get', {
        query: storeId ? { storeId } : {},
        signal,
      }),
    enabled: !!session,
    // not on the POS screen: there a waiting new version of the app activates between receipts,
    // and a request at that moment restarts the old worker, so Chrome puts the activation off until
    // the old worker is idle again (~30 s); the sales there go through the outbox, so leaving the
    // POS refreshes the numbers at once
    refetchInterval: !refresh || onPos ? false : 60_000,
  });
  const wasOnPos = useRef(onPos);
  useEffect(() => {
    if (refresh && wasOnPos.current && !onPos) {
      void queryClient.invalidateQueries({ queryKey: navCountersKey });
    }
    wasOnPos.current = onPos;
  }, [refresh, onPos, queryClient]);

  return { counters, storeId };
}
