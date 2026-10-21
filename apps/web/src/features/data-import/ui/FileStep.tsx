'use client';

import {
  Alert,
  Button,
  Card,
  CardHeader,
  Select,
  TextField,
} from '@pharmacy/ui';
import { useRef } from 'react';
import { useTranslations } from 'use-intl';
import type { SpreadsheetErrorCode, Workbook } from '@/shared/lib/spreadsheet';
import { saveBlob, templateCsv } from '../model/csv-out';
import { type ImportKindKey, kindFields } from '../model/fields';

export interface FileStepProps {
  kind: ImportKindKey;
  fileName: string | null;
  workbook: Workbook | null;
  sheetIndex: number;
  reading: boolean;
  error: SpreadsheetErrorCode | null;
  stores: Array<{ id: string; name: string }>;
  storeId: string;
  date: string;
  today: string;
  onFile: (file: File) => void;
  onSheet: (index: number) => void;
  onStore: (storeId: string) => void;
  onDate: (date: string) => void;
  onNext: () => void;
}

/** Step 1 (spec 2026-10-20-data-import, section 9): the file, its sheet, the store and the date of the drafts. */
export function FileStep(props: FileStepProps) {
  const t = useTranslations('dataImport');
  const tFields = useTranslations('dataImport.fields');
  const input = useRef<HTMLInputElement>(null);
  // the `one-of` fields are one requirement: «Штрихкод или Наименование»
  const fields = kindFields[props.kind];
  const oneOf = fields
    .filter((field) => field.required === 'one-of')
    .map((field) => tFields(field.key as never));
  const required = [
    ...(oneOf.length > 0 ? [oneOf.join(t('columns.or'))] : []),
    ...fields
      .filter((field) => field.required === 'yes')
      .map((field) => tFields(field.key as never)),
  ];
  const balances = props.kind === 'opening-balances';
  const ready =
    props.workbook !== null &&
    !props.reading &&
    props.error === null &&
    (!balances || (props.storeId !== '' && props.date !== ''));

  return (
    <Card padding="none">
      <CardHeader
        inset
        title={t('steps.file')}
        description={t(`kinds.${props.kind}.hint`)}
        actions={
          <Button
            variant="tertiary"
            iconStart="download"
            onClick={() =>
              saveBlob(
                templateCsv(props.kind, (key) => tFields(key as never)),
                `${t(`kinds.${props.kind}.template`)}.csv`,
              )
            }
          >
            {t('file.template')}
          </Button>
        }
      />
      <div className="flex flex-col gap-4 px-(--ph-card-padding) pb-(--ph-card-padding)">
        <p className="text-sm text-fg-muted">
          {t('file.formats')}{' '}
          {t('file.required', { fields: required.join(', ') })}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={input}
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) props.onFile(file);
              // the same file chosen again after a fix is read again
              event.target.value = '';
            }}
          />
          <Button
            variant="secondary"
            iconStart="file-text"
            disabled={props.reading}
            onClick={() => input.current?.click()}
          >
            {t('file.choose')}
          </Button>
          <span className="text-sm" aria-live="polite">
            {props.reading
              ? t('file.reading')
              : props.fileName
                ? t('file.chosen', { name: props.fileName })
                : t('file.none')}
          </span>
        </div>
        {props.workbook?.lostLetters && (
          <Alert tone="warning">{t('file.lostLetters')}</Alert>
        )}
        {props.error && (
          <Alert tone="danger" live="assertive">
            {t(`fileErrors.${props.error}`)}
          </Alert>
        )}
        {props.workbook && props.workbook.sheets.length > 1 && (
          <Select
            label={t('file.sheet')}
            value={String(props.sheetIndex)}
            options={props.workbook.sheets.map((sheet, index) => ({
              value: String(index),
              label: sheet.name || String(index + 1),
            }))}
            onChange={(event) => props.onSheet(Number(event.target.value))}
          />
        )}
        {balances && (
          <div className="grid grid-cols-2 items-start gap-4">
            <Select
              label={t('file.store')}
              required
              value={props.storeId}
              placeholder={t('file.storePlaceholder')}
              options={props.stores.map((store) => ({
                value: store.id,
                label: store.name,
              }))}
              onChange={(event) => props.onStore(event.target.value)}
            />
            <TextField
              label={t('file.date')}
              type="date"
              required
              max={props.today}
              value={props.date}
              onChange={(event) => props.onDate(event.target.value)}
            />
          </div>
        )}
        <div className="flex justify-end">
          <Button disabled={!ready} onClick={props.onNext}>
            {t('next')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
