'use client';

import { importLimits } from '@pharmacy/shared-domain';
import type { ImportIssue } from '@pharmacy/shared-dto';
import { formatDateOnly, uuidv7 } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  DataTable,
  saveFile,
  Spinner,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { ApiError, useApiErrorMessage } from '@/shared/api';
import type { BuildResult } from '../model/build';
import { issuesCsv } from '../model/csv-out';
import type { ImportKindKey } from '../model/fields';
import {
  applyImport,
  checkImport,
  type ImportCheck,
  type ImportResult,
} from '../model/kinds';
import { columnLetter } from '../model/mapping';

/** The queries a load changes: the journal of its kind shows the new rows at once. */
const INVALIDATED: Record<ImportKindKey, readonly (readonly string[])[]> = {
  catalog: [['catalog']],
  'opening-balances': [['opening-balances']],
  suppliers: [['suppliers']],
};

export interface CheckStepProps {
  kind: ImportKindKey;
  build: BuildResult;
  headers: readonly string[];
  mapping: readonly (string | null)[];
  onBack: () => void;
  onDone: (result: ImportResult) => void;
}

/**
 * Step «Check» (spec 2026-10-20-data-import, F7, section 9): the cells the browser could not read, else the dry run
 * of the API — what will be written, warnings, every refused row. «Load» sends the same rows with the key of this
 * check: a repeat after a lost answer returns the first result (F15).
 */
export function CheckStep(props: CheckStepProps) {
  const t = useTranslations('dataImport');
  const tFields = useTranslations('dataImport.fields');
  const tIssues = useTranslations('dataImport.issues');
  const tHints = useTranslations('dataImport.hints');
  const queryClient = useQueryClient();
  const [key] = useState(() => uuidv7());
  const [changed, setChanged] = useState(false);
  const { request, clientIssues, warnings } = props.build;

  const check = useMutation({ mutationFn: () => checkImport(request) });
  const apply = useMutation({
    mutationFn: () => applyImport(request, key),
    onSuccess: (result) => {
      // the journals show what the load wrote (final review, web minor 15)
      for (const queryKey of INVALIDATED[props.kind]) {
        void queryClient.invalidateQueries({ queryKey });
      }
      props.onDone(result);
    },
    onError: (error) => {
      // the data changed after the check: nothing was written, the check runs again (F7)
      if (error instanceof ApiError && error.code === 'import_invalid') {
        setChanged(true);
        check.mutate();
      }
    },
  });
  const readable = clientIssues.length === 0 && request.body.rows.length > 0;
  useEffect(() => {
    if (readable) check.mutate();
    // once per entry into the step: the rows do not change inside it
  }, []);

  const failure = apply.error ?? check.error;
  const apiMessage = useApiErrorMessage(failure);
  const failureText = !(failure instanceof ApiError)
    ? apiMessage
    : failure.status === 413
      ? t('errors.tooLarge')
      : failure.code === 'import_invalid'
        ? null
        : failure.code === 'import_in_progress'
          ? t('errors.inProgress')
          : failure.code === 'imports_busy'
            ? t('errors.busy')
            : failure.code === 'timeout' || [502, 504].includes(failure.status)
              ? // a load without an answer may have been written: its repeat with the same key is safe (F15)
                t(apply.error ? 'errors.timeout' : 'errors.checkTimeout')
              : apiMessage;

  // every column of the field: the barcodes may take several (final review, web minor 14)
  const columnOf = (issue: ImportIssue): string => {
    if (!issue.field) return '';
    const columns = props.mapping.flatMap((key, index) =>
      key === issue.field ? [props.headers[index] || columnLetter(index)] : [],
    );
    return columns.length > 0
      ? columns.join(', ')
      : tFields(issue.field as never);
  };
  // the code of an issue is a key of `dataImport.issues`; `detail` — the name `barcode_conflict` shows
  const issueText = tIssues as unknown as (
    code: string,
    values: { detail: string },
  ) => string;
  // a value that cannot be read says what the field expects (final review, web minor 6)
  const messageOf = (issue: ImportIssue): string => {
    const text = issueText(issue.code, { detail: issue.detail ?? '' });
    return issue.code === 'invalid' &&
      issue.field &&
      tHints.has(issue.field as never)
      ? `${text}: ${tHints(issue.field as never)}`
      : text;
  };

  const result: ImportCheck | undefined = check.data;
  const errors =
    clientIssues.length > 0 ? clientIssues : (result?.check.errors ?? []);
  const errorsTotal =
    clientIssues.length > 0
      ? clientIssues.length
      : (result?.check.errorsTotal ?? 0);
  const busy = check.isPending || apply.isPending;

  return (
    <Card padding="none">
      <CardHeader
        inset
        title={t('check.title')}
        description={t('check.allOrNothing')}
      />
      <div
        className="flex flex-col gap-4 px-(--ph-card-padding) pb-(--ph-card-padding)"
        aria-busy={busy}
      >
        {clientIssues.length > 0 && (
          <Alert tone="danger">{t('check.clientErrors')}</Alert>
        )}
        {clientIssues.length === 0 && request.body.rows.length === 0 && (
          <Alert tone="warning">{t('check.noRows')}</Alert>
        )}
        {check.isPending && (
          <p className="flex items-center gap-2" aria-live="polite">
            <Spinner /> {t('check.checking')}
          </p>
        )}
        {changed && !check.isPending && (
          <Alert tone="info">{t('errors.changed')}</Alert>
        )}
        {failureText && (
          <Alert tone="danger" live="assertive">
            {failureText}
          </Alert>
        )}
        {check.isError && !busy && readable && (
          <div>
            <Button variant="secondary" onClick={() => check.mutate()}>
              {t('check.retry')}
            </Button>
          </div>
        )}
        {result && !check.isPending && (
          <Summary result={result} skippedZero={props.build.skippedZero} />
        )}
        {(['unknown_country', 'name_only'] as const).map((code) => {
          const lines = warnings.filter((issue) => issue.code === code);
          if (lines.length === 0) return null;
          return (
            <Alert key={code} tone="warning">
              {t(
                code === 'unknown_country'
                  ? 'check.countryWarning'
                  : 'check.nameOnlyWarning',
                {
                  count: lines.length,
                  lines: lines
                    .slice(0, 10)
                    .map((issue) => issue.line)
                    .join(', '),
                },
              )}
            </Alert>
          );
        })}
        {errorsTotal > 0 && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold">
                {t('check.errors', { count: errorsTotal })}
              </h3>
              <Button
                variant="tertiary"
                iconStart="download"
                onClick={() =>
                  saveFile(
                    issuesCsv(
                      [
                        t('check.csvLine'),
                        t('check.csvColumn'),
                        t('check.csvMessage'),
                      ],
                      errors,
                      columnOf,
                      messageOf,
                    ),
                    `${t('check.csvName')}.csv`,
                  )
                }
              >
                {t('check.downloadErrors')}
              </Button>
            </div>
            {errorsTotal > errors.length && (
              <p className="text-sm text-fg-muted">
                {t('check.errorsShown', {
                  shown: errors.length,
                  total: errorsTotal,
                })}
              </p>
            )}
            <IssuesTable
              issues={errors.slice(0, importLimits.issues)}
              columnOf={columnOf}
              messageOf={messageOf}
            />
          </section>
        )}
        <div className="flex justify-between">
          <Button
            variant="secondary"
            disabled={apply.isPending}
            onClick={props.onBack}
          >
            {t('back')}
          </Button>
          {readable && (
            <Button
              disabled={!result || errorsTotal > 0 || busy}
              onClick={() => {
                setChanged(false);
                apply.mutate();
              }}
            >
              {apply.isPending ? t('check.loading') : t('check.load')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function Summary({
  result,
  skippedZero,
}: {
  result: ImportCheck;
  skippedZero: number;
}) {
  const t = useTranslations('dataImport.check');
  switch (result.kind) {
    case 'catalog':
      return (
        <div className="flex flex-col gap-2">
          <p>
            {t('summaryCatalog', {
              total: result.check.total,
              create: result.check.create,
              existing: result.check.existing,
            })}
          </p>
          {result.check.newCategories.length > 0 && (
            <p>
              {t('newCategories', {
                names: result.check.newCategories.join(', '),
              })}
            </p>
          )}
        </div>
      );
    case 'opening-balances':
      return (
        <div className="flex flex-col gap-2">
          <p>
            {t('summaryBalances', {
              total: result.check.total,
              documents: result.check.documents,
            })}
          </p>
          {skippedZero > 0 && <p>{t('skippedZero', { count: skippedZero })}</p>}
          {result.check.storeHasStock && (
            <Alert tone="warning">{t('storeHasStock')}</Alert>
          )}
          {result.check.previousImports.map((previous) => (
            <Alert key={previous.importId} tone="warning">
              {t('previousImport', {
                date: formatDateOnly(previous.createdAt.slice(0, 10)),
                numbers: previous.documentNumbers.join(', '),
              })}
            </Alert>
          ))}
        </div>
      );
    case 'suppliers':
      return (
        <p>
          {t('summarySuppliers', {
            total: result.check.total,
            create: result.check.create,
            existing: result.check.existing,
          })}
        </p>
      );
  }
}

function IssuesTable({
  issues,
  columnOf,
  messageOf,
}: {
  issues: readonly ImportIssue[];
  columnOf: (issue: ImportIssue) => string;
  messageOf: (issue: ImportIssue) => string;
}) {
  const t = useTranslations('dataImport.check');
  const columns: DataTableColumn<ImportIssue & { id: string }>[] = [
    {
      key: 'line',
      header: t('csvLine'),
      cell: (issue) => issue.line,
      numeric: true,
    },
    { key: 'column', header: t('csvColumn'), cell: (issue) => columnOf(issue) },
    {
      key: 'message',
      header: t('csvMessage'),
      cell: (issue) => messageOf(issue),
    },
  ];
  return (
    <div className="max-h-(--ph-import-table-height) overflow-auto">
      <DataTable
        caption={t('csvName')}
        rowKey={(issue) => issue.id}
        rows={issues.map((issue, index) => ({ ...issue, id: String(index) }))}
        columns={columns}
      />
    </div>
  );
}
