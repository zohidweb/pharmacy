'use client';

/*
 * DataTable — native <table> (ADR-0007): caption, <th scope="col">, aria-sort on the sorted
 * column and a real <button> in sortable headers. Sorting, filtering and paging are done by the
 * caller / API (limit/offset); the table only reports the requested sort. Wide tables scroll
 * horizontally inside their own region (keyboard-focusable, labelled by the caption).
 */
import { useId, type ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from '../icon/Icon';

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

export interface DataTableColumn<Row, K extends string = string> {
  key: K;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  align?: 'start' | 'end';
  sortable?: boolean;
  /** Numbers and money: right-aligned tabular figures. */
  numeric?: boolean;
  /** Keeps short values on one line (dates, statuses). */
  nowrap?: boolean;
}

export interface DataTableProps<Row, K extends string = string> {
  /** Table caption; visually hidden unless showCaption. */
  caption: string;
  showCaption?: boolean;
  columns: ReadonlyArray<DataTableColumn<Row, K>>;
  rows: ReadonlyArray<Row>;
  rowKey: (row: Row) => string;
  sort?: SortState<K>;
  onSortChange?: (sort: SortState<K>) => void;
  /** Rendered in place of the body when there are no rows. */
  empty?: ReactNode;
  /** Visual emphasis for group rows (e.g. a company above its stores). */
  rowVariant?: (row: Row) => 'default' | 'group' | 'muted';
  /** Localized hint for sort buttons, e.g. (direction) => "сортировка по возрастанию". */
  sortLabel?: (direction: SortDirection | 'none') => string;
  /** Minimum table width before it scrolls, as a token in the spacing namespace. */
  minWidth?: 'none' | 'md' | 'lg';
  /** Layout only. */
  className?: string;
}

const minWidthClass = {
  none: '',
  md: 'min-w-(--ph-size-table-md)',
  lg: 'min-w-(--ph-size-table-lg)',
} as const;

const rowVariantClass = {
  default: '',
  group: 'bg-surface-sunken font-bold',
  muted: 'text-fg-subtle',
} as const;

export function DataTable<Row, K extends string = string>({
  caption,
  showCaption = false,
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  empty,
  rowVariant,
  sortLabel,
  minWidth = 'md',
  className,
}: DataTableProps<Row, K>) {
  const captionId = useId();

  const toggleSort = (key: K) => {
    if (!onSortChange) return;
    const direction: SortDirection =
      sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange({ key, direction });
  };

  return (
    <div
      role="region"
      aria-labelledby={captionId}
      tabIndex={0}
      className={cx('w-full overflow-x-auto', className)}
    >
      <table
        className={cx(
          'w-full border-collapse text-sm text-fg',
          minWidthClass[minWidth],
        )}
      >
        <caption
          id={captionId}
          className={cx(
            showCaption
              ? 'px-(--ph-table-cell-padding-x) py-3 text-start text-sm font-bold'
              : 'ph-visually-hidden',
          )}
        >
          {caption}
        </caption>
        <thead className="bg-(--ph-table-header-bg)">
          <tr>
            {columns.map((column) => {
              const sorted =
                sort?.key === column.key ? sort.direction : undefined;
              const alignEnd = column.align === 'end' || column.numeric;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    column.sortable
                      ? sorted === 'asc'
                        ? 'ascending'
                        : sorted === 'desc'
                          ? 'descending'
                          : 'none'
                      : undefined
                  }
                  className={cx(
                    'h-(--ph-table-row-height) px-(--ph-table-cell-padding-x) text-xs font-medium',
                    'whitespace-nowrap text-fg-muted',
                    alignEnd ? 'text-end' : 'text-start',
                  )}
                >
                  {column.sortable && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className={cx(
                        'inline-flex items-center gap-1 rounded-sm bg-transparent hover:text-fg',
                        sorted && 'text-fg',
                        alignEnd && 'flex-row-reverse',
                      )}
                    >
                      <span>{column.header}</span>
                      <Icon
                        name={
                          sorted === 'asc'
                            ? 'arrow-up'
                            : sorted === 'desc'
                              ? 'arrow-down'
                              : 'chevrons-up-down'
                        }
                        size="xs"
                      />
                      {sortLabel && (
                        <span className="ph-visually-hidden">
                          , {sortLabel(sorted ?? 'none')}
                        </span>
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && empty ? (
            <tr>
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={cx(
                  'border-t border-border',
                  rowVariantClass[rowVariant?.(row) ?? 'default'],
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cx(
                      'h-(--ph-table-row-height) px-(--ph-table-cell-padding-x) py-2 align-middle',
                      'wrap-anywhere',
                      (column.align === 'end' || column.numeric) && 'text-end',
                      column.numeric && 'tabular-nums',
                      column.nowrap && 'whitespace-nowrap',
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
