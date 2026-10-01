import { cx } from '../cx';

export type AvatarSize = 'sm' | 'md' | 'lg';

const sizeClass: Record<AvatarSize, string> = {
  sm: 'size-avatar-sm text-xs',
  md: 'size-avatar-md text-sm',
  lg: 'size-avatar-lg text-xl',
};

export interface AvatarProps {
  /** Full name; initials are derived from its first two words. */
  name: string;
  size?: AvatarSize;
  /** Set when the avatar stands alone; next to a visible name it is decorative. */
  label?: string;
  /** Layout only. */
  className?: string;
}

export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toLocaleUpperCase('ru-RU'))
    .join('');
}

export function Avatar({ name, size = 'md', label, className }: AvatarProps) {
  return (
    <span
      className={cx(
        'inline-grid shrink-0 place-items-center rounded-full bg-primary-subtle font-bold text-primary',
        sizeClass[size],
        className,
      )}
      {...(label
        ? { role: 'img', 'aria-label': label }
        : { 'aria-hidden': true })}
    >
      {initialsOf(name)}
    </span>
  );
}
