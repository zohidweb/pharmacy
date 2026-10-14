'use client';

import { useTranslations } from 'use-intl';
import { apiFieldErrors, useApiCodeMessage } from '@/shared/api';

/**
 * Texts of the server errors at `lines.i.productId` of a rejected request, by the key of the line
 * that was sent at index i: a line removed or moved since then does not pass its error to another.
 * A product of a running stock count (409 `stock_count_in_progress`) gets a short text: the banner
 * carries the reason.
 */
export function useLineErrors(
  error: unknown,
  sentKeys: readonly string[] | undefined,
): ReadonlyMap<string, string> {
  const t = useTranslations('stockDocs');
  const codeMessage = useApiCodeMessage();
  const texts = new Map<string, string>();
  for (const e of apiFieldErrors(error)) {
    const match = /^lines\.(\d+)\.productId$/.exec(e.field);
    const key = match ? sentKeys?.[Number(match[1])] : undefined;
    if (key === undefined || texts.has(key)) continue;
    texts.set(
      key,
      e.code === 'stock_count_in_progress'
        ? t('lines.inCount')
        : (codeMessage(e.code) ?? t('checkValue')),
    );
  }
  return texts;
}
