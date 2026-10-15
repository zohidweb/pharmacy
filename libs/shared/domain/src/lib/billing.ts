/*
 * Billing of networks (spec 2026-10-15-billing-services, A2–A4, A7, A8): the charge of a store for
 * the days of a month, the discount and VAT of an invoice, its due date and number, and the
 * allocation of payments to invoices. Money in whole dirams, rounded half up through BigInt; months
 * as YYYY-MM, dates as YYYY-MM-DD. The API and the admin mocks compute with the same functions.
 */
import { daysInMonth } from './expenses';

const DAY_MS = 86_400_000;

const dayOf = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

const dateOf = (day: number) =>
  new Date(day * DAY_MS).toISOString().slice(0, 10);

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** a × b / c, half up, for non-negative integers. */
function mulDivHalfUp(a: number, b: number, c: number): number {
  return Number((2n * BigInt(a) * BigInt(b) + BigInt(c)) / (2n * BigInt(c)));
}

function nextMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return monthNumber === 12
    ? `${year + 1}-01`
    : `${year}-${String(monthNumber + 1).padStart(2, '0')}`;
}

/**
 * Billed days of a store in `month` (A2, B15): from its first sale ever, or the 1st when it sold
 * before, to the day it was closed, or the end of the month; both ends included.
 */
export function billedDays(
  month: string,
  firstSaleEver: string,
  closedOn: string | null,
): number {
  const first = dayOf(`${month}-01`);
  const last = first + daysInMonth(month) - 1;
  const from = Math.max(first, dayOf(firstSaleEver));
  const to = closedOn === null ? last : Math.min(last, dayOf(closedOn));
  return Math.max(0, to - from + 1);
}

/** The charge of a store: tariff × days / days of the month, half up (A3). */
export function storeCharge(
  priceMinor: number,
  days: number,
  daysOfMonth: number,
): number {
  return mulDivHalfUp(priceMinor, days, daysOfMonth);
}

/** The discount of a store line: amount × basis points / 10 000, half up (A3). */
export function discountOf(amountMinor: number, percentBp: number): number {
  return mulDivHalfUp(amountMinor, percentBp, 10_000);
}

/** VAT of an invoice: the sum of its lines × basis points / 10 000, half up (A3). */
export function vatOf(subtotalMinor: number, vatBp: number): number {
  return mulDivHalfUp(subtotalMinor, vatBp, 10_000);
}

export interface ComposeInput {
  /** YYYY-MM. */
  period: string;
  pricePerStoreMinor: number;
  vatBp: number;
  /** The discount of the network for the period (A10); services get none (B10). */
  discountBp: number | null;
  stores: ReadonlyArray<{
    storeId: string;
    name: string;
    firstSaleEver: string;
    closedOn: string | null;
  }>;
  services: ReadonlyArray<{
    tenantServiceId: string;
    name: string;
    priceMinor: number;
    providedOn: string;
  }>;
}

export interface ComposedLine {
  kind: 'store' | 'service';
  description: string;
  storeId: string | null;
  days: number | null;
  daysInMonth: number | null;
  baseMinor: number | null;
  discountBp: number | null;
  discountMinor: number | null;
  tenantServiceId: string | null;
  providedOn: string | null;
  amountMinor: number;
}

export interface ComposedInvoice {
  lines: ComposedLine[];
  subtotalMinor: number;
  vatMinor: number;
  totalMinor: number;
}

/**
 * The lines and sums of an invoice: stores by name (a store without billed days is left out), then
 * services by the day they were provided; VAT on the sum of the lines.
 */
export function composeInvoice(input: ComposeInput): ComposedInvoice {
  const dim = daysInMonth(input.period);
  const discountBp = input.discountBp ?? 0;
  const lines: ComposedLine[] = [];
  const stores = [...input.stores].sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'ru') || compare(a.storeId, b.storeId),
  );
  for (const store of stores) {
    const days = billedDays(input.period, store.firstSaleEver, store.closedOn);
    if (days === 0) continue;
    const base = storeCharge(input.pricePerStoreMinor, days, dim);
    const discount = discountOf(base, discountBp);
    lines.push({
      kind: 'store',
      description: store.name,
      storeId: store.storeId,
      days,
      daysInMonth: dim,
      baseMinor: base,
      discountBp,
      discountMinor: discount,
      tenantServiceId: null,
      providedOn: null,
      amountMinor: base - discount,
    });
  }
  const services = [...input.services].sort(
    (a, b) =>
      compare(a.providedOn, b.providedOn) ||
      compare(a.tenantServiceId, b.tenantServiceId),
  );
  for (const service of services) {
    lines.push({
      kind: 'service',
      description: service.name,
      storeId: null,
      days: null,
      daysInMonth: null,
      baseMinor: null,
      discountBp: null,
      discountMinor: null,
      tenantServiceId: service.tenantServiceId,
      providedOn: service.providedOn,
      amountMinor: service.priceMinor,
    });
  }
  const subtotalMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  const vatMinor = vatOf(subtotalMinor, input.vatBp);
  return {
    lines,
    subtotalMinor,
    vatMinor,
    totalMinor: subtotalMinor + vatMinor,
  };
}

/** Invoices of a month are generated from the 3rd of the next month (A1). */
export function generationOpensOn(period: string): string {
  return `${nextMonth(period)}-03`;
}

/** The 15th of the next month, but not earlier than 10 days after the invoice was issued (A4). */
export function invoiceDueOn(period: string, issuedOn: string): string {
  return dateOf(
    Math.max(dayOf(`${nextMonth(period)}-15`), dayOf(issuedOn) + 10),
  );
}

/** `СЧ-ГГГГ-ММ-NNN`: NNN in the order of the period over all networks (A4). */
export function invoiceNumber(period: string, sequence: number): string {
  return `СЧ-${period}-${String(sequence).padStart(3, '0')}`;
}

/** The order of an invoice in its period, from its number. */
export function invoiceSequence(number: string): number {
  return Number(number.slice(number.lastIndexOf('-') + 1));
}

export type BillingInvoiceStatus = 'issued' | 'partially_paid' | 'paid';

/** Derived, not stored (A8). */
export function invoiceStatus(
  totalMinor: number,
  paidMinor: number,
): BillingInvoiceStatus {
  if (paidMinor >= totalMinor) return 'paid';
  return paidMinor > 0 ? 'partially_paid' : 'issued';
}

export interface AllocationInvoice {
  id: string;
  /** YYYY-MM. */
  period: string;
  number: string;
  totalMinor: number;
  issuedOn: string;
}

export interface AllocationPayment {
  id: string;
  amountMinor: number;
  paidOn: string;
  /** ISO instant; orders payments of the same day. */
  createdAt: string;
  preferredInvoiceId: string | null;
}

export interface Allocation {
  allocations: Array<{
    paymentId: string;
    invoiceId: string;
    amountMinor: number;
  }>;
  invoices: Record<string, { paidMinor: number; paidOn: string | null }>;
  advanceMinor: number;
}

/**
 * The allocation of the active payments of a network to its invoices (A7, B2): payments in the
 * order (paid on, created at, id); each goes first to its chosen invoice while it is open, then to
 * the oldest invoices by (period, number); what is left is the advance. Deterministic: the result
 * depends only on the payments and invoices as they are now.
 */
export function allocatePayments(
  invoices: readonly AllocationInvoice[],
  payments: readonly AllocationPayment[],
): Allocation {
  const ordered = [...invoices].sort(
    (a, b) =>
      compare(a.period, b.period) ||
      invoiceSequence(a.number) - invoiceSequence(b.number) ||
      compare(a.id, b.id),
  );
  const rest = new Map(
    ordered.map((invoice) => [invoice.id, invoice.totalMinor]),
  );
  const result: Allocation['invoices'] = {};
  for (const invoice of ordered) {
    result[invoice.id] = {
      paidMinor: 0,
      paidOn: invoice.totalMinor === 0 ? invoice.issuedOn : null,
    };
  }
  const allocations: Allocation['allocations'] = [];
  let advanceMinor = 0;
  const queue = [...payments].sort(
    (a, b) =>
      compare(a.paidOn, b.paidOn) ||
      compare(a.createdAt, b.createdAt) ||
      compare(a.id, b.id),
  );
  for (const payment of queue) {
    let left = payment.amountMinor;
    const preferred = payment.preferredInvoiceId;
    const targets = [
      ...(preferred !== null && rest.has(preferred) ? [preferred] : []),
      ...ordered.map((invoice) => invoice.id).filter((id) => id !== preferred),
    ];
    for (const invoiceId of targets) {
      if (left === 0) break;
      const open = rest.get(invoiceId) ?? 0;
      if (open === 0) continue;
      const amountMinor = Math.min(left, open);
      left -= amountMinor;
      rest.set(invoiceId, open - amountMinor);
      result[invoiceId].paidMinor += amountMinor;
      if (open === amountMinor) result[invoiceId].paidOn = payment.paidOn;
      allocations.push({ paymentId: payment.id, invoiceId, amountMinor });
    }
    advanceMinor += left;
  }
  return { allocations, invoices: result, advanceMinor };
}
