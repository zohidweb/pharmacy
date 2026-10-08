'use client';

import type {
  CatalogDuplicate,
  CatalogFlag,
  CatalogListItem,
  CatalogReferences,
  CatalogStatus,
} from '@pharmacy/shared-dto';
import { formatDateOnly, formatMoney } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  DataTable,
  Dialog,
  EmptyState,
  KpiTile,
  Pagination,
  Select,
  StatusPill,
  TextField,
  type DataTableColumn,
  type StatusTone,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { canWrite, useSession } from '@/entities/session';
import {
  apiFieldErrors,
  apiRequest,
  isApiRouteAvailable,
  useApiErrorMessage,
} from '@/shared/api';
import { routes } from '@/shared/config';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import {
  ProductForm,
  draftProblems,
  emptyDraft,
  inputOf,
  shownAtFields,
  type ProductDraft,
} from './ProductForm';
import { WithMessages } from '@/shared/i18n';

const PAGE = 20;
const FLAGS: CatalogFlag[] = ['rx', 'controlled', 'regulated', 'no_barcode'];
const STATUSES: CatalogStatus[] = ['active', 'archived'];

const flagTone: Record<CatalogFlag, StatusTone> = {
  rx: 'info',
  controlled: 'danger',
  regulated: 'attention',
  no_barcode: 'neutral',
};

export function FlagPill({ flag }: { flag: CatalogFlag }) {
  const t = useTranslations('products.flags');
  return (
    <StatusPill tone={flagTone[flag]} icon={null}>
      {t(flag)}
    </StatusPill>
  );
}

export function useCatalogReferences() {
  return useQuery({
    queryKey: ['catalog', 'references'],
    queryFn: ({ signal }) => apiRequest('catalog.references', { signal }),
    staleTime: 5 * 60_000,
  });
}

/** Catalog of products (UI mockup «Каталог товаров»). */
function CatalogPageView() {
  const t = useTranslations('products');
  const tDocs = useTranslations('stockDocs');
  const { data: session } = useSession();
  const canCreate = canWrite(session, 'catalog:create');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [form, setForm] = useState('');
  const [flag, setFlag] = useState<CatalogFlag | ''>('');
  const [status, setStatus] = useState<CatalogStatus>('active');
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const refs = useCatalogReferences();

  const list = useQuery({
    queryKey: ['catalog', 'list', q, categoryId, form, flag, status, offset],
    queryFn: ({ signal }) =>
      apiRequest('catalog.list', {
        query: {
          q: q || undefined,
          categoryId: categoryId || undefined,
          form: form || undefined,
          flag: flag || undefined,
          status,
          limit: PAGE,
          offset,
        },
        signal,
      }),
    placeholderData: (previous) => previous,
  });
  const duplicates = useQuery({
    queryKey: ['catalog', 'duplicates'],
    queryFn: ({ signal }) => apiRequest('catalog.duplicates', { signal }),
    // duplicates of offline stores come with the sync (ADR-0014)
    enabled: isApiRouteAvailable('catalog.duplicates'),
  });
  const filtered = Boolean(
    q || categoryId || form || flag || status === 'archived',
  );
  const reset = () => {
    setQ('');
    setCategoryId('');
    setForm('');
    setFlag('');
    setStatus('active');
    setOffset(0);
  };

  const columns: DataTableColumn<CatalogListItem>[] = [
    {
      key: 'product',
      header: t('columns.product'),
      cell: (row) => (
        <div className="flex flex-col">
          <Link
            href={routes.product(row.id)}
            className="min-h-touch content-center font-bold text-primary underline"
          >
            {row.name}
          </Link>
          <span className="text-xs text-fg-subtle">
            {[row.inn, row.barcode ?? t('noBarcodeShort')]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      ),
    },
    {
      key: 'category',
      header: t('columns.category'),
      nowrap: true,
      cell: (row) => row.categoryName,
    },
    {
      key: 'form',
      header: t('columns.form'),
      nowrap: true,
      cell: (row) => (
        <div className="flex flex-col">
          <span>{row.form || '—'}</span>
          <span className="text-xs text-fg-subtle">
            {row.piecesPerPack > 1
              ? t('packOf', { pieces: row.piecesPerPack })
              : t(`form.units.${row.unit}`)}
          </span>
        </div>
      ),
    },
    {
      key: 'manufacturer',
      header: t('columns.manufacturer'),
      cell: (row) => row.manufacturer || '—',
    },
    {
      key: 'price',
      header: t('columns.price'),
      numeric: true,
      nowrap: true,
      cell: (row) =>
        row.retailPriceMinor !== null
          ? formatMoney(row.retailPriceMinor, { withSign: false })
          : '—',
    },
    {
      key: 'flags',
      header: t('columns.flags'),
      cell: (row) =>
        row.flags.length === 0 ? (
          '—'
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.flags.map((f) => (
              <FlagPill key={f} flag={f} />
            ))}
          </div>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <>
            <Button
              variant="secondary"
              iconStart="download"
              disabled
              title={t('importPending')}
            >
              {t('import')}
            </Button>
            <Button
              iconStart="plus"
              disabled={!canCreate || !refs.data}
              onClick={() => setCreating(true)}
            >
              {t('new')}
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-4 px-6 pt-4">
        {session?.impersonation && (
          <Alert tone="info">{tDocs('notices.impersonation')}</Alert>
        )}
        <QueryState query={list}>
          {(data) => (
            <>
              <div className="grid grid-cols-3 gap-4">
                <KpiTile
                  label={t('kpi.products')}
                  value={data.kpi.products}
                  icon="pill"
                />
                <KpiTile
                  label={t('kpi.noBarcode')}
                  value={data.kpi.withoutBarcode}
                  hint={t('kpi.noBarcodeHint')}
                  icon="scan-barcode"
                />
                <KpiTile
                  label={t('kpi.duplicates')}
                  value={data.kpi.duplicates}
                  hint={t('kpi.duplicatesHint')}
                  tone={data.kpi.duplicates > 0 ? 'warning' : 'default'}
                  icon="triangle-alert"
                />
              </div>
              <Card padding="none">
                <div className="grid grid-cols-(--ph-search-columns) gap-3 p-(--ph-card-padding)">
                  <TextField
                    label={t('search')}
                    hideLabel
                    type="search"
                    placeholder={t('search')}
                    value={q}
                    onChange={(event) => {
                      setQ(event.target.value);
                      setOffset(0);
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Select
                      label={t('columns.category')}
                      hideLabel
                      value={categoryId}
                      onChange={(event) => {
                        setCategoryId(event.target.value);
                        setOffset(0);
                      }}
                      options={[
                        { value: '', label: t('allCategories') },
                        ...(refs.data?.categories ?? []).map((c) => ({
                          value: c.id,
                          label: c.name,
                        })),
                      ]}
                    />
                    <Select
                      label={t('form.formField')}
                      hideLabel
                      value={form}
                      onChange={(event) => {
                        setForm(event.target.value);
                        setOffset(0);
                      }}
                      options={[
                        { value: '', label: t('allForms') },
                        ...(refs.data?.forms ?? []).map((value) => ({
                          value,
                          label: value,
                        })),
                      ]}
                    />
                    <Select
                      label={t('columns.flags')}
                      hideLabel
                      value={flag}
                      onChange={(event) => {
                        setFlag(event.target.value as CatalogFlag | '');
                        setOffset(0);
                      }}
                      options={[
                        { value: '', label: t('allFlags') },
                        ...FLAGS.map((value) => ({
                          value,
                          label: t(`flags.${value}`),
                        })),
                      ]}
                    />
                    <Select
                      label={t('statusFilter.label')}
                      hideLabel
                      value={status}
                      onChange={(event) => {
                        setStatus(event.target.value as CatalogStatus);
                        setOffset(0);
                      }}
                      options={STATUSES.map((value) => ({
                        value,
                        label: t(`statusFilter.${value}`),
                      }))}
                    />
                  </div>
                </div>
                <DataTable
                  caption={t('title')}
                  rowKey={(row) => row.id}
                  rows={data.items}
                  columns={columns}
                  empty={
                    <EmptyState
                      icon="search"
                      title={t('nothingFound')}
                      description={filtered ? t('nothingFoundHint') : undefined}
                      action={
                        filtered ? (
                          <Button variant="secondary" onClick={reset}>
                            {t('resetFilters')}
                          </Button>
                        ) : undefined
                      }
                    />
                  }
                />
                {data.total > PAGE && (
                  <Pagination
                    className="px-4 py-3"
                    total={data.total}
                    limit={PAGE}
                    offset={offset}
                    onOffsetChange={setOffset}
                    labels={{
                      nav: t('pagination'),
                      previous: tDocs('previous'),
                      next: tDocs('next'),
                      range: (range) => tDocs('shown', range),
                    }}
                  />
                )}
              </Card>
            </>
          )}
        </QueryState>
        <Duplicates rows={duplicates.data ?? []} />
      </div>
      {creating && refs.data && (
        <NewProductDialog refs={refs.data} onClose={() => setCreating(false)} />
      )}
    </>
  );
}

/** Duplicates from offline stores: the store decides (ADR-0014), the cloud only shows them. */
function Duplicates({ rows }: { rows: CatalogDuplicate[] }) {
  const t = useTranslations('products.duplicates');
  if (rows.length === 0) return null;
  const columns: DataTableColumn<CatalogDuplicate>[] = [
    {
      key: 'store',
      header: t('store'),
      cell: (row) => (
        <div className="flex flex-col">
          <span>{row.storeName}</span>
          <span className="text-xs text-fg-subtle">
            {row.addedBy.name} · {formatDateOnly(row.addedBy.at.slice(0, 10))}
          </span>
        </div>
      ),
    },
    {
      key: 'new',
      header: t('newProduct'),
      cell: (row) => <b>{row.newName}</b>,
    },
    {
      key: 'existing',
      header: t('existing'),
      cell: (row) => (
        <Link
          href={routes.product(row.existingId)}
          className="font-bold text-primary underline"
        >
          {row.existingName}
        </Link>
      ),
    },
    {
      key: 'match',
      header: t('matchedBy'),
      cell: (row) =>
        row.matchedBy === 'barcode'
          ? t('byBarcode', { code: row.barcode ?? '' })
          : t('byName'),
    },
    {
      key: 'status',
      header: t('status'),
      cell: (row) => (
        <StatusPill tone={row.status === 'pending' ? 'warning' : 'success'}>
          {t(`statuses.${row.status}`)}
        </StatusPill>
      ),
    },
  ];
  return (
    <Card padding="none">
      <CardHeader title={t('title')} description={t('hint')} inset />
      <DataTable
        caption={t('title')}
        rowKey={(row) => row.id}
        rows={rows}
        columns={columns}
      />
    </Card>
  );
}

function NewProductDialog({
  refs,
  onClose,
}: {
  refs: CatalogReferences;
  onClose: () => void;
}) {
  const t = useTranslations('products');
  const tDocs = useTranslations('stockDocs');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ProductDraft>(() => emptyDraft(refs));
  const [touched, setTouched] = useState(false);
  const create = useMutation({
    mutationFn: () => apiRequest('catalog.create', { body: inputOf(draft) }),
    onSuccess: (product) => {
      void queryClient.invalidateQueries({ queryKey: ['catalog'] });
      router.push(routes.product(product.id));
    },
  });
  const fieldErrors = apiFieldErrors(create.error);
  // a rejected field is shown at the field itself
  const error = useApiErrorMessage(
    shownAtFields(fieldErrors) ? null : create.error,
  );
  const problems = draftProblems(draft);
  const valid =
    !problems.nameRu && !problems.piecesPerPack && !problems.maxPrice;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('new')}
      description={t('newHint')}
      closeLabel={tDocs('close')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tDocs('cancel')}
          </Button>
          <Button
            loading={create.isPending}
            onClick={() => {
              setTouched(true);
              if (valid) create.mutate();
            }}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <ProductForm
          draft={draft}
          onChange={setDraft}
          refs={refs}
          touched={touched}
          disabled={false}
          fieldErrors={fieldErrors}
        />
        <Alert tone="info">{t('priceFromReceipt')}</Alert>
      </div>
    </Dialog>
  );
}

export function CatalogPage() {
  return (
    <WithMessages groups={['stock', 'purchasing']}>
      <CatalogPageView />
    </WithMessages>
  );
}
