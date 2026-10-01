'use client';

/*
 * Catalog snapshot of the working store (ADR-0015): the stored snapshot is read from IndexedDB,
 * the API is asked only for changes since its version; during an outage the stored snapshot keeps
 * scan and search working. The index is rebuilt only when the version changes.
 */
import type { CatalogSnapshot } from '@pharmacy/shared-dto';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ApiError, apiRequest } from '@/shared/api';
import type { TerminalRuntime } from '@/shared/lib/offline-queue';
import { buildCatalogIndex, mergeSnapshot } from '../model/catalog-index';

const SNAPSHOT_KEY = 'snapshot';

export interface CatalogData {
  snapshot: CatalogSnapshot;
  /** True when the API was unreachable and the stored snapshot is shown. */
  stale: boolean;
}

async function loadCatalog(
  runtime: TerminalRuntime,
  storeId: string,
  signal: AbortSignal,
): Promise<CatalogData> {
  const stored = ((await runtime.db.get('catalog', SNAPSHOT_KEY)) ??
    null) as CatalogSnapshot | null;
  try {
    const incoming = await apiRequest('catalog.snapshot', {
      params: { storeId },
      query: { sinceVersion: stored?.version },
      signal,
    });
    const snapshot = mergeSnapshot(stored, incoming);
    if (snapshot !== stored)
      await runtime.db.put('catalog', snapshot, SNAPSHOT_KEY);
    return { snapshot, stale: false };
  } catch (error) {
    const unreachable =
      error instanceof ApiError &&
      (error.code === 'network' || error.code === 'timeout');
    if (unreachable && stored) return { snapshot: stored, stale: true };
    throw error;
  }
}

export function useCatalog(
  runtime: TerminalRuntime | null,
  storeId: string | null,
) {
  const query = useQuery({
    queryKey: ['catalog', storeId],
    queryFn: ({ signal }) => {
      if (!runtime || !storeId) throw new Error('no terminal runtime');
      return loadCatalog(runtime, storeId, signal);
    },
    enabled: Boolean(runtime && storeId),
    staleTime: 5 * 60_000,
    networkMode: 'always',
  });
  const snapshot = query.data?.snapshot;
  const index = useMemo(
    () => (snapshot ? buildCatalogIndex(snapshot) : null),
    [snapshot],
  );
  return { ...query, index };
}
