'use client';

import { formatMoney, parseMoneyToMinor } from '@pharmacy/shared-util';
import { TextField } from '@pharmacy/ui';
import { useEffect, useState } from 'react';

export interface MoneyInputProps<E extends number | null> {
  label: string;
  valueMinor: number | E;
  onChange: (valueMinor: number | E) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  /** Shown while the text is not an amount, e.g. «Сумма — число, например 4,50». */
  invalidText: string;
  /**
   * An empty field is a valid «not set» that stands for this value: 0 for a store without a price, null for an
   * amount not entered. Without it an empty field is invalid.
   */
  empty?: E;
}

/** Amount in somoni with a comma, kept as dirams; the text is kept while it does not parse. */
export function MoneyInput<E extends number | null = never>({
  label,
  valueMinor,
  onChange,
  disabled,
  hideLabel = true,
  invalidText,
  empty,
}: MoneyInputProps<E>) {
  const allowEmpty = empty !== undefined;
  const format = (minor: number | E) =>
    typeof minor !== 'number' || (allowEmpty && minor === empty)
      ? ''
      : formatMoney(minor, { withSign: false });
  const [text, setText] = useState(format(valueMinor));
  useEffect(() => {
    // an outside change (e.g. the retail price recomputed) replaces the text
    if (parseMoneyToMinor(text) !== valueMinor) setText(format(valueMinor));
  }, [valueMinor]);
  const isEmpty = allowEmpty && text.trim() === '';
  const invalid = !isEmpty && parseMoneyToMinor(text) === null;
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
        if (empty !== undefined && event.target.value.trim() === '') {
          onChange(empty);
          return;
        }
        const minor = parseMoneyToMinor(event.target.value);
        if (minor !== null) onChange(minor);
      }}
    />
  );
}
