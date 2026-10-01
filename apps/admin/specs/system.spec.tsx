/*
 * Screen tests of «Дашборд», «Статистика», «Уведомления», «Журнал действий», «Настройки»,
 * «Профиль», the sidebar counters and the service-state screens against the in-memory API mocks.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AuditLogPage } from '@/pages/audit-log';
import { DashboardPage } from '@/pages/dashboard';
import { NotFoundPage } from '@/pages/not-found';
import { NotificationsPage } from '@/pages/notifications';
import { ProfilePage } from '@/pages/profile';
import { SettingsPage } from '@/pages/settings';
import { StatisticsPage } from '@/pages/statistics';
import {
  ApiError,
  loadMockTransport,
  resetApiMocks,
  setApiTransport,
  type ApiTransport,
} from '@/shared/api';
import { AppShell } from '@/widgets/app-shell';
import { renderWithProviders } from './test-utils';

const replace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace, prefetch: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  notFound: jest.fn(),
}));

let mockTransport: ApiTransport;

beforeAll(async () => {
  mockTransport = await loadMockTransport();
});

beforeEach(async () => {
  setApiTransport(mockTransport);
  await resetApiMocks();
  replace.mockClear();
  sessionStorage.clear();
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

async function signIn() {
  await mockTransport(
    'operator.sessions.create',
    { body: { login: 'operator@example.test', password: 'demo-password' } },
    'test',
  );
}

describe('AppShell counters', () => {
  it('shows attention counters next to menu items with accessible text', async () => {
    await signIn();
    renderWithProviders(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    expect(await screen.findByText('2 запроса ждут решения')).toBeTruthy();
    expect(screen.getByText('1 ключ истекает')).toBeTruthy();
    expect(screen.getByText('4 новых уведомления')).toBeTruthy();
  });
});

describe('DashboardPage', () => {
  it('shows KPIs and an operator queue with links to the right screens', async () => {
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('Требует внимания')).toBeTruthy();
    const queue = screen.getByRole('region', { name: 'Очередь оператора' });
    const overdue = within(queue).getByRole('link', {
      name: /Просрочена оплата: Пример Мед/,
    });
    expect(overdue.getAttribute('href')).toBe('/companies/view?id=t-2');
    expect(
      within(queue)
        .getByRole('link', { name: /Запрос услуги: Тест Аптека/ })
        .getAttribute('href'),
    ).toBe('/billing/services');
    expect(
      screen.getByRole('table', { name: 'Продажи компаний за 14 дней' }),
    ).toBeTruthy();
  });
});

describe('StatisticsPage', () => {
  it('groups stores under companies and narrows to one company', async () => {
    renderWithProviders(<StatisticsPage />);
    const table = await screen.findByRole('table', { name: /Статистика за/ });
    expect(within(table).getByText('Демо Фарм №1')).toBeTruthy();
    expect(within(table).getByText('Пример Мед')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Тест Аптека' }));
    await waitFor(() =>
      expect(
        within(
          screen.getByRole('table', { name: /Статистика за/ }),
        ).queryByText('Пример Мед'),
      ).toBeNull(),
    );
  });
});

describe('NotificationsPage', () => {
  it('filters by topic and marks everything read', async () => {
    renderWithProviders(<NotificationsPage />);
    const events = () =>
      within(screen.getByRole('region', { name: 'События' }));
    await waitFor(() =>
      expect(events().getByText(/Просрочена оплата: Пример Мед/)).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole('button', { name: /^Ключи 2$/ }));
    await waitFor(() =>
      expect(events().queryByText(/Просрочена оплата: Пример Мед/)).toBeNull(),
    );
    await waitFor(() =>
      expect(events().getByText(/Ключ истекает: Демо Фарм №3/)).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Отметить прочитанными' }),
    );
    expect(await screen.findByText('Все уведомления прочитаны')).toBeTruthy();
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Отметить прочитанными',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    );
  });

  it('validates the announcement window before publishing', async () => {
    renderWithProviders(<NotificationsPage />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Объявить техработы' }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Объявление о технических работах',
    });

    fireEvent.change(within(dialog).getByLabelText(/Заголовок/), {
      target: { value: 'Техработы' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Текст/), {
      target: { value: 'Облако недоступно ночью' },
    });
    fireEvent.change(within(dialog).getByLabelText('Окончание, время'), {
      target: { value: '00:30' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Опубликовать' }),
    );
    expect(
      within(dialog).getByText('Окончание должно быть позже начала'),
    ).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText('Окончание, время'), {
      target: { value: '03:00' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Опубликовать' }),
    );
    expect(await screen.findByText('Объявление опубликовано')).toBeTruthy();
  });
});

describe('AuditLogPage', () => {
  it('filters by operator and action type, and offers a reset', async () => {
    renderWithProviders(<AuditLogPage />);
    const table = await screen.findByRole('table', {
      name: 'Журнал действий операторов',
    });
    expect(within(table).getAllByRole('row')).toHaveLength(8);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Второй Оператор' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ключ' }));
    await waitFor(() =>
      expect(
        within(
          screen.getByRole('table', { name: 'Журнал действий операторов' }),
        ).getAllByRole('row'),
      ).toHaveLength(3),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Оплата' }));
    expect(await screen.findByText('Записей по фильтру нет')).toBeTruthy();
  });
});

describe('SettingsPage', () => {
  it('validates requisites and saves settings', async () => {
    renderWithProviders(<SettingsPage />);
    const inn = await screen.findByLabelText('ИНН');

    fireEvent.input(inn, { target: { value: '123' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Сохранить изменения' }),
    );
    expect(await screen.findByText('ИНН — 9 цифр')).toBeTruthy();

    fireEvent.input(inn, { target: { value: '123456789' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Сохранить изменения' }),
    );
    expect(
      await screen.findByText('Настройки платформы сохранены'),
    ).toBeTruthy();
  });

  it('adds an operator and refuses a duplicate login', async () => {
    renderWithProviders(<SettingsPage />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Добавить оператора' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Добавить оператора' });

    fireEvent.change(within(dialog).getByLabelText(/ФИО/), {
      target: { value: 'Третий Оператор' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Рабочая почта/), {
      target: { value: 'operator2@example.test' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'уже есть',
    );

    fireEvent.change(within(dialog).getByLabelText(/Рабочая почта/), {
      target: { value: 'operator3@example.test' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    expect(
      await screen.findByText('Оператор Третий Оператор добавлен'),
    ).toBeTruthy();
  });
});

describe('ProfilePage', () => {
  it('checks password rules and the current password', async () => {
    renderWithProviders(<ProfilePage />);
    const next = await screen.findByLabelText('Новый пароль');
    const rules = screen.getByRole('list', { name: 'Требования к паролю' });

    fireEvent.change(next, { target: { value: 'short' } });
    expect(within(rules).getByText('Минимум 8 символов').textContent).toContain(
      'не выполнено',
    );
    fireEvent.change(next, { target: { value: 'NewPassw0rd' } });
    expect(within(rules).getAllByText(/, выполнено/)).toHaveLength(3);

    fireEvent.change(screen.getByLabelText('Текущий пароль'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Обновить пароль' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Текущий пароль указан неверно',
    );

    fireEvent.change(screen.getByLabelText('Текущий пароль'), {
      target: { value: 'demo-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Обновить пароль' }));
    expect(
      await screen.findByText('Пароль обновлён, другие сеансы завершены'),
    ).toBeTruthy();
  });

  it('signs out to the login screen', async () => {
    renderWithProviders(<ProfilePage />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Выйти из аккаунта' }),
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });
});

describe('state screens', () => {
  it('renders 404 with ways back', () => {
    renderWithProviders(<NotFoundPage />);

    expect(
      screen.getByRole('heading', { name: 'Страница не найдена' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'На дашборд' }).getAttribute('href'),
    ).toBe('/');
  });

  it('turns API 403 and 503 into service states', async () => {
    setApiTransport(async (_route, _options, correlationId) => {
      throw new ApiError(403, 'forbidden', correlationId);
    });
    const { unmount } = renderWithProviders(<SettingsPage />);
    expect(
      await screen.findByRole('heading', { name: 'Недостаточно прав' }),
    ).toBeTruthy();
    unmount();

    setApiTransport(async (_route, _options, correlationId) => {
      throw new ApiError(503, 'maintenance', correlationId);
    });
    renderWithProviders(<SettingsPage />);
    expect(
      await screen.findByRole('heading', { name: 'Технические работы' }),
    ).toBeTruthy();
  });
});
