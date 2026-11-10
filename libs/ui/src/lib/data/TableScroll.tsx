/*
 * TableScroll — the horizontal scroll region of a wide table (ADR-0007; amendment 2026-11-10 — tables built
 * without DataTable on a phone). The region is keyboard-focusable and named, so a keyboard user can scroll it
 * and a screen reader announces what it holds.
 */
import type { ReactNode } from 'react';
import { cx } from '../cx';

export type TableScrollProps = (
  | {
      /** Localized name of the region, e.g. "Строки перемещения". */
      label: string;
      labelledBy?: never;
    }
  | {
      /** Id of the element that names the region (a table caption). */
      labelledBy: string;
      label?: never;
    }
) & {
  children: ReactNode;
  /** Layout only. */
  className?: string;
};

export function TableScroll({
  label,
  labelledBy,
  children,
  className,
}: TableScrollProps) {
  return (
    <div
      role="region"
      aria-label={label}
      aria-labelledby={labelledBy}
      tabIndex={0}
      // relative: visually hidden labels (absolute) stay inside the scroll area
      className={cx('relative w-full overflow-x-auto', className)}
    >
      {children}
    </div>
  );
}
