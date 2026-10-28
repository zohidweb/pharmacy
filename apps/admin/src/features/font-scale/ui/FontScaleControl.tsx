'use client';

import { FontScaleControl as FontScaleControlView } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import { fontScale } from '../model/font-scale';

/** A−, the current size and A+ in the page header, beside the language switch. */
export function FontScaleControl() {
  const t = useTranslations('shell.fontScale');
  return (
    <FontScaleControlView
      store={fontScale}
      size="compact"
      labels={{
        group: t('label'),
        decrease: t('decrease'),
        increase: t('increase'),
        reset: (percent) => t('reset', { percent }),
      }}
    />
  );
}
