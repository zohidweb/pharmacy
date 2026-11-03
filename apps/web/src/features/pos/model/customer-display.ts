'use client';

/*
 * The POS side of the customer display (spec 2026-11-03-pos-store-ideas, D2, D3, D7): the state of the receipt goes to
 * the channel of the terminal coalesced by a short timer (not a frame: a window that is not drawn, e.g. covered by
 * another program, runs no animation frames), a display that says `hello` gets the current state, and the display
 * goes idle when the POS page unmounts (sign-out, another screen), the POS tab is closed or reloaded (`pagehide`) or
 * there is no open shift. A tab that comes back from the page cache sends its state again.
 */
import type { DiscountRule } from '@pharmacy/shared-domain';
import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/shared/i18n';
import {
  DISPLAY_PROTOCOL,
  isDisplayMessage,
  openDisplayChannel,
  type DisplayQr,
  type DisplayState,
} from '@/shared/lib/customer-display';
import {
  lineAmount,
  paymentState,
  totals,
  type DraftLine,
  type ReceiptDraft,
} from './receipt';

/** Changes within this window go to the display as one state. */
const SEND_DELAY_MS = 50;
/** The payment QR reaches the buyer once it stopped changing for this long: no QR of an amount still being typed. */
const QR_SETTLE_MS = 1000;

export interface CustomerDisplayInput {
  terminalId: string | null;
  storeName: string | null;
  locale: Locale;
  draft: ReceiptDraft;
  rules: readonly DiscountRule[];
  /** The sale just paid, while its receipt dialog is open. */
  done: { saleId: string; totalMinor: number; changeMinor: number } | null;
  /** An open shift and a POS that may sell. */
  active: boolean;
  /** The payment QR of the QR part (`usePaymentQr`). */
  qr: DisplayQr | null;
}

/** The line added or whose quantity changed since `before`; else the last highlighted one if it is still there. */
function changedLine(
  before: readonly DraftLine[],
  after: readonly DraftLine[],
  last: string | null,
): string | null {
  const old = new Map(before.map((line) => [line.key, line.quantity]));
  const changed = after.find((line) => old.get(line.key) !== line.quantity);
  if (changed) return changed.key;
  return after.some((line) => line.key === last) ? last : null;
}

/**
 * What the buyer sees (D3, D4): only names, quantities and money; the payment once the cashier started it (R6) and
 * while the bank-terminal parts fit the total — a part above it is the cashier's mistake to fix, not the buyer's.
 */
export function displayStateOf(
  c: Omit<CustomerDisplayInput, 'terminalId'>,
  changedKey: string | null,
): DisplayState {
  const base = { storeName: c.storeName, locale: c.locale };
  if (!c.active) return { ...base, screen: 'idle' };
  if (c.draft.lines.length === 0) {
    return c.done
      ? { ...base, screen: 'done', ...c.done }
      : { ...base, screen: 'idle' };
  }
  const sum = totals(c.draft, c.rules);
  const payment = paymentState(c.draft, sum.totalMinor);
  const started =
    (payment.nonCashMinor > 0 || c.draft.cashTenderedMinor !== null) &&
    payment.problem !== 'non_cash_exceeds_total';
  return {
    ...base,
    screen: 'receipt',
    lines: c.draft.lines.map((line) => ({
      key: line.key,
      name: line.name,
      unit: line.unit,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      amountMinor: lineAmount(line),
    })),
    changedKey,
    subtotalMinor: sum.subtotalMinor,
    discountPercent: sum.discount.percent,
    discountMinor: sum.discount.amountMinor,
    totalMinor: sum.totalMinor,
    payment: started
      ? {
          payments: payment.payments,
          tenderedMinor: c.draft.cashTenderedMinor,
          changeMinor: payment.changeMinor,
          qr: c.qr,
        }
      : null,
  };
}

/** `value` once it has stayed the same for `ms`; null before that and while it changes. */
function useSettled<T>(value: T | null, ms: number): T | null {
  const [settled, setSettled] = useState<T | null>(null);
  useEffect(() => {
    if (value === null) return;
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return value !== null && settled === value ? value : null;
}

export function useCustomerDisplay(c: CustomerDisplayInput): void {
  const channel = useRef<BroadcastChannel | null>(null);
  const latest = useRef<DisplayState | null>(null);
  const lines = useRef<readonly DraftLine[]>([]);
  const changedKey = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { terminalId, storeName, locale, draft, rules, done, active } = c;
  // typing the QR part of a mixed payment changes the amount per key; the buyer could scan 12,00 on the way to 125,50
  const qr = useSettled(c.qr, QR_SETTLE_MS);
  const saleId = done?.saleId ?? null;
  const doneTotal = done?.totalMinor ?? 0;
  const doneChange = done?.changeMinor ?? 0;

  useEffect(() => {
    if (!terminalId) return;
    const opened = openDisplayChannel(terminalId);
    if (!opened) return;
    channel.current = opened;
    const post = (state: DisplayState) =>
      opened.postMessage({ v: DISPLAY_PROTOCOL, kind: 'state', state });
    const postLatest = () => {
      if (latest.current) post(latest.current);
    };
    const postIdle = () => {
      const base = latest.current ?? {
        storeName: null,
        locale: 'ru' as Locale,
      };
      post({ storeName: base.storeName, locale: base.locale, screen: 'idle' });
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) postLatest();
    };
    opened.onmessage = (event: MessageEvent<unknown>) => {
      if (isDisplayMessage(event.data) && event.data.kind === 'hello') {
        postLatest();
      }
    };
    postLatest();
    window.addEventListener('pagehide', postIdle);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pagehide', postIdle);
      window.removeEventListener('pageshow', onPageShow);
      if (timer.current !== null) clearTimeout(timer.current);
      postIdle();
      opened.close();
      channel.current = null;
    };
  }, [terminalId]);

  useEffect(() => {
    changedKey.current = changedLine(
      lines.current,
      draft.lines,
      changedKey.current,
    );
    lines.current = draft.lines;
    latest.current = displayStateOf(
      {
        storeName,
        locale,
        draft,
        rules,
        done: saleId
          ? { saleId, totalMinor: doneTotal, changeMinor: doneChange }
          : null,
        active,
        qr,
      },
      changedKey.current,
    );
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (channel.current && latest.current) {
        channel.current.postMessage({
          v: DISPLAY_PROTOCOL,
          kind: 'state',
          state: latest.current,
        });
      }
    }, SEND_DELAY_MS);
  }, [
    storeName,
    locale,
    draft,
    rules,
    saleId,
    doneTotal,
    doneChange,
    active,
    qr,
  ]);
}
