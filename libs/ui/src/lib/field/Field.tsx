/*
 * Field — label + control + hint/error wiring shared by text inputs, textarea and select.
 * WCAG 1.3.1 / 3.3.1 / 3.3.2: visible <label for>, error text linked by aria-describedby,
 * aria-invalid on the control; required is stated in text (requiredText), not only by a mark.
 */
import { useId, type ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from '../icon/Icon';

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

export interface FieldProps {
  label: string;
  /** Helper text under the control. */
  hint?: ReactNode;
  /** Error text; when set, the control is marked invalid. */
  error?: ReactNode;
  required?: boolean;
  /** Localized marker shown after the label for required fields, e.g. "обязательно". */
  requiredText?: string;
  /** Visually hide the label (it stays the accessible name). */
  hideLabel?: boolean;
  /** Layout only. */
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required = false,
  requiredText,
  hideLabel = false,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <label
        htmlFor={id}
        className={cx(
          // As in the client mockups (QA 2026-10-28): a quiet label, the value stands out.
          'text-sm text-fg-muted',
          hideLabel && 'ph-visually-hidden',
        )}
      >
        {label}
        {required && requiredText && (
          <span className="ms-1 font-normal text-fg-subtle">
            ({requiredText})
          </span>
        )}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
      })}
      {error && (
        <p id={errorId} className="flex items-start gap-1 text-xs text-danger">
          <Icon name="circle-alert" size="xs" className="mt-0.5" />
          <span>{error}</span>
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-xs text-fg-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * Shared look of text-like controls (input, textarea, select) in apps/web and apps/admin: a white field; focus — the
 * primary border and a soft ring in place of the offset outline (tokens --ph-input-*).
 */
export const controlClassName =
  'w-full min-w-0 rounded-(--ph-input-radius) border border-(--ph-input-border) ' +
  'bg-(--ph-input-bg) px-(--ph-input-padding-x) text-sm text-fg transition ' +
  'placeholder:text-fg-subtle hover:border-fg-subtle focus-visible:border-(--ph-input-border-focus) ' +
  'focus-visible:shadow-(--ph-input-ring-focus) focus-visible:outline-hidden ' +
  'aria-invalid:border-(--ph-input-border-invalid) ' +
  'read-only:text-fg-muted disabled:cursor-not-allowed disabled:border-border ' +
  'disabled:bg-(--ph-input-bg-disabled) disabled:text-fg-disabled';
