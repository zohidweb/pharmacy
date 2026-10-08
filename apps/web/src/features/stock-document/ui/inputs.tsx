'use client';

import { formatMoney, parseMoneyToMinor } from '@pharmacy/shared-util';
import { TextField } from '@pharmacy/ui';
import { useEffect, useState } from 'react';

/** Whole quantity inside a document table: digits only, the label is for screen readers. */
export function QuantityInput({
  label,
  value,
  onChange,
  disabled,
  invalid,
  max,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  /** Error text, e.g. «больше остатка». */
  invalid?: string;
  max?: number;
}) {
  return (
    <TextField
      label={label}
      hideLabel
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      value={value === null ? '' : String(value)}
      error={invalid}
      max={max}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, '');
        onChange(digits === '' ? null : Number(digits));
      }}
    />
  );
}

/** Amount in somoni with a comma, kept as dirams; the text is kept while it does not parse. */
export function MoneyInput({
  label,
  valueMinor,
  onChange,
  disabled,
  hideLabel = true,
  invalidText,
  allowEmpty = false,
}: {
  label: string;
  valueMinor: number;
  onChange: (valueMinor: number) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  /** Shown while the text is not an amount, e.g. «Сумма — число, например 4,50». */
  invalidText: string;
  /** An empty field is a valid «not set» and stands for 0 (e.g. a store without a price). */
  allowEmpty?: boolean;
}) {
  const format = (minor: number) =>
    allowEmpty && minor === 0 ? '' : formatMoney(minor, { withSign: false });
  const [text, setText] = useState(format(valueMinor));
  useEffect(() => {
    // an outside change (e.g. the retail price recomputed) replaces the text
    if (parseMoneyToMinor(text) !== valueMinor) setText(format(valueMinor));
  }, [valueMinor]);
  const empty = allowEmpty && text.trim() === '';
  const invalid = !empty && parseMoneyToMinor(text) === null;
  return (
    <TextField
      label={label}
      hideLabel={hideLabel}
      inputMode="decimal"
      autoComplete="off"
      disabled={disabled}
      value={text}
      error={invalid ? invalidText : undefined}
      onChange={(event) => {
        setText(event.target.value);
        if (allowEmpty && event.target.value.trim() === '') {
          onChange(0);
          return;
        }
        const minor = parseMoneyToMinor(event.target.value);
        if (minor !== null) onChange(minor);
      }}
    />
  );
}
