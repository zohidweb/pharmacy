/*
 * Screen tests of «Компании», «Компания», «Точка» and «Новая компания» against the in-memory
 * API mocks (same routes and problem codes as apps/api).
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { CompaniesPage } from '@/pages/companies';
import { CompanyPage } from '@/pages/company';
import { CompanyCreatePage } from '@/pages/company-create';
import { StorePage } from '@/pages/store';
import {
  loadMockTransport,
  resetApiMocks,
  setApiTransport,
} from '@/shared/api';
import { renderWithProviders } from './test-utils';

const push = jest.fn();
let searchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/companies',
  useSearchParams: () => searchParams,
  notFound: jest.fn(),
}));

beforeAll(async () => {
  setApiTransport(await loadMockTransport());
});

beforeEach(async () => {
  await resetApiMocks();
  push.mockClear();
  searchParams = new URLSearchParams();
});

describe('CompaniesPage', () => {
  it('lists companies with status and filter counts from the API', async () => {
    renderWithProviders(<CompaniesPage />);
    const table = await screen.findByRole('table', { name: 'Компании' });

    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('Не оплачено')).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: /^Все 3$/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: /^Не оплачено 1$/ }),
    ).toBeTruthy();
  });

  it('filters by status and searches by owner', async () => {
    renderWithProviders(<CompaniesPage />);
    await screen.findByRole('table', { name: 'Компании' });

    fireEvent.click(screen.getByRole('button', { name: /^Не оплачено 1$/ }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('table', { name: 'Компании' })).getAllByRole(
          'row',
        ),
      ).toHaveLength(2),
    );
    expect(screen.getByText('Пример Мед')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Все/ }));
    fireEvent.change(
      screen.getByRole('searchbox', {
        name: 'Поиск по компаниям и владельцам',
      }),
      {
        target: { value: 'Тест' },
      },
    );
    await waitFor(() => expect(screen.queryByText('Демо Фарм')).toBeNull());
    expect(screen.getByText('Тест Аптека')).toBeTruthy();
  });

  it('shows an empty state with a reset action', async () => {
    renderWithProviders(<CompaniesPage />);
    await screen.findByRole('table', { name: 'Компании' });

    fireEvent.click(
      screen.getByRole('button', { name: /^Заблокированные 0$/ }),
    );
    expect(await screen.findByText('Ничего не найдено')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Показать все' }));
    expect(await screen.findByText('Демо Фарм')).toBeTruthy();
  });

  it('offers no impersonation (ADR-0008 amendment 2026-10-05)', async () => {
    renderWithProviders(<CompaniesPage />);
    expect(await screen.findByText('Демо Фарм')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Войти от имени/ })).toBeNull();
  });
});

describe('CompanyPage', () => {
  it('shows the company with its stores and derived store statuses', async () => {
    searchParams = new URLSearchParams('id=t-1');
    renderWithProviders(<CompanyPage />);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Демо Фарм' }),
    ).toBeTruthy();
    const stores = await screen.findByRole('table', { name: 'Точки компании' });
    expect(within(stores).getAllByRole('row')).toHaveLength(6);
    expect(within(stores).getByText('Закрыта 08.09.2026')).toBeTruthy();
  });

  it('blocks with a reason and unblocks', async () => {
    searchParams = new URLSearchParams('id=t-3');
    renderWithProviders(<CompanyPage />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Заблокировать' }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Заблокировать «Тест Аптека»?',
    });
    fireEvent.input(within(dialog).getByLabelText('Причина'), {
      target: { value: 'Расторжение договора' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Заблокировать' }),
    );

    expect(
      await screen.findByText('Компания заблокирована', { selector: 'p' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Разблокировать' })).toBeTruthy();
  });

  it('switches tabs and loads their data', async () => {
    searchParams = new URLSearchParams('id=t-1');
    renderWithProviders(<CompanyPage />);

    fireEvent.click(
      await screen.findByRole('tab', { name: 'Счета и платежи' }),
    );
    expect(await screen.findByText('СЧ-2026-09-001')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Аудит' }));
    expect(
      await screen.findByText('Принята накладная поставщика'),
    ).toBeTruthy();
  });

  it('reports an unknown company', async () => {
    searchParams = new URLSearchParams('id=missing');
    renderWithProviders(<CompanyPage />);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Запись не найдена',
    );
  });
});

describe('StorePage', () => {
  it('shows an offline store with key status, queue and license settings', async () => {
    searchParams = new URLSearchParams('id=s-103');
    renderWithProviders(<StorePage />);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Демо Фарм №3' }),
    ).toBeTruthy();
    expect(screen.getByDisplayValue('DMO-0001-TEST-2026')).toBeTruthy();
    expect(screen.getByText('148')).toBeTruthy();
    expect(
      screen.getByRole('table', { name: 'История синхронизаций' }),
    ).toBeTruthy();
  });

  it('refuses cloud migration while the sync queue is not empty', async () => {
    searchParams = new URLSearchParams('id=s-103');
    renderWithProviders(<StorePage />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Перевести в облако' }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Перевести точку в облако',
    });
    fireEvent.change(within(dialog).getByLabelText(/Оплачено до/), {
      target: { value: '2099-12-31' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Начать перевод' }),
    );

    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'неотправленные операции',
    );
  });

  it('validates and saves store parameters', async () => {
    searchParams = new URLSearchParams('id=s-101');
    renderWithProviders(<StorePage />);
    const phone = await screen.findByLabelText('Телефон заведующей');

    fireEvent.input(phone, { target: { value: '12345' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Сохранить' })[0]);
    expect(
      await screen.findByText('Телефон в формате +992 00 000 00 00'),
    ).toBeTruthy();

    fireEvent.input(phone, { target: { value: '+992 00 000 00 99' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Сохранить' })[0]);
    expect(await screen.findByText('Параметры точки сохранены')).toBeTruthy();
  });
});

describe('CompanyCreatePage', () => {
  const fill = (label: string | RegExp, value: string) =>
    fireEvent.input(screen.getByLabelText(label), { target: { value } });

  const fillValid = (overrides: Partial<Record<string, string>> = {}) => {
    const values: Record<string, string> = {
      'Название сети или аптеки': 'Новая Демо Аптека',
      Город: 'Куляб',
      ИНН: '000000099',
      'ФИО владельца': 'Владелец Новый',
      'Телефон владельца': '+992 00 000 00 50',
      'Логин владельца': 'owner9',
      ...overrides,
    };
    for (const [label, value] of Object.entries(values)) fill(label, value);
  };

  it('validates the form and shows the owner code once after creating', async () => {
    renderWithProviders(<CompanyCreatePage />);

    fireEvent.click(screen.getByRole('button', { name: 'Создать компанию' }));
    expect(
      (await screen.findAllByText('Заполните поле')).length,
    ).toBeGreaterThan(0);

    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Создать компанию' }));

    expect(
      await screen.findByRole('heading', { name: 'Код активации владельца' }),
    ).toBeTruthy();
    expect(screen.getByLabelText('Код активации').textContent).toBe(
      'MOCK-ACTI-VATI-ONCO-DE00-0000-00',
    );
    expect(
      screen.getByRole('link', { name: 'Перейти к компании' }).getAttribute('href'),
    ).toMatch(/^\/companies\/view\?id=t-/);
  });

  it('marks the INN when it is taken', async () => {
    renderWithProviders(<CompanyCreatePage />);
    fillValid({ ИНН: '000000001', 'Логин владельца': 'owner10' });
    fireEvent.click(screen.getByRole('button', { name: 'Создать компанию' }));

    expect(
      await screen.findByText('Компания с таким ИНН уже есть'),
    ).toBeTruthy();
    expect(screen.getByLabelText('ИНН').getAttribute('aria-invalid')).toBe(
      'true',
    );
  });
});
