'use client';

/*
 * Button — native <button> (ADR-0007).
 * ARIA APG "Button": role from the element; Enter/Space activate natively; disabled buttons leave
 * the tab order; while loading the button is aria-disabled + aria-busy and keeps focus.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon } from '../icon/Icon';
import type { IconName } from '../icon/icons';
import { Spinner } from '../spinner/Spinner';
import { buttonClassName, type ButtonStyleOptions } from './button-class-name';

export {
  buttonClassName,
  type ButtonSize,
  type ButtonStyleOptions,
  type ButtonVariant,
} from './button-class-name';

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
