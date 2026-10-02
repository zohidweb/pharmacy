import {
  deficitQuantity,
  orderStatusAfterReceipt,
  receivedPercent,
  supplierDebt,
} from './purchasing';

describe('deficitQuantity', () => {
  it('covers 30 days of consumption above the minimum', () => {
    // 12 packs, minimum 15, 64 sold in 30 days
    expect(
      deficitQuantity({
        stockPieces: 192,
        piecesPerPack: 16,
        minPacks: 15,
        sales30Packs: 64,
      }),
    ).toBe(67);
    // half a pack left: rounded up
    expect(
      deficitQuantity({
        stockPieces: 5,
        piecesPerPack: 10,
        minPacks: 10,
        sales30Packs: 0,
      }),
    ).toBe(10);
  });

  it('orders nothing at or above the minimum', () => {
    expect(
      deficitQuantity({
        stockPieces: 310,
        piecesPerPack: 10,
        minPacks: 8,
        sales30Packs: 22,
      }),
    ).toBe(0);
  });

  it('covers a negative stock after an offline merge', () => {
    expect(
      deficitQuantity({
        stockPieces: -120,
        piecesPerPack: 60,
        minPacks: 8,
        sales30Packs: 10,
      }),
    ).toBe(20);
    expect(() =>
      deficitQuantity({
        stockPieces: 0,
        piecesPerPack: 0,
        minPacks: 1,
        sales30Packs: 1,
      }),
    ).toThrow(RangeError);
  });
});

describe('order progress', () => {
  it('computes the received share and the status', () => {
    const lines = [
      { quantity: 60, receivedQuantity: 20 },
      { quantity: 40, receivedQuantity: 40 },
    ];
    expect(receivedPercent(lines)).toBe(60);
    expect(orderStatusAfterReceipt(lines)).toBe('partially_received');
    expect(
      orderStatusAfterReceipt([{ quantity: 5, receivedQuantity: 0 }]),
    ).toBe('confirmed');
    expect(
      orderStatusAfterReceipt([{ quantity: 5, receivedQuantity: 6 }]),
    ).toBe('closed');
    expect(receivedPercent([{ quantity: 5, receivedQuantity: 9 }])).toBe(100);
    expect(receivedPercent([])).toBe(0);
  });
});

describe('supplierDebt', () => {
  const invoices = [
    { document: 'ПР-2', dueOn: '2026-10-15', amountMinor: 50_000 },
    { document: 'ПР-1', dueOn: '2026-09-10', amountMinor: 30_000 },
    { document: 'ПР-3', dueOn: '2026-11-01', amountMinor: 20_000 },
  ];

  it('covers the earliest due dates first', () => {
    const debt = supplierDebt(invoices, 40_000, '2026-09-21');
    expect(debt.debtMinor).toBe(60_000);
    expect(debt.open.map((i) => [i.document, i.remainingMinor])).toEqual([
      ['ПР-2', 40_000],
      ['ПР-3', 20_000],
    ]);
    expect(debt.nextDueOn).toBe('2026-10-15');
    expect(debt.overdueMinor).toBe(0);
  });

  it('reports what is overdue and for how long', () => {
    const debt = supplierDebt(invoices, 10_000, '2026-09-21');
    expect(debt.overdueMinor).toBe(20_000);
    expect(debt.overdueDays).toBe(11);
    expect(debt.nextDueOn).toBe('2026-09-10');
  });

  it('never goes negative on an advance', () => {
    const debt = supplierDebt(invoices, 500_000, '2026-09-21');
    expect(debt.debtMinor).toBe(0);
    expect(debt.nextDueOn).toBeNull();
    expect(debt.overdueDays).toBe(0);
  });
});
