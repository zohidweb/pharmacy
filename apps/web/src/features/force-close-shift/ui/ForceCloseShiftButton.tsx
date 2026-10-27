'use client';

import type {
  ReceiptPaymentMethod,
  ShiftDetails,
  ZReport,
} from '@pharmacy/shared-dto';
import {
  formatDateTime,
  formatMoney,
  parseMoneyToMinor,
  uuidv7,
} from '@pharmacy/shared-util';
import { Alert, Button, Dialog, TextareaField, TextField } from '@pharmacy/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { can, useSession } from '@/entities/session';
import { apiRequest, useApiErrorMessage, withFreshAuth } from '@/shared/api';

type BankMethod = Exclude<ReceiptPaymentMethod, 'cash'>;
const BANK: readonly BankMethod[] = ['card', 'qr', 'nfc'];
const REASON_MAX = 500;

/** A signed amount: the net of a bank terminal is negative when its refunds exceed its sales. */
function parseSigned(text: string): number | null {
  const value = text.trim();
  const negative = value.startsWith('-') || value.startsWith('−');
  const minor = parseMoneyToMinor(negative ? value.slice(1) : value);
  return minor === null ? null : negative ? -minor : minor;
}

/**
 * «Закрыть с другого компьютера» (plan 2026-10-27-shift-history, S3): a manager closes the open shift of a broken or
 * unreachable till — the counted cash, the bank terminal and a required reason, under a fresh password. Shown for an
 * open shift to a session with `shifts:force-close`.
 */
export function ForceCloseShiftButton({
  details,
  onClosed,
}: {
  details: ShiftDetails;
  onClosed: (report: ZReport) => void;
}) {
  const t = useTranslations('shiftHistory.forceClose');
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  if (details.shift.status !== 'open' || !can(session, 'shifts:force-close')) {
    return null;
  }
  return (
    <>
      <Button
        variant="destructive"
        iconStart="lock"
        onClick={() => setOpen(true)}
      >
        {t('action')}
      </Button>
      {open && (
        <ForceCloseDialog
          details={details}
          onClose={() => setOpen(false)}
          onClosed={(report) => {
            setOpen(false);
            onClosed(report);
          }}
        />
      )}
    </>
  );
}

function ForceCloseDialog({
  details,
  onClose,
  onClosed,
}: {
  details: ShiftDetails;
  onClose: () => void;
  onClosed: (report: ZReport) => void;
}) {
  const t = useTranslations('shiftHistory.forceClose');
  const tMethods = useTranslations('shift.methods');
  const { shift } = details;
  // one key for every retry of this closing (Idempotency-Key, S3)
  const [key] = useState(() => uuidv7());
  const [cash, setCash] = useState(() =>
    formatMoney(Math.max(0, shift.cash.expectedMinor), { withSign: false }),
  );
  const [bank, setBank] = useState<Record<BankMethod, string>>(
    () =>
      Object.fromEntries(
        BANK.map((m) => [
          m,
          formatMoney(
            shift.byMethod[m].amountMinor -
              shift.returnsByMethod[m].amountMinor,
            { withSign: false },
          ),
        ]),
      ) as Record<BankMethod, string>,
  );
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const cashMinor = cash.trim() === '' ? null : parseMoneyToMinor(cash);
  const bankMinor = (m: BankMethod) => parseSigned(bank[m]);
  const reasonMissing = reason.trim() === '';
  const invalid =
    cashMinor === null ||
    BANK.some((m) => bankMinor(m) === null) ||
    reasonMissing ||
    reason.trim().length > REASON_MAX;
  const close = useMutation({
    mutationFn: () =>
      withFreshAuth(() =>
        apiRequest('shifts.forceClose', {
          params: { id: shift.id },
          idempotencyKey: key,
          body: {
            id: key,
            actualCashMinor: cashMinor ?? 0,
            terminalTotals: Object.fromEntries(
              BANK.map((m) => [m, bankMinor(m) ?? 0]),
            ) as Record<BankMethod, number>,
            reason: reason.trim(),
          },
        }),
      ),
    onSuccess: onClosed,
  });
  const error = useApiErrorMessage(close.error);

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title', { terminal: details.terminalName })}
      description={t('description', { number: shift.number })}
      closeLabel={t('cancel')}
      size="lg"
      tone="warning"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="destructive"
            loading={close.isPending}
            disabled={touched && invalid}
            onClick={() => {
              setTouched(true);
              if (!invalid) close.mutate();
            }}
          >
            {t('submit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <Alert tone="warning" title={t('lateTitle')}>
          {t('late', {
            time: details.lastActivityAt
              ? formatDateTime(details.lastActivityAt)
              : t('noActivity'),
          })}
        </Alert>
        <Alert tone="info">{t('unbind')}</Alert>
        <div className="grid grid-cols-2 items-end gap-4">
          <p className="flex flex-col text-sm">
            <span className="text-fg-subtle">{t('expected')}</span>
            <b className="text-lg tabular-nums">
              {formatMoney(shift.cash.expectedMinor)}
            </b>
          </p>
          <TextField
            label={t('cash')}
            inputMode="decimal"
            required
            value={cash}
            onChange={(event) => setCash(event.target.value)}
            error={
              touched && cashMinor === null ? t('amountInvalid') : undefined
            }
          />
        </div>
        <div className="grid grid-cols-3 gap-4">
          {BANK.map((m) => (
            <TextField
              key={m}
              label={t('bank', { method: tMethods(m) })}
              inputMode="decimal"
              value={bank[m]}
              onChange={(event) =>
                setBank((current) => ({ ...current, [m]: event.target.value }))
              }
              error={
                touched && bankMinor(m) === null
                  ? t('amountInvalid')
                  : undefined
              }
            />
          ))}
        </div>
        <TextareaField
          label={t('reason')}
          required
          maxLength={REASON_MAX}
          hint={t('reasonHint')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={touched && reasonMissing ? t('reasonRequired') : undefined}
        />
      </div>
    </Dialog>
  );
}
