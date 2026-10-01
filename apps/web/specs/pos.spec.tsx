/*
 * POS against the in-memory API mocks and fake-indexeddb: scan → receipt line with FEFO, analogs,
 * prescription and ПКУ rules, mixed payment and change, the sale through the outbox (online and
 * during an outage), the draft surviving a reload.
 */
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { axe } from 'jest-axe';
import { PosPage } from '@/pages/pos';
import { getTerminalRuntime } from '@/shared/lib/offline-queue';
import { AppShell } from '@/widgets/app-shell';
import { scenario, signInAs, signInByPin, useMockApi } from './mock-env';
import { renderWithProviders } from './test-utils';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/pos',
  useSearchParams: () => new URLSearchParams(),
}));

useMockApi();

const PARACETAMOL = '4870001000017';

function scan(code: string) {
  let at = 10_000;
  const clock = jest.spyOn(performance, 'now').mockImplementation(() => at);
  for (const digit of code) {
    fireEvent.keyDown(window, { code: `Digit${digit}`, key: digit });
    at += 5;
  }
  fireEvent.keyDown(window, { code: 'Enter', key: 'Enter' });
  clock.mockRestore();
}

const receipt = () => screen.getByRole('region', { name: 'Чек' });
const WIDE_SPACES = new RegExp('[\u00a0\u202f]', 'g');
const plain = (text: string | null | undefined) =>
  (text ?? '').replace(WIDE_SPACES, ' ');

async function openPos(withShell = false) {
  const view = renderWithProviders(
    withShell ? (
      <AppShell>
        <PosPage />
      </AppShell>
    ) : (
      <PosPage />
    ),
  );
  await screen.findByRole('list', { name: 'Найденные товары' });
  return view;
}

describe('PosPage', () => {
  it('turns a scan into a receipt line from the FEFO batch', async () => {
    await signInByPin('emp-cashier', '2580');
    await openPos();
    act(() => scan(PARACETAMOL));
    const line = await within(receipt()).findByText(
      'Парацетамол 500 мг, таб. №10',
    );
    expect(line).toBeTruthy();
    // P-2288 expires first; P-2201 is expired and never offered
    expect(within(receipt()).getByText(/партия P-2288/)).toBeTruthy();
    expect(
      plain(
        within(receipt()).getByRole('button', { name: /Оплатить/ }).textContent,
      ),
    ).toBe('Оплатить 4,50 с');
  });

  it('reports an unknown barcode without touching the receipt', async () => {
    await signInByPin('emp-cashier', '2580');
    await openPos();
    act(() => scan('4870009999999'));
    expect(
      await screen.findByText(
        'Товар со штрихкодом 4870009999999 не найден в каталоге точки',
      ),
    ).toBeTruthy();
    expect(within(receipt()).getByText('Чек пуст')).toBeTruthy();
  });

  it('shows analogs by МНН for a product that is out of stock', async () => {
    await signInByPin('emp-cashier', '2580');
    await openPos();
    fireEvent.change(screen.getByLabelText('Скан или поиск'), {
      target: { value: 'ибупрофен 400' },
    });
    expect(
      await screen.findByText('«Ибупрофен 400 мг, таб. №20» нет в наличии'),
    ).toBeTruthy();
    const analogs = screen.getByRole('list', { name: 'Аналоги по МНН' });
    expect(within(analogs).getByText('Нурофен 200 мг, таб. №10')).toBeTruthy();
    expect(
      within(analogs).getByText('Ибупрофен 200 мг, таб. №20'),
    ).toBeTruthy();
  });

  it('asks to confirm a prescription and blocks ПКУ without the right', async () => {
    await signInByPin('emp-cashier', '2580');
    await openPos();
    fireEvent.click(
      screen.getByRole('button', { name: /^Амоксициллин 500 мг/ }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Рецептурный препарат',
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Рецепт предъявлен' }),
    );
    expect(
      await within(receipt()).findByText('Амоксициллин 500 мг, капс. №16'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Трамадол 50 мг/ }));
    expect(
      await screen.findByText(
        '«Трамадол 50 мг, капс. №20» — ПКУ: продажа доступна только с правом «Продажа ПКУ»',
      ),
    ).toBeTruthy();
  });

  it('sells ПКУ only with prescription and buyer data', async () => {
    await signInAs('manizha', 'store-3');
    await openPos();
    fireEvent.click(screen.getByRole('button', { name: /^Трамадол 50 мг/ }));
    const dialog = await screen.findByRole('dialog', {
      name: 'ПКУ · данные рецепта',
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Добавить в чек' }),
    );
    expect(
      within(dialog).getByText('Укажите серию и номер рецепта'),
    ).toBeTruthy();
    const fields: Array<[RegExp, string]> = [
      [/^Серия и номер рецепта/, 'Р-441288'],
      [/^Медучреждение/, 'Поликлиника №4'],
      [/^Врач/, 'Каримова М. С.'],
      [/^ФИО покупателя/, 'Тестов Тест'],
      [/^Документ покупателя/, 'Паспорт ТЕСТ-0001'],
    ];
    for (const [label, value] of fields) {
      fireEvent.change(within(dialog).getByLabelText(label), {
        target: { value },
      });
    }
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Добавить в чек' }),
    );
    expect(
      await within(receipt()).findByText('Данные рецепта заполнены'),
    ).toBeTruthy();
  });

  it('keeps expired batches in the batch choice but never sellable', async () => {
    await signInAs('manizha', 'store-3');
    await openPos();
    act(() => scan(PARACETAMOL));
    fireEvent.click(
      await within(receipt()).findByRole('button', { name: /партия P-2288/ }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Выбор партии' });
    const expired = within(dialog).getByRole('button', {
      name: /Партия P-2201/,
    });
    expect((expired as HTMLButtonElement).disabled).toBe(true);
    expect(
      within(dialog).getByText(
        'Просроченная партия заблокирована для продажи без возможности обхода.',
      ),
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Партия P-2311/ }),
    );
    expect(await within(receipt()).findByText(/партия P-2311/)).toBeTruthy();
  });

  it('takes a mixed payment and gives change from cash', async () => {
    await signInByPin('emp-cashier', '2580');
    await openPos();
    act(() => scan(PARACETAMOL));
    act(() => scan(PARACETAMOL));
    await within(receipt()).findByText('Парацетамол 500 мг, таб. №10');
    fireEvent.click(
      within(receipt()).getByRole('button', { name: 'Смешанная оплата' }),
    );
    fireEvent.change(within(receipt()).getByLabelText(/^Карта/), {
      target: { value: '4,00' },
    });
    fireEvent.change(within(receipt()).getByLabelText(/^Получено наличными/), {
      target: { value: '10' },
    });
    // 9,00 total − 4,00 card = 5,00 cash; 10,00 given → 5,00 change
    expect(
      plain(within(receipt()).getByText('Сдача').parentElement?.textContent),
    ).toBe('Сдача5,00 с');
  });

  it('pays through the outbox and prints the receipt with its server number', async () => {
    await signInByPin('emp-cashier', '2580');
    await openPos();
    act(() => scan(PARACETAMOL));
    await within(receipt()).findByText('Парацетамол 500 мг, таб. №10');
    fireEvent.click(
      within(receipt()).getByRole('button', { name: /Оплатить/ }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Чек оплачен' });
    await waitFor(() =>
      expect(within(dialog).getByText('Чек №1042')).toBeTruthy(),
    );
    const preview = within(dialog).getByRole('figure', {
      name: 'Предпросмотр чека',
    });
    expect(preview.textContent).toContain('Аптечная сеть «Шифо»');
    expect(preview.textContent).toContain(
      'Фискальные реквизиты — после выбора ККМ',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Новый чек' }));
    expect(within(receipt()).getByText('Чек пуст')).toBeTruthy();
  });

  it('keeps selling during an outage: the receipt waits in the buffer', async () => {
    await signInByPin('emp-cashier', '2580');
    await openPos(true);
    act(() => scan(PARACETAMOL));
    await within(receipt()).findByText('Парацетамол 500 мг, таб. №10');
    await scenario('offline');
    fireEvent.click(
      within(receipt()).getByRole('button', { name: /Оплатить/ }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Чек оплачен' });
    expect(
      await within(dialog).findByText(
        /Нет связи: чек сохранён в буфере/,
        undefined,
        {
          timeout: 3_000,
        },
      ),
    ).toBeTruthy();
    expect(await screen.findByText('Нет связи — в буфере: 1')).toBeTruthy();
    const runtime = await getTerminalRuntime('tenant-shifo', 'store-3');
    const [operation] = await runtime.queue.list();
    expect(operation).toMatchObject({
      kind: 'receipt',
      status: 'pending',
      attempts: 1,
    });
  });

  it('keeps the draft receipt after a reload', async () => {
    await signInByPin('emp-cashier', '2580');
    const first = await openPos();
    act(() => scan(PARACETAMOL));
    await within(receipt()).findByText('Парацетамол 500 мг, таб. №10');
    // the draft is written to IndexedDB asynchronously
    const runtime = await getTerminalRuntime('tenant-shifo', 'store-3');
    await waitFor(async () =>
      expect(await runtime.db.get('state', 'draft')).toMatchObject({
        lines: [expect.objectContaining({ productId: 'p-paracetamol' })],
      }),
    );
    first.unmount();
    await openPos();
    expect(
      await within(receipt()).findByText('Парацетамол 500 мг, таб. №10'),
    ).toBeTruthy();
  });

  it('asks to open a shift before selling', async () => {
    await scenario('no-shift');
    await signInByPin('emp-cashier', '2580');
    renderWithProviders(<PosPage />);
    expect(
      await screen.findAllByText('Смена не открыта: продажа недоступна'),
    ).not.toHaveLength(0);
    expect(
      screen.getByRole('link', { name: 'Открыть смену' }).getAttribute('href'),
    ).toBe('/shift');
  });

  it('has no axe violations', async () => {
    await signInByPin('emp-cashier', '2580');
    const { container } = await openPos();
    act(() => scan(PARACETAMOL));
    await within(receipt()).findByText('Парацетамол 500 мг, таб. №10');
    expect(await axe(container)).toHaveNoViolations();
  });
});
