import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { useState } from 'react';
import { BarChart } from './BarChart';
import { DataTable, type DataTableColumn, type SortState } from './DataTable';

interface KeyRow {
  id: string;
  store: string;
  validUntil: string;
  amount: string;
}

type KeyColumn = 'store' | 'validUntil' | 'amount';

const rows: KeyRow[] = [
  {
    id: '1',
    store: 'Тестовая точка 1',
    validUntil: '01.10.2026',
    amount: '120,00',
  },
  {
    id: '2',
    store: 'Тестовая точка 2',
    validUntil: '15.12.2026',
    amount: '240,00',
  },
];

const columns: DataTableColumn<KeyRow, KeyColumn>[] = [
  { key: 'store', header: 'Точка', cell: (row) => row.store, sortable: true },
  {
    key: 'validUntil',
    header: 'Действует до',
    cell: (row) => row.validUntil,
    sortable: true,
    nowrap: true,
  },
  {
    key: 'amount',
    header: 'Сумма, с',
    cell: (row) => row.amount,
    numeric: true,
  },
];

function Harness({ data = rows }: { data?: KeyRow[] }) {
  const [sort, setSort] = useState<SortState<KeyColumn>>({
    key: 'store',
    direction: 'asc',
  });
  return (
    <DataTable
      caption="Лицензионные ключи"
      columns={columns}
      rows={data}
      rowKey={(row) => row.id}
      sort={sort}
      onSortChange={setSort}
      sortLabel={(direction) =>
        direction === 'asc'
          ? 'по возрастанию'
          : direction === 'desc'
            ? 'по убыванию'
            : 'не сортируется'
      }
      empty={<p>Ключей нет</p>}
    />
  );
}

describe('DataTable', () => {
  it('renders a captioned table with column headers and rows', () => {
    render(<Harness />);
    const table = screen.getByRole('table', { name: 'Лицензионные ключи' });

    expect(within(table).getAllByRole('columnheader')).toHaveLength(3);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(
      screen.getByRole('region', { name: 'Лицензионные ключи' }).tabIndex,
    ).toBe(0);
  });

  it('exposes aria-sort and toggles the direction from the header button', () => {
    render(<Harness />);
    const [storeHeader, dateHeader, amountHeader] =
      screen.getAllByRole('columnheader');

    expect(storeHeader.getAttribute('aria-sort')).toBe('ascending');
    expect(dateHeader.getAttribute('aria-sort')).toBe('none');
    expect(amountHeader.hasAttribute('aria-sort')).toBe(false);

    fireEvent.click(within(storeHeader).getByRole('button'));
    expect(storeHeader.getAttribute('aria-sort')).toBe('descending');

    fireEvent.click(within(dateHeader).getByRole('button'));
    expect(dateHeader.getAttribute('aria-sort')).toBe('ascending');
    expect(storeHeader.getAttribute('aria-sort')).toBe('none');
  });

  it('shows the empty state in place of rows', () => {
    render(<Harness data={[]} />);

    expect(screen.getByText('Ключей нет')).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const { container } = render(<Harness />);

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('BarChart', () => {
  const items = [
    { key: 'd1', label: '08.09', value: 100, valueText: '100,00 с' },
    { key: 'd2', label: '09.09', value: 50, valueText: '50,00 с' },
  ];

  it('hides the bars and exposes exact values as a table', () => {
    const { container } = render(
      <BarChart
        caption="Продажи за 14 дней"
        columnLabels={{ label: 'День', value: 'Продажи' }}
        items={items}
      />,
    );
    const table = screen.getByRole('table', { name: 'Продажи за 14 дней' });

    expect(within(table).getByText('50,00 с')).toBeTruthy();
    const bars = container.querySelectorAll<HTMLElement>('[style]');
    expect(bars[0].style.getPropertyValue('--bar-height')).toBe('100%');
    expect(bars[1].style.getPropertyValue('--bar-height')).toBe('50%');
  });

  it('handles all-zero data', async () => {
    const { container } = render(
      <BarChart
        caption="Нет продаж"
        columnLabels={{ label: 'День', value: 'Продажи' }}
        items={items.map((item) => ({ ...item, value: 0 }))}
      />,
    );

    expect(
      container
        .querySelector<HTMLElement>('[style]')
        ?.style.getPropertyValue('--bar-height'),
    ).toBe('0%');
    expect(await axe(container)).toHaveNoViolations();
  });
});
