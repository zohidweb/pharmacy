/*
 * Protocol of the customer display (spec 2026-11-03-pos-store-ideas, D1–D7): the POS window sends the state of the
 * receipt to the window on the buyer's monitor over a BroadcastChannel of the same origin and the same terminal. Nothing
 * leaves the PC and it works without the connection. A display that opens or reloads asks with `hello` and the POS
 * answers with its state. Only what the buyer may see: no batches, expiry dates, purchase prices or ПКУ data (D4).
 */
import type { ReceiptPaymentMethod, SaleUnit } from '@pharmacy/shared-dto';
import type { Locale } from '@/shared/i18n';

export const DISPLAY_PROTOCOL = 1;

export interface DisplayLine {
  key: string;
  name: string;
  unit: SaleUnit;
  quantity: number;
  unitPriceMinor: number;
  amountMinor: number;
}

export interface DisplayPayment {
  method: ReceiptPaymentMethod;
  amountMinor: number;
}

interface DisplayBase {
  storeName: string | null;
  /** The language of the receipt — the interface language of the POS. */
  locale: Locale;
}

export type DisplayState =
  | (DisplayBase & { screen: 'idle' })
  | (DisplayBase & {
      screen: 'receipt';
      lines: DisplayLine[];
      /** The line added or changed last: highlighted. */
      changedKey: string | null;
      subtotalMinor: number;
      discountPercent: number;
      discountMinor: number;
      totalMinor: number;
      /** null — the cashier has not started the payment yet. */
      payment: {
        payments: DisplayPayment[];
        /** Cash handed over; null — exactly the cash part. */
        tenderedMinor: number | null;
        changeMinor: number;
      } | null;
    })
  | (DisplayBase & {
      screen: 'done';
      /** The sale (its idempotency key): the display shows its «thank you» once, not again on a repeated state. */
      saleId: string;
      totalMinor: number;
      changeMinor: number;
    });

export type DisplayMessage =
  | { v: typeof DISPLAY_PROTOCOL; kind: 'state'; state: DisplayState }
  | { v: typeof DISPLAY_PROTOCOL; kind: 'hello' };

/** True where the browser can carry the protocol. */
export function displaySupported(): boolean {
  return typeof BroadcastChannel !== 'undefined';
}

/** The channel of one terminal; null without BroadcastChannel. */
export function openDisplayChannel(
  terminalId: string,
): BroadcastChannel | null {
  if (!displaySupported()) return null;
  return new BroadcastChannel(`ph-customer-display:${terminalId}`);
}

/** A state the display can show: a known screen, and the lines of a receipt. */
function isDisplayState(data: unknown): data is DisplayState {
  if (typeof data !== 'object' || data === null) return false;
  const state = data as { screen?: unknown; lines?: unknown };
  if (state.screen === 'idle' || state.screen === 'done') return true;
  return state.screen === 'receipt' && Array.isArray(state.lines);
}

/** A message of this version of the protocol; anything else is dropped. */
export function isDisplayMessage(data: unknown): data is DisplayMessage {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as { v?: unknown; kind?: unknown; state?: unknown };
  if (message.v !== DISPLAY_PROTOCOL) return false;
  if (message.kind === 'hello') return true;
  return message.kind === 'state' && isDisplayState(message.state);
}
