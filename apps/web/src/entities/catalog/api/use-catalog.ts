'use client';

/*
 * Catalog snapshot of the working store (ADR-0015): the stored snapshot is read from IndexedDB,
 * the API is asked only for changes since its version; during an outage the stored snapshot keeps
 * scan and search working. The index is rebuilt only when the version changes.
 */
import type { CatalogSnapshot } from '@pharmacy/shared-dto';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useLocale } from 'use-intl';
import { ApiError, apiRequest } from '@/shared/api';
import type { TerminalRuntime } from '@/shared/lib/offline-queue';
import { buildCatalogIndex, mergeSnapshot } from '../model/catalog-index';

const SNAPSHOT_KEY = 'snapshot';

/** The stored snapshot: the language of its names; purchase prices are never stored. */
type StoredSnapshot = CatalogSnapshot & { locale?: string };

/**
 * Stores the snapshot of the terminal for an outage. The terminal is shared by its employees: the
 * purchase prices of a session with `finance:view-cost` stay in memory only (final review M9).
 */
export function storeSnapshot(
  runtime: TerminalRuntime,
  snapshot: CatalogSnapshot,
  locale: string,
): Promise<unknown> {
  const stored: StoredSnapshot = {
    ...snapshot,
    locale,
    products: snapshot.products.map((product) => ({
      ...product,
      batches: product.batches.map(({ costMinor: _cost, ...batch }) => batch),
    })),
  };
  return runtime.db.put('catalog', stored, SNAPSHOT_KEY);
}

export interface CatalogData {
  snapshot: CatalogSnapshot;
  /** True when the API was unreachable and the stored snapshot is shown. */
  stale: boolean;
}

async function loadCatalog(
  runtime: TerminalRuntime,
  storeId: string,
  locale: string,
  signal: AbortSignal,
): Promise<CatalogData> {
  const stored = ((await runtime.db.get('catalog', SNAPSHOT_KEY)) ??
    null) as StoredSnapshot | null;
  // names of another language are replaced by a whole snapshot, not mixed by a delta
  const base = stored && stored.locale === locale ? stored : null;
  try {
    const incoming = await apiRequest('catalog.snapshot', {
      params: { storeId },
      query: { sinceVersion: base?.version },
      signal,
    });
    const snapshot = mergeSnapshot(base, incoming);
    if (snapshot !== stored) await storeSnapshot(runtime, snapshot, locale);
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
  const locale = useLocale();
  const query = useQuery({
    queryKey: ['catalog', storeId],
    queryFn: ({ signal }) => {
      if (!runtime || !storeId) throw new Error('no terminal runtime');
      return loadCatalog(runtime, storeId, locale, signal);
    },
    enabled: Boolean(runtime && storeId),
    // a minute: another terminal of the store sells the same batches (spec 2026-10-13, E16). No
    // background interval — it held the update of the Service Worker; the POS refreshes the snapshot
    // after each delivered sale, and a focus or a reconnect refreshes a stale one
    staleTime: 60_000,
    networkMode: 'always',
  });
  const snapshot = query.data?.snapshot;
  const index = useMemo(
    () => (snapshot ? buildCatalogIndex(snapshot) : null),
    [snapshot],
  );
  return { ...query, index };
}
