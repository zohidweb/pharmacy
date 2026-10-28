'use client';

/*
 * FontScaleControl — A−, the current size (a click returns to 100 %) and A+ (QA 2026-10-28). Three native buttons in a
 * labelled group; the ends of the scale disable their button. Labels come localized from the app.
 */
import { cx } from '../cx';
import { DEFAULT_FONT_SCALE, type FontScaleStore } from './font-scale';

export interface FontScaleControlLabels {
  /** Group name, e.g. "Размер шрифта". */
  group: string;
  decrease: string;
  increase: string;
  /** The middle button, with the current size, e.g. "Размер шрифта 120 %, вернуть обычный". */
  reset: (percent: number) => string;
}

export type FontScaleControlSize = 'compact' | 'touch';

const sizes: Record<FontScaleControlSize, string> = {
  // beside the RU/TJ switch of the admin header (mouse)
  compact: 'min-h-8 min-w-8 px-2',
  // touch screens of apps/web: a 44 px target
  touch: 'min-h-touch min-w-touch px-3',
};

export interface FontScaleControlProps {
  store: FontScaleStore;
  labels: FontScaleControlLabels;
  size?: FontScaleControlSize;
  /** Layout only. */
  className?: string;
}

export function FontScaleControl({
  store,
  labels,
  size = 'compact',
  className,
}: FontScaleControlProps) {
  const scale = store.useFontScale();
  const item = cx(
    'inline-flex items-center justify-center rounded-sm font-medium text-fg-muted transition-colors',
    'hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:text-fg-disabled',
    'disabled:hover:bg-transparent',
    sizes[size],
  );

  return (
    <div
      role="group"
      aria-label={labels.group}
      className={cx(
        'inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-surface-sunken p-0.5',
        className,
      )}
    >
      <button
        type="button"
        className={cx(item, 'text-xs')}
        aria-label={labels.decrease}
        title={labels.decrease}
        disabled={scale === store.scales[0]}
        onClick={() => store.stepFontScale(-1)}
      >
        A−
      </button>
      <button
        type="button"
        className={cx(item, 'text-xs tabular-nums')}
        aria-label={labels.reset(scale)}
        title={labels.reset(scale)}
        onClick={() => store.setFontScale(DEFAULT_FONT_SCALE)}
      >
        {scale}%
      </button>
      <button
        type="button"
        className={cx(item, 'text-md')}
        aria-label={labels.increase}
        title={labels.increase}
        disabled={scale === store.scales[store.scales.length - 1]}
        onClick={() => store.stepFontScale(1)}
      >
        A+
      </button>
    </div>
  );
}
