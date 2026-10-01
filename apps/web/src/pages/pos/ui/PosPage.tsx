'use client';

import type {
  ControlledSaleData,
  HeldReceipt,
  PosBatch,
  PosProduct,
  SaleUnit,
} from '@pharmacy/shared-dto';
import { formatDateTime, toAppDate, uuidv7 } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  buttonClassName,
  EmptyState,
  Spinner,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import { useCatalog, type CatalogData } from '@/entities/catalog';
import { can, canWrite, currentStoreOf, useSession } from '@/entities/session';
import { shiftQueryKey, useCurrentShift } from '@/entities/shift';
import { useTerminalRuntime } from '@/entities/terminal';
import {
  addProduct,
  applySaleToSnapshot,
  awaitDelivery,
  BatchDialog,
  buildReceiptRequest,
  CancelReceiptDialog,
  CartPanel,
  changeBatch,
  ControlledDialog,
  emptyDraft,
  enqueueSale,
  HeldReceiptsDialog,
  payAllBy,
  ProductDetailsDialog,
  ProductPicker,
  removeLine,
  RxDialog,
  SaleReceiptDialog,
  setNonCash,
  setQuantity,
  setTendered,
  totals,
  useDraftPersistence,
  usePosStore,
  type AddError,
  type DraftLine,
  type ReceiptPrintData,
} from '@/features/pos';
import {
  apiRequest,
  isOnline,
  subscribeConnectivity,
  useApiErrorMessage,
} from '@/shared/api';
import { routes } from '@/shared/config';
import { useBarcodeScanner } from '@/shared/lib/scanner';
import { useShellChrome } from '@/shared/lib/shell-chrome';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

interface PendingAdd {
  product: PosProduct;
  unit: SaleUnit;
  batch?: PosBatch;
}

function useOnlineState(): boolean {
  return useSyncExternalStore(subscribeConnectivity, isOnline, () => true);
}

/** POS (UI mockups «Касса» and «Касса · полный экран»). */
export function PosPage() {
  const t = useTranslations('pos');
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const store = currentStoreOf(session);
  const storeId = store?.id ?? null;
  const runtime = useTerminalRuntime();
  useDraftPersistence(runtime);
  const catalog = useCatalog(runtime, storeId);
  const shift = useCurrentShift(storeId);
  const online = useOnlineState();
  const { fullscreen, setFullscreen } = useShellChrome();

  const draft = usePosStore((s) => s.draft);
  const hydrated = usePosStore((s) => s.hydrated);
  const notice = usePosStore((s) => s.notice);
  const update = usePosStore((s) => s.update);
  const setNotice = usePosStore((s) => s.setNotice);

  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [details, setDetails] = useState<PosProduct | null>(null);
  const [rx, setRx] = useState<PendingAdd | null>(null);
  const [controlled, setControlled] = useState<{
    pending: PendingAdd | null;
    line: DraftLine | null;
  } | null>(null);
  const [batchFor, setBatchFor] = useState<DraftLine | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [printed, setPrinted] = useState<ReceiptPrintData | null>(null);
  const [paying, setPaying] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const today = toAppDate();
  const index = catalog.index;
  const snapshot = catalog.data?.snapshot;
  const canChooseBatch = can(session, 'pos:choose-batch');
  const canSeeCost = can(session, 'finance:view-cost');
  const openShift = shift.data ?? null;
  const locked = !canWrite(session, 'pos:create')
    ? t('readOnly')
    : !openShift
      ? t('noShift')
      : null;

  useEffect(() => () => setFullscreen(false), [setFullscreen]);
  useEffect(() => {
    searchRef.current?.focus();
  }, [hydrated]);

  const addError = (error: AddError, product: PosProduct) =>
    setNotice(t(`addErrors.${error}`, { name: product.name }));

  const commitAdd = (
    pending: PendingAdd,
    controlledData: ControlledSaleData | null = null,
  ) => {
    let failed: AddError | null = null;
    update((current) => {
      const result = addProduct(current, pending.product, {
        unit: pending.unit,
        batch: pending.batch,
        today,
        controlled: controlledData,
      });
      failed = result.error;
      return result.draft;
    });
    if (failed) addError(failed, pending.product);
    else {
      setQuery('');
      performance.mark?.('pos:scan-to-line');
    }
  };

  const requestAdd = (
    product: PosProduct,
    unit: SaleUnit,
    batch?: PosBatch,
  ) => {
    const pending = { product, unit, batch };
    if (product.prescription === 'controlled') {
      if (!can(session, 'pos:sell-controlled')) {
        setNotice(t('controlledForbidden', { name: product.name }));
        return;
      }
      setControlled({ pending, line: null });
      return;
    }
    if (product.prescription === 'rx') {
      setRx(pending);
      return;
    }
    commitAdd(pending);
  };

  useBarcodeScanner(
    (code) => {
      const product = index?.byBarcode.get(code);
      if (!product) {
        setNotice(t('unknownBarcode', { code }));
        return;
      }
      requestAdd(product, 'pack');
    },
    { enabled: Boolean(index) && !locked },
  );

  // held receipts live on the server: shared by the cashiers of the store, online only
  const held = useQuery({
    queryKey: ['held-receipts', storeId],
    queryFn: ({ signal }) =>
      apiRequest('heldReceipts.list', {
        params: { storeId: storeId ?? '' },
        signal,
      }),
    enabled: Boolean(storeId) && online,
  });
  const heldCount = held.data?.length;

  const hold = useMutation({
    mutationFn: () => {
      const sum = totals(draft, snapshot?.discountRules ?? []);
      return apiRequest('heldReceipts.create', {
        body: {
          id: uuidv7(),
          storeId: storeId ?? '',
          subtotalMinor: sum.subtotalMinor,
          lines: draft.lines.map((line) => ({
            productId: line.productId,
            productName: line.name,
            batchId: line.batchId,
            unit: line.unit,
            quantity: line.quantity,
            unitPriceMinor: line.unitPriceMinor,
            amountMinor: line.quantity * line.unitPriceMinor,
          })),
        },
      });
    },
    onSuccess: () => {
      usePosStore.getState().replace(emptyDraft());
      void queryClient.invalidateQueries({
        queryKey: ['held-receipts', storeId],
      });
      setNotice(t('heldDone'));
    },
  });
  const holdError = useApiErrorMessage(hold.error);

  const deleteHeld = useMutation({
    mutationFn: (id: string) =>
      apiRequest('heldReceipts.delete', { params: { id } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['held-receipts', storeId] }),
  });

  const resumeHeld = (item: HeldReceipt) => {
    if (!index) return;
    let next = emptyDraft();
    for (const line of item.lines) {
      const product = index.byId.get(line.productId);
      if (!product) continue;
      const batch = product.batches.find((b) => b.id === line.batchId);
      const result = addProduct(next, product, {
        unit: line.unit,
        quantity: line.quantity,
        batch: batch && batch.expiresOn >= today ? batch : undefined,
        today,
      });
      next = result.draft;
    }
    usePosStore.getState().replace({ ...next, heldId: item.id });
    setHeldOpen(false);
  };

  const pay = async () => {
    if (!session || !openShift || !snapshot || !runtime || paying) return;
    setPaying(true);
    try {
      const current = usePosStore.getState().draft;
      const request = buildReceiptRequest(current, {
        session,
        shiftId: openShift.id,
        snapshot,
      });
      const delivery = awaitDelivery(runtime, request.id);
      await enqueueSale(runtime, request);
      const updated = applySaleToSnapshot(snapshot, request);
      queryClient.setQueryData<CatalogData>(['catalog', storeId], (data) =>
        data ? { ...data, snapshot: updated } : data,
      );
      void runtime.db.put('catalog', updated, 'snapshot');
      usePosStore.getState().replace(emptyDraft());
      if (current.heldId && online) deleteHeld.mutate(current.heldId);
      const data: ReceiptPrintData = {
        request,
        number: null,
        productNames: Object.fromEntries(
          current.lines.map((l) => [l.productId, l.name]),
        ),
        cashierName: session.employee.fullName,
        settings: snapshot.settings,
      };
      setPrinted(data);
      const created = await delivery;
      if (created) {
        setPrinted((shown) =>
          shown?.request.id === request.id
            ? { ...shown, number: created.number }
            : shown,
        );
        void queryClient.invalidateQueries({
          queryKey: shiftQueryKey(storeId),
        });
      }
    } finally {
      setPaying(false);
    }
  };

  const productOf = (line: DraftLine) => index?.byId.get(line.productId);
  const sum = totals(draft, snapshot?.discountRules ?? []);

  const header = (
    <PageHeader
      title={t('title')}
      subtitle={
        openShift
          ? t('subtitle', {
              number: openShift.number,
              at: formatDateTime(openShift.openedAt),
              cashier: session?.employee.fullName ?? '—',
            })
          : t('noShiftShort')
      }
      actions={
        <>
          <Button
            variant="secondary"
            iconStart="pause"
            onClick={() => {
              setHeldOpen(true);
              void held.refetch();
            }}
          >
            {heldCount ? t('heldCount', { count: heldCount }) : t('heldTitle')}
          </Button>
          <Button
            variant="secondary"
            iconStart={fullscreen ? 'minimize' : 'maximize'}
            onClick={() => setFullscreen(!fullscreen)}
          >
            {fullscreen ? t('exitFullscreen') : t('fullscreen')}
          </Button>
        </>
      }
    />
  );

  if (shift.isPending || (Boolean(runtime) && !hydrated)) {
    return (
      <>
        {header}
        <div className="grid place-items-center py-16 text-primary">
          <Spinner size="xl" label={t('loading')} />
        </div>
      </>
    );
  }

  return (
    // the POS fits the screen: catalog and receipt lines scroll inside, «Оплатить» stays visible
    <div className="flex h-(--ph-pos-height) min-h-0 flex-col">
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pt-4">
        {!openShift && (
          <EmptyState
            icon="clock"
            title={t('noShift')}
            description={t('noShiftHint')}
            action={
              can(session, 'shifts:create') ? (
                <Link href={routes.shift()} className={buttonClassName({})}>
                  {t('openShift')}
                </Link>
              ) : undefined
            }
          />
        )}
        {catalog.data?.stale && (
          <Alert tone="warning">{t('staleCatalog')}</Alert>
        )}
        {notice && (
          <Alert tone="info" live="polite">
            {notice}
          </Alert>
        )}
        {holdError && (
          <Alert tone="danger" live="assertive">
            {holdError}
          </Alert>
        )}
        <QueryState query={catalog}>
          {(data) =>
            index ? (
              <div className="grid min-h-0 flex-1 grid-cols-(--ph-pos-columns) gap-4">
                <ProductPicker
                  index={index}
                  categories={data.snapshot.categories}
                  today={today}
                  query={query}
                  onQueryChange={setQuery}
                  categoryId={categoryId}
                  onCategoryChange={setCategoryId}
                  onAdd={(product, unit) => requestAdd(product, unit)}
                  onDetails={setDetails}
                  searchRef={searchRef}
                />
                <CartPanel
                  draft={draft}
                  rules={data.snapshot.discountRules}
                  canChooseBatch={canChooseBatch}
                  busy={paying || hold.isPending}
                  locked={locked}
                  onQuantity={(line, quantity) => {
                    const product = productOf(line);
                    if (!product) return;
                    let failed: AddError | null = null;
                    update((current) => {
                      const result = setQuantity(
                        current,
                        line.key,
                        quantity,
                        product,
                      );
                      failed = result.error;
                      return result.draft;
                    });
                    if (failed) addError(failed, product);
                  }}
                  onRemove={(line) =>
                    update((current) => removeLine(current, line.key))
                  }
                  onBatch={setBatchFor}
                  onControlled={(line) =>
                    setControlled({ pending: null, line })
                  }
                  onPayAllBy={(method) =>
                    update((current) =>
                      payAllBy(
                        current,
                        method,
                        totals(current, data.snapshot.discountRules).totalMinor,
                      ),
                    )
                  }
                  onNonCash={(method, amount) =>
                    update((current) => setNonCash(current, method, amount))
                  }
                  onTendered={(amount) =>
                    update((current) => setTendered(current, amount))
                  }
                  onHold={() => {
                    if (!online) setNotice(t('holdOffline'));
                    else hold.mutate();
                  }}
                  onCancel={() => setCancelOpen(true)}
                  onPay={() => void pay()}
                />
              </div>
            ) : null
          }
        </QueryState>
      </div>

      <ProductDetailsDialog
        product={details}
        today={today}
        canSeeCost={canSeeCost}
        onAdd={(product) => {
          setDetails(null);
          requestAdd(product, 'pack');
        }}
        onClose={() => setDetails(null)}
      />
      <RxDialog
        product={rx?.product ?? null}
        onConfirm={() => {
          if (rx) commitAdd(rx);
          setRx(null);
        }}
        onClose={() => setRx(null)}
      />
      {controlled && (
        <ControlledDialog
          name={controlled.pending?.product.name ?? controlled.line?.name ?? ''}
          initial={controlled.line?.controlled ?? null}
          today={today}
          onSave={(data) => {
            if (controlled.pending) commitAdd(controlled.pending, data);
            else if (controlled.line) {
              const key = controlled.line.key;
              update((current) => ({
                ...current,
                lines: current.lines.map((l) =>
                  l.key === key ? { ...l, controlled: data } : l,
                ),
              }));
            }
            setControlled(null);
          }}
          onClose={() => setControlled(null)}
        />
      )}
      <BatchDialog
        product={batchFor ? (productOf(batchFor) ?? null) : null}
        currentBatchId={batchFor?.batchId ?? null}
        today={today}
        canSeeCost={canSeeCost}
        onChoose={(batch) => {
          const line = batchFor;
          const product = line ? productOf(line) : undefined;
          setBatchFor(null);
          if (!line || !product) return;
          let failed: AddError | null = null;
          update((current) => {
            const result = changeBatch(
              current,
              line.key,
              product,
              batch,
              today,
            );
            failed = result.error;
            return result.draft;
          });
          if (failed) addError(failed, product);
        }}
        onClose={() => setBatchFor(null)}
      />
      <CancelReceiptDialog
        open={cancelOpen}
        positions={draft.lines.length}
        totalMinor={sum.totalMinor}
        onConfirm={() => {
          usePosStore.getState().replace(emptyDraft());
          setCancelOpen(false);
        }}
        onClose={() => setCancelOpen(false)}
      />
      <HeldReceiptsDialog
        open={heldOpen}
        items={held.data}
        error={held.error}
        offline={!online}
        onResume={resumeHeld}
        onDelete={(item) => deleteHeld.mutate(item.id)}
        onClose={() => setHeldOpen(false)}
      />
      <SaleReceiptDialog
        data={printed}
        onClose={() => {
          setPrinted(null);
          searchRef.current?.focus();
        }}
      />
    </div>
  );
}
