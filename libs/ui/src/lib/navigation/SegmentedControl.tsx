'use client';

/*
 * SegmentedControl — a small single-choice switch (RU/TJ, "Таблица / Карточки").
 * Native radio inputs in a <fieldset>: arrows move the choice and Tab enters the group once,
 * both by the browser (ARIA APG "Radio Group").
 */
import { useId } from 'react';
import { cx } from '../cx';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Full name when the visible label is an abbreviation ("TJ" → "Тоҷикӣ"). */
  ariaLabel?: string;
}

export interface SegmentedControlProps<T extends string> {
  /** Localized group name, e.g. "Язык интерфейса". */
  label: string;
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onValueChange: (value: T) => void;
  /** Layout only. */
  className?: string;
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onValueChange,
  className,
}: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <fieldset
      className={cx(
        'm-0 inline-flex min-w-0 gap-0.5 rounded-sm border-0 bg-surface-sunken p-0.5',
        className,
      )}
    >
      <legend className="ph-visually-hidden">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cx(
            'relative inline-flex min-h-8 cursor-pointer items-center rounded-sm px-3 text-xs font-medium',
            'text-fg-muted transition-colors has-checked:bg-surface has-checked:text-fg',
            'has-checked:shadow-sm has-focus-visible:outline-(length:--ph-focus-ring-width)',
            'has-focus-visible:outline-focus-ring has-focus-visible:outline-solid',
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onValueChange(option.value)}
            aria-label={option.ariaLabel}
            className="ph-visually-hidden"
          />
          <span aria-hidden={option.ariaLabel ? true : undefined}>
            {option.label}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
