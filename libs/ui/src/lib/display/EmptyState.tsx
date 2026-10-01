import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from '../icon/Icon';
import type { IconName } from '../icon/icons';

export interface EmptyStateProps {
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  /** Usually a Button, e.g. "Показать все" / "Сбросить фильтры". */
  action?: ReactNode;
  /** Layout only. */
  className?: string;
}

export function EmptyState({
  icon = 'search',
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        'flex flex-col items-center gap-2 px-6 py-12 text-center',
        className,
      )}
    >
      <span className="mb-1 grid size-avatar-md place-items-center rounded-full bg-surface-sunken text-fg-subtle">
        <Icon name={icon} size="lg" />
      </span>
      <p className="text-md font-bold text-fg">{title}</p>
      {description && (
        <p className="max-w-(--ph-size-dialog-sm) text-sm text-fg-subtle">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
