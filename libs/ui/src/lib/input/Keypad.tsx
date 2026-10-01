'use client';

/*
 * Keypad — on-screen digit keypad for touch screens: PIN entry, quantities and amounts at the POS.
 * It does not hold a value: the owner field keeps it and the hardware keyboard keeps working there.
 * Native <button>s in a labelled group: Tab walks the keys, Enter/Space press them (ARIA APG
 * "Button"); keys never take focus away on press with a pointer, so the field stays focused.
 */
import type { PointerEvent } from 'react';
import { cx } from '../cx';
import { Icon } from '../icon/Icon';

export type KeypadSize = 'pos' | 'primary';

export interface KeypadProps {
  /** Localized group name, e.g. «Цифровая клавиатура». */
  label: string;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  /** Localized names of the service keys. */
  backspaceLabel: string;
  clearLabel: string;
  disabled?: boolean;
  /** 48 px keys (POS minimum) or 64 px keys (sign-in). */
  size?: KeypadSize;
  /** Layout only. */
  className?: string;
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

const sizes: Record<KeypadSize, string> = {
  pos: 'min-h-touch-pos text-lg',
  primary: 'min-h-touch-primary text-2xl',
};

const key =
  'inline-flex items-center justify-center rounded-md border border-border bg-surface ' +
  'font-medium text-fg tabular-nums transition-colors select-none hover:bg-surface-sunken ' +
  'active:bg-primary-subtle disabled:cursor-not-allowed disabled:text-on-disabled';

/** Keeps focus in the field the keypad types into. */
const keepFocus = (event: PointerEvent<HTMLButtonElement>) =>
  event.preventDefault();

export function Keypad({
  label,
  onDigit,
  onBackspace,
  onClear,
  backspaceLabel,
  clearLabel,
  disabled = false,
  size = 'pos',
  className,
}: KeypadProps) {
  const keyClass = cx(key, sizes[size]);
  return (
    <div
      role="group"
      aria-label={label}
      className={cx('grid grid-cols-3 gap-2', className)}
    >
      {DIGITS.map((digit) => (
        <button
          key={digit}
          type="button"
          className={keyClass}
          disabled={disabled}
          onPointerDown={keepFocus}
          onClick={() => onDigit(digit)}
        >
          {digit}
        </button>
      ))}
      <button
        type="button"
        className={cx(keyClass, 'text-fg-muted')}
        disabled={disabled}
        aria-label={clearLabel}
        onPointerDown={keepFocus}
        onClick={onClear}
      >
        <span aria-hidden="true">C</span>
      </button>
      <button
        type="button"
        className={keyClass}
        disabled={disabled}
        onPointerDown={keepFocus}
        onClick={() => onDigit('0')}
      >
        0
      </button>
      <button
        type="button"
        className={cx(keyClass, 'text-fg-muted')}
        disabled={disabled}
        aria-label={backspaceLabel}
        onPointerDown={keepFocus}
        onClick={onBackspace}
      >
        <Icon name="delete" size="lg" />
      </button>
    </div>
  );
}
