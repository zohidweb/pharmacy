'use client';

/*
 * OtpField — one-time code split into single-digit inputs (e.g. the 4-digit login code).
 * role="group" labelled by the visible label; each cell has its own localized name.
 * Keyboard: typing a digit moves forward, Backspace on an empty cell moves back,
 * ArrowLeft/ArrowRight move between cells; pasting fills all cells.
 * autocomplete="one-time-code" on the first cell lets the browser offer the code.
 */
import {
  useId,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cx } from '../cx';
import { Icon } from '../icon/Icon';

export interface OtpFieldProps {
  label: string;
  /** Localized name of one cell, e.g. (i) => `Цифра ${i}`. */
  cellLabel: (position: number) => string;
  length?: number;
  value: string;
  onValueChange: (value: string) => void;
  error?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Layout only. */
  className?: string;
}

const DIGIT = /^\d$/;

export function OtpField({
  label,
  cellLabel,
  length = 4,
  value,
  onValueChange,
  error,
  hint,
  disabled = false,
  autoFocus = false,
  className,
}: OtpFieldProps) {
  const id = useId();
  const cells = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;

  const focusCell = (index: number) => {
    cells.current[Math.max(0, Math.min(length - 1, index))]?.focus();
  };

  const setDigit = (index: number, digit: string) => {
    const next = [...digits];
    next[index] = digit;
    onValueChange(next.join('').slice(0, length));
  };

  const handleKeyDown = (
    index: number,
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (DIGIT.test(event.key)) {
      event.preventDefault();
      setDigit(index, event.key);
      focusCell(index + 1);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      if (digits[index]) {
        setDigit(index, '');
      } else if (index > 0) {
        setDigit(index - 1, '');
        focusCell(index - 1);
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusCell(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusCell(index + 1);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '');
    if (!pasted) return;
    event.preventDefault();
    onValueChange(pasted.slice(0, length));
    focusCell(pasted.length);
  };

  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <span id={`${id}-label`} className="text-sm font-medium text-fg">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={
          [errorId, hintId].filter(Boolean).join(' ') || undefined
        }
        className="flex gap-3"
      >
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(element) => {
              cells.current[index] = element;
            }}
            aria-label={cellLabel(index + 1)}
            aria-invalid={error ? true : undefined}
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            autoFocus={autoFocus && index === 0}
            maxLength={1}
            disabled={disabled}
            value={digit}
            onChange={(event) => {
              // Fallback for input without keydown (mobile keyboards, autofill)
              const typed = event.target.value.replace(/\D/g, '');
              if (typed.length > 1) {
                onValueChange(typed.slice(0, length));
                focusCell(typed.length);
              } else if (typed) {
                setDigit(index, typed);
                focusCell(index + 1);
              }
            }}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={handlePaste}
            onFocus={(event) => event.target.select()}
            className={cx(
              'size-(--ph-size-touch-pos) rounded-(--ph-input-radius) border border-(--ph-input-border)',
              'bg-(--ph-input-bg) text-center text-xl font-bold text-fg tabular-nums',
              'focus-visible:border-(--ph-input-border-focus) focus-visible:bg-surface',
              'aria-invalid:border-(--ph-input-border-invalid) disabled:text-fg-disabled',
            )}
          />
        ))}
      </div>
      {error && (
        <p id={errorId} className="flex items-start gap-1 text-xs text-danger">
          <Icon name="circle-alert" size="xs" className="mt-0.5" />
          <span>{error}</span>
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-xs text-fg-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}
