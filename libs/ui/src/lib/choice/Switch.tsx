'use client';

/*
 * Switch — ARIA APG "Switch": <button role="switch" aria-checked>, Space/Enter toggle natively
 * via click. The visible label is the accessible name (aria-labelledby).
 */
import { useId, type ReactNode } from 'react';
import { cx } from '../cx';

export interface SwitchProps {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Layout only. */
  className?: string;
}

export function Switch({
  label,
  description,
  checked,
  onCheckedChange,
  disabled = false,
  className,
}: SwitchProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div className={cx('flex items-start justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-col">
        <span
          id={labelId}
          className={cx('text-sm text-fg', disabled && 'text-fg-disabled')}
        >
          {label}
        </span>
        {description && (
          <span id={descriptionId} className="text-xs text-fg-subtle">
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cx(
          'flex h-(--ph-switch-height) w-(--ph-switch-width) shrink-0 cursor-pointer items-center',
          'rounded-full border border-transparent px-0.5 transition-colors',
          'disabled:cursor-not-allowed disabled:bg-disabled',
          checked
            ? 'justify-end bg-(--ph-switch-track-on)'
            : 'justify-start bg-(--ph-switch-track-off)',
        )}
      >
        <span
          aria-hidden="true"
          className="size-(--ph-switch-thumb) rounded-full bg-surface shadow-sm"
        />
      </button>
    </div>
  );
}
