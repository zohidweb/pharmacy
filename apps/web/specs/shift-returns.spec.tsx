/*
 * Shift and customer returns against the in-memory API mocks: cash operations through the outbox,
 * closing with reconciliation and the Z-report; returns by receipt with the discount recalculated,
 * the return window, the right to return without a receipt, no returns during an outage.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { ReturnsPage } from '@/pages/returns';
import { ShiftPage } from '@/pages/shift';
import { scenario, signInAs, signInByPin, useMockApi } from './mock-env';
import { renderWithProviders } from './test-utils';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/shift',
  useSearchParams: () => new URLSearchParams(),
}));

useMockApi();

const WIDE_SPACES = new RegExp('[\u00a0\u202f]', 'g');
const plain = (text: string | null | undefined) =>
  (text ?? '').replace(WIDE_SPACES, ' ');

// operations go through the IndexedDB outbox: slower on a loaded machine (parallel nx tasks)
jest.setTimeout(20_000);

describe('ShiftPage', () => {
  it('shows totals by payment method and the cash drawer', async () => {
    await signInByPin('emp-cashier', '2580');
    renderWithProviders(<ShiftPage />);
    expect(
      await screen.findByRole('heading', { name: 'Смена №218' }),
    ).toBeTruthy();
    const drawer = screen.getByRole('region', { name: 'Денежный ящик' });
    expect(
      plain(
        within(drawer).getByText('Ожидается в кассе').parentElement
          ?.textContent,
      ),
    ).toBe('Ожидается в кассе1 472,50 с');
  });

  it('records a cash-in through the buffer and refreshes the drawer', async () => {
    await signInByPin('emp-cashier', '2580');
    renderWithProviders(<ShiftPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Внесение' }));
    const dialog = await screen.findByRole('dialog', { name: 'Внесение' });
    fireEvent.change(within(dialog).getByLabelText(/^Сумма/), {
      target: { value: '200' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Внесение' }));
    // the toast is short-lived; the durable result is the closed dialog and the refreshed drawer
    await waitFor(
      () =>
        expect(screen.queryByRole('dialog', { name: 'Внесение' })).toBeNull(),
      { timeout: 6_000 },
    );
    const drawer = screen.getByRole('region', { name: 'Денежный ящик' });
    await waitFor(
      () =>
        expect(
          plain(
            within(drawer).getByText('Ожидается в кассе').parentElement
              ?.textContent,
          ),
        ).toBe('Ожидается в кассе1 672,50 с'),
      { timeout: 6_000 },
    );
  });

  it('closes the shift with reconciliation and shows the Z-report', async () => {
    await signInByPin('emp-cashier', '2580');
    renderWithProviders(<ShiftPage />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Закрыть смену' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Закрытие смены',
    });
    expect(
      within(dialog).getByText(/2 отложенных чека будут удалены/),
    ).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/^Фактически в кассе/), {
      target: { value: '1460' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'Закрыть и сформировать Z-отчёт',
      }),
    );
    // a discrepancy needs a reason
    expect(
      await within(dialog).findByText('Укажите причину расхождения'),
    ).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/^Причина расхождения/), {
      target: { value: 'размен не пробит' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'Закрыть и сформировать Z-отчёт',
      }),
    );
    const report = await screen.findByRole('dialog', { name: 'Z-отчёт' });
    const paper = within(report).getByRole('figure', { name: 'Z-отчёт' });
    expect(paper.textContent).toContain('Z-ОТЧЁТ');
    expect(plain(paper.textContent)).toContain('-12,50 с');
  });

  it('opens a shift when none is open', async () => {
    await scenario('no-shift');
    await signInByPin('emp-cashier', '2580');
    renderWithProviders(<ShiftPage />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Открыть смену' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Открытие смены',
    });
    fireEvent.change(within(dialog).getByLabelText(/^Наличные на начало/), {
      target: { value: '500' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Открыть смену' }),
    );
    // the toast is short-lived; the durable result is the shift on the screen
    expect(
      await screen.findByRole(
        'heading',
        { name: /^Смена №/ },
        { timeout: 15_000 },
      ),
    ).toBeTruthy();
  });

  it('has no axe violations', async () => {
    await signInByPin('emp-cashier', '2580');
    const { container } = renderWithProviders(<ShiftPage />);
    await screen.findByRole('heading', { name: 'Смена №218' });
    expect(await axe(container)).toHaveNoViolations();
  });
});

async function findReceipt(number: string) {
  fireEvent.change(await screen.findByLabelText(/^Номер чека/), {
    target: { value: number },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
}

describe('ReturnsPage', () => {
  it('returns part of a receipt and takes the lost discount back', async () => {
    await signInAs('manizha', 'store-3');
    renderWithProviders(<ReturnsPage />);
    await findReceipt('1035');
    const lines = await screen.findByRole('table', { name: 'Строки чека' });
    fireEvent.click(
      within(lines).getByLabelText('Вернуть: Витамин D3 2000 МЕ, капс. №60'),
    );
    fireEvent.click(
      within(lines).getByRole('button', {
        name: 'Больше: Витамин D3 2000 МЕ, капс. №60',
      }),
    );
    // 558,00 − 3 %: keeping 428,00 (< 500,00) loses the discount → 541,26 − 428,00
    const calc = screen.getByRole('region', { name: 'Расчёт' });
    expect(
      plain(within(calc).getByText('К выдаче').parentElement?.textContent),
    ).toBe('К выдаче113,26 с');
    expect(within(calc).getByText(/скидка на них пересчитана/)).toBeTruthy();
    fireEvent.click(
      within(calc).getByRole('button', { name: /Оформить возврат/ }),
    );
    expect(await screen.findByText(/Возврат ВЗ-000043 оформлен/)).toBeTruthy();
    const journal = await screen.findByRole('table', {
      name: 'Журнал возвратов',
    });
    expect(await within(journal).findByText('ВЗ-000043')).toBeTruthy();
  });

  it('refuses a receipt past the return window', async () => {
    await signInAs('manizha', 'store-3');
    renderWithProviders(<ReturnsPage />);
    await findReceipt('0950');
    expect(
      await screen.findByText('Срок возврата по этому чеку (14 дней) истёк.'),
    ).toBeTruthy();
  });

  it('finds sales without a receipt only with the right', async () => {
    await signInAs('manizha', 'store-3');
    const manager = renderWithProviders(<ReturnsPage />);
    expect(await screen.findByLabelText(/^Без чека: товар/)).toBeTruthy();
    manager.unmount();

    await signInByPin('emp-cashier', '2580');
    renderWithProviders(<ReturnsPage />);
    expect(
      await screen.findByText(
        'Возврат без чека — только с правом «Возврат без чека».',
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/^Без чека: товар/)).toBeNull();
  });

  it('is unavailable during an outage', async () => {
    await signInAs('manizha', 'store-3');
    await scenario('offline');
    renderWithProviders(<ReturnsPage />);
    await findReceipt('1035');
    expect(
      (
        await screen.findAllByText(
          'Нет связи: возвраты недоступны до восстановления связи.',
        )
      ).length,
    ).toBeGreaterThan(0);
  });

  it('has no axe violations', async () => {
    await signInAs('manizha', 'store-3');
    const { container } = renderWithProviders(<ReturnsPage />);
    await findReceipt('1039');
    await screen.findByRole('table', { name: 'Строки чека' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
