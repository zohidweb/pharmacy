'use client';

import { nextDiscount, type DiscountRule } from '@pharmacy/shared-domain';
import type { ReceiptPaymentMethod } from '@pharmacy/shared-dto';
import {
  formatDateOnly,
  formatMoney,
  parseMoneyToMinor,
} from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  cx,
  EmptyState,
  Icon,
  IconButton,
  TextField,
  type IconName,
} from '@pharmacy/ui';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { PrescriptionBadge } from '@/entities/catalog';
import {
  lineAmount,
  paymentState,
  totals,
  type DraftLine,
  type NonCashMethod,
  type ReceiptDraft,
} from '../model/receipt';

const METHODS: Array<{ method: ReceiptPaymentMethod; icon: IconName }> = [
  { method: 'cash', icon: 'banknote' },
  { method: 'card', icon: 'credit-card' },
  { method: 'qr', icon: 'qr-code' },
  { method: 'nfc', icon: 'nfc' },
];

export interface CartPanelProps {
  draft: ReceiptDraft;
  rules: readonly DiscountRule[];
  canChooseBatch: boolean;
  busy: boolean;
  /** Writes are not possible (no open shift, view-only session). */
  locked: string | null;
  onQuantity: (line: DraftLine, quantity: number) => void;
  onRemove: (line: DraftLine) => void;
  onBatch: (line: DraftLine) => void;
  onControlled: (line: DraftLine) => void;
  onPayAllBy: (method: ReceiptPaymentMethod) => void;
  onNonCash: (method: NonCashMethod, amountMinor: number) => void;
  onTendered: (amountMinor: number | null) => void;
  onHold: () => void;
  onCancel: () => void;
  onPay: () => void;
}

function MoneyInput({
  label,
  valueMinor,
  onChange,
  disabled,
}: {
  label: string;
  valueMinor: number | null;
  onChange: (minor: number | null) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(
    valueMinor === null ? '' : formatMoney(valueMinor, { withSign: false }),
  );
  const t = useTranslations('pos');
  const parsed = text.trim() === '' ? null : parseMoneyToMinor(text);
  return (
    <TextField
      label={label}
      inputMode="decimal"
      autoComplete="off"
      disabled={disabled}
      value={text}
      error={
        text.trim() !== '' && parsed === null ? t('amountFormat') : undefined
      }
      onChange={(event) => {
        setText(event.target.value);
        const value = event.target.value.trim();
        if (value === '') onChange(null);
        else {
          const minor = parseMoneyToMinor(value);
          if (minor !== null) onChange(minor);
        }
      }}
    />
  );
}

function Line({
  line,
  canChooseBatch,
  onQuantity,
  onRemove,
  onBatch,
  onControlled,
}: {
  line: DraftLine;
  canChooseBatch: boolean;
} & Pick<
  CartPanelProps,
  'onQuantity' | 'onRemove' | 'onBatch' | 'onControlled'
>) {
  const t = useTranslations('pos');
  const unit = t(`units.${line.unit}`);
  return (
    <li className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {line.name}
            <PrescriptionBadge kind={line.prescription} />
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-fg-subtle">
            <span>
              {t('lineDetail', {
                quantity: line.quantity,
                unit,
                price: formatMoney(line.unitPriceMinor),
              })}
            </span>
            {canChooseBatch ? (
              <button
                type="button"
                onClick={() => onBatch(line)}
                className="min-h-touch rounded-sm text-primary underline"
              >
                {t('batchOf', {
                  batch: line.batchNumber,
                  expires: formatDateOnly(line.expiresOn),
                })}
                {!line.manualBatch && ' · FEFO'}
              </button>
            ) : (
              <span>
                {t('batchOf', {
                  batch: line.batchNumber,
                  expires: formatDateOnly(line.expiresOn),
                })}
              </span>
            )}
          </span>
        </div>
        <span className="text-sm font-bold tabular-nums">
          {formatMoney(lineAmount(line))}
        </span>
      </div>
      {line.prescription === 'controlled' && (
        <Button
          variant={line.controlled ? 'tertiary' : 'secondary'}
          iconStart={line.controlled ? 'circle-check' : 'file-text'}
          onClick={() => onControlled(line)}
        >
          {line.controlled ? t('controlledFilled') : t('controlledRequired')}
        </Button>
      )}
      <div className="flex items-center gap-2">
        <IconButton
          icon="trash-2"
          label={t('removeLine', { name: line.name })}
          variant="surface"
          onClick={() => onRemove(line)}
        />
        <span className="ms-auto flex items-center gap-2">
          <button
            type="button"
            aria-label={t('decrease', { name: line.name })}
            onClick={() => onQuantity(line, line.quantity - 1)}
            className="grid min-h-touch-pos min-w-touch-pos place-items-center rounded-md border border-border text-lg hover:bg-surface-sunken"
          >
            −
          </button>
          <output
            aria-label={t('quantityOf', { name: line.name })}
            className="min-w-touch text-center text-lg font-bold tabular-nums"
          >
            {line.quantity}
          </output>
          <button
            type="button"
            aria-label={t('increase', { name: line.name })}
            onClick={() => onQuantity(line, line.quantity + 1)}
            className="grid min-h-touch-pos min-w-touch-pos place-items-center rounded-md border border-border text-lg hover:bg-surface-sunken"
          >
            +
          </button>
        </span>
      </div>
    </li>
  );
}

/** Receipt lines, totals with the discount threshold, mixed payment and change, «Оплатить». */
export function CartPanel(props: CartPanelProps) {
  const { draft, rules, busy, locked } = props;
  const t = useTranslations('pos');
  const [mixed, setMixed] = useState(
    draft.nonCash.card + draft.nonCash.qr + draft.nonCash.nfc > 0,
  );
  const sum = totals(draft, rules);
  const payment = paymentState(draft, sum.totalMinor);
  const next = nextDiscount(sum.subtotalMinor, rules);
  const allNonCash = (['card', 'qr', 'nfc'] as const).find(
    (m) => draft.nonCash[m] === sum.totalMinor && sum.totalMinor > 0,
  );
  const selected: ReceiptPaymentMethod = mixed
    ? 'cash'
    : (allNonCash ?? 'cash');

  return (
    <section
      aria-label={t('receipt')}
      className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-lg bg-surface p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-md font-bold">{t('receipt')}</h2>
        <span className="flex items-center gap-2">
          <span className="text-xs text-fg-subtle">
            {t('positions', { count: draft.lines.length })}
          </span>
          {draft.lines.length > 0 && (
            <Button variant="tertiary" onClick={props.onCancel}>
              {t('cancelReceipt')}
            </Button>
          )}
        </span>
      </div>
      {draft.lines.length === 0 ? (
        <EmptyState
          icon="shopping-cart"
          title={t('emptyReceipt')}
          description={t('emptyReceiptHint')}
        />
      ) : (
        <ul className="m-0 flex min-h-0 flex-1 list-none flex-col overflow-y-auto p-0">
          {draft.lines.map((line) => (
            <Line key={line.key} line={line} {...props} />
          ))}
        </ul>
      )}

      <dl className="m-0 flex flex-col gap-1 border-t border-border pt-3 text-sm">
        <div className="flex justify-between">
          <dt>{t('subtotal')}</dt>
          <dd className="m-0 tabular-nums">{formatMoney(sum.subtotalMinor)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>
            {t('discount', { percent: sum.discount.percent })}
            {next && (
              <span className="ms-2 text-xs text-fg-subtle">
                {t('nextDiscount', {
                  amount: formatMoney(
                    next.minSubtotalMinor - sum.subtotalMinor,
                  ),
                  percent: next.percent,
                })}
              </span>
            )}
          </dt>
          <dd className="m-0 tabular-nums">
            −{formatMoney(sum.discount.amountMinor)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between">
          <dt className="text-lg font-bold">{t('total')}</dt>
          <dd className="m-0 text-3xl font-bold tabular-nums">
            {formatMoney(sum.totalMinor)}
          </dd>
        </div>
      </dl>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-medium">
          {t('paymentMethod')}
        </legend>
        <div className="grid grid-cols-4 gap-2">
          {METHODS.map(({ method, icon }) => (
            <button
              key={method}
              type="button"
              aria-pressed={!mixed && selected === method}
              disabled={draft.lines.length === 0}
              onClick={() => {
                setMixed(false);
                props.onPayAllBy(method);
              }}
              className={cx(
                'flex min-h-touch-pos flex-col items-center justify-center gap-1 rounded-md border text-xs font-medium transition-colors disabled:text-on-disabled',
                !mixed && selected === method
                  ? 'border-primary bg-primary-subtle text-primary'
                  : 'border-border bg-surface hover:bg-surface-sunken',
              )}
            >
              <Icon name={icon} size="md" />
              {t(`methods.${method}`)}
            </button>
          ))}
        </div>
        <Button
          variant="tertiary"
          iconStart={mixed ? 'x' : 'plus'}
          disabled={draft.lines.length === 0}
          onClick={() => {
            if (mixed) props.onPayAllBy('cash');
            setMixed(!mixed);
          }}
        >
          {mixed ? t('mixedOff') : t('mixedOn')}
        </Button>
        {mixed && (
          <div className="grid grid-cols-3 gap-2">
            {(['card', 'qr', 'nfc'] as const).map((method) => (
              <MoneyInput
                key={method}
                label={t(`methods.${method}`)}
                valueMinor={draft.nonCash[method] || null}
                onChange={(minor) => props.onNonCash(method, minor ?? 0)}
              />
            ))}
          </div>
        )}
        {payment.nonCashMinor > 0 && (
          <p className="text-xs text-fg-subtle">{t('bankTerminalHint')}</p>
        )}
        {payment.cashPartMinor > 0 && (
          <div className="grid grid-cols-2 items-end gap-2">
            <MoneyInput
              key={`tendered-${payment.cashPartMinor}`}
              label={t('tendered', {
                amount: formatMoney(payment.cashPartMinor),
              })}
              valueMinor={draft.cashTenderedMinor}
              onChange={props.onTendered}
            />
            <p
              className="flex min-h-touch flex-col justify-center text-sm"
              role="status"
            >
              <span className="text-fg-subtle">{t('change')}</span>
              <span className="text-xl font-bold tabular-nums">
                {formatMoney(payment.changeMinor)}
              </span>
            </p>
          </div>
        )}
      </fieldset>

      {payment.problem && payment.problem !== 'empty' && (
        <Alert tone="warning" live="polite">
          {t(`problems.${payment.problem}`)}
        </Alert>
      )}
      {locked && <Alert tone="info">{locked}</Alert>}

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          disabled={draft.lines.length === 0 || busy || Boolean(locked)}
          onClick={props.onHold}
          className="min-h-touch-primary rounded-lg border border-border bg-surface text-md font-medium hover:bg-surface-sunken disabled:text-on-disabled"
        >
          {t('hold')}
        </button>
        <button
          type="button"
          disabled={Boolean(payment.problem) || busy || Boolean(locked)}
          onClick={props.onPay}
          className="col-span-2 min-h-touch-primary rounded-lg bg-primary text-xl font-bold text-on-primary hover:bg-primary-hover disabled:bg-disabled disabled:text-on-disabled"
        >
          {t('pay', { amount: formatMoney(sum.totalMinor) })}
        </button>
      </div>
    </section>
  );
}
