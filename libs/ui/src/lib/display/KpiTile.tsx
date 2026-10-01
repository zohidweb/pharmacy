import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from '../icon/Icon';
import type { IconName } from '../icon/icons';

export type KpiTone = 'default' | 'success' | 'warning' | 'danger';

const valueTone: Record<KpiTone, string> = {
  default: 'text-fg',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

export interface KpiTileProps {
  label: ReactNode;
  /** Already formatted value (money via formatMoney, counts, versions). */
  value: ReactNode;
  /** Secondary line: explains the value in words, so color is never the only signal. */
  hint?: ReactNode;
  tone?: KpiTone;
  icon?: IconName;
  /** Layout only. */
  className?: string;
}

/** Key figure tile; renders as a description-list group for assistive technology. */
export function KpiTile({
  label,
  value,
  hint,
  tone = 'default',
  icon,
  className,
}: KpiTileProps) {
  return (
    <div
      className={cx(
        'flex min-w-0 items-start justify-between gap-3 rounded-(--ph-card-radius) bg-surface p-5',
        'shadow-(--ph-card-shadow)',
        className,
      )}
    >
      <dl className="m-0 flex min-w-0 flex-col gap-1">
        <dt className="text-sm text-fg-muted">{label}</dt>
        <dd
          className={cx(
            'm-0 text-2xl font-bold tracking-tight tabular-nums',
            valueTone[tone],
          )}
        >
          {value}
        </dd>
        {hint && <dd className="m-0 text-xs text-fg-subtle">{hint}</dd>}
      </dl>
      {icon && (
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-subtle text-primary">
          <Icon name={icon} size="md" />
        </span>
      )}
    </div>
  );
}
