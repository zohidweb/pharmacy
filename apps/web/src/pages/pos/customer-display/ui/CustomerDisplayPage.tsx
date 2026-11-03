'use client';

import { formatMoney } from '@pharmacy/shared-util';
import { cx } from '@pharmacy/ui';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { getLocale, setLocale, WithMessages } from '@/shared/i18n';
import {
  DISPLAY_PROTOCOL,
  isDisplayMessage,
  openDisplayChannel,
  type DisplayState,
} from '@/shared/lib/customer-display';

/** «Спасибо за покупку!» stays this long without a new receipt (D3). */
const THANKS_MS = 10_000;

/**
 * The customer display (spec 2026-11-03-pos-store-ideas, D1–D7): a window on the buyer's monitor that only shows what
 * the POS of its terminal sends over the BroadcastChannel — no session, no requests of its own.
 */
function CustomerDisplayView() {
  const t = useTranslations('pos.customerDisplay');
  const tPos = useTranslations('pos');
  const terminal = useSearchParams()?.get('terminal') ?? '';
  const [state, setState] = useState<DisplayState | null>(null);
  // the sales whose «thank you» is over: a repeated state of the same sale does not show it again
  const thanked = useRef(new Set<string>());
  const [fullscreen, setFullscreen] = useState(true);
  const [fullscreenRefused, setFullscreenRefused] = useState(false);

  useEffect(() => {
    if (!terminal) return;
    const channel = openDisplayChannel(terminal);
    if (!channel) return;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!isDisplayMessage(event.data) || event.data.kind !== 'state') return;
      const next = event.data.state;
      if (next.screen === 'done' && thanked.current.has(next.saleId)) {
        setState({
          screen: 'idle',
          storeName: next.storeName,
          locale: next.locale,
        });
        return;
      }
      // the «thank you» stays its 10 s when the cashier closes the receipt dialog: only a new receipt interrupts it
      setState((current) =>
        current?.screen === 'done' && next.screen === 'idle' ? current : next,
      );
    };
    channel.postMessage({ v: DISPLAY_PROTOCOL, kind: 'hello' });
    return () => channel.close();
  }, [terminal]);

  // the language of the receipt (R1)
  const locale = state?.locale;
  useEffect(() => {
    if (locale && locale !== getLocale()) setLocale(locale);
  }, [locale]);

  // keyed on the sale, not the state: the same «thank you» sent again (a `hello` answer) keeps its 10 s
  const doneSale = state?.screen === 'done' ? state.saleId : null;
  useEffect(() => {
    if (doneSale === null) return;
    const timer = setTimeout(() => {
      thanked.current.add(doneSale);
      setState((current) =>
        current?.screen === 'done' && current.saleId === doneSale
          ? {
              screen: 'idle',
              storeName: current.storeName,
              locale: current.locale,
            }
          : current,
      );
    }, THANKS_MS);
    return () => clearTimeout(timer);
  }, [doneSale]);

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement !== null);
    update();
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  const goFullscreen = () => {
    document.documentElement
      .requestFullscreen()
      .catch(() => setFullscreenRefused(true));
  };

  let body;
  if (!terminal) {
    body = (
      <p className="m-auto px-8 text-center text-2xl text-fg-muted">
        {t('noTerminal')}
      </p>
    );
  } else if (!state || state.screen === 'idle') {
    body = (
      <div className="m-auto flex flex-col items-center gap-4 px-8 text-center">
        {state?.storeName && (
          <span className="text-3xl font-bold">{state.storeName}</span>
        )}
        <span className="text-2xl text-fg-muted">{t('welcome')}</span>
      </div>
    );
  } else if (state.screen === 'done') {
    body = (
      <div className="m-auto flex flex-col items-center gap-4 px-8 text-center">
        <span className="text-3xl font-bold text-primary">{t('thanks')}</span>
        <span className="text-2xl tabular-nums">
          {t('paid', { amount: formatMoney(state.totalMinor) })}
        </span>
        {state.changeMinor > 0 && (
          <span className="text-2xl font-bold tabular-nums">
            {t('change', { amount: formatMoney(state.changeMinor) })}
          </span>
        )}
      </div>
    );
  } else {
    body = (
      <>
        {state.storeName && (
          <header className="border-b border-border bg-surface px-8 py-4 text-xl font-bold">
            {state.storeName}
          </header>
        )}
        <ul
          aria-label={t('lines')}
          className="m-0 flex min-h-0 flex-1 list-none flex-col gap-1 overflow-y-auto px-6 py-4"
        >
          {state.lines.map((line) => (
            <li
              key={line.key}
              className={cx(
                'flex items-baseline gap-6 rounded-md px-4 py-3 text-2xl',
                line.key === state.changedKey && 'bg-primary-subtle',
              )}
            >
              <span className="min-w-0 flex-1">{line.name}</span>
              <span className="text-xl text-fg-muted tabular-nums">
                {line.quantity} {tPos(`units.${line.unit}`)} ×{' '}
                {formatMoney(line.unitPriceMinor)}
              </span>
              <span className="font-bold tabular-nums">
                {formatMoney(line.amountMinor)}
              </span>
            </li>
          ))}
        </ul>
        <footer className="flex flex-col gap-2 border-t border-border bg-surface px-8 py-6 text-xl">
          <div className="flex justify-between tabular-nums">
            <span>{t('subtotal')}</span>
            <span>{formatMoney(state.subtotalMinor)}</span>
          </div>
          {state.discountMinor > 0 && (
            <div className="flex justify-between tabular-nums">
              <span>{t('discount', { percent: state.discountPercent })}</span>
              <span>−{formatMoney(state.discountMinor)}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between text-3xl font-bold tabular-nums">
            <span>{t('toPay')}</span>
            <span className="text-primary">
              {formatMoney(state.totalMinor)}
            </span>
          </div>
          {state.payment && (
            <div className="mt-2 flex flex-col gap-1 border-t border-border pt-3 text-xl tabular-nums">
              {state.payment.payments.map((payment) => (
                <div key={payment.method} className="flex justify-between">
                  <span>{tPos(`methods.${payment.method}`)}</span>
                  <span>{formatMoney(payment.amountMinor)}</span>
                </div>
              ))}
              {state.payment.tenderedMinor !== null && (
                <div className="flex justify-between">
                  <span>{t('tendered')}</span>
                  <span>{formatMoney(state.payment.tenderedMinor)}</span>
                </div>
              )}
              {state.payment.changeMinor > 0 && (
                <div className="flex justify-between font-bold">
                  <span>{t('changeLabel')}</span>
                  <span>{formatMoney(state.payment.changeMinor)}</span>
                </div>
              )}
            </div>
          )}
        </footer>
      </>
    );
  }

  return (
    <main className="flex h-dvh flex-col bg-bg text-fg">
      {body}
      {!fullscreen && !fullscreenRefused && (
        // the Fullscreen API needs a gesture in this window (D6)
        <button
          type="button"
          onClick={goFullscreen}
          className="fixed inset-0 z-(--ph-z-overlay) flex items-end justify-center bg-transparent pb-8"
        >
          <span className="rounded-full bg-surface px-6 py-3 text-lg shadow-lg">
            {t('tapToFullscreen')}
          </span>
        </button>
      )}
    </main>
  );
}

export function CustomerDisplayPage() {
  return (
    <Suspense>
      <WithMessages groups={['pos']}>
        <CustomerDisplayView />
      </WithMessages>
    </Suspense>
  );
}
