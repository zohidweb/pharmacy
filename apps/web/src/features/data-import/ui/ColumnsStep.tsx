'use client';

import {
  Alert,
  Button,
  Card,
  CardHeader,
  DataTable,
  Select,
  TextField,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import type { Sheet } from '@/shared/lib/spreadsheet';
import { type ImportKindKey, kindFields } from '../model/fields';
import { columnLetter, headersOf, missingFields } from '../model/mapping';

export interface ColumnsStepProps {
  kind: ImportKindKey;
  sheet: Sheet;
  headerRow: number;
  mapping: readonly (string | null)[];
  onMapping: (mapping: (string | null)[]) => void;
  /** The row of the headers chosen by hand (zero-based). */
  onHeaderRow: (index: number) => void;
  /** The references of the catalog are still loading: «Далее» waits for them. */
  waiting?: boolean;
  onBack: () => void;
  onNext: () => void;
}

interface ColumnRow {
  index: number;
  header: string;
  samples: string;
}

/** Step 2 (F5): the field of every column of the file, suggested by its header; required fields must be chosen. */
export function ColumnsStep(props: ColumnsStepProps) {
  const t = useTranslations('dataImport');
  const tFields = useTranslations('dataImport.fields');
  const fields = kindFields[props.kind];
  const headers = headersOf(props.sheet.rows[props.headerRow]);
  const width = Math.max(
    headers.length,
    ...props.sheet.rows.slice(props.headerRow + 1).map((row) => row.length),
  );
  const rows: ColumnRow[] = Array.from({ length: width }, (_, index) => ({
    index,
    header: headers[index] ?? '',
    samples: props.sheet.rows
      .slice(props.headerRow + 1)
      .map((row) => row[index]?.text ?? '')
      .filter((text) => text !== '')
      .slice(0, 3)
      .join(' · '),
  })).filter((row) => row.header !== '' || row.samples !== '');

  const missing = missingFields(props.mapping, props.kind).map((key) =>
    key
      .split('|')
      .map((part) => tFields(part as never))
      .join(t('columns.or')),
  );
  const taken = new Set(props.mapping.filter((key) => key !== null));
  const choose = (index: number, key: string) => {
    const next = Array.from(
      { length: Math.max(props.mapping.length, index + 1) },
      (_, i) => props.mapping[i] ?? null,
    );
    next[index] = key === '' ? null : key;
    props.onMapping(next);
  };

  const columns: DataTableColumn<ColumnRow>[] = [
    {
      key: 'column',
      header: t('columns.header'),
      cell: (row) =>
        row.header
          ? `${columnLetter(row.index)} · ${row.header}`
          : t('columns.column', { letter: columnLetter(row.index) }),
    },
    {
      key: 'samples',
      header: t('columns.sample'),
      cell: (row) => (
        <span className="line-clamp-2 text-fg-muted">{row.samples}</span>
      ),
    },
    {
      key: 'field',
      header: t('columns.field'),
      cell: (row) => {
        const current = props.mapping[row.index] ?? '';
        return (
          <Select
            label={t('columns.fieldOf', { letter: columnLetter(row.index) })}
            hideLabel
            value={current}
            options={[
              { value: '', label: t('columns.skip') },
              ...fields.map((field) => ({
                value: field.key,
                label: tFields(field.key as never),
                // a field takes one column, the barcodes may take several
                disabled:
                  field.key !== current &&
                  !field.multiple &&
                  taken.has(field.key),
              })),
            ]}
            onChange={(event) => choose(row.index, event.target.value)}
          />
        );
      },
    },
  ];

  return (
    <Card padding="none">
      <CardHeader
        inset
        title={t('columns.title')}
        description={t('columns.hint', { line: props.headerRow + 1 })}
      />
      <div className="flex flex-col gap-4 px-(--ph-card-padding) pb-(--ph-card-padding)">
        <div className="grid grid-cols-4 gap-4">
          <TextField
            label={t('columns.headerRow')}
            type="number"
            min={1}
            max={props.sheet.rows.length}
            value={String(props.headerRow + 1)}
            onChange={(event) => {
              // the headers are not where the file was guessed: the owner points at them (web minor 9)
              const line = Number(event.target.value);
              if (
                Number.isInteger(line) &&
                line >= 1 &&
                line <= props.sheet.rows.length
              ) {
                props.onHeaderRow(line - 1);
              }
            }}
          />
        </div>
        <div className="max-h-(--ph-import-table-height) overflow-auto">
          <DataTable
            caption={t('columns.title')}
            rowKey={(row) => String(row.index)}
            rows={rows}
            columns={columns}
          />
        </div>
        {props.sheet.hiddenRows !== undefined && (
          <Alert tone="info">
            {t('columns.hiddenRows', { count: props.sheet.hiddenRows })}
          </Alert>
        )}
        {props.waiting && (
          <p className="text-sm text-fg-muted" aria-live="polite">
            {t('columns.loadingReferences')}
          </p>
        )}
        {missing.length > 0 && (
          <Alert tone="warning">
            {t('columns.missing', { fields: missing.join(', ') })}
          </Alert>
        )}
        <div className="flex justify-between">
          <Button variant="secondary" onClick={props.onBack}>
            {t('back')}
          </Button>
          <Button
            disabled={missing.length > 0 || props.waiting === true}
            onClick={props.onNext}
          >
            {t('next')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
