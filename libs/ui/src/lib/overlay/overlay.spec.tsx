import { act, fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { useState } from 'react';
import { Button } from '../button/Button';
import { IconButton } from '../button/IconButton';
import { Dialog } from './Dialog';
import { Popover } from './Popover';
import { TOAST_DURATION_MS, ToastProvider, useToast } from './Toast';

function DialogHarness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    onClose?.();
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>Отозвать ключ</Button>
      <Dialog
        open={open}
        onClose={close}
        title="Отозвать ключ?"
        description="Точка перестанет синхронизироваться"
        closeLabel="Закрыть"
        icon="triangle-alert"
        tone="danger"
        footer={
          <>
            <Button variant="tertiary" onClick={close}>
              Отмена
            </Button>
            <Button variant="destructive">Отозвать</Button>
          </>
        }
      >
        <p>Причина обязательна.</p>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('opens as a labelled, described modal and closes from its buttons', () => {
    render(<DialogHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Отозвать ключ' }));
    const dialog = screen.getByRole('dialog', { name: 'Отозвать ключ?' });

    expect(dialog.hasAttribute('open')).toBe(true);
    expect(
      document.getElementById(dialog.getAttribute('aria-describedby') ?? '')
        ?.textContent,
    ).toBe('Точка перестанет синхронизироваться');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(dialog.hasAttribute('open')).toBe(false);
  });

  it('closes on Esc (cancel) and on a backdrop click', () => {
    const onClose = jest.fn();
    render(<DialogHarness onClose={onClose} />);
    const trigger = screen.getByRole('button', { name: 'Отозвать ключ' });

    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(dialog.hasAttribute('open')).toBe(false);

    fireEvent.click(trigger);
    fireEvent.click(dialog);
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('returns focus to the trigger after closing', () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Отозвать ключ' });

    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(document.activeElement).toBe(trigger);
  });

  it('has no axe violations when open', async () => {
    const { container } = render(<DialogHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Отозвать ключ' }));

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Popover', () => {
  function Harness() {
    return (
      <Popover
        label="Уведомления"
        trigger={(props) => (
          <IconButton icon="bell" label="Уведомления" {...props} />
        )}
      >
        {(close) => (
          <div>
            <p>Новый запрос услуги</p>
            <button type="button" onClick={close}>
              Скрыть
            </button>
          </div>
        )}
      </Popover>
    );
  }

  it('links the trigger to the panel and syncs aria-expanded from toggle events', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Уведомления' });
    const panelId = trigger.getAttribute('aria-controls') ?? '';
    const panel = document.getElementById(panelId) as HTMLElement;

    expect(trigger.getAttribute('popovertarget')).toBe(panelId);
    expect(panel.getAttribute('popover')).toBe('auto');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    act(() => panel.showPopover());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(
      screen.getByRole('button', { name: 'Скрыть', hidden: true }),
    );
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('Toast', () => {
  function Harness() {
    const toast = useToast();
    return (
      <Button onClick={() => toast.show('Настройки сохранены')}>
        Сохранить
      </Button>
    );
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('announces the message politely without moving focus and hides it later', () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    const button = screen.getByRole('button', { name: 'Сохранить' });

    button.focus();
    fireEvent.click(button);
    const region = screen.getByRole('status', { hidden: true });
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toContain('Настройки сохранены');
    expect(document.activeElement).toBe(button);

    act(() => jest.advanceTimersByTime(TOAST_DURATION_MS));
    expect(region.textContent).toBe('');
  });

  it('throws a clear error outside the provider', () => {
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    expect(() => render(<Harness />)).toThrow(
      'useToast must be used inside <ToastProvider>',
    );
    spy.mockRestore();
  });
});
