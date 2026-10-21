'use client';

import { toAppDate } from '@pharmacy/shared-util';
import { Alert, Stepper } from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiRequest } from '@/shared/api';
import {
  readSpreadsheet,
  SpreadsheetError,
  type SpreadsheetErrorCode,
  type Workbook,
} from '@/shared/lib/spreadsheet';
import { type BuildResult, buildRequest } from '../model/build';
import {
  type CatalogValueChoices,
  catalogExtrasOf,
  initialChoices,
  needsChoices,
} from '../model/catalog-values';
import type { ImportKindKey } from '../model/fields';
import type { ImportResult } from '../model/kinds';
import { detectHeaderRow, headersOf, suggestMapping } from '../model/mapping';
import { CheckStep } from './CheckStep';
import { ColumnsStep } from './ColumnsStep';
import { DoneStep } from './DoneStep';
import { FileStep } from './FileStep';
import { ValuesStep } from './ValuesStep';

type Step = 'file' | 'columns' | 'values' | 'check' | 'done';

export interface DataImportWizardProps {
  kind: ImportKindKey;
  /** Cloud stores of the scope (opening balances). */
  stores: Array<{ id: string; name: string }>;
  /** `catalog:update`: a category the network does not have may be created (F14). */
  canCreateCategories: boolean;
}

/**
 * Loading data from a file (spec 2026-10-20-data-import, section 9): file → columns → values (catalog) → check →
 * done. The file is read in the browser; the API receives typed rows.
 */
export function DataImportWizard({
  kind,
  stores,
  canCreateCategories,
}: DataImportWizardProps) {
  const t = useTranslations('dataImport');
  const today = toAppDate();
  const [step, setStep] = useState<Step>('file');
  const [source, setSource] = useState<{
    fileName: string;
    workbook: Workbook;
  } | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<SpreadsheetErrorCode | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [storeId, setStoreId] = useState(
    stores.length === 1 ? stores[0].id : '',
  );
  const [date, setDate] = useState(today);
  const [choices, setChoices] = useState<CatalogValueChoices | null>(null);
  const [build, setBuild] = useState<BuildResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const references = useQuery({
    queryKey: ['catalog', 'references'],
    queryFn: ({ signal }) => apiRequest('catalog.references', { signal }),
    staleTime: 5 * 60_000,
    enabled: kind === 'catalog',
  });

  const sheet = source?.workbook.sheets[sheetIndex];
  const steps: Step[] =
    kind === 'catalog'
      ? ['file', 'columns', 'values', 'check', 'done']
      : ['file', 'columns', 'check', 'done'];

  const selectSheet = (workbook: Workbook, index: number) => {
    const rows = workbook.sheets[index].rows;
    const header = detectHeaderRow(rows, kind);
    setSheetIndex(index);
    setHeaderRow(header);
    setMapping(suggestMapping(headersOf(rows[header]), kind));
  };

  const readFile = async (file: File) => {
    setReading(true);
    setReadError(null);
    setSource(null);
    try {
      const workbook = await readSpreadsheet(file);
      setSource({ fileName: file.name, workbook });
      selectSheet(workbook, 0);
    } catch (error) {
      setReadError(error instanceof SpreadsheetError ? error.code : 'corrupt');
    } finally {
      setReading(false);
    }
  };

  /** The rows of the request; a sheet past the limit is a read error of the file step. */
  const toCheck = (catalogChoices: CatalogValueChoices | null) => {
    if (!source || !sheet) return;
    try {
      setBuild(
        buildRequest({
          sheet,
          headerRow,
          mapping,
          date1904: source.workbook.date1904,
          fileName: source.fileName,
          extras:
            kind === 'catalog' && catalogChoices
              ? catalogExtrasOf(catalogChoices)
              : kind === 'opening-balances'
                ? {
                    kind,
                    storeId,
                    date,
                    comment: t('comment', { name: source.fileName }).slice(
                      0,
                      450,
                    ),
                  }
                : { kind: 'suppliers' },
        }),
      );
      setStep('check');
    } catch (error) {
      setReadError(error instanceof SpreadsheetError ? error.code : 'corrupt');
      setStep('file');
    }
  };

  const afterColumns = () => {
    if (kind !== 'catalog') {
      toCheck(null);
      return;
    }
    if (!sheet || !references.data) return;
    const initial = initialChoices(
      sheet,
      headerRow,
      mapping,
      {
        categories: references.data.categories.map((category) => category.name),
        forms: references.data.forms,
      },
      canCreateCategories,
    );
    setChoices(initial);
    if (needsChoices(initial)) setStep('values');
    else toCheck(initial);
  };

  const restart = () => {
    setStep('file');
    setSource(null);
    setBuild(null);
    setResult(null);
    setChoices(null);
  };

  const headers = useMemo(
    () => (sheet ? headersOf(sheet.rows[headerRow]) : []),
    [sheet, headerRow],
  );

  return (
    <div className="flex flex-col gap-4">
      <Stepper
        label={t('stepsLabel')}
        steps={steps.map((item) => ({ label: t(`steps.${item}`) }))}
        current={steps.indexOf(step)}
        completedText={t('stepDone')}
      />
      {kind === 'catalog' && references.isError && (
        <Alert tone="danger">{t('errors.references')}</Alert>
      )}
      {step === 'file' && (
        <FileStep
          kind={kind}
          fileName={source?.fileName ?? null}
          workbook={source?.workbook ?? null}
          sheetIndex={sheetIndex}
          reading={reading}
          error={readError}
          stores={stores}
          storeId={storeId}
          date={date}
          today={today}
          onFile={(file) => void readFile(file)}
          onSheet={(index) => source && selectSheet(source.workbook, index)}
          onStore={setStoreId}
          onDate={setDate}
          onNext={() => setStep('columns')}
        />
      )}
      {step === 'columns' && sheet && (
        <ColumnsStep
          kind={kind}
          sheet={sheet}
          headerRow={headerRow}
          mapping={mapping}
          onMapping={setMapping}
          onBack={() => setStep('file')}
          onNext={afterColumns}
        />
      )}
      {step === 'values' && choices && references.data && (
        <ValuesStep
          choices={choices}
          categories={references.data.categories.map(
            (category) => category.name,
          )}
          forms={references.data.forms}
          canCreateCategories={canCreateCategories}
          onChoices={setChoices}
          onBack={() => setStep('columns')}
          onNext={() => toCheck(choices)}
        />
      )}
      {step === 'check' && build && (
        <CheckStep
          kind={kind}
          build={build}
          headers={headers}
          mapping={mapping}
          onBack={() =>
            setStep(
              kind === 'catalog' && choices && needsChoices(choices)
                ? 'values'
                : 'columns',
            )
          }
          onDone={(done) => {
            setResult(done);
            setStep('done');
          }}
        />
      )}
      {step === 'done' && result && (
        <DoneStep result={result} onAgain={restart} />
      )}
    </div>
  );
}
