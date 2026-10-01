'use client';

/*
 * RadioCardGroup — native radio inputs in a <fieldset>, drawn as selectable cards
 * (e.g. "Облачная точка" / "Автономная"). Arrow keys move the selection natively (ARIA APG
 * "Radio Group" behavior comes from the browser); Tab enters/leaves the group once.
 */
import { useId, type ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from '../icon/Icon';
import type { IconName } from '../icon/icons';

const columnClass = { 1: 'grid-cols-1', 2: 'grid-cols-2' } as const;

export interface RadioCardOption<T extends string> {
  value: T;
  title: string;
  description?: ReactNode;
  icon?: IconName;
  disabled?: boolean;
}

export interface RadioCardGroupProps<T extends string> {
  /** Group label (rendered as <legend>). */
  label: string;
  hideLabel?: boolean;
  name?: string;
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<RadioCardOption<T>>;
  columns?: 1 | 2;
  /** Layout only. */
  className?: string;
}

export function RadioCardGroup<T extends string>({
  label,
  hideLabel = false,
  name,
  value,
  onValueChange,
  options,
  columns = 2,
  className,
}: RadioCardGroupProps<T>) {
  const autoName = useId();
  const groupName = name ?? autoName;

  return (
    <fieldset className={cx('m-0 min-w-0 border-0 p-0', className)}>
      <legend
        className={cx(
          'mb-2 p-0 text-sm font-medium text-fg',
          hideLabel && 'ph-visually-hidden',
        )}
      >
        {label}
      </legend>
      <div className={cx('grid gap-3', columnClass[columns])}>
        {options.map((option) => (
          <label
            key={option.value}
            className={cx(
              'flex cursor-pointer items-start gap-3 rounded-md border-2 border-border bg-surface p-4',
              'transition-colors hover:border-control has-checked:border-primary',
              'has-checked:bg-surface-highlight has-disabled:cursor-not-allowed',
              'has-disabled:text-fg-disabled',
            )}
          >
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={option.value === value}
              disabled={option.disabled}
              onChange={() => onValueChange(option.value)}
              className="mt-0.5 size-icon-sm shrink-0 accent-primary"
            />
            {option.icon && (
              <span className="text-primary">
                <Icon name={option.icon} size="md" />
              </span>
            )}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium text-fg">
                {option.title}
              </span>
              {option.description && (
                <span className="text-xs text-fg-subtle">
                  {option.description}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
