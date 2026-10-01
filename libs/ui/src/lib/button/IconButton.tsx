/*
 * IconButton — native <button> with an icon only (ADR-0007).
 * WCAG 1.1.1 / 4.1.2: `label` is required and becomes the accessible name.
 */
import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../cx';
import { Icon, type IconSize } from '../icon/Icon';
import type { IconName } from '../icon/icons';

export type IconButtonVariant = 'ghost' | 'surface' | 'subtle';

const variants: Record<IconButtonVariant, string> = {
  ghost: 'bg-transparent text-fg-muted hover:bg-surface-sunken hover:text-fg',
  surface:
    'border-border bg-surface text-fg-muted hover:bg-surface-sunken hover:text-fg',
  subtle: 'bg-surface-sunken text-fg-muted hover:bg-border hover:text-fg',
};

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'children' | 'aria-label'
> {
  icon: IconName;
  /** Localized accessible name, e.g. "Закрыть". */
  label: string;
  variant?: IconButtonVariant;
  iconSize?: IconSize;
  /** Small dot, e.g. unread notifications; mention it in `label` too. */
  indicator?: boolean;
  /** Layout only. */
  className?: string;
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  iconSize = 'md',
  indicator = false,
  type = 'button',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cx(
        'relative inline-grid size-(--ph-icon-button-size) shrink-0 place-items-center rounded-full',
        'border border-transparent transition-colors disabled:cursor-not-allowed',
        'disabled:text-fg-disabled',
        variants[variant],
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
      {indicator && (
        <span
          aria-hidden="true"
          className="absolute end-2 top-2 size-2 rounded-full border-2 border-surface bg-danger"
        />
      )}
    </button>
  );
}
