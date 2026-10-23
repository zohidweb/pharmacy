'use client';

import { TextField } from '@pharmacy/ui';

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
