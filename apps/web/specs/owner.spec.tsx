/*
 * Owner cabinet against the in-memory API mocks: stores (a new one waits for activation, a closing
 * one moves its stock by a transfer), employees and roles without escalation (ADR-0018), reports
 * with cost only by permission, the 1C export with article mapping, the read-only audit log,
 * network settings that reach the POS, and the offline store (ADR-0014).
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { EmployeesPage } from '@/pages/owner/employees';
import { OfflinePage } from '@/pages/owner/offline';
import { ReportsPage } from '@/pages/owner/reports';
import { SettingsPage } from '@/pages/owner/settings';
import { StoresPage } from '@/pages/owner/stores';
import { AuditLogPage } from '@/pages/owner/audit-log';
import {
  MOCK_PASSWORD,
  mockApi,
  scenario,
  signInAs,
  useMockApi,
} from './mock-env';
import { renderWithProviders } from './test-utils';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/stores',
  useSearchParams: () => new URLSearchParams(),
}));

useMockApi();

const dialog = (name: string | RegExp) => screen.findByRole('dialog', { name });

async function clickWhenEnabled(name: string | RegExp) {
  const button = (await screen.findByRole('button', {
    name,
  })) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}

describe('StoresPage', () => {
  it('lists the stores with a closed one and creates a store waiting for activation', async () => {
    await signInAs('firuz', 'store-1');
    const { container } = renderWithProviders(<StoresPage />);
    const table = await screen.findByRole('table', { name: 'Точки' });
    expect(within(table).getByText('Аптека №5 · Хуҷанд')).toBeTruthy();
    expect(within(table).getAllByText('Закрыта')).toHaveLength(1);
    expect(await axe(container)).toHaveNoViolations();

    await clickWhenEnabled('Добавить точку');
    const form = await dialog('Новая точка');
    fireEvent.click(
      within(form).getByRole('button', { name: 'Создать точку' }),
    );
    expect(await within(form).findByText('Укажите название')).toBeTruthy();
    fireEvent.change(within(form).getByRole('textbox', { name: /Название/ }), {
      target: { value: 'Аптека №6 · Турсунзода' },
    });
    fireEvent.change(within(form).getByRole('textbox', { name: /Адрес/ }), {
      target: { value: 'г. Турсунзода, ул. Мира, 1' },
    });
    fireEvent.click(
      within(form).getByRole('button', { name: 'Создать точку' }),
    );
    const row = (
      await within(table).findByText('Аптека №6 · Турсунзода')
    ).closest('tr');
    if (!row) throw new Error('no store row');
    expect(within(row).getByText('Ожидает активации')).toBeTruthy();
  });

  it('closes a store by a transfer of its stock, completed on acceptance', async () => {
    await signInAs('firuz', 'store-1');
    renderWithProviders(<StoresPage />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Аптека №2 · Сино' }),
    );
    const card = await dialog('Аптека №2 · Сино');
    fireEvent.click(
      within(card).getByRole('button', { name: 'Закрыть точку' }),
    );
    const closing = await dialog('Закрытие точки');
    await within(closing).findByRole('table', {
      name: 'Остатки к перемещению',
    });
    fireEvent.click(
      within(closing).getByRole('button', {
        name: 'Создать перемещение и закрыть',
      }),
    );
    const done = await within(closing).findByText(
      /Создано перемещение (ПМ-\d+)/,
    );
    const number = /ПМ-\d+/.exec(done.textContent ?? '')?.[0] ?? '';

    const api = mockApi();
    const overview = await api('transfers.overview', {}, 'test');
    const transfer = overview.transfers.find((t) => t.number === number);
    if (!transfer) throw new Error('no transfer');
    const full = await api(
      'transfers.get',
      { params: { id: transfer.id } },
      'test',
    );
    await api(
      'transfers.accept',
      {
        params: { id: transfer.id },
        body: {
          comment: '',
          lines: full.lines.map((l) => ({
            batchId: l.batchId,
            receivedQuantity: l.sentQuantity,
          })),
        },
      },
      'test',
    );
    const stores = await api('stores.overview', {}, 'test');
    expect(stores.stores.find((s) => s.id === 'store-2')?.status).toBe(
      'closed',
    );
    const session = await api('sessions.current', {}, 'test');
    expect(session.stores.map((s) => s.id)).not.toContain('store-2');
  });
});

describe('EmployeesPage', () => {
  it('creates an employee with the password policy and blocks a sign-in', async () => {
    await signInAs('firuz', 'store-1');
    renderWithProviders(<EmployeesPage />);
    await screen.findByRole('table', { name: 'Сотрудники' });
    await clickWhenEnabled('Сотрудник');
    const form = await dialog('Новый сотрудник');
    fireEvent.change(within(form).getByRole('textbox', { name: /ФИО/ }), {
      target: { value: 'Сабина Холова' },
    });
    fireEvent.change(within(form).getByRole('textbox', { name: /Логин/ }), {
      target: { value: 'sabina' },
    });
    fireEvent.change(within(form).getByLabelText(/^Пароль/), {
      target: { value: 'sabina' },
    });
    fireEvent.click(
      within(form).getByRole('checkbox', { name: 'Аптека №3 · Рудаки' }),
    );
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));
    expect(await within(form).findByText(/нужна заглавная буква/)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/^Пароль/), {
      target: { value: 'Sabina2026' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));
    const table = screen.getByRole('table', { name: 'Сотрудники' });
    expect(await within(table).findByText('Сабина Холова')).toBeTruthy();

    // a blocked employee cannot sign in
    const blocked = await mockApi()(
      'sessions.create',
      { body: { login: 'rustam', password: MOCK_PASSWORD } },
      'test',
    ).catch((error: unknown) => error);
    expect(blocked).toMatchObject({ status: 403, code: 'employee_blocked' });
  });

  it('keeps a manager within own permissions and stores (ADR-0018)', async () => {
    await signInAs('manizha', 'store-1');
    const api = mockApi();
    // the manager sees only the employees of own stores
    const list = await api('employees.list', { query: {} }, 'test');
    expect(list.items.map((e) => e.login)).not.toContain('firuz');
    await expect(
      api(
        'employees.create',
        {
          body: {
            fullName: 'Тест',
            phone: '',
            login: 'test-owner',
            password: 'Demo12345',
            pin: '',
            roleId: 'role-owner',
            storeIds: null,
            locale: 'ru',
          },
        },
        'test',
      ),
    ).rejects.toMatchObject({ status: 403, code: 'permission_escalation' });
    await expect(
      api(
        'employees.create',
        {
          body: {
            fullName: 'Тест',
            phone: '',
            login: 'test-cashier',
            password: 'Demo12345',
            pin: '',
            roleId: 'role-cashier',
            storeIds: ['store-2'],
            locale: 'ru',
          },
        },
        'test',
      ),
    ).rejects.toMatchObject({ status: 403, code: 'store_not_in_scope' });
    await expect(
      api(
        'employees.setStatus',
        { params: { id: 'emp-manager' }, body: { status: 'blocked' } },
        'test',
      ),
    ).rejects.toMatchObject({ status: 403, code: 'own_assignment' });
  });

  it('builds a role from the catalog without escalation', async () => {
    await signInAs('firuz', 'store-1');
    const api = mockApi();
    // an HR role: may manage roles, but has no network prices
    const hr = await api(
      'roles.create',
      {
        body: {
          name: 'Кадровик',
          permissions: [
            'roles:view',
            'roles:manage',
            'employees:view',
            'pos:view',
          ],
        },
      },
      'test',
    );
    await api(
      'employees.create',
      {
        body: {
          fullName: 'Кадровик Тестов',
          phone: '',
          login: 'kadry',
          password: 'Kadry2026',
          pin: '',
          roleId: hr.id,
          storeIds: null,
          locale: 'ru',
        },
      },
      'test',
    );
    await api(
      'sessions.create',
      { body: { login: 'kadry', password: 'Kadry2026' } },
      'test',
    );
    await api('sessions.selectStore', { body: { storeId: 'store-1' } }, 'test');

    renderWithProviders(<EmployeesPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Роли' }));
    await clickWhenEnabled('Новая роль');
    const editor = await dialog('Новая роль');
    expect(
      (
        within(editor).getByRole('checkbox', {
          name: 'Цены сети',
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(
      within(editor).getByRole('textbox', { name: /Название роли/ }),
      {
        target: { value: 'Провизор' },
      },
    );
    fireEvent.click(
      within(editor).getByRole('checkbox', { name: 'Касса — Просмотр' }),
    );
    fireEvent.click(within(editor).getByRole('button', { name: 'Сохранить' }));
    const roles = await screen.findByRole('table', { name: 'Роли' });
    expect(
      await within(roles).findByRole('button', { name: 'Провизор' }),
    ).toBeTruthy();
    await expect(
      api(
        'roles.create',
        { body: { name: 'Цены', permissions: ['pricing:update-network'] } },
        'test',
      ),
    ).rejects.toMatchObject({ status: 403, code: 'permission_escalation' });
  });
});

describe('ReportsPage', () => {
  it('shows sales by store with cost and margin for the owner', async () => {
    await signInAs('firuz', 'store-1');
    const { container } = renderWithProviders(<ReportsPage />);
    const table = await screen.findByRole('table', {
      name: 'Продажи по точкам',
    });
    expect(
      within(table).getByRole('columnheader', { name: 'Маржа, %' }),
    ).toBeTruthy();
    expect(within(table).getByText('Итого')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Журнал ПКУ' }));
    expect(
      await screen.findByRole('table', { name: 'Журнал ПКУ' }),
    ).toBeTruthy();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('leaves cost columns out without finance:view-cost', async () => {
    await signInAs('firuz', 'store-1');
    const api = mockApi();
    const role = await api(
      'roles.create',
      { body: { name: 'Аналитик', permissions: ['reports:view'] } },
      'test',
    );
    await api(
      'employees.create',
      {
        body: {
          fullName: 'Аналитик Тестов',
          phone: '',
          login: 'analyst',
          password: 'Analyst2026',
          pin: '',
          roleId: role.id,
          storeIds: null,
          locale: 'ru',
        },
      },
      'test',
    );
    await api(
      'sessions.create',
      { body: { login: 'analyst', password: 'Analyst2026' } },
      'test',
    );
    await api('sessions.selectStore', { body: { storeId: 'store-1' } }, 'test');
    const report = await api(
      'reports.get',
      {
        params: { kind: 'sales_by_store' },
        query: { from: '2026-09-01', to: '2026-09-30' },
      },
      'test',
    );
    expect(report.columns.map((c) => c.key)).toEqual([
      'store',
      'receipts',
      'revenue',
      'returns',
    ]);
    expect(report.rows[0]).not.toHaveProperty('margin');
    expect(report.rows[0]).not.toHaveProperty('cost');
  });

  it('maps unmapped products to 1C before the export', async () => {
    await signInAs('nargis', 'store-1');
    renderWithProviders(<ReportsPage />);
    await clickWhenEnabled('Выгрузка в 1С');
    const exportDialog = await dialog('Выгрузка в 1С');
    expect(
      await within(exportDialog).findByRole('heading', {
        name: 'Не сопоставлено с 1С · 3',
      }),
    ).toBeTruthy();
    fireEvent.change(
      within(exportDialog).getByRole('textbox', {
        name: 'Артикул 1С: Физраствор 0,9% 200 мл',
      }),
      { target: { value: 'ЛС-00500' } },
    );
    fireEvent.click(
      within(exportDialog).getByRole('button', {
        name: 'Сопоставить Физраствор 0,9% 200 мл',
      }),
    );
    expect(
      await within(exportDialog).findByRole('heading', {
        name: 'Не сопоставлено с 1С · 2',
      }),
    ).toBeTruthy();
    fireEvent.click(
      within(exportDialog).getByRole('button', { name: 'Выгрузить' }),
    );
    expect(
      await within(exportDialog).findByText(/исключено позиций 2/),
    ).toBeTruthy();
    const link = within(exportDialog).getByRole('link', {
      name: 'Скачать файл',
    });
    expect(link.getAttribute('href')).toMatch(
      /^data:application\/xml;charset=utf-8,/,
    );
  });
});

describe('AuditLogPage', () => {
  it('filters the read-only log by action and marks operator actions', async () => {
    await signInAs('firuz', 'store-1');
    renderWithProviders(<AuditLogPage />);
    const table = await screen.findByRole('table', { name: 'Журнал действий' });
    expect(within(table).getAllByText('Оператор').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('combobox', { name: 'Действие' }), {
      target: { value: 'employee_block' },
    });
    await waitFor(() =>
      expect(within(table).getAllByRole('row')).toHaveLength(2),
    );
    expect(within(table).getByText('Рустам Назаров')).toBeTruthy();
  });
});

describe('SettingsPage', () => {
  it('saves network settings that reach the POS and the PIN rule', async () => {
    await signInAs('firuz', 'store-1');
    renderWithProviders(<SettingsPage />);
    const returnWindow = await screen.findByRole('textbox', {
      name: /Срок возврата, дней/,
    });
    fireEvent.change(returnWindow, { target: { value: '10' } });
    fireEvent.change(
      screen.getByRole('textbox', { name: /Минимальная длина PIN/ }),
      {
        target: { value: '6' },
      },
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Сохранить' })[0]);
    expect(await screen.findByText('Настройки сохранены')).toBeTruthy();
    const snapshot = await mockApi()(
      'catalog.snapshot',
      { params: { storeId: 'store-1' }, query: {} },
      'test',
    );
    expect(snapshot.settings.returnWindowDays).toBe(10);
    await expect(
      mockApi()(
        'me.changePin',
        { body: { currentPin: '', newPin: '4826' } },
        'test',
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe('OfflinePage', () => {
  it('shows the cloud view of the offline stores', async () => {
    await signInAs('firuz', 'store-1');
    renderWithProviders(<OfflinePage />);
    const table = await screen.findByRole('table', { name: 'Офлайн-точки' });
    expect(within(table).getByText('Аптека №4 · Вахдат')).toBeTruthy();
    expect(within(table).getByText('дубли: 2')).toBeTruthy();
  });

  it('syncs the offline store and decides its duplicates there', async () => {
    await scenario('offline-store');
    const api = mockApi();
    await signInAs('firuz', 'store-4');
    renderWithProviders(<OfflinePage />);
    expect(await screen.findByText('Очередь в облако')).toBeTruthy();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Объединить Парацетамол 500мг таб 10',
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', {
          name: 'Объединить Парацетамол 500мг таб 10',
        }),
      ).toBeNull(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Синхронизировать сейчас' }),
    );
    expect(await screen.findByText('Очередь пуста')).toBeTruthy();
    const duplicates = await api('catalog.duplicates', {}, 'test');
    expect(duplicates.find((d) => d.id === 'dup-1')?.status).toBe('merged');
  });
});
