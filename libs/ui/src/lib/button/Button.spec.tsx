import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { Button, buttonClassName } from './Button';
import { IconButton } from './IconButton';

describe('Button', () => {
  it('renders a native button that is not a submit button by default', () => {
    render(<Button>Сохранить</Button>);
    const button = screen.getByRole('button', { name: 'Сохранить' });

    expect(button.getAttribute('type')).toBe('button');
  });

  it('calls onClick on click and keyboard activation', () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Войти</Button>);
    const button = screen.getByRole('button', { name: 'Войти' });

    fireEvent.click(button);
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps focus but blocks activation while loading', () => {
    const onClick = jest.fn();
    render(
      <Button loading onClick={onClick}>
        Сохранить
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Сохранить' });

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('exposes variant classes for links styled as buttons', () => {
    const classes = buttonClassName({ variant: 'secondary', block: true });

    expect(classes).toContain('bg-primary-subtle');
    expect(classes).toContain('w-full');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div>
        <Button iconStart="plus">Создать</Button>
        <Button variant="destructive" disabled>
          Заблокировать
        </Button>
      </div>,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('IconButton', () => {
  it('uses the label as the accessible name and hides the icon', () => {
    const { container } = render(<IconButton icon="x" label="Закрыть" />);

    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeTruthy();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('renders the indicator dot as decoration only', async () => {
    const { container } = render(
      <IconButton icon="bell" label="Уведомления, есть новые" indicator />,
    );

    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
    expect(await axe(container)).toHaveNoViolations();
  });
});
