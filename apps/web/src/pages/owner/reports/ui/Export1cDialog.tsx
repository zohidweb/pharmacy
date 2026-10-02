'use client';

import type {
  Export1cDataSet,
  Export1cResult,
  Export1cUnmapped,
} from '@pharmacy/shared-dto';
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  Select,
  TextField,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { canWrite, useSession } from '@/entities/session';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { QueryState } from '@/shared/ui';

/**
 * Manual export to 1C:Бухгалтерия 8 for a period (CommerceML, closed list of integrations): the
 * products without a 1C article are mapped here or left out of the file.
 */
export function Export1cDialog({
  from,
  to,
  storeId,
  onClose,
}: {
  from: string;
  to: string;
  storeId: string;
  onClose: () => void;
}) {
  const t = useTranslations('reports.export1c');
  const tReports = useTranslations('reports');
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const canExport = canWrite(session, 'export-1c:export');
  const [dataSet, setDataSet] = useState<Export1cDataSet>('sales_and_movement');
  const [articles, setArticles] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Export1cResult | null>(null);
  const previewKey = ['export-1c', from, to, storeId];
  const preview = useQuery({
    queryKey: previewKey,
    queryFn: ({ signal }) =>
      apiRequest('export1c.preview', {
        query: { from, to, storeId: storeId || undefined },
        signal,
      }),
  });
  const map = useMutation({
    mutationFn: (productId: string) =>
      apiRequest('export1c.setArticle', {
        params: { productId },
        body: { article: articles[productId] ?? '' },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: previewKey }),
  });
  const run = useMutation({
    mutationFn: () =>
      apiRequest('export1c.run', {
        body: { from, to, storeId: storeId || null, dataSet },
      }),
    onSuccess: setResult,
  });
  const error = useApiErrorMessage(map.error ?? run.error);

  const columns: DataTableColumn<Export1cUnmapped>[] = [
    {
      key: 'product',
      header: t('product'),
      cell: (row) => <b>{row.productName}</b>,
    },
    {
      key: 'barcode',
      header: t('barcode'),
      nowrap: true,
      cell: (row) => row.barcode ?? '—',
    },
    {
      key: 'article',
      header: t('article'),
      cell: (row) => (
        <TextField
          label={t('articleOf', { name: row.productName })}
          hideLabel
          placeholder={t('articlePlaceholder')}
          disabled={!canExport}
          value={articles[row.productId] ?? row.conflictArticle ?? ''}
          error={row.conflictArticle ? t('articleTaken') : undefined}
          onChange={(event) =>
            setArticles((current) => ({
              ...current,
              [row.productId]: event.target.value,
            }))
          }
        />
      ),
    },
    {
      key: 'actions',
      header: <span className="ph-visually-hidden">{tReports('actions')}</span>,
      cell: (row) => (
        <Button
          variant="secondary"
          disabled={!canExport || !(articles[row.productId] ?? '').trim()}
          loading={map.isPending && map.variables === row.productId}
          aria-label={t('mapOf', { name: row.productName })}
          onClick={() => map.mutate(row.productId)}
        >
          {t('map')}
        </Button>
      ),
    },
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={t('subtitle')}
      closeLabel={tReports('close')}
      size="xl"
      footer={
        result ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {tReports('close')}
            </Button>
            <a
              href={result.downloadUrl}
              download={result.fileName}
              className="inline-flex min-h-touch items-center gap-2 rounded-(--ph-button-radius) bg-primary px-(--ph-button-padding-x) text-sm font-medium text-on-primary hover:bg-primary-hover"
            >
              {t('download')}
            </a>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {tReports('cancel')}
            </Button>
            <Button
              iconStart="file-text"
              disabled={!canExport || !preview.data}
              loading={run.isPending}
              onClick={() => run.mutate()}
            >
              {t('run')}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        {result && (
          <Alert tone="success" live="polite">
            {t('done', {
              file: result.fileName,
              receipts: result.receipts,
              documents: result.documents,
              excluded: result.excluded,
            })}
          </Alert>
        )}
        <div className="grid grid-cols-3 gap-4">
          <Select
            label={t('dataSet')}
            value={dataSet}
            disabled={result !== null}
            onChange={(event) =>
              setDataSet(event.target.value as Export1cDataSet)
            }
            options={(['sales_and_movement', 'sales'] as const).map(
              (value) => ({ value, label: t(`dataSets.${value}`) }),
            )}
          />
          <div className="flex flex-col gap-1 rounded-md bg-surface-sunken p-3 text-sm">
            <span className="text-xs text-fg-muted">{t('format')}</span>
            <b>CommerceML / XML</b>
          </div>
          <div className="flex flex-col gap-1 rounded-md bg-surface-sunken p-3 text-sm">
            <span className="text-xs text-fg-muted">{t('target')}</span>
            <b>1С:Бухгалтерия 8 · TJ</b>
          </div>
        </div>
        <QueryState query={preview}>
          {(data) => (
            <>
              <p className="text-sm">
                {t('scope', {
                  receipts: data.receipts,
                  documents: data.documents,
                })}
              </p>
              {data.unmapped.length > 0 ? (
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-bold">
                    {t('mappingTitle', { count: data.unmapped.length })}
                  </h3>
                  <p className="text-xs text-fg-subtle">{t('mappingHint')}</p>
                  <DataTable
                    caption={t('mappingTitle', { count: data.unmapped.length })}
                    rowKey={(row) => row.productId}
                    rows={data.unmapped}
                    columns={columns}
                  />
                  <Alert tone="warning">
                    {t('excluded', { count: data.unmapped.length })}
                  </Alert>
                </section>
              ) : (
                <Alert tone="success">{t('allMapped')}</Alert>
              )}
            </>
          )}
        </QueryState>
      </div>
    </Dialog>
  );
}
