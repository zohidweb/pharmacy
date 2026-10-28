'use client';

import { FontScaleControl as FontScaleControlView } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import { fontScale } from '../model/font-scale';

/** A−, the current size and A+ in the top bar: touch targets of 44 px. */
export function FontScaleControl() {
  const t = useTranslations('shell.fontScale');
  return (
    <FontScaleControlView
      store={fontScale}
      size="touch"
      labels={{
        group: t('label'),
        decrease: t('decrease'),
        increase: t('increase'),
        reset: (percent) => t('reset', { percent }),
      }}
    />
  );
}
