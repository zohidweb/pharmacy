import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { useState } from 'react';
import { Checkbox } from './Checkbox';
import { RadioCardGroup } from './RadioCardGroup';
import { Switch } from './Switch';

describe('Switch', () => {
  function Harness() {
    const [on, setOn] = useState(false);
    return (
      <Switch
        label="Подтверждение входа по коду"
        description="Код приходит на почту"
        checked={on}
        onCheckedChange={setOn}
      />
    );
  }

  it('exposes switch role, name and state and toggles on click', () => {
    render(<Harness />);
    const control = screen.getByRole('switch', {
      name: 'Подтверждение входа по коду',
    });

    expect(control.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(control);
    expect(control.getAttribute('aria-checked')).toBe('true');
  });

  it('does not toggle when disabled', () => {
    const onChange = jest.fn();
    render(
      <Switch
        label="Вне MVP"
        checked={false}
        onCheckedChange={onChange}
        disabled
      />,
    );

    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    const { container } = render(<Harness />);

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('RadioCardGroup', () => {
  function Harness() {
    const [mode, setMode] = useState<'cloud' | 'offline'>('cloud');
    return (
      <RadioCardGroup
        label="Режим точки"
        value={mode}
        onValueChange={setMode}
        options={[
          { value: 'cloud', title: 'Облачная точка', icon: 'store' },
          {
            value: 'offline',
            title: 'Автономная',
            description: 'Лицензионный ключ',
          },
        ]}
      />
    );
  }

  it('is a labelled radio group with one checked option', () => {
    render(<Harness />);

    expect(screen.getByRole('group', { name: 'Режим точки' })).toBeTruthy();
    expect(
      (
        screen.getByRole('radio', {
          name: /Облачная точка/,
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it('changes the value when another card is chosen', () => {
    render(<Harness />);
    const offline = screen.getByRole('radio', { name: /Автономная/ });

    fireEvent.click(offline);
    expect((offline as HTMLInputElement).checked).toBe(true);
  });

  it('has no axe violations', async () => {
    const { container } = render(<Harness />);

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Checkbox', () => {
  it('toggles through its label', async () => {
    const { container } = render(<Checkbox label="Запомнить устройство" />);
    const box = screen.getByRole('checkbox', { name: 'Запомнить устройство' });

    fireEvent.click(screen.getByText('Запомнить устройство'));
    expect((box as HTMLInputElement).checked).toBe(true);
    expect(await axe(container)).toHaveNoViolations();
  });
});
