/*
 * Screen tests of «Счета и платежи», «Услуги», «Лицензионные ключи», «Версии установок» against
 * the in-memory API mocks.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { BillingPage } from '@/pages/billing';
import { InstallationsPage } from '@/pages/installations';
import { LicensesPage } from '@/pages/licenses';
import { ServicesPage } from '@/pages/services';
import {
  loadMockTransport,
  resetApiMocks,
  setApiTransport,
} from '@/shared/api';
import { renderWithProviders } from './test-utils';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/billing',
  useSearchParams: () => new URLSearchParams(),
  notFound: jest.fn(),
}));

beforeAll(async () => {
  setApiTransport(await loadMockTransport());
});

beforeEach(async () => {
  await resetApiMocks();
  jest.useFakeTimers({
    now: new Date('2026-10-01T06:00:00Z'),
    doNotFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'queueMicrotask',
    ],
  });
});

afterEach(() => jest.useRealTimers());

const WIDE_SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, 'g');
const plain = (text: string | null) => (text ?? '').replace(WIDE_SPACES, ' ');

describe('BillingPage', () => {
  it('shows period KPIs and invoices with VAT as a separate column', async () => {
    renderWithProviders(<BillingPage />);

    expect(await screen.findByText('Выставлено за период')).toBeTruthy();
    const table = await screen.findByRole('table', { name: 'Счета' });
    expect(within(table).getByText('СЧ-2026-09-003')).toBeTruthy();
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(expect.arrayContaining(['Без НДС, с', 'НДС, с', 'Итого, с']));
  });

  it('filters overdue invoices', async () => {
    renderWithProviders(<BillingPage />);
    await screen.findByRole('table', { name: 'Счета' });

    fireEvent.click(screen.getByRole('button', { name: /^Просрочены 1$/ }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('table', { name: 'Счета' })).getAllByRole(
          'row',
        ),
      ).toHaveLength(2),
    );
  });

  it('records a payment for an overdue invoice with an idempotency key and marks it paid', async () => {
    renderWithProviders(<BillingPage />);
    await screen.findByRole('table', { name: 'Счета' });

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Зафиксировать платёж' })[0],
    );
    const dialog = screen.getByRole('dialog', { name: 'Зафиксировать платёж' });
    const invoice = await within(dialog).findByRole('combobox', {
      name: /Счёт/,
    });
    const option = within(invoice).getByRole('option', {
      name: /СЧ-2026-09-003/,
    }) as HTMLOptionElement;
    fireEvent.change(invoice, { target: { value: option.value } });
    expect(
      plain((within(dialog).getByLabelText(/Сумма/) as HTMLInputElement).value),
    ).toBe('174,80');

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Зафиксировать' }),
    );
    expect(
      plain((await screen.findByText(/Платёж .* зафиксирован/)).textContent),
    ).toBe('Платёж 174,80 с зафиксирован');
    await waitFor(() => {
      const row = within(screen.getByRole('table', { name: 'Счета' }))
        .getByText('СЧ-2026-09-003')
        .closest('tr');
      expect(row?.textContent).toContain('Оплачен');
    });
  });

  it('rejects a payment date in the future', async () => {
    renderWithProviders(<BillingPage />);
    await screen.findByRole('table', { name: 'Счета' });

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Зафиксировать платёж' })[0],
    );
    const dialog = screen.getByRole('dialog', { name: 'Зафиксировать платёж' });
    const invoice = await within(dialog).findByRole('combobox', {
      name: /Счёт/,
    });
    fireEvent.change(invoice, { target: { value: 'inv-4' } });
    fireEvent.input(within(dialog).getByLabelText('Дата платежа'), {
      target: { value: '2026-12-31' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Зафиксировать' }),
    );

    expect(
      await within(dialog).findByText('Дата платежа не может быть в будущем'),
    ).toBeTruthy();
  });

  it('cancels a payment with a reason and keeps it in the list', async () => {
    renderWithProviders(<BillingPage />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Открыть платёж по счёту СЧ-2026-09-001',
      }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Платёж по счёту СЧ-2026-09-001',
    });

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Отменить платёж' }),
    );
    const confirm = within(dialog).getByRole('button', {
      name: 'Отменить платёж',
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Причина отмены/), {
      target: { value: 'Ошибочно зачислен' },
    });
    fireEvent.click(confirm);

    expect(await screen.findByText('Платёж отменён')).toBeTruthy();
    await waitFor(() =>
      expect(
        within(screen.getByRole('table', { name: 'Платежи' })).getByText(
          'Отменён',
        ),
      ).toBeTruthy(),
    );
  });

  it('allows invoice generation only for a closed period', async () => {
    renderWithProviders(<BillingPage />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Сформировать счета' }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Сформировать счета за период',
    });

    fireEvent.click(within(dialog).getByRole('button', { name: '10.2026' }));
    expect(await within(dialog).findByText(/Период ещё идёт/)).toBeTruthy();
    expect(
      (
        within(dialog).getByRole('button', {
          name: 'Сформировать',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('shows invoice lines with proration days and the VAT line', async () => {
    renderWithProviders(<BillingPage />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Открыть счёт СЧ-2026-09-003',
      }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Счёт СЧ-2026-09-003' });

    expect(
      await within(dialog).findByText('Пример Мед — склад — 8 дней'),
    ).toBeTruthy();
    expect(within(dialog).getByText('НДС 15%')).toBeTruthy();
  });
});

describe('ServicesPage', () => {
  it('approves a request and removes it from the list', async () => {
    renderWithProviders(<ServicesPage />);
    const approve = await screen.findAllByRole('button', {
      name: 'Подтвердить',
    });

    fireEvent.click(approve[0]);
    expect(
      await screen.findByText('Услуга «Расширенная аналитика» подключена'),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: 'Подтвердить' }),
      ).toHaveLength(1),
    );
  });

  it('requires a reason to reject', async () => {
    renderWithProviders(<ServicesPage />);
    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Отклонить' }))[0],
    );
    const dialog = screen.getByRole('dialog', { name: 'Отклонить запрос?' });
    const confirm = within(dialog).getByRole('button', {
      name: 'Отклонить',
    }) as HTMLButtonElement;

    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Причина/), {
      target: { value: 'Нет договора' },
    });
    expect(confirm.disabled).toBe(false);
  });

  it('adds a monthly service to the catalog', async () => {
    renderWithProviders(<ServicesPage />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Добавить услугу' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Новая услуга' });

    fireEvent.input(within(dialog).getByLabelText(/Название/), {
      target: { value: 'Обучение персонала' },
    });
    fireEvent.input(within(dialog).getByLabelText(/Описание/), {
      target: { value: 'Два занятия для кассиров' },
    });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Ежемесячная/ }));
    fireEvent.input(within(dialog).getByLabelText(/Цена в месяц/), {
      target: { value: '50' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Обучение персонала')).toBeTruthy();
    expect(plain(screen.getByText('50,00 с / мес').textContent)).toBe(
      '50,00 с / мес',
    );
  });
});

describe('LicensesPage', () => {
  it('derives statuses and filters keys that expire soon', async () => {
    renderWithProviders(<LicensesPage />);
    const table = await screen.findByRole('table', {
      name: 'Лицензионные ключи',
    });

    expect(within(table).getByText('Истекает через 7 дней')).toBeTruthy();
    expect(within(table).getByText('Отозван')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Истекают 1$/ }));
    await waitFor(() =>
      expect(
        within(
          screen.getByRole('table', { name: 'Лицензионные ключи' }),
        ).getAllByRole('row'),
      ).toHaveLength(2),
    );
  });

  it('renews a key for a year', async () => {
    renderWithProviders(<LicensesPage />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Продлить ключ DMO-0001-TEST-2026',
      }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Продлить лицензионный ключ',
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Продлить' }));
    expect(await screen.findByText('Ключ продлён до 01.10.2027')).toBeTruthy();
  });

  it('offers only stores without an active key when issuing', async () => {
    renderWithProviders(<LicensesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Выдать ключ' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Выдать лицензионный ключ',
    });
    const select = await within(dialog).findByRole('combobox', {
      name: /Офлайн-точка/,
    });

    await waitFor(() =>
      expect(within(select).getAllByRole('option').length).toBeGreaterThan(1),
    );
    for (const option of within(select)
      .getAllByRole('option')
      .slice(1) as HTMLOptionElement[]) {
      expect(option.disabled).toBe(true);
    }
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Выдать ключ' }),
    );
    expect(
      await within(dialog).findByText('Выберите точку', { selector: 'span' }),
    ).toBeTruthy();
  });
});

describe('InstallationsPage', () => {
  it('shows version states and schedules an update in Dushanbe time', async () => {
    renderWithProviders(<InstallationsPage />);
    const table = await screen.findByRole('table', {
      name: 'Офлайн-установки',
    });
    expect(within(table).getByText('Отстаёт на 1 версию')).toBeTruthy();
    expect(within(table).getByText('Поддержка до 01.12.2026')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Запланировать обновление точки Демо Фарм №3',
      }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Запланировать обновление',
    });
    fireEvent.change(within(dialog).getByLabelText(/Дата/), {
      target: { value: '2026-10-05' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Способ подключения/), {
      target: { value: 'Удалённый доступ' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Запланировать' }),
    );

    expect(
      await screen.findByText('Обновление запланировано на 05.10.2026, 20:00'),
    ).toBeTruthy();
  });
});
