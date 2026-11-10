/*
 * The look of Button as plain class names, without a client boundary: a server component (apps/site)
 * styles its links with it. Button.tsx is a client module, and a function exported from one cannot be
 * called on the server.
 */
import { cx } from '../cx';

export type ButtonVariant =
  'primary' | 'secondary' | 'tertiary' | 'destructive' | 'success';
export type ButtonSize = 'md' | 'lg';

// The button of the client mockups in apps/web and apps/admin (QA 2026-10-28): radius 8 px, semibold text.
const base =
  'inline-flex items-center justify-center gap-2 rounded-(--ph-button-radius) border ' +
  'border-transparent px-(--ph-button-padding-x) text-sm font-semibold whitespace-nowrap ' +
  'transition-colors select-none disabled:cursor-not-allowed disabled:bg-disabled ' +
  'disabled:text-on-disabled aria-disabled:cursor-not-allowed';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active',
  // the surface with a border, as the second button of the client mockups
  secondary:
    'border-border-strong bg-surface text-fg hover:bg-surface-sunken active:bg-surface-sunken',
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
