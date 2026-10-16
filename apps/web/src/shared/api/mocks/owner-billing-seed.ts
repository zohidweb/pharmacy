/*
 * The billing of the mock network (spec 2026-10-15-billing-services, A2–A4, A10, A19): the invoices
 * of the last three months by the formulas of the API — one paid, one partly paid after its due
 * date, one issued — and a discount from this month on. Synthetic data (ADR-0011).
 */
import {
  composeInvoice,
  generationOpensOn,
  invoiceDueOn,
  invoiceNumber,
  invoiceStatus,
} from '@pharmacy/shared-domain';
import type { InvoiceDetails } from '@pharmacy/shared-dto';
import { addDays, toAppDate } from '@pharmacy/shared-util';
import { initialStores } from './fixtures';

export const MOCK_PRICE_PER_STORE_MINOR = 40_000;
export const MOCK_VAT_BP = 1_400;
/** The first sale of every mock store: long before the invoices. */
export const MOCK_FIRST_SALE = '2025-01-10';

export interface MockDiscount {
  percentBp: number;
  /** YYYY-MM. */
  fromMonth: string;
  toMonth: string;
}

/** A provided service of the network as an invoice takes it. */
export interface MockProvidedService {
  tenantServiceId: string;
  name: string;
  priceMinor: number;
  providedOn: string;
}

const SUPPLIER = {
  name: 'ООО «Платформа аптек»',
  inn: '010000001',
  bankAccount: '20202972000000000001',
  bankName: 'ОАО «Демо-банк»',
  bankBik: '350101001',
  bankCorrAccount: '20402972000000000001',
};

const PAYER = { name: 'Аптечная сеть «Шифо»', inn: '020012345' };

/** YYYY-MM moved by `months`. */
export function shiftPeriod(period: string, months: number): string {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return date.toISOString().slice(0, 7);
}

/** The remainder, status and overdue mark of an invoice on `today`. */
export function invoiceState(invoice: InvoiceDetails, today: string) {
  const remainingMinor = invoice.totalMinor - invoice.paidMinor;
  return {
    remainingMinor,
    status: invoiceStatus(invoice.totalMinor, invoice.paidMinor),
    overdue: remainingMinor > 0 && invoice.dueOn < today,
  };
}

export function seedOwnerInvoices(
  provided: readonly MockProvidedService[],
): InvoiceDetails[] {
  const today = toAppDate();
  const current = today.slice(0, 7);
  const cloud = initialStores().filter((store) => store.mode === 'cloud');
  // months back → what is paid: in full, partly, nothing
  const paidOf: Record<number, (total: number) => number> = {
    3: (total) => total,
    2: () => 60_000,
    1: () => 0,
  };
  return [1, 2, 3].map((back) => {
    const period = shiftPeriod(current, -back);
    const issuedOn = generationOpensOn(period);
    const dueOn = invoiceDueOn(period, issuedOn);
    const number = invoiceNumber(period, 14);
    const draft = composeInvoice({
      period,
      pricePerStoreMinor: MOCK_PRICE_PER_STORE_MINOR,
      vatBp: MOCK_VAT_BP,
      discountBp: null,
      stores: cloud.map((store) => ({
        storeId: store.id,
        name: store.name,
        firstSaleEver: MOCK_FIRST_SALE,
        closedOn: null,
      })),
      services: provided.filter((s) => s.providedOn.slice(0, 7) === period),
    });
    const paidMinor = paidOf[back](draft.totalMinor);
    const invoice: InvoiceDetails = {
      id: `invoice-${period}`,
      number,
      tenantId: 'tenant-demo',
      tenantName: PAYER.name,
      period,
      stores: draft.lines.filter((line) => line.kind === 'store').length,
      hasServices: draft.lines.some((line) => line.kind === 'service'),
      netMinor: draft.subtotalMinor,
      vatMinor: draft.vatMinor,
      totalMinor: draft.totalMinor,
      paidMinor,
      remainingMinor: 0,
      status: 'issued',
      overdue: false,
      issuedAt: `${issuedOn}T04:00:00.000Z`,
      dueOn,
      paidOn: paidMinor === draft.totalMinor ? addDays(dueOn, -3) : null,
      pricePerStoreMinor: MOCK_PRICE_PER_STORE_MINOR,
      vatRatePercent: MOCK_VAT_BP / 100,
      supplier: SUPPLIER,
      payer: PAYER,
      paymentPurpose: `Оплата по счёту ${number} за услуги платформы, в т.ч. НДС`,
      recalculatedAt: null,
      lines: draft.lines.map((line, index) => ({
        id: `${period}-${index + 1}`,
        ...line,
      })),
    };
    return { ...invoice, ...invoiceState(invoice, today) };
  });
}
