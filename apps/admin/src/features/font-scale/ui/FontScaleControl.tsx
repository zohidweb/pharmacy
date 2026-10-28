'use client';

import { cx } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import {
  DEFAULT_FONT_SCALE,
  FONT_SCALES,
  setFontScale,
  stepFontScale,
  useFontScale,
} from '../model/font-scale';

const item =
  'inline-flex min-h-8 min-w-8 items-center justify-center rounded-sm px-2 font-medium text-fg-muted ' +
  'transition-colors hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:text-fg-disabled ' +
  'disabled:hover:bg-transparent';

/** A−, the current size (a click returns to 100 %) and A+, in the look of the language switch beside it. */
export function FontScaleControl() {
  const t = useTranslations('shell.fontScale');
  const scale = useFontScale();

  return (
    <div
      role="group"
      aria-label={t('label')}
      className="inline-flex items-center gap-0.5 rounded-sm bg-surface-sunken p-0.5"
    >
      <button
        type="button"
        className={cx(item, 'text-xs')}
        aria-label={t('decrease')}
        title={t('decrease')}
        disabled={scale === FONT_SCALES[0]}
        onClick={() => stepFontScale(-1)}
      >
        A−
      </button>
      <button
        type="button"
        className={cx(item, 'text-xs tabular-nums')}
        aria-label={t('reset', { percent: scale })}
        title={t('reset', { percent: scale })}
        onClick={() => setFontScale(DEFAULT_FONT_SCALE)}
      >
        {scale}%
      </button>
      <button
        type="button"
        className={cx(item, 'text-md')}
        aria-label={t('increase')}
        title={t('increase')}
        disabled={scale === FONT_SCALES[FONT_SCALES.length - 1]}
        onClick={() => stepFontScale(1)}
      >
        A+
      </button>
    </div>
  );
}
