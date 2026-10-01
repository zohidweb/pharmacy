/*
 * Alert — inline message block (tone + icon + text).
 * `live="assertive"` renders role="alert" for errors that appear after an action
 * (e.g. "Неверная почта или пароль"); "polite" → role="status"; default — static content.
 */
import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from '../icon/Icon';
import type { IconName } from '../icon/icons';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger' | 'attention';

const toneClass: Record<AlertTone, string> = {
  info: 'border-info-border bg-info-subtle text-fg',
  success: 'border-success-border bg-success-subtle text-fg',
  warning: 'border-warning-border bg-warning-subtle text-fg',
  danger: 'border-danger-border bg-danger-surface text-danger',
  attention: 'border-attention-border bg-attention-subtle text-attention',
};

const iconClass: Record<AlertTone, string> = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  attention: 'text-attention',
};

const toneIcon: Record<AlertTone, IconName> = {
  info: 'info',
  success: 'circle-check',
  warning: 'triangle-alert',
  danger: 'circle-alert',
  attention: 'triangle-alert',
};

export interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: IconName;
  live?: 'polite' | 'assertive';
  /** Layout only. */
  className?: string;
}

export function Alert({
  tone = 'info',
  title,
  children,
  icon,
  live,
  className,
}: AlertProps) {
  const role =
    live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined;
  return (
    <div
      role={role}
      className={cx(
        'flex items-start gap-3 rounded-md border px-4 py-3 text-sm',
        toneClass[tone],
        className,
      )}
    >
      <span className={cx('mt-0.5', iconClass[tone])}>
        <Icon name={icon ?? toneIcon[tone]} size="sm" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
