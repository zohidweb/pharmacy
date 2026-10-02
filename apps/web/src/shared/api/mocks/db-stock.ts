/*
 * Stock part of the mock database: stock by store and batch (the one source for the POS and the
 * stock screens), movements for the unposting check, documents of the stock module. Synthetic data
 * after the UI mockups; amounts in dirams, TJS only.
 */
import type {
  DocumentAuthor,
  GoodsReceipt,
  PosProduct,
  PurchaseOrder,
  StockCount,
  Supplier,
  SupplierPaymentMethod,
  SupplierReturn,
  Transfer,
  TransferRequest,
  WriteOff,
} from '@pharmacy/shared-dto';
import { DAY_MS, dateIn, minutesAgo } from './fixtures-pos';

export interface Movement {
  storeId: string;
  batchId: string;
  /** Number of the document, or «sale». */
  document: string;
  pieces: number;
  at: string;
}

export interface StockMockDb {
  /** storeId → batchId → pieces. */
  stock: Record<string, Record<string, number>>;
  movements: Movement[];
  minPacks: Record<string, number>;
  markup: Record<string, number>;
  suppliers: Supplier[];
  /** Debt from before the system (ввод начального долга): invoices with a due date. */
  openingDebts: Array<{
    supplierId: string;
    date: string;
    dueOn: string;
    amountMinor: number;
  }>;
  payments: SupplierPaymentRecord[];
  /** Consumption of the last 30 days by product, packs (the deficit of purchase orders). */
  sales30Packs: Record<string, number>;
  orders: PurchaseOrder[];
  goodsReceipts: GoodsReceipt[];
  writeOffs: WriteOff[];
  supplierReturns: SupplierReturn[];
  stockCounts: StockCount[];
  transferRequests: TransferRequest[];
  transfers: Transfer[];
  counters: Record<'pr' | 'sp' | 'vp' | 'in' | 'zp' | 'pm' | 'zk', number>;
}

export interface SupplierPaymentRecord {
  /** Idempotency key of the payment (UUIDv7 of the client). */
  id: string;
  supplierId: string;
  date: string;
  method: SupplierPaymentMethod;
  comment: string;
  amountMinor: number;
}

const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString();
const dateAgo = (days: number) => daysAgo(days).slice(0, 10);
const author = (name: string, days: number): DocumentAuthor => ({
  name,
  at: daysAgo(days),
});

const STORES = ['store-1', 'store-2', 'store-3', 'store-4'] as const;
/** Store-3 holds the stock of the POS fixtures; the others are scaled copies. */
const SCALE: Record<(typeof STORES)[number], number> = {
  'store-1': 2,
  'store-2': 1,
  'store-3': 1,
  'store-4': 0.5,
};

function initialStock(products: PosProduct[]) {
  const stock: StockMockDb['stock'] = {};
  for (const store of STORES) {
    stock[store] = {};
    for (const product of products) {
      for (const batch of product.batches) {
        stock[store][batch.id] = Math.round(
          batch.quantityPieces * SCALE[store],
        );
      }
    }
  }
  // an offline store sold more than it had before the merge («продажа — факт», ADR-0014)
  stock['store-4']['b-v-9021'] = -120;
  return stock;
}

function receipt(
  overrides: Partial<GoodsReceipt> &
    Pick<GoodsReceipt, 'id' | 'number' | 'lines'>,
): GoodsReceipt {
  const totalMinor = overrides.lines.reduce(
    (s, l) => s + l.quantity * l.costMinor,
    0,
  );
  return {
    status: 'posted',
    date: dateAgo(10),
    supplierId: 'sup-pharm-import',
    supplierName: 'ООО «Фарм-Импорт»',
    storeId: 'store-1',
    storeName: 'Аптека №1 · Центр',
    orderId: null,
    orderNumber: null,
    invoiceNumber: 'INV-5000',
    paymentDueOn: dateIn(20),
    totalMinor,
    createdBy: author('Фируз А.', 10),
    postedBy: author('Фируз А.', 10),
    ...overrides,
  };
}

const line = (
  productId: string,
  productName: string,
  quantity: number,
  receivedQuantity: number,
  priceMinor: number,
): PurchaseOrder['lines'][number] => ({
  productId,
  productName,
  quantity,
  receivedQuantity,
  priceMinor,
});

function order(
  overrides: Partial<PurchaseOrder> &
    Pick<PurchaseOrder, 'id' | 'number' | 'status' | 'date' | 'lines'>,
): PurchaseOrder {
  const ordered = overrides.lines.reduce((s, l) => s + l.quantity, 0);
  const received = overrides.lines.reduce((s, l) => s + l.receivedQuantity, 0);
  return {
    supplierId: 'sup-pharm-import',
    supplierName: 'ООО «Фарм-Импорт»',
    storeId: 'store-1',
    storeName: 'Аптека №1 · Центр',
    expectedOn: null,
    comment: '',
    totalMinor: overrides.lines.reduce(
      (s, l) => s + l.quantity * l.priceMinor,
      0,
    ),
    receivedPercent: ordered ? Math.floor((received * 100) / ordered) : 0,
    createdBy: author('Фируз А.', 12),
    confirmedBy: author('Фируз А.', 12),
    ...overrides,
  };
}

export function createStockDb(products: PosProduct[]): StockMockDb {
  return {
    stock: initialStock(products),
    movements: [
      // after ПР-000122 the batch A-1187 was sold and moved: its unposting is blocked
      {
        storeId: 'store-1',
        batchId: 'b-a-1187',
        document: 'ПР-000122',
        pieces: 640,
        at: daysAgo(1.1),
      },
      {
        storeId: 'store-1',
        batchId: 'b-a-1187',
        document: 'sale',
        pieces: -96,
        at: daysAgo(0.8),
      },
      {
        storeId: 'store-1',
        batchId: 'b-a-1187',
        document: 'ПМ-000044',
        pieces: -32,
        at: daysAgo(0.5),
      },
    ],
    minPacks: {
      'p-paracetamol': 20,
      'p-amoxicillin': 15,
      'p-ibuprofen-400': 10,
      'p-ibuprofen-200': 10,
      'p-nurofen': 10,
      'p-ibufen': 4,
      'p-vitamin-d3': 8,
      'p-tramadol': 5,
      'p-saline': 40,
      'p-nurofen-kids': 4,
    },
    markup: {
      'cat-analgesics': 45,
      'cat-antibiotics': 45,
      'cat-vitamins': 48,
      'cat-children': 40,
      'cat-other': 60,
    },
    suppliers: [
      {
        id: 'sup-pharm-import',
        name: 'ООО «Фарм-Импорт»',
        taxId: '020012345',
        phone: '+992 37 227-00-11',
        address: 'г. Душанбе, ул. Айни, 24',
        paymentDelayDays: 30,
      },
      {
        id: 'sup-sino',
        name: 'Сино-Фарм',
        taxId: '030045678',
        phone: '+992 90 500-12-12',
        address: 'г. Душанбе, пр. Сино, 61',
        paymentDelayDays: 14,
      },
      {
        id: 'sup-dori',
        name: 'Дори-Дармон',
        taxId: '010098765',
        phone: '+992 44 600-77-00',
        address: 'г. Худжанд, ул. Ленина, 5',
        paymentDelayDays: 45,
      },
    ],
    openingDebts: [
      {
        supplierId: 'sup-pharm-import',
        date: dateAgo(50),
        dueOn: dateAgo(20),
        amountMinor: 820_000,
      },
      {
        supplierId: 'sup-pharm-import',
        date: dateAgo(26),
        dueOn: dateIn(4),
        amountMinor: 1_192_000,
      },
      {
        supplierId: 'sup-sino',
        date: dateAgo(25),
        dueOn: dateAgo(11),
        amountMinor: 612_500,
      },
      {
        supplierId: 'sup-dori',
        date: dateAgo(21),
        dueOn: dateIn(24),
        amountMinor: 1_966_000,
      },
    ],
    payments: [
      {
        id: 'pay-1',
        supplierId: 'sup-pharm-import',
        date: dateAgo(34),
        method: 'bank',
        comment: '',
        amountMinor: 140_000,
      },
      {
        id: 'pay-2',
        supplierId: 'sup-pharm-import',
        date: dateAgo(18),
        method: 'cash',
        comment: '',
        amountMinor: 680_000,
      },
    ],
    sales30Packs: {
      'p-paracetamol': 48,
      'p-amoxicillin': 22,
      'p-ibuprofen-400': 48,
      'p-ibuprofen-200': 30,
      'p-nurofen': 26,
      'p-ibufen': 6,
      'p-vitamin-d3': 22,
      'p-tramadol': 4,
      'p-saline': 64,
      'p-nurofen-kids': 5,
    },
    orders: [
      order({
        id: 'po-88',
        number: 'ЗК-000088',
        status: 'draft',
        date: dateAgo(0),
        expectedOn: dateIn(7),
        createdBy: author('Фируз А.', 0),
        confirmedBy: null,
        lines: [
          line('p-amoxicillin', 'Амоксициллин 500 мг, капс. №16', 40, 0, 1_915),
          line('p-ibuprofen-400', 'Ибупрофен 400 мг, таб. №20', 60, 0, 760),
          line('p-vitamin-d3', 'Витамин D3 2000 МЕ, капс. №60', 24, 0, 4_362),
        ],
      }),
      order({
        id: 'po-87',
        number: 'ЗК-000087',
        status: 'partially_received',
        date: dateAgo(6),
        lines: [
          line(
            'p-amoxicillin',
            'Амоксициллин 500 мг, капс. №16',
            60,
            20,
            1_915,
          ),
          line('p-vitamin-d3', 'Витамин D3 2000 МЕ, капс. №60', 24, 0, 4_362),
          line('p-saline', 'Физраствор 0,9% 200 мл', 100, 0, 426),
        ],
      }),
      order({
        id: 'po-86',
        number: 'ЗК-000086',
        status: 'closed',
        date: dateAgo(9),
        supplierId: 'sup-dori',
        supplierName: 'Дори-Дармон',
        lines: [
          line(
            'p-amoxicillin',
            'Амоксициллин 500 мг, капс. №16',
            40,
            40,
            1_900,
          ),
        ],
      }),
      order({
        id: 'po-85',
        number: 'ЗК-000085',
        status: 'confirmed',
        date: dateAgo(11),
        supplierId: 'sup-sino',
        supplierName: 'Сино-Фарм',
        storeId: 'store-3',
        storeName: 'Аптека №3 · Рудаки',
        lines: [line('p-nurofen', 'Нурофен 200 мг, таб. №10', 30, 0, 1_250)],
      }),
    ],
    goodsReceipts: [
      receipt({
        id: 'gr-124',
        number: 'ПР-000124',
        status: 'draft',
        date: dateAgo(0),
        orderId: 'po-87',
        orderNumber: 'ЗК-000087',
        invoiceNumber: 'INV-5521',
        paymentDueOn: dateIn(30),
        createdBy: author('Фируз А.', 0),
        postedBy: null,
        lines: [
          {
            productId: 'p-amoxicillin',
            productName: 'Амоксициллин 500 мг, капс. №16',
            batchNumber: 'A-1204',
            expiresOn: dateIn(900),
            quantity: 40,
            orderPriceMinor: 1_915,
            costMinor: 1_915,
            retailPriceMinor: 2_800,
          },
          {
            productId: 'p-vitamin-d3',
            productName: 'Витамин D3 2000 МЕ, капс. №60',
            batchNumber: 'V-9102',
            expiresOn: dateIn(980),
            quantity: 24,
            orderPriceMinor: 4_362,
            costMinor: 4_714,
            retailPriceMinor: 7_000,
          },
          {
            productId: 'p-saline',
            productName: 'Физраствор 0,9% 200 мл',
            batchNumber: 'F-1010',
            expiresOn: dateIn(400),
            quantity: 100,
            orderPriceMinor: 426,
            costMinor: 426,
            retailPriceMinor: 620,
          },
        ],
      }),
      receipt({
        id: 'gr-122',
        number: 'ПР-000122',
        date: dateAgo(1),
        supplierId: 'sup-dori',
        supplierName: 'Дори-Дармон',
        orderId: null,
        invoiceNumber: 'DD-3310',
        createdBy: author('Фируз А.', 1.1),
        postedBy: author('Фируз А.', 1.1),
        lines: [
          {
            productId: 'p-amoxicillin',
            productName: 'Амоксициллин 500 мг, капс. №16',
            batchNumber: 'A-1187',
            expiresOn: dateIn(300),
            quantity: 40,
            orderPriceMinor: null,
            costMinor: 1_900,
            retailPriceMinor: 2_800,
          },
        ],
      }),
      receipt({
        id: 'gr-78',
        number: 'ПР-000078',
        date: dateAgo(13),
        invoiceNumber: 'INV-5402',
        lines: [
          {
            productId: 'p-nurofen',
            productName: 'Нурофен 200 мг, таб. №10',
            batchNumber: 'N-4471',
            expiresOn: dateIn(12),
            quantity: 20,
            orderPriceMinor: null,
            costMinor: 1_250,
            retailPriceMinor: 1_900,
          },
          {
            productId: 'p-ibufen',
            productName: 'Ибуфен сусп. 100 мг/5 мл, 100 мл',
            batchNumber: 'IB-120',
            expiresOn: dateIn(400),
            quantity: 10,
            orderPriceMinor: null,
            costMinor: 2_300,
            retailPriceMinor: 3_400,
          },
        ],
      }),
    ],
    writeOffs: [
      {
        id: 'wo-20',
        number: 'СП-000020',
        status: 'draft',
        date: dateAgo(0),
        storeId: 'store-3',
        storeName: 'Аптека №3 · Рудаки',
        reason: 'expired',
        comment: '',
        lines: [
          {
            productId: 'p-paracetamol',
            productName: 'Парацетамол 500 мг, таб. №10',
            batchId: 'b-p-2201',
            batchNumber: 'P-2201',
            expiresOn: dateIn(-31),
            unit: 'pack',
            quantity: 3,
            costMinor: 290,
          },
        ],
        totalMinor: 870,
        createdBy: author('Манижа К.', 0),
        postedBy: null,
      },
      {
        id: 'wo-17',
        number: 'СП-000017',
        status: 'posted',
        date: dateAgo(9),
        storeId: 'store-3',
        storeName: 'Аптека №3 · Рудаки',
        reason: 'broken',
        comment: 'Разбит флакон при выкладке',
        lines: [
          {
            productId: 'p-saline',
            productName: 'Физраствор 0,9% 200 мл',
            batchId: 'b-f-0902',
            batchNumber: 'F-0902',
            expiresOn: dateIn(40),
            unit: 'pack',
            quantity: 1,
            costMinor: 380,
          },
        ],
        totalMinor: 380,
        createdBy: author('Зарина Р.', 9),
        postedBy: author('Зарина Р.', 9),
      },
      {
        id: 'wo-18',
        number: 'СП-000018',
        status: 'posted',
        date: dateAgo(4),
        storeId: 'store-1',
        storeName: 'Аптека №1 · Центр',
        reason: 'defect',
        comment: '',
        lines: [
          {
            productId: 'p-amoxicillin',
            productName: 'Амоксициллин 500 мг, капс. №16',
            batchId: 'b-a-1187',
            batchNumber: 'A-1187',
            expiresOn: dateIn(300),
            unit: 'pack',
            quantity: 2,
            costMinor: 1_900,
          },
        ],
        totalMinor: 3_800,
        createdBy: author('Манижа К.', 4),
        postedBy: author('Манижа К.', 4),
      },
    ],
    supplierReturns: [
      {
        id: 'vr-12',
        number: 'ВП-000012',
        status: 'draft',
        date: dateAgo(0),
        supplierId: 'sup-pharm-import',
        supplierName: 'ООО «Фарм-Импорт»',
        storeId: 'store-1',
        storeName: 'Аптека №1 · Центр',
        receiptId: 'gr-78',
        receiptNumber: 'ПР-000078',
        reason: 'defect',
        claim: 'draft',
        lines: [
          {
            productId: 'p-ibufen',
            productName: 'Ибуфен сусп. 100 мг/5 мл, 100 мл',
            batchId: 'b-ib-120',
            batchNumber: 'IB-120',
            expiresOn: dateIn(400),
            unit: 'pack',
            quantity: 2,
            costMinor: 2_300,
            note: 'нарушена герметичность',
          },
        ],
        totalMinor: 4_600,
        createdBy: author('Фируз А.', 0),
        postedBy: null,
      },
      {
        id: 'vr-3',
        number: 'ВП-000003',
        status: 'posted',
        date: dateAgo(3),
        supplierId: 'sup-sino',
        supplierName: 'Сино-Фарм',
        storeId: 'store-1',
        storeName: 'Аптека №1 · Центр',
        receiptId: null,
        receiptNumber: null,
        reason: 'expired',
        claim: 'sent',
        lines: [
          {
            productId: 'p-nurofen',
            productName: 'Нурофен 200 мг, таб. №10',
            batchId: 'b-n-4471',
            batchNumber: 'N-4471',
            expiresOn: dateIn(12),
            unit: 'pack',
            quantity: 2,
            costMinor: 1_250,
            note: 'короткий срок при поставке',
          },
        ],
        totalMinor: 2_500,
        createdBy: author('Фируз А.', 3),
        postedBy: author('Фируз А.', 3),
      },
    ],
    stockCounts: [
      {
        id: 'sc-7',
        number: 'ИН-000007',
        status: 'in_progress',
        startedAt: minutesAgo(240),
        storeId: 'store-3',
        storeName: 'Аптека №3 · Рудаки',
        scope: 'category',
        categoryId: 'cat-analgesics',
        categoryName: 'Анальгетики',
        comment: '',
        lines: [
          {
            productId: 'p-paracetamol',
            productName: 'Парацетамол 500 мг, таб. №10',
            batchId: 'b-p-2311',
            batchNumber: 'P-2311',
            expiresOn: dateIn(180),
            piecesPerPack: 10,
            bookPieces: 480,
            soldSincePieces: 60,
            factPieces: 420,
            pieceCostMinor: 31,
          },
          {
            productId: 'p-nurofen',
            productName: 'Нурофен 200 мг, таб. №10',
            batchId: 'b-n-4471',
            batchNumber: 'N-4471',
            expiresOn: dateIn(12),
            piecesPerPack: 10,
            bookPieces: 180,
            soldSincePieces: 10,
            factPieces: 150,
            pieceCostMinor: 125,
          },
          {
            productId: 'p-ibuprofen-200',
            productName: 'Ибупрофен 200 мг, таб. №20',
            batchId: 'b-i-3301',
            batchNumber: 'I-3301',
            expiresOn: dateIn(200),
            piecesPerPack: 20,
            bookPieces: 440,
            soldSincePieces: 0,
            factPieces: null,
            pieceCostMinor: 26,
          },
        ],
        createdBy: author('Манижа К.', 0.2),
        postedBy: null,
      },
      {
        id: 'sc-6',
        number: 'ИН-000006',
        status: 'posted',
        startedAt: daysAgo(7),
        storeId: 'store-1',
        storeName: 'Аптека №1 · Центр',
        scope: 'category',
        categoryId: 'cat-antibiotics',
        categoryName: 'Антибиотики',
        comment: '',
        lines: [
          {
            productId: 'p-amoxicillin',
            productName: 'Амоксициллин 500 мг, капс. №16',
            batchId: 'b-a-1187',
            batchNumber: 'A-1187',
            expiresOn: dateIn(300),
            piecesPerPack: 16,
            bookPieces: 384,
            soldSincePieces: 16,
            factPieces: 336,
            pieceCostMinor: 119,
          },
        ],
        createdBy: author('Манижа К.', 7),
        postedBy: author('Манижа К.', 7),
      },
    ],
    transferRequests: [
      {
        id: 'rq-9',
        number: 'ЗП-000009',
        date: dateAgo(0),
        requesterStoreId: 'store-1',
        requesterStoreName: 'Аптека №1 · Центр',
        fromStoreId: 'store-3',
        fromStoreName: 'Аптека №3 · Рудаки',
        status: 'draft',
        comment: '',
        rejection: null,
        lines: [
          {
            productId: 'p-tramadol',
            productName: 'Трамадол 50 мг, капс. №20',
            quantity: 2,
          },
        ],
      },
      {
        id: 'rq-7',
        number: 'ЗП-000007',
        date: dateAgo(0),
        requesterStoreId: 'store-2',
        requesterStoreName: 'Аптека №2 · Сино',
        fromStoreId: 'store-1',
        fromStoreName: 'Аптека №1 · Центр',
        status: 'sent',
        comment: 'Закончился Парацетамол',
        rejection: null,
        lines: [
          {
            productId: 'p-paracetamol',
            productName: 'Парацетамол 500 мг, таб. №10',
            quantity: 30,
          },
          {
            productId: 'p-nurofen',
            productName: 'Нурофен 200 мг, таб. №10',
            quantity: 40,
          },
          {
            productId: 'p-saline',
            productName: 'Физраствор 0,9% 200 мл',
            quantity: 50,
          },
        ],
      },
      {
        id: 'rq-5',
        number: 'ЗП-000005',
        date: dateAgo(2),
        requesterStoreId: 'store-3',
        requesterStoreName: 'Аптека №3 · Рудаки',
        fromStoreId: 'store-1',
        fromStoreName: 'Аптека №1 · Центр',
        status: 'in_progress',
        comment: '',
        rejection: null,
        lines: [
          {
            productId: 'p-paracetamol',
            productName: 'Парацетамол 500 мг, таб. №10',
            quantity: 30,
          },
          {
            productId: 'p-nurofen',
            productName: 'Нурофен 200 мг, таб. №10',
            quantity: 20,
          },
        ],
      },
      {
        id: 'rq-2',
        number: 'ЗП-000002',
        date: dateAgo(19),
        requesterStoreId: 'store-1',
        requesterStoreName: 'Аптека №1 · Центр',
        fromStoreId: 'store-3',
        fromStoreName: 'Аптека №3 · Рудаки',
        status: 'rejected',
        comment: '',
        rejection: { reason: 'no_stock', comment: '' },
        lines: [
          {
            productId: 'p-ibufen',
            productName: 'Ибуфен сусп. 100 мг/5 мл, 100 мл',
            quantity: 4,
          },
        ],
      },
    ],
    transfers: [
      {
        id: 'mv-15',
        number: 'ПМ-000015',
        date: dateAgo(2),
        requestId: 'rq-5',
        requestNumber: 'ЗП-000005',
        fromStoreId: 'store-1',
        fromStoreName: 'Аптека №1 · Центр',
        toStoreId: 'store-3',
        toStoreName: 'Аптека №3 · Рудаки',
        status: 'in_transit',
        lines: [
          {
            productId: 'p-paracetamol',
            productName: 'Парацетамол 500 мг, таб. №10',
            batchId: 'b-p-2311',
            batchNumber: 'P-2311',
            expiresOn: dateIn(180),
            sentQuantity: 30,
            receivedQuantity: null,
          },
          {
            productId: 'p-nurofen',
            productName: 'Нурофен 200 мг, таб. №10',
            batchId: 'b-n-4471',
            batchNumber: 'N-4471',
            expiresOn: dateIn(12),
            sentQuantity: 20,
            receivedQuantity: null,
          },
        ],
        sentBy: author('Фируз А.', 2),
        receivedBy: null,
        discrepancy: null,
      },
      {
        id: 'mv-3',
        number: 'ПМ-000003',
        date: dateAgo(4),
        requestId: null,
        requestNumber: null,
        fromStoreId: 'store-1',
        fromStoreName: 'Аптека №1 · Центр',
        toStoreId: 'store-4',
        toStoreName: 'Аптека №4 · Вахдат',
        status: 'awaiting',
        lines: [
          {
            productId: 'p-saline',
            productName: 'Физраствор 0,9% 200 мл',
            batchId: 'b-f-0902',
            batchNumber: 'F-0902',
            expiresOn: dateIn(40),
            sentQuantity: 40,
            receivedQuantity: null,
          },
        ],
        sentBy: author('Манижа К.', 4),
        receivedBy: null,
        discrepancy: null,
      },
      {
        id: 'mv-12',
        number: 'ПМ-000012',
        date: dateAgo(17),
        requestId: null,
        requestNumber: null,
        fromStoreId: 'store-1',
        fromStoreName: 'Аптека №1 · Центр',
        toStoreId: 'store-2',
        toStoreName: 'Аптека №2 · Сино',
        status: 'accepted',
        lines: [
          {
            productId: 'p-vitamin-d3',
            productName: 'Витамин D3 2000 МЕ, капс. №60',
            batchId: 'b-v-9021',
            batchNumber: 'V-9021',
            expiresOn: dateIn(500),
            sentQuantity: 6,
            receivedQuantity: 6,
          },
        ],
        sentBy: author('Фируз А.', 17),
        receivedBy: author('Далер С.', 16),
        discrepancy: null,
      },
    ],
    counters: { pr: 125, sp: 21, vp: 13, in: 8, zp: 10, pm: 16, zk: 89 },
  };
}
