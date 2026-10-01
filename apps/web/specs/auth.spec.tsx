/*
 * Sign-in of the client product against the in-memory API mocks: password → working store,
 * cashier PIN on a bound terminal with the PIN lock after three failures (ADR-0008).
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { LoginPage } from '@/pages/login';
import { MOCK_PASSWORD, scenario, useMockApi } from './mock-env';
import { renderWithProviders } from './test-utils';

const replace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace, prefetch: jest.fn() }),
  usePathname: () => '/login',
  useSearchParams: () => new URLSearchParams(),
}));

useMockApi();
beforeEach(() => replace.mockClear());

function typePin(pin: string) {
  const keypad = screen.getByRole('group', { name: 'Цифровая клавиатура' });
  for (const digit of pin) {
    fireEvent.click(within(keypad).getByRole('button', { name: digit }));
  }
}

async function signInByPassword(login: string, password = MOCK_PASSWORD) {
  fireEvent.change(await screen.findByLabelText(/^Логин/), {
    target: { value: login },
  });
  fireEvent.change(screen.getByLabelText(/^Пароль/), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
}

describe('LoginPage on a bound terminal', () => {
  it('starts with the cashier PIN and lets a cashier in', async () => {
    renderWithProviders(<LoginPage />);

    expect(
      await screen.findByRole('heading', { name: 'PIN кассира' }),
    ).toBeTruthy();
    expect(
      screen.getByText('Аптека №3 · Рудаки · Касса 1 · Аптека №3'),
    ).toBeTruthy();
    const cashiers = screen.getByRole('group', { name: 'Кассир' });
    expect(within(cashiers).getAllByRole('radio')).toHaveLength(3);

    fireEvent.click(within(cashiers).getByRole('radio', { name: 'Зарина Р.' }));
    typePin('2580');
    expect(
      (screen.getByLabelText(/^PIN/, { selector: 'input' }) as HTMLInputElement)
        .value,
    ).toBe('2580');
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    // a cashier has no dashboard: the first ready screen of the role is the POS
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/pos'));
  });

  it('locks the PIN after three failures and asks for the password', async () => {
    renderWithProviders(<LoginPage />);
    await screen.findByRole('heading', { name: 'PIN кассира' });

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      typePin('9999');
      fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
      expect(await screen.findByText(/Неверный PIN/)).toBeTruthy();
    }
    typePin('9999');
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByText(/PIN заблокирован/)).toBeTruthy();

    // even the right PIN does not open a locked PIN
    typePin('3690');
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByText(/PIN заблокирован/)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('asks for a complete PIN before sending it', async () => {
    renderWithProviders(<LoginPage />);
    await screen.findByRole('heading', { name: 'PIN кассира' });
    typePin('25');
    fireEvent.click(screen.getByRole('button', { name: 'Стереть цифру' }));
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(
      await screen.findByText('Введите PIN не короче 4 цифр'),
    ).toBeTruthy();
  });

  it('has no axe violations on the PIN step', async () => {
    const { container } = renderWithProviders(<LoginPage />);
    await screen.findByRole('heading', { name: 'PIN кассира' });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('LoginPage by password', () => {
  it('signs the owner in and asks for the working store', async () => {
    renderWithProviders(<LoginPage />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Войти по логину и паролю' }),
    );
    await signInByPassword('Firuz');

    expect(
      await screen.findByRole('heading', { name: 'Выбор точки' }),
    ).toBeTruthy();
    expect(screen.getByText('Фируз Ахмедов · Владелец')).toBeTruthy();
    const stores = screen.getByRole('group', { name: 'Рабочая точка' });
    expect(within(stores).getAllByRole('radio')).toHaveLength(4);

    fireEvent.click(screen.getByRole('radio', { name: /Аптека №2 · Сино/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });

  it('skips the store step for an employee with one store', async () => {
    await scenario('unbound-terminal');
    renderWithProviders(<LoginPage />);
    await signInByPassword('zarina');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/pos'));
  });

  it('does not tell which field of a wrong pair was wrong', async () => {
    await scenario('unbound-terminal');
    renderWithProviders(<LoginPage />);
    await signInByPassword('firuz', 'wrong-password');
    expect(await screen.findByText('Неверный логин или пароль')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('validates empty fields with localized messages', async () => {
    await scenario('unbound-terminal');
    renderWithProviders(<LoginPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти' }));
    expect(await screen.findByText('Укажите логин')).toBeTruthy();
    expect(screen.getByText('Укажите пароль')).toBeTruthy();
  });

  it('offers no PIN sign-in on an unbound browser', async () => {
    await scenario('unbound-terminal');
    renderWithProviders(<LoginPage />);
    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Вход кассира по PIN' }),
    ).toBeNull();
  });

  it('has no axe violations on the password step', async () => {
    await scenario('unbound-terminal');
    const { container } = renderWithProviders(<LoginPage />);
    await screen.findByRole('heading', { name: 'Вход' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
