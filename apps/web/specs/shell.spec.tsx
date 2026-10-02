/*
 * Shell, dashboard and profile of the client product against the in-memory API mocks:
 * menu by role (ADR-0018), working store, view-only impersonation, step-up for secrets (ADR-0008).
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { DashboardPage } from '@/pages/dashboard';
import { ProfilePage } from '@/pages/profile';
import { AppShell } from '@/widgets/app-shell';
import { scenario, signInAs, signInByPin, useMockApi } from './mock-env';
import { renderWithProviders } from './test-utils';

const replace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace, prefetch: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

useMockApi();
beforeEach(() => replace.mockClear());

const nav = () =>
  screen.findByRole('navigation', { name: 'Основная навигация' });

describe('AppShell', () => {
  it('shows the owner every section with every screen linked', async () => {
    await signInAs('firuz');
    renderWithProviders(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );
    const menu = await nav();
    for (const section of ['Касса', 'Склад', 'Закупки', 'Кабинет владельца']) {
      expect(within(menu).getByRole('heading', { name: section })).toBeTruthy();
    }
    expect(
      within(menu)
        .getByRole('link', { name: 'Дашборд' })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(within(menu).getByRole('link', { name: 'Остатки' })).toBeTruthy();
    expect(
      within(menu).getByRole('link', { name: 'Заказы поставщикам' }),
    ).toBeTruthy();
    // every screen of the mockups is in place: no «появится позже» items left
    for (const item of ['Отчёты', 'Журнал действий', 'Настройки']) {
      expect(within(menu).getByRole('link', { name: item })).toBeTruthy();
    }
  });

  it('shows a cashier only the cashier menu and a fixed terminal store', async () => {
    await signInByPin('emp-cashier', '2580');
    renderWithProviders(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );
    const menu = await nav();
    expect(within(menu).queryByText('Дашборд')).toBeNull();
    expect(within(menu).queryByText('Закупки')).toBeNull();
    expect(within(menu).queryByText('Кабинет владельца')).toBeNull();
    expect(within(menu).getByText('Касса', { selector: 'h2' })).toBeTruthy();
    expect(screen.getByText('Аптека №3 · Рудаки')).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'Терминал привязан к этой точке' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Рабочая точка/ })).toBeNull();
  });

  it('switches the working store among the stores of the scope', async () => {
    await signInAs('firuz', 'store-1');
    renderWithProviders(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Рабочая точка: Аптека №1 · Центр. Сменить',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Аптека №4 · Вахдат/ }));
    expect(
      await screen.findByRole('button', {
        name: 'Рабочая точка: Аптека №4 · Вахдат. Сменить',
      }),
    ).toBeTruthy();
    // an offline store reports its sync with the cloud and the queue
    expect(
      await screen.findByText(/Синхронизировано .* · в очереди: 3/),
    ).toBeTruthy();
  });

  it('marks a view-only session of the platform operator', async () => {
    await scenario('impersonation');
    renderWithProviders(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );
    expect(await screen.findByText('Сеанс оператора платформы')).toBeTruthy();
    expect(screen.getByText(/Только просмотр/)).toBeTruthy();
  });

  it('sends a signed-out visitor to the sign-in', async () => {
    renderWithProviders(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('content')).toBeNull();
  });

  it('shows notifications and marks them read', async () => {
    await signInAs('firuz');
    renderWithProviders(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Уведомления, новых: 3' }),
    );
    const panel = screen.getByRole('region', { name: 'Уведомления' });
    expect(
      within(panel).getByText('Нурофен 200 мг · партия N-4471'),
    ).toBeTruthy();
    expect(
      within(panel).getByText(/истекает через 12 дней · 18 уп\./),
    ).toBeTruthy();
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Отметить все прочитанными' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Уведомления' }),
    ).toBeTruthy();
  });

  it('has no axe violations', async () => {
    await signInAs('firuz');
    const { container } = renderWithProviders(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );
    await nav();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('DashboardPage', () => {
  it('shows KPIs, sales by store and switches the period', async () => {
    await signInAs('firuz');
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('Выручка сегодня')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Продажи по точкам' });
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(within(table).getByText('Аптека №4 · Вахдат')).toBeTruthy();
    expect(screen.getByText(/синхр\./)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Период'), {
      target: { value: 'week' },
    });
    expect(await screen.findByText('Выручка за неделю')).toBeTruthy();
  });

  it('covers only the stores of a manager', async () => {
    await signInAs('manizha', 'store-1');
    renderWithProviders(<DashboardPage />);
    const table = await screen.findByRole('table', {
      name: 'Продажи по точкам',
    });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).queryByText('Аптека №2 · Сино')).toBeNull();
  });

  it('is denied to a role without reports', async () => {
    await signInByPin('emp-cashier', '2580');
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText('Недостаточно прав')).toBeTruthy();
  });

  it('has no axe violations', async () => {
    await signInAs('firuz');
    const { container } = renderWithProviders(<DashboardPage />);
    await screen.findByText('Выручка сегодня');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ProfilePage', () => {
  it('rejects a trivial PIN on the client and a wrong current PIN on the server', async () => {
    await signInAs('manizha', 'store-1');
    renderWithProviders(<ProfilePage />);
    const pinCard = await screen.findByRole('region', { name: 'Смена PIN' });

    fireEvent.change(within(pinCard).getByLabelText(/^Текущий PIN/), {
      target: { value: '0000' },
    });
    fireEvent.change(within(pinCard).getByLabelText(/^Новый PIN/), {
      target: { value: '1234' },
    });
    fireEvent.click(
      within(pinCard).getByRole('button', { name: 'Сохранить PIN' }),
    );
    expect(
      await within(pinCard).findByText(/Слишком простой PIN/),
    ).toBeTruthy();

    fireEvent.change(within(pinCard).getByLabelText(/^Новый PIN/), {
      target: { value: '4826' },
    });
    fireEvent.click(
      within(pinCard).getByRole('button', { name: 'Сохранить PIN' }),
    );
    expect(
      await within(pinCard).findByText('Текущий PIN указан неверно'),
    ).toBeTruthy();

    fireEvent.change(within(pinCard).getByLabelText(/^Текущий PIN/), {
      target: { value: '3690' },
    });
    fireEvent.click(
      within(pinCard).getByRole('button', { name: 'Сохранить PIN' }),
    );
    expect(await screen.findByText('PIN изменён')).toBeTruthy();
  });

  it('changes secrets only in a session opened by password (step-up)', async () => {
    await signInByPin('emp-cashier', '2580');
    renderWithProviders(<ProfilePage />);
    expect((await screen.findAllByText(/Вы вошли по PIN/)).length).toBe(2);
    expect(
      (
        screen.getByRole('button', {
          name: 'Сменить пароль',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    // a cashier may not unbind terminals
    expect(screen.queryByRole('button', { name: /Отвязать/ })).toBeNull();
  });

  it('unbinds a terminal after confirmation', async () => {
    await signInAs('firuz');
    renderWithProviders(<ProfilePage />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Отвязать терминал ПК владельца · Windows 11',
      }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Отвязать терминал?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отвязать' }));
    expect(await screen.findByText('Терминал отвязан')).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText('ПК владельца · Windows 11')).toBeNull(),
    );
  });

  it('has no axe violations', async () => {
    await signInAs('firuz');
    const { container } = renderWithProviders(<ProfilePage />);
    await screen.findByRole('region', { name: 'Основные данные' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
