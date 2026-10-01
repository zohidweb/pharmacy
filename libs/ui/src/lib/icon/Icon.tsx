import { createElement } from 'react';
import { cx } from '../cx';
import { icons, type IconName } from './icons';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const sizeClass: Record<IconSize, string> = {
  xs: 'size-icon-xs',
  sm: 'size-icon-sm',
  md: 'size-icon-md',
  lg: 'size-icon-lg',
  xl: 'size-icon-xl',
};

export interface IconProps {
  name: IconName;
  size?: IconSize;
  /**
   * Accessible name for a meaningful standalone icon. Omit for decorative icons next to text:
   * they are hidden from assistive technology.
   */
  label?: string;
  /** Layout only (margins, grid placement); color comes from the parent's text color. */
  className?: string;
}

export function Icon({ name, size = 'md', label, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx('shrink-0', sizeClass[size], className)}
      focusable="false"
      {...(label
        ? { role: 'img', 'aria-label': label }
        : { 'aria-hidden': true })}
    >
      {icons[name].map(([tag, attrs], index) =>
        createElement(tag, { key: index, ...attrs }),
      )}
    </svg>
  );
}
