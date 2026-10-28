import { type XlsxSheet } from '@pharmacy/shared-util';
import { saveXlsx } from '@pharmacy/ui';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { ApiError, useApiErrorMessage } from '@/shared/api';

/** What an export builds: the sheet and its file, or the reason there is no file (more rows than one request takes). */
export type XlsxExport =
  { sheet: XlsxSheet; fileName: string } | { refused: string };

/**
 * The Excel export of a screen (plan 2026-10-27-excel-export, X7, X9): runs the build, saves the file and keeps the
 * message for the screen — the refusal, an API error or a failed build.
 */
export function useXlsxExport() {
  const t = useTranslations('export');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const apiMessage = useApiErrorMessage(
    error instanceof ApiError ? error : null,
  );

  const run = async (build: () => XlsxExport | Promise<XlsxExport>) => {
    setBusy(true);
    setRefused(null);
    setError(null);
    try {
      const result = await build();
      if ('refused' in result) setRefused(result.refused);
      else await saveXlsx(result.sheet, result.fileName);
    } catch (caught) {
      // an API error has its message and correlation id; a failed build (the writer, a mapper, a browser without
      // CompressionStream) keeps its cause in the console for support
      if (!(caught instanceof ApiError)) console.error(caught);
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const message =
    refused ?? (error === null ? null : (apiMessage ?? t('failed')));
  return { run, busy, message };
}
