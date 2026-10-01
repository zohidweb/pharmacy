/*
 * Stock screens against the in-memory API mocks: stock by batch and its states, posting writes
 * movements and unposting is blocked by later movements, write-off of expired batches, return to
 * a supplier, stock count with sold-since, transfer acceptance with a discrepancy, read-only rules.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { GoodsReceiptsPage } from '@/pages/goods-receipts';
import { StockPage } from '@/pages/stock';
import { StockCountsPage } from '@/pages/stock-counts';
import { SupplierReturnsPage } from '@/pages/supplier-returns';
import { TransfersPage } from '@/pages/transfers';
import { WriteOffsPage } from '@/pages/write-offs';
import { mockApi, signInAs, signInByPin, useMockApi } from './mock-env';
import { renderWithProviders } from './test-utils';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/stock',
  useSearchParams: () => new URLSearchParams(),
}));

useMockApi();

async function stockOf(storeId: string, productName: string) {
  const list = await mockApi()(
    'stock.list',
    { query: { storeId, q: productName, limit: 50 } },
    'test',
  );
  return list.items.reduce((sum, row) => sum + row.quantityPieces, 0);
}

const dialog = (name: string | RegExp) => screen.findByRole('dialog', { name });

/** Buttons are enabled once the session (permissions) is loaded. */
async function clickWhenEnabled(name: string) {
  const button = (await screen.findByRole('button', {
    name,
  })) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}

describe('StockPage', () => {
  it('shows the network stock with the negative stock of an offline store', async () => {
    await signInAs('firuz', 'store-1');
    renderWithProviders(<StockPage />);
    await screen.findByRole('table', { name: 'Остатки по партиям' });
    fireEvent.click(screen.getByRole('button', { name: /^Минус/ }));
    await waitFor(() =>
      expect(
        within(
          screen.getByRole('table', { name: 'Остатки по партиям' }),
        ).getAllByRole('row'),
      ).toHaveLength(2),
    );
    const table = screen.getByRole('table', { name: 'Остатки по партиям' });
    // the network view names the store of each row; −120 pieces of a 60-piece pack = −2 packs
    expect(within(table).getByText('Аптека №4 · Вахдат')).toBeTruthy();
    expect(within(table).getByText('Минус после слияния офлайн')).toBeTruthy();
    expect(within(table).getByText('-2 уп.')).toBeTruthy();
  });

  it('hides purchase prices and writes from a role without them', async () => {
    await signInByPin('emp-cashier', '2580');
    renderWithProviders(<StockPage />);
    const table = await screen.findByRole('table', {
      name: 'Остатки по партиям',
    });
    expect(
      within(table).queryByRole('columnheader', { name: /Закупка/ }),
    ).toBeNull();
    expect(
      screen.getByText('Закупочные цены и маржа скрыты для вашей роли.'),
    ).toBeTruthy();
    expect(screen.getByText(/только для просмотра/)).toBeTruthy();
  });

  it('has no axe violations', async () => {
    await signInAs('firuz', 'store-1');
    const { container } = renderWithProviders(<StockPage />);
    await screen.findByRole('table', { name: 'Остатки по партиям' });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('GoodsReceiptsPage', () => {
  it('posts a draft receipt: the stock of the store grows', async () => {
    await signInAs('manizha', 'store-1');
    const before = await stockOf('store-1', 'Физраствор');
    renderWithProviders(<GoodsReceiptsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'ПР-000124' }));
    const editor = await dialog('Приход ПР-000124');
    expect(
      await within(editor).findByText(/Цена отличается от заказа: \+8 %/),
    ).toBeTruthy();
    fireEvent.click(within(editor).getByRole('button', { name: 'Провести' }));
    expect(await within(editor).findByText('Проведён')).toBeTruthy();
    expect(await stockOf('store-1', 'Физраствор')).toBe(before + 100);
  });

  it('blocks unposting when the batch already moved', async () => {
    await signInAs('manizha', 'store-1');
    renderWithProviders(<GoodsReceiptsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'ПР-000122' }));
    const editor = await dialog('Приход ПР-000122');
    fireEvent.click(
      within(editor).getByRole('button', { name: 'Отменить проведение' }),
    );
    const unpost = await dialog('Отмена проведения');
    expect(
      await within(unpost).findByText('Отмена заблокирована'),
    ).toBeTruthy();
    expect(within(unpost).getByText(/партии A-1187.*ПМ-000044/)).toBeTruthy();
    expect(
      (
        within(unpost).getByRole('button', {
          name: 'Отменить проведение',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('requires the supplier, the invoice and lines before posting', async () => {
    await signInAs('manizha', 'store-1');
    renderWithProviders(<GoodsReceiptsPage />);
    await clickWhenEnabled('Новый приход');
    const editor = await dialog('Новый приход');
    fireEvent.click(within(editor).getByRole('button', { name: 'Провести' }));
    expect(within(editor).getByText('Укажите поставщика')).toBeTruthy();
    expect(within(editor).getByText('Укажите номер накладной')).toBeTruthy();
    expect(
      within(editor).getByText('Добавьте хотя бы одну строку'),
    ).toBeTruthy();
  });
});

describe('WriteOffsPage', () => {
  it('adds the expired batches of the store and posts the write-off', async () => {
    await signInAs('manizha', 'store-3');
    const before = await stockOf('store-3', 'Парацетамол');
    renderWithProviders(<WriteOffsPage />);
    await clickWhenEnabled('Новое списание');
    const editor = await dialog('Новое списание');
    fireEvent.change(within(editor).getByLabelText(/^Точка/), {
      target: { value: 'store-3' },
    });
    await waitFor(() =>
      expect(
        (
          within(editor).getByRole('button', {
            name: 'Добавить просроченные партии',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(
      within(editor).getByRole('button', {
        name: 'Добавить просроченные партии',
      }),
    );
    expect(
      await within(editor).findByText('Парацетамол 500 мг, таб. №10'),
    ).toBeTruthy();
    expect(within(editor).getByText('Просрочена')).toBeTruthy();
    fireEvent.click(within(editor).getByRole('button', { name: 'Провести' }));
    expect(await within(editor).findByText('Проведён')).toBeTruthy();
    // P-2201: 30 pieces = 3 packs written off
    expect(await stockOf('store-3', 'Парацетамол')).toBe(before - 30);
  });
});

describe('SupplierReturnsPage', () => {
  it('posts a return and sends the claim', async () => {
    await signInAs('manizha', 'store-1');
    renderWithProviders(<SupplierReturnsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'ВП-000012' }));
    const editor = await dialog('Возврат поставщику ВП-000012');
    await within(editor).findByText('Ибуфен сусп. 100 мг/5 мл, 100 мл');
    fireEvent.click(within(editor).getByRole('button', { name: 'Провести' }));
    expect(await within(editor).findByText('Проведён')).toBeTruthy();
    expect(within(editor).getByText('Отправлена')).toBeTruthy();
  });
});

describe('StockCountsPage', () => {
  it('posts a count: shortage against book minus sold since the start', async () => {
    await signInAs('manizha', 'store-3');
    const before = await stockOf('store-3', 'Нурофен 200');
    renderWithProviders(<StockCountsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'ИН-000007' }));
    const editor = await dialog('Инвентаризация ИН-000007');
    fireEvent.click(within(editor).getByRole('button', { name: 'Провести' }));
    expect(within(editor).getByText(/не заполнено: 1/)).toBeTruthy();
    fireEvent.change(
      within(editor).getByLabelText(
        'Факт: Ибупрофен 200 мг, таб. №20, партия I-3301',
      ),
      {
        target: { value: '440' },
      },
    );
    fireEvent.click(within(editor).getByRole('button', { name: 'Провести' }));
    const confirm = await dialog('Провести инвентаризацию?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Провести' }));
    expect(await within(editor).findByText('Проведён')).toBeTruthy();
    // Нурофен: book 180 − sold 10 = 170 expected, counted 150 → −20
    expect(await stockOf('store-3', 'Нурофен 200')).toBe(before - 20);
  });
});

describe('TransfersPage', () => {
  it('accepts a transfer with a shortage and resends the missing packs', async () => {
    await signInAs('manizha', 'store-3');
    renderWithProviders(<TransfersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'ПМ-000015' }));
    const card = await dialog('Перемещение ПМ-000015');
    fireEvent.change(
      await within(card).findByLabelText('Принято: Нурофен 200 мг, таб. №10'),
      {
        target: { value: '18' },
      },
    );
    fireEvent.click(
      within(card).getByRole('button', { name: 'Подтвердить приёмку' }),
    );
    expect(await within(card).findByText('Расхождение: −2 уп.')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Дослать' }));
    expect(
      await within(card).findByText(/Создано перемещение ПМ-000016/),
    ).toBeTruthy();
  });

  it('picks a request by FEFO within the sender stock', async () => {
    await signInAs('manizha', 'store-1');
    renderWithProviders(<TransfersPage />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Собрать заявку ЗП-000007' }),
    );
    const picking = await dialog('Сборка по заявке ЗП-000007');
    expect(
      await within(picking).findByText('Парацетамол 500 мг, таб. №10'),
    ).toBeTruthy();
    fireEvent.click(within(picking).getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // the request goes «в работе» and a new transfer appears in transit
    expect(
      await screen.findByRole('button', { name: 'ПМ-000016' }),
    ).toBeTruthy();
    expect(screen.getAllByText('В работе').length).toBeGreaterThan(0);
  });
});

describe('Offline store', () => {
  it('keeps the stock of an offline store read-only in the cloud', async () => {
    await signInAs('firuz', 'store-4');
    renderWithProviders(<WriteOffsPage />);
    expect(
      await screen.findByText(/Склад офлайн-точки в облаке — только просмотр/),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Новое списание',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
