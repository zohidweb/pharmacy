'use client';

import { useTranslations } from 'use-intl';
import { apiFieldErrors } from '@/shared/api';

const LINE_FIELD = /^lines\.(\d+)\./;

/**
 * A 400 about one line (`lines.<i>.<field>`) or the lines as a whole, worded with the line number:
 * the generic «check the fields» does not tell which line. Lines are sent in the order they are
 * shown, so the index is the row. Null for any other error (the generic message applies).
 */
export function useLineProblem(error: unknown): string | null {
  const t = useTranslations('transfers.lineErrors');
  const field = apiFieldErrors(error).find(
    (item) => item.field === 'lines' || LINE_FIELD.test(item.field),
  );
  if (!field || !t.has(field.code as never)) return null;
  const reason = t(field.code as never);
  const index = LINE_FIELD.exec(field.field);
  return index ? t('line', { line: Number(index[1]) + 1, reason }) : reason;
}
