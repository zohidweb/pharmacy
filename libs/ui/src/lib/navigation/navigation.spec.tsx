import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { useState } from 'react';
import { Pagination } from './Pagination';
import { SegmentedControl } from './SegmentedControl';
import { Tabs } from './Tabs';

type Section = 'stores' | 'billing' | 'audit';

function TabsHarness() {
  const [value, setValue] = useState<Section>('stores');
  return (
    <Tabs
      label="Разделы компании"
      value={value}
      onValueChange={setValue}
      items={[
        {
          value: 'stores',
          label: 'Точки',
          count: 3,
          panel: <p>Список точек</p>,
        },
        { value: 'billing', label: 'Счета', panel: <p>Список счетов</p> },
        { value: 'audit', label: 'Аудит', panel: <p>Журнал</p> },
      ]}
    />
  );
}

describe('Tabs', () => {
  it('wires tabs to the active panel with roving tabindex', () => {
    render(<TabsHarness />);
    const [stores, billing] = screen.getAllByRole('tab');
    const panel = screen.getByRole('tabpanel');

    expect(stores.getAttribute('aria-selected')).toBe('true');
    expect(stores.tabIndex).toBe(0);
    expect(billing.tabIndex).toBe(-1);
    expect(panel.getAttribute('aria-labelledby')).toBe(stores.id);
    expect(stores.getAttribute('aria-controls')).toBe(panel.id);
  });

  it('moves and activates with arrows, Home and End (wrapping)', () => {
    render(<TabsHarness />);
    const tablist = screen.getByRole('tablist', { name: 'Разделы компании' });
    const [stores, billing, audit] = screen.getAllByRole('tab');

    stores.focus();
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(billing);
    expect(screen.getByRole('tabpanel').textContent).toBe('Список счетов');

    fireEvent.keyDown(tablist, { key: 'End' });
    expect(document.activeElement).toBe(audit);
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(stores);
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(audit);
    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(document.activeElement).toBe(stores);
  });

  it('activates on click', () => {
    render(<TabsHarness />);

    fireEvent.click(screen.getByRole('tab', { name: 'Аудит' }));
    expect(screen.getByRole('tabpanel').textContent).toBe('Журнал');
  });

  it('has no axe violations', async () => {
    const { container } = render(<TabsHarness />);

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('SegmentedControl', () => {
  function Harness() {
    const [locale, setLocale] = useState<'ru' | 'tg'>('ru');
    return (
      <SegmentedControl
        label="Язык интерфейса"
        value={locale}
        onValueChange={setLocale}
        options={[
          { value: 'ru', label: 'RU', ariaLabel: 'Русский' },
          { value: 'tg', label: 'TJ', ariaLabel: 'Тоҷикӣ' },
        ]}
      />
    );
  }

  it('is a labelled radio group using full language names', () => {
    render(<Harness />);

    expect(screen.getByRole('group', { name: 'Язык интерфейса' })).toBeTruthy();
    const tajik = screen.getByRole('radio', { name: 'Тоҷикӣ' });
    fireEvent.click(tajik);
    expect((tajik as HTMLInputElement).checked).toBe(true);
  });

  it('has no axe violations', async () => {
    const { container } = render(<Harness />);

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Pagination', () => {
  const labels = {
    nav: 'Страницы',
    previous: 'Предыдущая страница',
    next: 'Следующая страница',
    range: ({ from, to, total }: { from: number; to: number; total: number }) =>
      `${from}–${to} из ${total}`,
  };

  it('shows the range and disables the ends', () => {
    const onOffsetChange = jest.fn();
    render(
      <Pagination
        offset={0}
        limit={5}
        total={6}
        onOffsetChange={onOffsetChange}
        labels={labels}
      />,
    );

    expect(screen.getByText('1–5 из 6')).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Предыдущая страница',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница' }));
    expect(onOffsetChange).toHaveBeenCalledWith(5);
  });

  it('clamps the last page and handles an empty list', () => {
    const { rerender } = render(
      <Pagination
        offset={5}
        limit={5}
        total={6}
        onOffsetChange={jest.fn()}
        labels={labels}
      />,
    );
    expect(screen.getByText('6–6 из 6')).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Следующая страница',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    rerender(
      <Pagination
        offset={0}
        limit={5}
        total={0}
        onOffsetChange={jest.fn()}
        labels={labels}
      />,
    );
    expect(screen.getByText('0–0 из 0')).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <Pagination
        offset={0}
        limit={5}
        total={6}
        onOffsetChange={jest.fn()}
        labels={labels}
      />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
