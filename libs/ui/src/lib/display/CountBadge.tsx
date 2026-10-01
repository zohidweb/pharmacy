import { cx } from '../cx';

export interface CountBadgeProps {
  count: number;
  tone?: 'danger' | 'neutral' | 'primary';
  /** Localized context for screen readers, e.g. "2 запроса ждут решения". */
  label?: string;
  /** Layout only. */
  className?: string;
}

const toneClass = {
  danger: 'bg-(--ph-nav-counter-bg) text-(--ph-nav-counter-fg)',
  neutral: 'bg-surface-sunken text-fg-muted',
  primary: 'bg-primary text-on-primary',
} as const;

/** Numeric counter (navigation items, tab labels). Renders nothing for zero. */
export function CountBadge({
  count,
  tone = 'danger',
  label,
  className,
}: CountBadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      className={cx(
        'inline-flex min-w-5 items-center justify-center rounded-full px-1 text-2xs font-bold tabular-nums',
        toneClass[tone],
        className,
      )}
    >
      <span aria-hidden={label ? true : undefined}>{count}</span>
      {label && <span className="ph-visually-hidden">{label}</span>}
    </span>
  );
}
