import type { DiscountRule } from '@pharmacy/shared-domain';
import type { PosProduct } from '@pharmacy/shared-dto';
import {
  addProduct,
  changeBatch,
  emptyDraft,
  payAllBy,
  paymentState,
  setNonCash,
  setQuantity,
  setTendered,
  totals,
} from './receipt';

const TODAY = '2026-10-01';

const paracetamol: PosProduct = {
  id: 'p1',
  name: 'Парацетамол 500 мг, таб. №10',
  inn: 'Paracetamol',
  manufacturer: 'X',
  country: 'TJ',
  form: 'таблетки',
  categoryId: 'c1',
  barcodes: ['111'],
  piecesPerPack: 10,
  divisible: true,
  prescription: 'none',
  priceMinor: 450,
  piecePriceMinor: 45,
  batches: [
    { id: 'late', number: 'P-2', expiresOn: '2027-03-01', quantityPieces: 480 },
    { id: 'soon', number: 'P-1', expiresOn: '2026-11-15', quantityPieces: 20 },
    { id: 'old', number: 'P-0', expiresOn: '2026-09-01', quantityPieces: 30 },
  ],
};

const tramadol: PosProduct = {
  ...paracetamol,
  id: 'p2',
  name: 'Трамадол',
  divisible: false,
  piecePriceMinor: null,
  prescription: 'controlled',
  priceMinor: 4_200,
  batches: [
    { id: 't', number: 'T', expiresOn: '2027-01-01', quantityPieces: 400 },
  ],
};

const rules: DiscountRule[] = [
  { id: 'r3', minSubtotalMinor: 50_000, percent: 3 },
];

const add = (draft = emptyDraft(), product = paracetamol, opts = {}) =>
  addProduct(draft, product, { today: TODAY, ...opts });

describe('receipt draft', () => {
  it('takes the batch with the nearest expiry (FEFO), never an expired one', () => {
    const { draft, error } = add();
    expect(error).toBeNull();
    expect(draft.lines[0]).toMatchObject({
      batchId: 'soon',
      quantity: 1,
      unitPriceMinor: 450,
    });
  });

  it('adds to the same line and moves to the next batch when one runs out', () => {
    let draft = add().draft; // 10 of 20 pieces of «soon»
    draft = add(draft).draft; // 20 of 20
    draft = add(draft).draft; // «soon» is used up → «late»
    expect(draft.lines.map((l) => [l.batchId, l.quantity])).toEqual([
      ['soon', 2],
      ['late', 1],
    ]);
  });

  it('sells by the piece only divisible products', () => {
    const pieces = add(emptyDraft(), paracetamol, {
      unit: 'piece',
      quantity: 8,
    });
    expect(pieces.draft.lines[0]).toMatchObject({
      unit: 'piece',
      unitPriceMinor: 45,
    });
    expect(add(emptyDraft(), tramadol, { unit: 'piece' }).error).toBe(
      'not_divisible',
    );
  });

  it('refuses an expired batch even when chosen and reports no stock', () => {
    const expired = paracetamol.batches[2];
    expect(add(emptyDraft(), paracetamol, { batch: expired }).error).toBe(
      'out_of_stock',
    );
    const empty = { ...paracetamol, batches: [paracetamol.batches[2]] };
    expect(add(emptyDraft(), empty).error).toBe('out_of_stock');
  });

  it('limits a quantity by the stock of its batch', () => {
    const { draft } = add();
    const key = draft.lines[0].key;
    expect(setQuantity(draft, key, 2, paracetamol).error).toBeNull();
    expect(setQuantity(draft, key, 3, paracetamol).error).toBe(
      'stock_exceeded',
    );
    expect(setQuantity(draft, key, 0, paracetamol).draft.lines).toEqual([]);
  });

  it('moves a line to a batch chosen by the cashier', () => {
    const { draft } = add();
    const moved = changeBatch(
      draft,
      draft.lines[0].key,
      paracetamol,
      paracetamol.batches[0],
      TODAY,
    );
    expect(moved.draft.lines[0]).toMatchObject({
      batchId: 'late',
      manualBatch: true,
    });
  });

  it('applies the threshold discount', () => {
    const { draft } = add(emptyDraft(), tramadol, {
      quantity: 12,
      controlled: null,
    });
    expect(totals(draft, rules)).toEqual({
      subtotalMinor: 50_400,
      discount: { ruleId: 'r3', percent: 3, amountMinor: 1_512 },
      totalMinor: 48_888,
    });
  });
});

describe('payment', () => {
  const draft = add(emptyDraft(), paracetamol, { quantity: 2 }).draft; // 9,00 с

  it('takes cash by default and gives change from cash only', () => {
    const tendered = setTendered(draft, 5_000);
    expect(paymentState(tendered, 900)).toMatchObject({
      cashPartMinor: 900,
      tenderedMinor: 5_000,
      changeMinor: 4_100,
      payments: [{ method: 'cash', amountMinor: 900 }],
      problem: null,
    });
  });

  it('splits a mixed payment between the bank terminal and cash', () => {
    const mixed = setTendered(setNonCash(draft, 'card', 400), 1_000);
    expect(paymentState(mixed, 900)).toMatchObject({
      cashPartMinor: 500,
      changeMinor: 500,
      payments: [
        { method: 'cash', amountMinor: 500 },
        { method: 'card', amountMinor: 400 },
      ],
    });
  });

  it('pays the whole total by one bank method', () => {
    expect(paymentState(payAllBy(draft, 'qr', 900), 900).payments).toEqual([
      { method: 'qr', amountMinor: 900 },
    ]);
  });

  it('reports what blocks the payment', () => {
    expect(paymentState(emptyDraft(), 0).problem).toBe('empty');
    expect(paymentState(setNonCash(draft, 'card', 1_000), 900).problem).toBe(
      'non_cash_exceeds_total',
    );
    expect(paymentState(setTendered(draft, 500), 900).problem).toBe(
      'cash_short',
    );
    const pku = add(emptyDraft(), tramadol).draft;
    expect(paymentState(pku, 4_200).problem).toBe('controlled_data_missing');
  });
});
