import { fireEvent, screen, waitFor } from '@testing-library/react';
import { axe } from 'jest-axe';
import {
  ApiError,
  loadMockTransport,
  setApiTransport,
  type ApiTransport,
} from '@/shared/api';
import { renderWithProviders } from '../../../../specs/test-utils';
import { LoginForm } from './LoginForm';
import { loginSchema } from '../model/login-schema';

function fill(login: string, password: string) {
  fireEvent.input(screen.getByLabelText('Рабочая почта'), {
    target: { value: login },
  });
  fireEvent.input(screen.getByLabelText('Пароль'), {
    target: { value: password },
  });
}

describe('loginSchema', () => {
  it('trims the login and returns i18n keys as errors', () => {
    expect(
      loginSchema.parse({ login: '  a@example.test ', password: 'p' }).login,
    ).toBe('a@example.test');
    const result = loginSchema.safeParse({
      login: 'not-an-email',
      password: '',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message).sort()).toEqual([
      'loginFormat',
      'passwordRequired',
    ]);
  });
});

describe('LoginForm', () => {
  let mockTransport: ApiTransport;
  beforeAll(async () => {
    mockTransport = await loadMockTransport();
  });
  beforeEach(() => {
    sessionStorage.clear();
    setApiTransport(mockTransport);
  });

  it('shows localized field errors and does not call the API for an empty form', async () => {
    const transport = jest.fn<
      ReturnType<ApiTransport>,
      Parameters<ApiTransport>
    >();
    setApiTransport(transport as unknown as ApiTransport);
    renderWithProviders(<LoginForm onSuccess={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByText('Укажите рабочую почту')).toBeTruthy();
    expect(screen.getByText('Укажите пароль')).toBeTruthy();
    expect(
      screen.getByLabelText('Рабочая почта').getAttribute('aria-invalid'),
    ).toBe('true');
    expect(transport).not.toHaveBeenCalled();
  });

  it('reports wrong credentials as one assertive message', async () => {
    renderWithProviders(<LoginForm onSuccess={jest.fn()} />);
    fill('operator@example.test', 'wrong');

    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Неверная почта или пароль',
    );
  });

  it('signs in with the demo operator and calls onSuccess', async () => {
    const onSuccess = jest.fn();
    const { queryClient } = renderWithProviders(
      <LoginForm onSuccess={onSuccess} />,
    );
    fill('operator@example.test', 'demo-password');

    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(queryClient.getQueryData(['operator-session'])).toMatchObject({
      operator: { login: 'operator@example.test' },
    });
  });

  it('shows a network message with no technical details', async () => {
    setApiTransport(async (_route, _options, correlationId) => {
      throw new ApiError(0, 'network', correlationId);
    });
    renderWithProviders(<LoginForm onSuccess={jest.fn()} />);
    fill('operator@example.test', 'demo-password');

    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Нет связи с сервером',
    );
  });

  it('toggles password visibility with a pressed-state button', () => {
    renderWithProviders(<LoginForm onSuccess={jest.fn()} />);
    const toggle = screen.getByRole('button', { name: 'Показать пароль' });

    fireEvent.click(toggle);
    expect(screen.getByLabelText('Пароль').getAttribute('type')).toBe('text');
    expect(
      screen
        .getByRole('button', { name: 'Скрыть пароль' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('has no axe violations', async () => {
    const { container } = renderWithProviders(
      <LoginForm onSuccess={jest.fn()} />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
