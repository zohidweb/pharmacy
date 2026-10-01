import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { useState } from 'react';
import { OtpField } from './OtpField';
import { Select } from './Select';
import { TextareaField, TextField } from './TextField';

describe('TextField', () => {
  it('links the visible label, hint and error to the input', () => {
    render(
      <TextField
        label="Рабочая почта"
        hint="Используется как логин"
        error="Неверная почта"
        required
        requiredText="обязательно"
      />,
    );
    const input = screen.getByRole('textbox', { name: /Рабочая почта/ });
    const describedBy = input.getAttribute('aria-describedby') ?? '';

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(screen.getByText('(обязательно)')).toBeTruthy();
    expect(describedBy.split(' ')).toHaveLength(2);
    expect(
      document.getElementById(describedBy.split(' ')[0])?.textContent,
    ).toBe('Неверная почта');
  });

  it('passes input props through and renders an end adornment', () => {
    const onChange = jest.fn();
    render(
      <TextField
        label="Пароль"
        type="password"
        onChange={onChange}
        endAdornment={<button type="button">Показать</button>}
      />,
    );
    const input = screen.getByLabelText('Пароль');

    fireEvent.change(input, { target: { value: 'secret' } });
    expect(input.getAttribute('type')).toBe('password');
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Показать' })).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <form>
        <TextField label="Название" error="Укажите название" />
        <TextareaField label="Описание" hint="Видно владельцу" />
      </form>,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Select', () => {
  const options = [
    { value: 'daily', label: 'Раз в сутки' },
    { value: 'hourly', label: 'Каждый час' },
  ];

  it('is a native combobox with a placeholder that cannot be chosen', () => {
    const onChange = jest.fn();
    render(
      <Select
        label="Расписание"
        placeholder="Выберите"
        options={options}
        defaultValue=""
        onChange={onChange}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Расписание' });

    expect(
      (screen.getByRole('option', { name: 'Выберите' }) as HTMLOptionElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(select, { target: { value: 'hourly' } });
    expect(onChange).toHaveBeenCalled();
    expect((select as HTMLSelectElement).value).toBe('hourly');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <Select label="Расписание" options={options} defaultValue="daily" />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});

function OtpHarness({ onValue }: { onValue?: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <OtpField
      label="Код из письма"
      cellLabel={(i) => `Цифра ${i}`}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
    />
  );
}

describe('OtpField', () => {
  it('moves focus forward on digits and back on Backspace', () => {
    render(<OtpHarness />);
    const first = screen.getByRole('textbox', { name: 'Цифра 1' });
    const second = screen.getByRole('textbox', { name: 'Цифра 2' });

    first.focus();
    fireEvent.keyDown(first, { key: '7' });
    expect((first as HTMLInputElement).value).toBe('7');
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second, { key: 'Backspace' });
    expect(document.activeElement).toBe(first);
    expect((first as HTMLInputElement).value).toBe('');
  });

  it('ignores non-digits and supports arrow navigation', () => {
    render(<OtpHarness />);
    const first = screen.getByRole('textbox', { name: 'Цифра 1' });

    first.focus();
    fireEvent.keyDown(first, { key: 'a' });
    expect((first as HTMLInputElement).value).toBe('');
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Цифра 2' }),
    );
  });

  it('fills every cell from a pasted code', () => {
    const onValue = jest.fn();
    render(<OtpHarness onValue={onValue} />);
    const first = screen.getByRole('textbox', { name: 'Цифра 1' });

    fireEvent.paste(first, { clipboardData: { getData: () => '12-34' } });
    expect(onValue).toHaveBeenLastCalledWith('1234');
  });

  it('has no axe violations', async () => {
    const { container } = render(<OtpHarness />);

    expect(await axe(container)).toHaveNoViolations();
  });
});
