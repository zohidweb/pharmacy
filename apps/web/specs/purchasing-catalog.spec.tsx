/*
 * Purchasing and catalog screens against the in-memory API mocks: an order filled by the deficit
 * and confirmed, a goods receipt opened from an order, supplier debts by due date and an idempotent
 * payment, the product card, store prices with the regulated maximum, discount rules by scope and
 * price conflicts of an offline store.
 */
import { formatMoney, uuidv7 } from '@pharmacy/shared-util';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { CatalogPage, ProductPage } from '@/pages/catalog';
import { OrdersPage } from '@/pages/orders';
import { PricingPage } from '@/pages/pricing';
import { SuppliersPage } from '@/pages/suppliers';
import { mockApi, signInAs, signInByPin, useMockApi } from './mock-env';
import { renderWithProviders } from './test-utils';

const push = jest.fn();
let searchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/orders',
  useSearchParams: () => searchParams,
}));

useMockApi();

beforeEach(() => {
  push.mockReset();
  searchParams = new URLSearchParams();
});

/** Testing Library collapses the narrow spaces of money into plain ones. */
const money = (minor: number) => formatMoney(minor, { plainSpaces: true });

const dialog = (name: string | RegExp) => screen.findByRole('dialog', { name });

async function clickWhenEnabled(
  name: string | RegExp,
  scope: Pick<typeof screen, 'findByRole'> = screen,
) {
  const button = (await scope.findByRole('button', {
    name,
  })) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}

describe('OrdersPage', () => {
  it('fills a new order by the deficit and confirms it', async () => {
    await signInAs('manizha', 'store-1');
    renderWithProviders(<OrdersPage />);
    await screen.findByRole('table', { name: 'Заказы' });
    await clickWhenEnabled('Новый заказ');
    const editor = await dialog('Новый заказ');
    fireEvent.change(
      await within(editor).findByRole('combobox', { name: /Поставщик/ }),
      { target: { value: 'sup-dori' } },
    );
    fireEvent.click(
      within(editor).getByRole('button', { name: 'Заполнить по дефициту' }),
    );
    // Ибупрофен 400 мг has no stock at all: minimum 10 + 48 sold in 30 days
    expect(
      await within(editor).findByText(/^Добавлен.* по дефициту/),
    ).toBeTruthy();
    const quantity = within(editor).getByRole('textbox', {
      name: 'Количество упаковок: Ибупрофен 400 мг, таб. №20',
    }) as HTMLInputElement;
    expect(quantity.value).toBe('58');
    // never bought: no last price, an order is not confirmed without one
    fireEvent.click(
      within(editor).getByRole('button', { name: 'Подтвердить заказ' }),
    );
    expect(
      await within(editor).findByText(/Укажите цену в заказе больше нуля/),
    ).toBeTruthy();
    fireEvent.change(
      within(editor).getByRole('textbox', {
        name: 'Цена в заказе: Ибупрофен 400 мг, таб. №20',
      }),
      { target: { value: '7,60' } },
    );
    fireEvent.click(
      within(editor).getByRole('button', { name: 'Подтвердить заказ' }),
    );
    expect(
      await within(editor).findByRole('heading', { name: /Заказ ЗК-000089/ }),
    ).toBeTruthy();
    expect(within(editor).getByText('Подтверждён')).toBeTruthy();
    // a confirmed order is not edited any more
    expect(quantity.disabled).toBe(true);
  });

  it('opens the goods receipt of a confirmed order with its lines', async () => {
    await signInAs('manizha', 'store-3');
    renderWithProviders(<OrdersPage />);
    const table = await screen.findByRole('table', { name: 'Заказы' });
    const row = within(table).getByText('ЗК-000085').closest('tr');
    if (!row) throw new Error('no order row');
    fireEvent.click(
      within(row).getByRole('button', { name: 'Оформить приход' }),
    );
    const receipt = await dialog('Новый приход');
    const quantity = (await within(receipt).findByRole('textbox', {
      name: 'Количество: Нурофен 200 мг, таб. №10',
    })) as HTMLInputElement;
    expect(quantity.value).toBe('30');
    expect(
      (
        within(receipt).getByRole('combobox', {
          name: /Поставщик/,
        }) as HTMLSelectElement
      ).value,
    ).toBe('sup-sino');
  });

  it('closes an order once its receipt covers every line', async () => {
    await signInAs('manizha', 'store-3');
    const api = mockApi();
    const created = await api(
      'goodsReceipts.create',
      {
        body: {
          date: '2026-09-21',
          supplierId: 'sup-sino',
          storeId: 'store-3',
          orderId: 'po-85',
          invoiceNumber: 'SF-1',
          paymentDueOn: null,
          lines: [
            {
              productId: 'p-nurofen',
              batchNumber: 'N-5000',
              expiresOn: '2030-01-01',
              quantity: 30,
              orderPriceMinor: 1_250,
              costMinor: 1_250,
              retailPriceMinor: 1_900,
            },
          ],
        },
      },
      'test',
    );
    await api('goodsReceipts.post', { params: { id: created.id } }, 'test');
    const order = await api(
      'purchaseOrders.get',
      { params: { id: 'po-85' } },
      'test',
    );
    expect(order.status).toBe('closed');
    expect(order.receivedPercent).toBe(100);
  });

  it('hides orders from a cashier and has no axe violations', async () => {
    await signInByPin('emp-cashier', '2580');
    await expect(
      mockApi()('purchaseOrders.list', { query: {} }, 'test'),
    ).rejects.toMatchObject({ status: 403 });

    await signInAs('firuz', 'store-1');
    const { container } = renderWithProviders(<OrdersPage />);
    await screen.findByRole('table', { name: 'Заказы' });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('SuppliersPage', () => {
  it('shows debts by due date and pays the overdue one', async () => {
    await signInAs('firuz', 'store-1');
    renderWithProviders(<SuppliersPage />);
    expect(await screen.findByText(money(3_892_000))).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Поставщики' });
    const sino = within(table).getByText('Сино-Фарм').closest('tr');
    if (!sino) throw new Error('no supplier row');
    expect(within(sino).getByText('Просрочено 11 дней')).toBeTruthy();

    fireEvent.click(within(sino).getByRole('button', { name: 'Оплатить' }));
    const pay = await dialog('Оплата поставщику');
    fireEvent.click(
      within(pay).getByRole('button', { name: 'Провести оплату' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Оплата поставщику' }),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(within(sino).getByText('Без долга')).toBeTruthy(),
    );
    expect(await screen.findByText(money(3_282_000))).toBeTruthy();
  });

  it('does not pay twice with the same idempotency key', async () => {
    await signInAs('firuz', 'store-1');
    const api = mockApi();
    const body = {
      id: uuidv7(),
      amountMinor: 100_000,
      date: '2026-09-21',
      method: 'bank' as const,
      comment: '',
    };
    const first = await api(
      'suppliers.pay',
      { params: { id: 'sup-dori' }, body },
      'test',
    );
    const again = await api(
      'suppliers.pay',
      { params: { id: 'sup-dori' }, body },
      'test',
    );
    expect(again).toEqual(first);
    const card = await api(
      'suppliers.get',
      { params: { id: 'sup-dori' } },
      'test',
    );
    expect(card.debtMinor).toBe(2_042_000 - 100_000);
    await expect(
      api(
        'suppliers.pay',
        { params: { id: 'sup-dori' }, body: { ...body, amountMinor: 1 } },
        'test',
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('shows the ledger of a supplier card', async () => {
    await signInAs('firuz', 'store-1');
    renderWithProviders(<SuppliersPage />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'ООО «Фарм-Импорт»' }),
    );
    const card = await dialog('ООО «Фарм-Импорт»');
    const ledger = await within(card).findByRole('table', { name: 'Расчёты' });
    expect(
      within(ledger).getByText('Приход · ПР-000078 · Аптека №1 · Центр'),
    ).toBeTruthy();
    expect(within(ledger).getAllByText(/^Оплата · /)).toHaveLength(2);
  });
});

describe('CatalogPage and ProductPage', () => {
  it('lists the catalog with flags and the duplicates of an offline store', async () => {
    await signInAs('firuz', 'store-1');
    const { container } = renderWithProviders(<CatalogPage />);
    const table = await screen.findByRole('table', { name: 'Каталог товаров' });
    const row = within(table)
      .getByRole('link', { name: 'Трамадол 50 мг, капс. №20' })
      .closest('tr');
    if (!row) throw new Error('no product row');
    expect(within(row).getByText('ПКУ')).toBeTruthy();
    const duplicates = await screen.findByRole('table', {
      name: 'Дубли товаров с офлайн-точек',
    });
    expect(within(duplicates).getAllByText('Ждёт решения точки')).toHaveLength(
      2,
    );
    // the store decides a duplicate (ADR-0014): no merge buttons in the cloud
    expect(within(duplicates).queryByRole('button')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('creates a product and opens its card', async () => {
    await signInAs('firuz', 'store-1');
    renderWithProviders(<CatalogPage />);
    await clickWhenEnabled('Новый товар');
    const editor = await dialog('Новый товар');
    fireEvent.click(within(editor).getByRole('button', { name: 'Сохранить' }));
    expect(
      await within(editor).findByText('Укажите наименование'),
    ).toBeTruthy();
    fireEvent.change(
      within(editor).getByRole('textbox', { name: /Наименование \(RU\)/ }),
      {
        target: { value: 'Цетиризин 10 мг, таб. №10' },
      },
    );
    const barcode = within(editor).getByRole('textbox', {
      name: 'Отсканируйте или введите штрихкод',
    });
    fireEvent.change(barcode, { target: { value: '4870001000017' } });
    fireEvent.keyDown(barcode, { key: 'Enter' });
    fireEvent.click(within(editor).getByRole('button', { name: 'Сохранить' }));
    // the barcode belongs to Парацетамол
    expect(await within(editor).findByRole('alert')).toBeTruthy();
    fireEvent.click(
      within(editor).getByRole('button', {
        name: 'Удалить штрихкод 4870001000017',
      }),
    );
    fireEvent.change(barcode, { target: { value: '4870009990011' } });
    fireEvent.keyDown(barcode, { key: 'Enter' });
    fireEvent.click(within(editor).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/catalog/view?id=p-new-1'),
    );
    const found = await mockApi()(
      'catalog.list',
      { query: { q: '4870009990011' } },
      'test',
    );
    expect(found.items.map((p) => p.name)).toEqual([
      'Цетиризин 10 мг, таб. №10',
    ]);
  });

  it('shows the prices of the stores with the regulated maximum', async () => {
    await signInAs('firuz', 'store-1');
    searchParams = new URLSearchParams({ id: 'p-paracetamol' });
    renderWithProviders(<ProductPage />);
    await screen.findByRole('heading', { name: 'Розничные цены по точкам' });
    // the prices come from GET /prices/{id}, after the card itself
    expect(await screen.findByText('Выше предельной')).toBeTruthy();
    expect(screen.getByText(`Предельная цена: ${money(500)}`)).toBeTruthy();
    const nameTj = (await screen.findByRole('textbox', {
      name: /Наименование \(TJ\)/,
    })) as HTMLInputElement;
    expect(nameTj.value).toBe('Парасетамол 500 мг, лавҳа №10');
  });
});

describe('PricingPage', () => {
  it('asks to confirm a price above the regulated maximum', async () => {
    await signInAs('manizha', 'store-1');
    renderWithProviders(<PricingPage />);
    const table = await screen.findByRole('table', { name: 'Цены по точкам' });
    const row = within(table)
      .getByText('Парацетамол 500 мг, таб. №10')
      .closest('tr');
    if (!row) throw new Error('no price row');
    fireEvent.click(within(row).getByRole('button', { name: 'Изменить' }));
    const edit = await dialog('Изменение цены');
    fireEvent.change(
      within(edit).getByRole('textbox', {
        name: 'Новая цена: Аптека №1 · Центр',
      }),
      { target: { value: '5,50' } },
    );
    expect(within(edit).getByText('Выше предельной')).toBeTruthy();
    const save = within(edit).getByRole('button', {
      name: 'Сохранить цены',
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(
      within(edit).getByRole('checkbox', {
        name: /Подтверждаю цену выше предельной/,
      }),
    );
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Изменение цены' }),
      ).toBeNull(),
    );
    // the POS of the store sells at the new price
    const snapshot = await mockApi()(
      'catalog.snapshot',
      { params: { storeId: 'store-1' }, query: {} },
      'test',
    );
    expect(
      snapshot.products.find((p) => p.id === 'p-paracetamol')?.priceMinor,
    ).toBe(550);
  });

  it('lets a manager create a rule only for own stores', async () => {
    await signInAs('manizha', 'store-1');
    renderWithProviders(<PricingPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Правила скидок' }));
    await clickWhenEnabled('Новое правило');
    const rule = await dialog('Новое правило');
    const network = within(rule).getByRole('switch', {
      name: /Вся сеть/,
    }) as HTMLInputElement;
    expect(network.disabled).toBe(true);
    fireEvent.change(within(rule).getByRole('textbox', { name: /Название/ }), {
      target: { value: 'Акция Центр' },
    });
    fireEvent.click(
      within(rule).getByRole('checkbox', { name: 'Аптека №1 · Центр' }),
    );
    fireEvent.click(within(rule).getByRole('button', { name: 'Сохранить' }));
    const rules = await screen.findByRole('table', { name: 'Правила скидок' });
    expect(await within(rules).findByText('Акция Центр')).toBeTruthy();
    // a network rule needs discounts:manage-network
    await expect(
      mockApi()(
        'discountRules.create',
        {
          body: {
            name: 'Сеть',
            storeIds: null,
            thresholds: [{ minSubtotalMinor: 10_000, percent: 2 }],
            period: null,
          },
        },
        'test',
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('lets the owner resolve a price conflict of an offline store', async () => {
    await signInAs('firuz', 'store-1');
    renderWithProviders(<PricingPage />);
    fireEvent.click(await screen.findByRole('tab', { name: /Конфликты цен/ }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Оставить облачную цену: Витамин D3 2000 МЕ, капс. №60',
      }),
    );
    expect(await screen.findByText('Конфликтов цен нет')).toBeTruthy();
  });
});
