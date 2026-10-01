/*
 * StatusPill — status as icon + text + color, never color alone (WCAG 1.4.1, Iron Law 3).
 * The caller maps a domain status (tenant, key, invoice…) to a tone and a localized label.
 */
import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from '../icon/Icon';
import type { IconName } from '../icon/icons';

export type StatusTone =
  'success' | 'warning' | 'danger' | 'info' | 'attention' | 'neutral';

const toneClass: Record<StatusTone, string> = {
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  info: 'bg-info-subtle text-info',
  attention: 'bg-attention-subtle text-attention',
  neutral: 'bg-surface-sunken text-fg-muted',
};

const toneIcon: Record<StatusTone, IconName | null> = {
  success: 'circle-check',
  warning: 'triangle-alert',
  danger: 'circle-alert',
  info: 'info',
  attention: 'triangle-alert',
  neutral: null,
};

export interface StatusPillProps {
  tone: StatusTone;
  children: ReactNode;
  /** Override the tone's default icon; `null` hides it (only for neutral-like labels). */
  icon?: IconName | null;
  /** Layout only. */
  className?: string;
}

export function StatusPill({
  tone,
  children,
  icon,
  className,
}: StatusPillProps) {
  const iconName = icon === undefined ? toneIcon[tone] : icon;
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-center gap-1 rounded-full px-(--ph-pill-padding-x) py-0.5',
        'text-xs font-medium whitespace-nowrap',
        toneClass[tone],
        className,
      )}
    >
      {iconName && <Icon name={iconName} size="xs" />}
      <span className="truncate">{children}</span>
    </span>
  );
}
