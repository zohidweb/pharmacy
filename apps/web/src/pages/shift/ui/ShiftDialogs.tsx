'use client';

import type {
  CashInReason,
  CashMovementKind,
  CashOutReason,
  Shift,
} from '@pharmacy/shared-dto';
import { formatMoney, parseMoneyToMinor } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  Select,
  TextField,
} from '@pharmacy/ui';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

function useMoney(initial = '') {
  const [text, setText] = useState(initial);
  const minor = text.trim() === '' ? null : parseMoneyToMinor(text);
  return { text, setText, minor };
}

export function OpenShiftDialog({
  open,
  storeName,
  cashierName,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  storeName: string;
  cashierName: string;
  busy: boolean;
  onConfirm: (openingCashMinor: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations('shift');
  const opening = useMoney('0');
  const [touched, setTouched] = useState(false);
  const invalid = opening.minor === null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('openTitle')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            loading={busy}
            onClick={() => {
              setTouched(true);
              if (opening.minor !== null) onConfirm(opening.minor);
            }}
          >
            {t('openAction')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <TextField label={t('store')} value={storeName} readOnly />
          <TextField label={t('cashier')} value={cashierName} readOnly />
        </div>
        <TextField
          label={t('openingCash')}
          inputMode="decimal"
          value={opening.text}
          error={touched && invalid ? t('amountFormat') : undefined}
          onChange={(event) => opening.setText(event.target.value)}
        />
        <p className="text-xs text-fg-subtle">{t('openHint')}</p>
      </div>
    </Dialog>
  );
}

export function CashMovementDialog({
  kind,
  shift,
  busy,
  onConfirm,
  onClose,
}: {
  kind: CashMovementKind | null;
  shift: Shift;
  busy: boolean;
  onConfirm: (input: {
    kind: CashMovementKind;
    amountMinor: number;
    reason: CashInReason | CashOutReason;
    comment: string;
  }) => void;
  onClose: () => void;
}) {
  const t = useTranslations('shift');
  const amount = useMoney();
  const [reason, setReason] = useState<CashInReason | CashOutReason>(
    kind === 'out' ? 'collection' : 'change_fund',
  );
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const minor = amount.minor ?? 0;
  const after = shift.cash.expectedMinor + (kind === 'out' ? -minor : minor);
  const invalid = amount.minor === null || minor <= 0;
  const reasons =
    kind === 'out'
      ? (['collection', 'expense'] as const)
      : (['change_fund', 'other'] as const);
  return (
    <Dialog
      open={kind !== null}
      onClose={onClose}
      title={kind === 'out' ? t('cashOut') : t('cashIn')}
      description={t('shiftNumber', { number: shift.number })}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            loading={busy}
            onClick={() => {
              setTouched(true);
              if (!invalid && kind) {
                onConfirm({
                  kind,
                  amountMinor: minor,
                  reason,
                  comment: comment.trim(),
                });
              }
            }}
          >
            {kind === 'out' ? t('cashOut') : t('cashIn')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label={t('amount')}
          inputMode="decimal"
          value={amount.text}
          error={touched && invalid ? t('amountPositive') : undefined}
          onChange={(event) => amount.setText(event.target.value)}
        />
        <Select
          label={t('reason')}
          value={reason}
          onChange={(event) =>
            setReason(event.target.value as CashInReason | CashOutReason)
          }
          options={reasons.map((value) => ({
            value,
            label: t(`reasons.${value}`),
          }))}
        />
        <TextField
          label={t('comment')}
          hint={t('optional')}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
        <p className="flex justify-between text-sm">
          <span>{t('inDrawerAfter')}</span>
          <b className="tabular-nums">{formatMoney(after)}</b>
        </p>
        {kind === 'out' && after < 0 && (
          <Alert tone="warning">{t('drawerNegative')}</Alert>
        )}
      </div>
    </Dialog>
  );
}

const TERMINAL_METHODS = ['card', 'qr', 'nfc'] as const;
type TerminalMethod = (typeof TERMINAL_METHODS)[number];

export function CloseShiftDialog({
  open,
  shift,
  pendingOperations,
  heldReceipts,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  shift: Shift;
  pendingOperations: number;
  heldReceipts: number;
  busy: boolean;
  onConfirm: (input: {
    actualCashMinor: number;
    discrepancyReason: string;
    terminalTotals: Record<TerminalMethod, number>;
  }) => void;
  onClose: () => void;
}) {
  const t = useTranslations('shift');
  const actual = useMoney(
    formatMoney(shift.cash.expectedMinor, { withSign: false }),
  );
  const [reason, setReason] = useState('');
  const [terminal, setTerminal] = useState<Record<TerminalMethod, string>>(
    () =>
      Object.fromEntries(
        TERMINAL_METHODS.map((m) => [
          m,
          formatMoney(shift.byMethod[m].amountMinor, { withSign: false }),
        ]),
      ) as Record<TerminalMethod, string>,
  );
  const [touched, setTouched] = useState(false);
  const discrepancy =
    actual.minor === null ? null : actual.minor - shift.cash.expectedMinor;
  const terminalMinor = (m: TerminalMethod) => parseMoneyToMinor(terminal[m]);
  const terminalInvalid = TERMINAL_METHODS.some(
    (m) => terminalMinor(m) === null,
  );
  const reasonRequired = discrepancy !== null && discrepancy !== 0;
  const invalid =
    actual.minor === null ||
    terminalInvalid ||
    (reasonRequired && reason.trim().length < 3);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('closeTitle')}
      description={t('shiftNumber', { number: shift.number })}
      closeLabel={t('close')}
      size="lg"
      tone="warning"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            loading={busy}
            onClick={() => {
              setTouched(true);
              if (invalid || actual.minor === null) return;
              onConfirm({
                actualCashMinor: actual.minor,
                discrepancyReason: reason.trim(),
                terminalTotals: Object.fromEntries(
                  TERMINAL_METHODS.map((m) => [m, terminalMinor(m) ?? 0]),
                ) as Record<TerminalMethod, number>,
              });
            }}
          >
            {t('closeAndZ')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {pendingOperations > 0 && (
          <Alert tone="warning" title={t('pendingTitle')}>
            {t('pendingClose', { count: pendingOperations })}
          </Alert>
        )}
        {heldReceipts > 0 && (
          <Alert tone="info">{t('heldClose', { count: heldReceipts })}</Alert>
        )}
        <section
          aria-labelledby="cash-reconcile"
          className="flex flex-col gap-3"
        >
          <h3 id="cash-reconcile" className="text-md font-bold">
            {t('cashReconcile')}
          </h3>
          <div className="grid grid-cols-3 items-end gap-4">
            <p className="flex flex-col text-sm">
              <span className="text-fg-subtle">{t('expected')}</span>
              <b className="text-lg tabular-nums">
                {formatMoney(shift.cash.expectedMinor)}
              </b>
            </p>
            <TextField
              label={t('actual')}
              inputMode="decimal"
              value={actual.text}
              error={
                touched && actual.minor === null ? t('amountFormat') : undefined
              }
              onChange={(event) => actual.setText(event.target.value)}
            />
            <p className="flex flex-col text-sm" role="status">
              <span className="text-fg-subtle">{t('discrepancy')}</span>
              <b
                className={
                  discrepancy && discrepancy < 0
                    ? 'text-lg text-danger tabular-nums'
                    : 'text-lg tabular-nums'
                }
              >
                {discrepancy === null ? '—' : formatMoney(discrepancy)}
              </b>
            </p>
          </div>
          {reasonRequired && (
            <TextField
              label={t('discrepancyReason')}
              placeholder={t('discrepancyPlaceholder')}
              required
              value={reason}
              error={
                touched && reason.trim().length < 3
                  ? t('discrepancyReasonRequired')
                  : undefined
              }
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </section>
        <section
          aria-labelledby="terminal-reconcile"
          className="flex flex-col gap-3"
        >
          <h3 id="terminal-reconcile" className="text-md font-bold">
            {t('terminalReconcile')}
          </h3>
          <p className="text-xs text-fg-subtle">{t('terminalHint')}</p>
          <DataTable
            caption={t('terminalReconcile')}
            minWidth="none"
            rowKey={(row) => row}
            rows={TERMINAL_METHODS}
            columns={[
              {
                key: 'method',
                header: t('method'),
                cell: (m) => t(`methods.${m}`),
              },
              {
                key: 'system',
                header: t('bySystem'),
                numeric: true,
                cell: (m) => formatMoney(shift.byMethod[m].amountMinor),
              },
              {
                key: 'terminal',
                header: t('byTerminal'),
                cell: (m) => (
                  <TextField
                    label={t('byTerminalOf', { method: t(`methods.${m}`) })}
                    hideLabel
                    inputMode="decimal"
                    value={terminal[m]}
                    error={
                      touched && terminalMinor(m) === null
                        ? t('amountFormat')
                        : undefined
                    }
                    onChange={(event) =>
                      setTerminal((current) => ({
                        ...current,
                        [m]: event.target.value,
                      }))
                    }
                  />
                ),
              },
              {
                key: 'diff',
                header: t('diff'),
                numeric: true,
                cell: (m) => {
                  const value = terminalMinor(m);
                  return value === null
                    ? '—'
                    : formatMoney(value - shift.byMethod[m].amountMinor);
                },
              },
            ]}
          />
        </section>
        <Alert tone="warning">{t('closeWarning')}</Alert>
      </div>
    </Dialog>
  );
}
