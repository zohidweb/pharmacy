/*
 * Checkbox — native <input type="checkbox"> wrapped in its <label> (ADR-0007).
 * Space toggles natively; the whole row is the click target.
 */
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'className'
> {
  label: ReactNode;
  description?: ReactNode;
  /** Layout only. */
  className?: string;
}

export function Checkbox({
  label,
  description,
  className,
  ...inputProps
}: CheckboxProps) {
  return (
    <label
      className={cx(
        'flex cursor-pointer items-start gap-3 has-disabled:cursor-not-allowed',
        className,
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 size-icon-md shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed"
        {...inputProps}
      />
      <span className="flex flex-col">
        <span className="text-sm text-fg">{label}</span>
        {description && (
          <span className="text-xs text-fg-subtle">{description}</span>
        )}
      </span>
    </label>
  );
}
