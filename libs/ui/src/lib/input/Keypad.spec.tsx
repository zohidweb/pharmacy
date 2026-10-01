import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { useState } from 'react';
import { Keypad } from './Keypad';

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('');
  return (
    <>
      <output aria-label="Значение">{value}</output>
      <Keypad
        label="Цифровая клавиатура"
        backspaceLabel="Стереть"
        clearLabel="Очистить"
        disabled={disabled}
        onDigit={(digit) => setValue((current) => current + digit)}
        onBackspace={() => setValue((current) => current.slice(0, -1))}
        onClear={() => setValue('')}
      />
    </>
  );
}

const value = () => screen.getByLabelText('Значение').textContent;

describe('Keypad', () => {
  it('types digits, erases the last one and clears', () => {
    render(<Harness />);
    for (const digit of ['4', '0', '7']) {
      fireEvent.click(screen.getByRole('button', { name: digit }));
    }
    expect(value()).toBe('407');
    fireEvent.click(screen.getByRole('button', { name: 'Стереть' }));
    expect(value()).toBe('40');
    fireEvent.click(screen.getByRole('button', { name: 'Очистить' }));
    expect(value()).toBe('');
  });

  it('is a labelled group of twelve keys', () => {
    render(<Harness />);
    const group = screen.getByRole('group', { name: 'Цифровая клавиатура' });
    expect(group.querySelectorAll('button')).toHaveLength(12);
  });

  it('keeps focus in the field on pointer press', () => {
    render(<Harness />);
    const pressed = fireEvent.pointerDown(
      screen.getByRole('button', { name: '1' }),
    );
    expect(pressed).toBe(false);
  });

  it('disables every key', () => {
    render(<Harness disabled />);
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('has no axe violations', async () => {
    const { container } = render(<Harness />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
