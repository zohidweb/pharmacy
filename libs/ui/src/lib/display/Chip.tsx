/*
 * Chip — filter toggle: native <button aria-pressed> ("Все · 6", "Просрочены · 1").
 * Chips of one filter sit in a ChipGroup (role="group" with a localized label).
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';

export interface ChipProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'aria-pressed' | 'children'
> {
  selected: boolean;
  children: ReactNode;
  /** Optional count shown after the label ("Label · N"). */
  count?: number;
  /** Layout only. */
  className?: string;
}

export function Chip({
  selected,
  children,
  count,
  type = 'button',
  className,
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx(
        'inline-flex min-h-(--ph-chip-height) items-center gap-1 rounded-full border px-4 text-sm',
        'whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:text-fg-disabled',
        selected
          ? 'border-primary bg-primary text-on-primary'
          : 'border-border bg-surface text-fg-muted hover:border-control hover:text-fg',
        className,
      )}
      {...rest}
    >
      <span>{children}</span>
      {count !== undefined && (
        <span className="tabular-nums">
          <span aria-hidden="true">·</span> {count}
        </span>
      )}
    </button>
  );
}

export interface ChipGroupProps {
  /** Localized name of the filter, e.g. "Статус счёта". */
  label: string;
  children: ReactNode;
  /** Layout only. */
  className?: string;
}

export function ChipGroup({ label, children, className }: ChipGroupProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx('flex flex-wrap gap-2', className)}
    >
      {children}
    </div>
  );
}
