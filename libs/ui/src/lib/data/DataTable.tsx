'use client';

/*
 * DataTable — native <table> (ADR-0007): caption, <th scope="col">, aria-sort on the sorted
 * column and a real <button> in sortable headers. Sorting, filtering and paging are done by the
 * caller / API (limit/offset); the table only reports the requested sort. Wide tables scroll
 * horizontally inside their own region (keyboard-focusable, labelled by the caption).
 *
 * Phone layout (ADR-0007, amendment 2026-11-10), below the tablet breakpoint:
 * - `mobileLayout="cards"` renders a list of cards in place of the table — the column `mobile` role
 *   says where a value goes. The table and the list are both rendered and switched by CSS: a static
 *   export knows no screen width, and a choice in JS would flash on load. The hidden copy is
 *   `display: none` — out of the accessibility tree and the Tab order. Cards have no sort buttons;
 *   the sort chosen before stays. A column whose cell renders nothing (null, undefined, false, an empty string)
 *   is left out of its card.
 * - `stickyFirstColumn` keeps the first column at the start while the table scrolls (reports); from 768 px
 *   the table stays as it was.
 */
import { useId, type ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from '../icon/Icon';
import { TableScroll } from './TableScroll';

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

/** Where a column goes in a card of the phone layout: title, a labelled field, the action row, nowhere. */
export type DataTableMobileRole = 'title' | 'field' | 'actions' | 'hidden';

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
  /** Role in a card of `mobileLayout="cards"`, default `field`. */
  mobile?: DataTableMobileRole;
  /** Label of the value in a card when `header` is not a string (hidden or a control). */
  mobileLabel?: string;
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
  /** Below the tablet breakpoint: the table as is, or a list of cards. Default `table`. */
  mobileLayout?: 'table' | 'cards';
  /** Below the tablet breakpoint the first column stays at the start while the table scrolls horizontally. */
  stickyFirstColumn?: boolean;
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

// Sticky first column — below the tablet breakpoint only: from 768 px the layout stays as it was. A sticky cell
// paints over the scrolled cells, so it needs the background of its row; its edge is a shadow, because with
// border-collapse a border of a sticky cell stays with the table grid. Its z-index lifts it above positioned
// content of the later cells; the scroll region is isolated, so it never reaches the top bar.
const stickyCellBgClass = {
  default: 'max-tablet:bg-surface',
  group: 'max-tablet:bg-surface-sunken',
  muted: 'max-tablet:bg-surface',
} as const;

const isEmptyValue = (value: ReactNode) =>
  value === null || value === undefined || value === false || value === '';

const stickyClass =
  'max-tablet:sticky max-tablet:start-0 max-tablet:z-(--ph-z-sticky) max-tablet:shadow-(--ph-table-sticky-edge)';

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
  mobileLayout = 'table',
  stickyFirstColumn = false,
  className,
}: DataTableProps<Row, K>) {
  const captionId = useId();
  const cards = mobileLayout === 'cards';

  const toggleSort = (key: K) => {
    if (!onSortChange) return;
    const direction: SortDirection =
      sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange({ key, direction });
  };

  const table = (
    <TableScroll
      labelledBy={captionId}
      className={cx(
        stickyFirstColumn && 'max-tablet:isolate',
        cards ? 'max-tablet:hidden' : className,
      )}
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
            {columns.map((column, index) => {
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
                    stickyFirstColumn &&
                      index === 0 &&
                      cx(stickyClass, 'max-tablet:bg-(--ph-table-header-bg)'),
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
            rows.map((row) => {
              const variant = rowVariant?.(row) ?? 'default';
              return (
                <tr
                  key={rowKey(row)}
                  className={cx(
                    'border-t border-border',
                    rowVariantClass[variant],
                  )}
                >
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={cx(
                        'h-(--ph-table-row-height) px-(--ph-table-cell-padding-x) py-2 align-middle',
                        'wrap-anywhere',
                        (column.align === 'end' || column.numeric) &&
                          'text-end',
                        column.numeric && 'tabular-nums',
                        column.nowrap && 'whitespace-nowrap',
                        stickyFirstColumn &&
                          index === 0 &&
                          cx(stickyClass, stickyCellBgClass[variant]),
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </TableScroll>
  );

  if (!cards) return table;

  const titleColumns = columns.filter((column) => column.mobile === 'title');
  const labelOf = (column: DataTableColumn<Row, K>) =>
    column.mobileLabel ??
    (typeof column.header === 'string' ? column.header : null);
  const fieldColumns = columns.filter(
    (column) => (column.mobile ?? 'field') === 'field',
  );
  // a value without a label is not a <dl> pair (a group needs its <dt>): it goes above the pairs
  const plainColumns = fieldColumns.filter(
    (column) => labelOf(column) === null,
  );
  const pairColumns = fieldColumns.filter((column) => labelOf(column) !== null);
  const actionColumns = columns.filter((column) => column.mobile === 'actions');

  return (
    <div className={className}>
      {table}
      <div className="tablet:hidden">
        {showCaption && (
          <p className="px-4 py-3 text-sm font-bold" aria-hidden="true">
            {caption}
          </p>
        )}
        {/* role: VoiceOver drops the list semantics of a list without markers */}
        <ul role="list" aria-label={caption} className="m-0 list-none p-0">
          {rows.length === 0 && empty ? (
            <li>{empty}</li>
          ) : (
            rows.map((row) => {
              // a column whose cell renders nothing is left out of the card: no label over an empty value
              const filled = (list: ReadonlyArray<DataTableColumn<Row, K>>) =>
                list.flatMap((column) => {
                  const value = column.cell(row);
                  return isEmptyValue(value) ? [] : [{ column, value }];
                });
              const titles = filled(titleColumns);
              const plains = filled(plainColumns);
              const pairs = filled(pairColumns);
              const actions = filled(actionColumns);
              return (
                <li
                  key={rowKey(row)}
                  className={cx(
                    'flex flex-col gap-2 border-t border-border px-4 py-3 text-sm text-fg',
                    rowVariantClass[rowVariant?.(row) ?? 'default'],
                  )}
                >
                  {titles.map(({ column, value }) => (
                    <div key={column.key} className="font-medium wrap-anywhere">
                      {value}
                    </div>
                  ))}
                  {plains.map(({ column, value }) => (
                    <div
                      key={column.key}
                      className={cx(
                        'min-w-0 wrap-anywhere',
                        column.numeric && 'tabular-nums',
                      )}
                    >
                      {value}
                    </div>
                  ))}
                  {pairs.length > 0 && (
                    <dl className="m-0 flex flex-col gap-1">
                      {pairs.map(({ column, value }) => (
                        <div
                          key={column.key}
                          className="flex items-baseline justify-between gap-3"
                        >
                          <dt className="shrink-0 text-xs text-fg-muted">
                            {labelOf(column)}
                          </dt>
                          <dd
                            className={cx(
                              'm-0 min-w-0 text-end wrap-anywhere',
                              column.numeric && 'tabular-nums',
                            )}
                          >
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {actions.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-2">
                      {actions.map(({ column, value }) => (
                        <div key={column.key}>{value}</div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
