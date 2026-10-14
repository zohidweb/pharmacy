'use client';

import { useTranslations } from 'use-intl';
import { apiFieldErrors, useApiCodeMessage } from '@/shared/api';

/**
 * Texts of the server errors at `lines.i.productId` of a rejected request, by line index (e.g. 409
 * `stock_count_in_progress`: the product is in the scope of a running stock count).
 */
export function useLineErrors(
  error: unknown,
  count: number,
): (string | undefined)[] {
  const tDocs = useTranslations('stockDocs');
  const codeMessage = useApiCodeMessage();
  const errors = apiFieldErrors(error);
  return Array.from({ length: count }, (_, i) => {
    const code = errors.find((e) => e.field === `lines.${i}.productId`)?.code;
    return code === undefined
      ? undefined
      : (codeMessage(code) ?? tDocs('checkValue'));
  });
}
