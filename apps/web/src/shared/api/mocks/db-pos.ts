/* Mutable POS part of the mock database: catalog stock, shifts, receipts, held receipts, returns. */
import type {
  HeldReceipt,
  PosProduct,
  ReceiptPayment,
  ReceiptLineInput,
  ReturnListItem,
  Shift,
  ShiftEvent,
} from '@pharmacy/shared-dto';
import { DAY_MS, initialProducts, minutesAgo } from './fixtures-pos';

export interface MockReceiptLine extends ReceiptLineInput {
  lineId: string;
  productName: string;
  batchNumber: string;
  returnedQuantity: number;
}

export interface MockReceipt {
  id: string;
  number: string;
  storeId: string;
  shiftId: string;
  soldAt: string;
  cashierName: string;
  lines: MockReceiptLine[];
  subtotalMinor: number;
  discountMinor: number;
  discountPercent: number;
  discountMinSubtotalMinor: number;
  returnedSubtotalMinor: number;
  payments: ReceiptPayment[];
}

export interface PosMockDb {
  catalogVersion: number;
  products: PosProduct[];
  shifts: Shift[];
  receipts: MockReceipt[];
  held: Record<string, HeldReceipt[]>;
  returns: ReturnListItem[];
  nextReceipt: number;
  nextReturn: number;
  nextShift: number;
  /** Idempotency-Key → payload fingerprint and the first response (ADR-0015, 6в). */
  idempotency: Map<string, { fingerprint: string; response: unknown }>;
  /** Simulated outage in tests and dev (the browser «offline» checkbox works too). */
  offline: boolean;
}

const zero = () => ({ count: 0, amountMinor: 0 });

function event(
  id: string,
  minutes: number,
  kind: ShiftEvent['kind'],
  reference: string | null,
  employeeName: string,
  amountMinor: number,
): ShiftEvent {
  return {
    id,
    at: minutesAgo(minutes),
    kind,
    reference,
    employeeName,
    amountMinor,
  };
}

function openShift(): Shift {
  const opening = 50_000;
  const sales = 231_050;
  const cashIn = 20_000;
  const cashOut = 150_000;
  const returns = 3_800;
  return {
    id: 'shift-218',
    number: 218,
    storeId: 'store-3',
    status: 'open',
    openedAt: minutesAgo(280),
    openedBy: 'Зарина Р.',
    closedAt: null,
    receipts: 107,
    byMethod: {
      cash: { count: 64, amountMinor: sales },
      card: { count: 31, amountMinor: 148_000 },
      qr: { count: 12, amountMinor: 32_950 },
      nfc: zero(),
    },
    returns: { count: 2, amountMinor: returns },
    revenueMinor: sales + 148_000 + 32_950 - returns,
    cash: {
      openingMinor: opening,
      salesMinor: sales,
      inMinor: cashIn,
      outMinor: cashOut,
      returnsMinor: returns,
      expectedMinor: opening + sales + cashIn - cashOut - returns,
    },
    events: [
      event('e-5', 4, 'sale', '1041', 'Зарина Р.', 8_650),
      event('e-4', 45, 'cash_out', 'collection', 'Манижа К.', -cashOut),
      event('e-3', 47, 'return', 'ВЗ-000042', 'Зарина Р.', -3_800),
      event('e-2', 152, 'cash_in', 'change_fund', 'Зарина Р.', cashIn),
      event('e-1', 280, 'opened', null, 'Зарина Р.', opening),
    ],
  };
}

function line(
  lineId: string,
  productId: string,
  productName: string,
  batchId: string,
  batchNumber: string,
  quantity: number,
  unitPriceMinor: number,
): MockReceiptLine {
  return {
    lineId,
    productId,
    productName,
    batchId,
    batchNumber,
    unit: 'pack',
    quantity,
    unitPriceMinor,
    amountMinor: quantity * unitPriceMinor,
    controlled: null,
    returnedQuantity: 0,
  };
}

function initialReceipts(): MockReceipt[] {
  const yesterday = new Date(Date.now() - DAY_MS).toISOString();
  return [
    {
      id: 'rc-1039',
      number: '1039',
      storeId: 'store-3',
      shiftId: 'shift-217',
      soldAt: yesterday,
      cashierName: 'Зарина Р.',
      lines: [
        line(
          'l-1',
          'p-vitamin-d3',
          'Витамин D3 2000 МЕ, капс. №60',
          'b-v-9021',
          'V-9021',
          2,
          6_500,
        ),
        line(
          'l-2',
          'p-paracetamol',
          'Парацетамол 500 мг, таб. №10',
          'b-p-2311',
          'P-2311',
          1,
          450,
        ),
        line(
          'l-3',
          'p-saline',
          'Физраствор 0,9% 200 мл',
          'b-f-0902',
          'F-0902',
          3,
          620,
        ),
      ],
      subtotalMinor: 15_310,
      discountMinor: 0,
      discountPercent: 0,
      discountMinSubtotalMinor: 0,
      returnedSubtotalMinor: 0,
      payments: [{ method: 'cash', amountMinor: 15_310 }],
    },
    {
      id: 'rc-1035',
      number: '1035',
      storeId: 'store-3',
      shiftId: 'shift-217',
      soldAt: yesterday,
      cashierName: 'Далер С.',
      lines: [
        line(
          'l-4',
          'p-vitamin-d3',
          'Витамин D3 2000 МЕ, капс. №60',
          'b-v-9021',
          'V-9021',
          8,
          6_500,
        ),
        line(
          'l-5',
          'p-nurofen',
          'Нурофен 200 мг, таб. №10',
          'b-n-4471',
          'N-4471',
          2,
          1_900,
        ),
      ],
      subtotalMinor: 55_800,
      discountMinor: 1_674,
      discountPercent: 3,
      discountMinSubtotalMinor: 50_000,
      returnedSubtotalMinor: 0,
      payments: [{ method: 'card', amountMinor: 54_126 }],
    },
    {
      id: 'rc-0950',
      number: '0950',
      storeId: 'store-3',
      shiftId: 'shift-205',
      soldAt: new Date(Date.now() - 20 * DAY_MS).toISOString(),
      cashierName: 'Зарина Р.',
      lines: [
        line(
          'l-6',
          'p-nurofen',
          'Нурофен 200 мг, таб. №10',
          'b-n-4471',
          'N-4471',
          1,
          1_900,
        ),
      ],
      subtotalMinor: 1_900,
      discountMinor: 0,
      discountPercent: 0,
      discountMinSubtotalMinor: 0,
      returnedSubtotalMinor: 0,
      payments: [{ method: 'cash', amountMinor: 1_900 }],
    },
  ];
}

function initialHeld(): Record<string, HeldReceipt[]> {
  return {
    'store-3': [
      {
        id: 'held-1040',
        lines: [
          {
            productId: 'p-vitamin-d3',
            productName: 'Витамин D3 2000 МЕ, капс. №60',
            batchId: 'b-v-9021',
            unit: 'pack',
            quantity: 2,
            unitPriceMinor: 6_500,
            amountMinor: 13_000,
          },
          {
            productId: 'p-paracetamol',
            productName: 'Парацетамол 500 мг, таб. №10',
            batchId: 'b-p-2288',
            unit: 'pack',
            quantity: 2,
            unitPriceMinor: 450,
            amountMinor: 900,
          },
          {
            productId: 'p-saline',
            productName: 'Физраствор 0,9% 200 мл',
            batchId: 'b-f-0902',
            unit: 'pack',
            quantity: 1,
            unitPriceMinor: 620,
            amountMinor: 620,
          },
        ],
        subtotalMinor: 14_520,
        heldAt: minutesAgo(26),
        heldBy: 'Зарина Р.',
      },
      {
        id: 'held-1037',
        lines: [
          {
            productId: 'p-amoxicillin',
            productName: 'Амоксициллин 500 мг, капс. №16',
            batchId: 'b-a-1187',
            unit: 'pack',
            quantity: 1,
            unitPriceMinor: 2_800,
            amountMinor: 2_800,
          },
        ],
        subtotalMinor: 2_800,
        heldAt: minutesAgo(62),
        heldBy: 'Далер С.',
      },
    ],
  };
}

function initialReturns(): ReturnListItem[] {
  return [
    {
      id: 'ret-42',
      number: 'ВЗ-000042',
      at: minutesAgo(47),
      storeName: 'Аптека №3 · Рудаки',
      receiptNumber: '0988',
      summary: 'Витамин D3 2000 МЕ №60 · 1 уп.',
      reason: 'customer',
      refundMinor: 3_800,
      method: 'cash',
      cashierName: 'Зарина Р.',
    },
    {
      id: 'ret-41',
      number: 'ВЗ-000041',
      at: minutesAgo(60 * 20),
      storeName: 'Аптека №1 · Центр',
      receiptNumber: '0961',
      summary: 'Нурофен 200 мг №10 · 2 уп.',
      reason: 'defect',
      refundMinor: 3_800,
      method: 'card',
      cashierName: 'Манижа К.',
    },
    {
      id: 'ret-40',
      number: 'ВЗ-000040',
      at: minutesAgo(60 * 75),
      storeName: 'Аптека №2 · Сино',
      receiptNumber: '0934',
      summary: 'Парацетамол 500 мг №10 · 1 уп.',
      reason: 'customer',
      refundMinor: 450,
      method: 'cash',
      cashierName: 'Далер С.',
    },
  ];
}

export function createPosDb(): PosMockDb {
  return {
    catalogVersion: 41,
    products: initialProducts(),
    shifts: [openShift()],
    receipts: initialReceipts(),
    held: initialHeld(),
    returns: initialReturns(),
    nextReceipt: 1042,
    nextReturn: 43,
    nextShift: 219,
    idempotency: new Map(),
    offline: false,
  };
}
