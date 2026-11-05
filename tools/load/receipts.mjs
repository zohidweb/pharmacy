// The receipt of the load run (plan R16), built as apps/web/src/features/pos/model/pay.ts builds it: products of the
// store's snapshot, the first batch with stock by FEFO, the current pack price, cash or card. No discount: the network
// «Нагрузка» has no discount rules. ПКУ products are left out (they need prescription data).
import { uuidv7 } from './api.mjs';

/** mulberry32: the same seed, the same receipts — a run can be repeated. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The products a cashier can sell from a snapshot: a price, a batch with stock, no ПКУ. */
export function sellable(snapshot) {
  return snapshot.products
    .filter((p) => p.priceMinor > 0 && p.prescription !== 'controlled' && p.batches.some((b) => b.quantityPieces > 0))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

function fefoBatch(product, pieces) {
  return [...product.batches]
    .sort((a, b) => (a.expiresOn < b.expiresOn ? -1 : a.expiresOn > b.expiresOn ? 1 : a.id < b.id ? -1 : 1))
    .find((batch) => batch.quantityPieces >= pieces);
}

/**
 * The body and the idempotency key of one sale of `cashier` (storeId, terminalId, employeeId, shiftId). 1–3 lines,
 * the products skewed to the head of the list (a few sell often, as in the history); `productId` sells that product
 * alone — the hot batch (R12). The sold pieces leave the batches of the snapshot at once, as the POS does
 * (applySaleToSnapshot): a sold-out batch is not sold again, a sold-out product gives way to another (final review M3).
 */
export function buildReceipt(cashier, snapshot, products, rng, { productId } = {}) {
  const hot = productId ? products.find((p) => p.id === productId) : null;
  if (productId && !hot) throw new Error(`product ${productId} is not sellable in the snapshot of the store`);
  const count = productId ? 1 : rng() < 0.45 ? 1 : rng() < 0.64 ? 2 : 3;
  const lines = [];
  const picked = new Set();
  for (let attempt = 0; lines.length < count && attempt < 50; attempt += 1) {
    const product = hot ?? products[Math.floor(products.length * rng() ** 3)];
    if (picked.has(product.id)) continue;
    const quantity = rng() < 0.8 ? 1 : 2;
    const batch = fefoBatch(product, quantity * product.piecesPerPack);
    if (!batch) {
      if (hot) break;
      continue;
    }
    picked.add(product.id);
    batch.quantityPieces -= quantity * product.piecesPerPack;
    lines.push({
      productId: product.id,
      batchId: batch.id,
      unit: 'pack',
      quantity,
      unitPriceMinor: product.priceMinor,
      amountMinor: quantity * product.priceMinor,
      piecesPerPack: product.piecesPerPack,
      batchChosenManually: false,
      controlled: null,
    });
  }
  if (lines.length === 0) throw new Error(hot ? 'the hot batch is sold out in the snapshot' : 'no line with stock: the snapshot is sold out');
  const total = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  const cash = rng() < 0.6;
  const tendered = cash ? Math.ceil(total / 1000) * 1000 : 0;
  const id = uuidv7();
  return {
    key: id,
    body: {
      id,
      storeId: cashier.storeId,
      terminalId: cashier.terminalId,
      employeeId: cashier.employeeId,
      occurredAt: new Date().toISOString(),
      shiftId: cashier.shiftId,
      priceListVersion: snapshot.version,
      lines,
      subtotalMinor: total,
      discountRuleId: null,
      discountPercent: 0,
      discountMinSubtotalMinor: 0,
      discountMinor: 0,
      totalMinor: total,
      payments: [{ method: cash ? 'cash' : 'card', amountMinor: total }],
      cashTenderedMinor: tendered,
      changeMinor: cash ? tendered - total : 0,
      language: rng() < 0.85 ? 'ru' : 'tj',
    },
  };
}
