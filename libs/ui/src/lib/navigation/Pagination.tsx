'use client';

/*
 * Pagination — limit/offset paging (REST convention): range summary + previous/next.
 * Wrapped in <nav> with a localized name; buttons at the ends are disabled, not hidden.
 */
import { cx } from '../cx';
import { IconButton } from '../button/IconButton';

export interface PaginationProps {
  /** Zero-based offset of the first row on the page. */
  offset: number;
  limit: number;
  total: number;
  onOffsetChange: (offset: number) => void;
  labels: {
    /** e.g. "Страницы журнала" */
    nav: string;
    previous: string;
    next: string;
    /** e.g. ({from, to, total}) => `${from}–${to} из ${total}` */
    range: (range: { from: number; to: number; total: number }) => string;
  };
  /** Layout only. */
  className?: string;
}

export function Pagination({
  offset,
  limit,
  total,
  onOffsetChange,
  labels,
  className,
}: PaginationProps) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const hasPrevious = offset > 0;
  const hasNext = offset + limit < total;

  return (
    <nav
      aria-label={labels.nav}
      className={cx('flex items-center justify-end gap-3', className)}
    >
      <span className="text-xs text-fg-subtle tabular-nums" aria-live="polite">
        {labels.range({ from, to, total })}
      </span>
      <div className="flex gap-1">
        <IconButton
          icon="chevron-left"
          label={labels.previous}
          variant="surface"
          iconSize="sm"
          disabled={!hasPrevious}
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
        />
        <IconButton
          icon="chevron-right"
          label={labels.next}
          variant="surface"
          iconSize="sm"
          disabled={!hasNext}
          onClick={() => onOffsetChange(offset + limit)}
        />
      </div>
    </nav>
  );
}
