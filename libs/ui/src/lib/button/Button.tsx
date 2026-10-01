'use client';

/*
 * Button — native <button> (ADR-0007).
 * ARIA APG "Button": role from the element; Enter/Space activate natively; disabled buttons leave
 * the tab order; while loading the button is aria-disabled + aria-busy and keeps focus.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from '../icon/Icon';
import type { IconName } from '../icon/icons';
import { Spinner } from '../spinner/Spinner';

export type ButtonVariant =
  'primary' | 'secondary' | 'tertiary' | 'destructive' | 'success';
export type ButtonSize = 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-(--ph-button-radius) border ' +
  'border-transparent px-(--ph-button-padding-x) text-sm font-medium whitespace-nowrap ' +
  'transition-colors select-none disabled:cursor-not-allowed disabled:bg-disabled ' +
  'disabled:text-on-disabled aria-disabled:cursor-not-allowed';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active',
  secondary:
    'bg-primary-subtle text-primary hover:bg-primary-subtle-hover active:bg-primary-subtle-hover',
  tertiary:
    'bg-transparent text-primary hover:bg-primary-subtle active:bg-primary-subtle-hover',
  destructive: 'bg-danger text-on-danger hover:bg-danger-hover',
  success: 'bg-success text-on-success hover:bg-success-hover',
};

const sizes: Record<ButtonSize, string> = {
  md: 'min-h-(--ph-button-height)',
  lg: 'min-h-(--ph-button-height-lg) text-md',
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** Layout only (margins, grid placement). */
  className?: string;
}

/** Button look for other elements, e.g. a Next.js <Link> that navigates. */
export function buttonClassName({
  variant = 'primary',
  size = 'md',
  block = false,
  className,
}: ButtonStyleOptions = {}): string {
  return cx(base, variants[variant], sizes[size], block && 'w-full', className);
}

export interface ButtonProps
  extends
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>,
    ButtonStyleOptions {
  iconStart?: IconName;
  iconEnd?: IconName;
  /** Shows a spinner and blocks activation; the label stays for screen readers. */
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant,
  size,
  block,
  className,
  iconStart,
  iconEnd,
  loading = false,
  type = 'button',
  onClick,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName({ variant, size, block, className })}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={loading ? (event) => event.preventDefault() : onClick}
      {...rest}
    >
      {loading ? (
        <Spinner size="sm" />
      ) : (
        iconStart && <Icon name={iconStart} size="sm" />
      )}
      <span>{children}</span>
      {iconEnd && !loading && <Icon name={iconEnd} size="sm" />}
    </button>
  );
}
