'use client';

import { PIN_MAX_LENGTH } from '@pharmacy/shared-domain';
import type { BoundTerminal, EmployeeSession } from '@pharmacy/shared-dto';
import { Alert, Button, Keypad, RadioCardGroup, TextField } from '@pharmacy/ui';
import { useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { ApiError } from '@/shared/api';
import { usePinLogin } from '../api/pin-login';
import { isPinComplete, onlyDigits } from '../model/pin';

export interface PinLoginFormProps {
  terminal: BoundTerminal;
  onSuccess: (session: EmployeeSession) => void;
}

/**
 * Cashier switching on a bound terminal (ADR-0008): pick the cashier, then the PIN — the PIN is
 * not an identifier. The field accepts the hardware keyboard; the keypad types into it.
 */
export function PinLoginForm({ terminal, onSuccess }: PinLoginFormProps) {
  const t = useTranslations('auth.pin');
  const tErrors = useTranslations('errors');
  const [cashier, setCashier] = useState(
    terminal.cashiers[0]?.employeeId ?? '',
  );
  const [pin, setPin] = useState('');
  const [touched, setTouched] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);
  const login = usePinLogin();
  const complete = isPinComplete(pin, terminal.pinLength);

  const submitError = (() => {
    const error = login.error;
    if (!error) return null;
    if (error instanceof ApiError) {
      if (error.code === 'invalid_pin') return t('invalid');
      if (error.code === 'pin_locked') return t('locked');
      if (error.code === 'terminal_locked') return t('terminalLocked');
      if (error.code === 'network' || error.code === 'timeout') {
        return tErrors('network');
      }
    }
    return tErrors('unexpected', {
      correlationId: error instanceof ApiError ? error.correlationId : '—',
    });
  })();

  const update = (next: string) => {
    setPin(onlyDigits(next));
    if (login.error) login.reset();
  };

  return (
    <form
      noValidate
      className="grid grid-cols-2 items-start gap-8"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!cashier || !complete) return;
        login.mutate(
          { employeeId: cashier, pin },
          {
            onSuccess,
            onError: () => {
              setPin('');
              pinRef.current?.focus();
            },
          },
        );
      }}
    >
      <div className="flex flex-col gap-5">
        {terminal.cashiers.length === 0 ? (
          <Alert tone="warning">{t('noCashiers')}</Alert>
        ) : (
          <RadioCardGroup
            label={t('cashier')}
            value={cashier}
            onValueChange={(value) => {
              setCashier(value);
              update('');
              pinRef.current?.focus();
            }}
            columns={2}
            options={terminal.cashiers.map((item) => ({
              value: item.employeeId,
              title: item.shortName,
              icon: 'user',
            }))}
          />
        )}
        <TextField
          ref={pinRef}
          label={t('enter')}
          hint={t('hint', { length: terminal.pinLength })}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={PIN_MAX_LENGTH}
          mono
          required
          value={pin}
          error={
            touched && !complete
              ? t('tooShort', { length: terminal.pinLength })
              : undefined
          }
          onChange={(event) => update(event.target.value)}
        />
        {submitError && (
          <Alert tone="danger" live="assertive">
            {submitError}
          </Alert>
        )}
        <Button
          type="submit"
          size="lg"
          block
          loading={login.isPending}
          disabled={terminal.cashiers.length === 0}
        >
          {t('submit')}
        </Button>
      </div>
      <Keypad
        label={t('keypad')}
        backspaceLabel={t('backspace')}
        clearLabel={t('clear')}
        size="primary"
        disabled={login.isPending}
        onDigit={(digit) => update(pin + digit)}
        onBackspace={() => update(pin.slice(0, -1))}
        onClear={() => update('')}
      />
    </form>
  );
}
