/*
 * Mock handlers of the owner cabinet — stores, services, billing, reports, the 1C export, network
 * settings and offline stores. Rules apps/api will enforce: `stores:*`, `reports:view`,
 * `export-1c:*`, `settings:*`, `sync:*` (ADR-0018); cost and margin only with `finance:view-cost`;
 * a store closes by a transfer of its stock and only when the receiver accepts it; an offline
 * store's stock is not moved from the cloud (ADR-0014); duplicates are decided by the offline store.
 */
import { checkPin, stockState } from '@pharmacy/shared-domain';
import type {
  EmployeeSession,
  NetworkSettings,
  OwnerStore,
  ReportCell,
  ReportColumn,
  ReportKind,
  ReportTable,
  CreateStoreRequest,
  LegalEntity,
  LegalEntityInput,
} from '@pharmacy/shared-dto';
import { daysBetween, toAppDate } from '@pharmacy/shared-util';
import { ApiError } from '../client';
import type { ApiRouteKey } from '../routes';
import { mockDb } from './db';
import { categories } from './fixtures-pos';
import { storeDay, stores } from './fixtures';
import { debtOf } from './handlers-purchasing';
import { legalEntityName, ownerStore } from './owner-stores';
import { appendAudit } from './handlers-staff';
import { context, findDoc, stockAt, stockHandlers } from './handlers-stock';
import { storePrice } from './pricing';
import type { MockHandlers } from './types';

type OwnerRoute = Extract<
  ApiRouteKey,
  | `stores.${string}`
  | `legalEntities.${string}`
  | `services.${string}`
  | 'billing.get'
  | 'reports.get'
  | `export1c.${string}`
  | `settings.${string}`
  | 'sync.stores'
  | 'sync.queue'
  | 'sync.run'
  | 'catalog.resolveDuplicate'
>;

const owner = () => mockDb().owner;
const activeCategories = () =>
  mockDb()
    .catalog.categories.filter((c) => c.status === 'active')
    .map((c) => ({ id: c.id, name: c.nameRu }));
const today = () => toAppDate();
const PRICE_PER_STORE_MINOR = 40_000;

const validation = (correlationId: string, field: string, code: string) =>
  new ApiError(422, 'validation_failed', correlationId, [{ field, code }]);

/* ---------------- stores ---------------- */

const TAX_ID = /^\d{9}$/;
const STORE_CODE = /^[A-Z0-9]{1,8}$/;

const invalid = (correlationId: string, field: string, code: string) =>
  new ApiError(400, 'validation_failed', correlationId, [{ field, code }]);

function legalEntityInput(
  body: Partial<LegalEntityInput>,
  correlationId: string,
  prefix = '',
): Partial<LegalEntityInput> {
  if (body.name !== undefined && !body.name.trim()) {
    throw invalid(correlationId, `${prefix}name`, 'required');
  }
  if (body.taxId !== undefined && !TAX_ID.test(body.taxId.trim())) {
    throw invalid(correlationId, `${prefix}taxId`, 'format');
  }
  if (body.legalAddress !== undefined && !body.legalAddress.trim()) {
    throw invalid(correlationId, `${prefix}legalAddress`, 'required');
  }
  const blankToNull = (value: string | null | undefined) =>
    value === undefined ? undefined : value?.trim() || null;
  return Object.fromEntries(
    Object.entries({
      name: body.name?.trim(),
      taxId: body.taxId?.trim(),
      legalAddress: body.legalAddress?.trim(),
      phone: blankToNull(body.phone),
      email: blankToNull(body.email),
      bankDetails: blankToNull(body.bankDetails),
    }).filter(([, value]) => value !== undefined),
  );
}

function taxIdTaken(taxId: string, exceptId: string | null) {
  return owner().legalEntities.some(
    (e) => e.taxId === taxId && e.id !== exceptId,
  );
}

function toLegalEntity(id: string): LegalEntity {
  const entity = owner().legalEntities.find((e) => e.id === id);
  if (!entity) throw new Error(`no legal entity ${id}`);
  const all = [
    ...Object.values(owner().storeDetails),
    ...owner().extraStores,
  ];
  return {
    ...entity,
    stores: all.filter((s) => s.legalEntityId === id).length,
  };
}

function createLegalEntity(
  input: LegalEntityInput,
  correlationId: string,
  taxIdField: string,
): string {
  if (taxIdTaken(input.taxId, null)) {
    throw new ApiError(409, 'tax_id_taken', correlationId, [
      { field: taxIdField, code: 'tax_id_taken' },
    ]);
  }
  const id = `le-${owner().counters.legalEntity++}`;
  owner().legalEntities.push({
    id,
    name: input.name,
    taxId: input.taxId,
    legalAddress: input.legalAddress,
    phone: input.phone ?? null,
    email: input.email ?? null,
    bankDetails: input.bankDetails ?? null,
  });
  return id;
}

function storeCodes(): string[] {
  return [
    ...Object.values(owner().storeDetails).map((d) => d.code),
    ...owner().extraStores.map((s) => s.code),
  ];
}

function checkStore(body: CreateStoreRequest, correlationId: string) {
  if (!body.name.trim()) throw invalid(correlationId, 'name', 'required');
  if (!body.address.trim()) {
    throw invalid(correlationId, 'address', 'required');
  }
  if (!STORE_CODE.test(body.code.trim().toUpperCase())) {
    throw invalid(correlationId, 'code', 'format');
  }
  if (Boolean(body.legalEntityId) === Boolean(body.newLegalEntity)) {
    throw invalid(correlationId, 'legalEntityId', 'exactly_one');
  }
}

function activeLegalEntity(id: string, correlationId: string): string {
  if (!owner().legalEntities.some((e) => e.id === id)) {
    throw new ApiError(404, 'not_found', correlationId);
  }
  return id;
}

/* ---------------- reports ---------------- */

const CATEGORY_SHARE: Record<string, { share: number; cost: number }> = {
  'cat-analgesics': { share: 0.26, cost: 0.67 },
  'cat-antibiotics': { share: 0.23, cost: 0.72 },
  'cat-vitamins': { share: 0.2, cost: 0.66 },
  'cat-children': { share: 0.17, cost: 0.77 },
  'cat-other': { share: 0.14, cost: 0.7 },
};

const col = (key: string, type: ReportColumn['type']): ReportColumn => ({
  key,
  type,
});

const percentOf = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part * 1000) / whole) / 10;

function sumRows(
  rows: Array<Record<string, ReportCell>>,
  keys: string[],
  label: string,
  firstKey: string,
) {
  const total: Record<string, ReportCell> = { [firstKey]: label };
  for (const key of keys) {
    total[key] = rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
  }
  return total;
}

const inPeriod = (date: string, from: string, to: string) =>
  date.slice(0, 10) >= from && date.slice(0, 10) <= to;

function report(
  kind: ReportKind,
  session: EmployeeSession,
  canSeeCost: boolean,
  from: string,
  to: string,
  storeId: string | undefined,
): Omit<ReportTable, 'kind'> {
  const days = Math.max(1, daysBetween(from, to) + 1);
  const scoped = session.stores.filter((s) => !storeId || s.id === storeId);
  const costCols = (...columns: ReportColumn[]) => (canSeeCost ? columns : []);
  const products = mockDb().pos.products;
  const stock = mockDb().stock;

  switch (kind) {
    case 'sales_by_store': {
      const rows = scoped.map((store) => {
        const day = storeDay[store.id] ?? { receipts: 0, revenueMinor: 0 };
        const revenue = day.revenueMinor * days;
        const returns = -Math.round(revenue * 0.008);
        const cost = Math.round(revenue * 0.7);
        const margin = revenue + returns - cost;
        return {
          store: store.name,
          receipts: day.receipts * days,
          revenue,
          returns,
          cost,
          margin,
          marginPercent: percentOf(margin, revenue + returns),
        };
      });
      const total = sumRows(
        rows,
        ['receipts', 'revenue', 'returns', 'cost', 'margin'],
        'total',
        'store',
      );
      total.marginPercent = percentOf(
        Number(total.margin),
        Number(total.revenue) + Number(total.returns),
      );
      return {
        columns: [
          col('store', 'text'),
          col('receipts', 'count'),
          col('revenue', 'money'),
          col('returns', 'money'),
          ...costCols(
            col('cost', 'money'),
            col('margin', 'money'),
            col('marginPercent', 'percent'),
          ),
        ],
        rows,
        total,
      };
    }
    case 'sales_by_category': {
      const revenueAll = scoped.reduce(
        (sum, s) => sum + (storeDay[s.id]?.revenueMinor ?? 0) * days,
        0,
      );
      const rows = categories.map((category) => {
        const { share, cost: costRatio } = CATEGORY_SHARE[category.id] ?? {
          share: 0,
          cost: 0.7,
        };
        const revenue = Math.round(revenueAll * share);
        const cost = Math.round(revenue * costRatio);
        return {
          category: category.name,
          revenue,
          cost,
          margin: revenue - cost,
          marginPercent: percentOf(revenue - cost, revenue),
        };
      });
      const total = sumRows(
        rows,
        ['revenue', 'cost', 'margin'],
        'total',
        'category',
      );
      total.marginPercent = percentOf(
        Number(total.margin),
        Number(total.revenue),
      );
      return {
        columns: [
          col('category', 'text'),
          col('revenue', 'money'),
          ...costCols(
            col('cost', 'money'),
            col('margin', 'money'),
            col('marginPercent', 'percent'),
          ),
        ],
        rows,
        total,
      };
    }
    case 'stock': {
      const notice = owner().settings.expiryNoticeDays;
      const rows = scoped.map((store) => {
        let positions = 0;
        let cost = 0;
        let retail = 0;
        let low = 0;
        let expiring = 0;
        for (const product of products) {
          const pieces = product.batches.reduce(
            (sum, b) => sum + (stockAt(store.id)[b.id] ?? 0),
            0,
          );
          if (pieces > 0) positions += 1;
          retail += Math.round(
            (Math.max(0, pieces) * storePrice(store.id, product)) /
              product.piecesPerPack,
          );
          for (const batch of product.batches) {
            const held = stockAt(store.id)[batch.id] ?? 0;
            if (held <= 0) continue;
            cost += Math.round(
              (held * (batch.costMinor ?? 0)) / product.piecesPerPack,
            );
            if (daysBetween(today(), batch.expiresOn) <= notice) expiring += 1;
          }
          const state = stockState({
            quantityPieces: pieces,
            minPieces:
              (stock.minPacks[product.id] ?? 0) * product.piecesPerPack,
            daysToExpiry: null,
          });
          if (state === 'low' || state === 'out') low += 1;
        }
        return { store: store.name, positions, cost, retail, low, expiring };
      });
      return {
        columns: [
          col('store', 'text'),
          col('positions', 'count'),
          ...costCols(col('cost', 'money')),
          col('retail', 'money'),
          col('low', 'count'),
          col('expiring', 'count'),
        ],
        rows,
        total: sumRows(
          rows,
          ['positions', 'cost', 'retail', 'low', 'expiring'],
          'total',
          'store',
        ),
      };
    }
    case 'movement': {
      const ids = scoped.map((s) => s.id);
      const rows = products.map((product) => {
        const packs = (pieces: number) =>
          Math.trunc(pieces / product.piecesPerPack);
        const receipt = stock.goodsReceipts
          .filter(
            (d) =>
              d.status === 'posted' &&
              ids.includes(d.storeId) &&
              inPeriod(d.date, from, to),
          )
          .flatMap((d) => d.lines)
          .filter((l) => l.productId === product.id)
          .reduce((sum, l) => sum + l.quantity, 0);
        const transfers = stock.transfers
          .filter((t) => t.status === 'accepted' && inPeriod(t.date, from, to))
          .reduce((sum, t) => {
            const moved = t.lines
              .filter((l) => l.productId === product.id)
              .reduce((s, l) => s + (l.receivedQuantity ?? l.sentQuantity), 0);
            const sign =
              (ids.includes(t.toStoreId) ? 1 : 0) -
              (ids.includes(t.fromStoreId) ? 1 : 0);
            return sum + sign * moved;
          }, 0);
        const sold = mockDb()
          .pos.receipts.filter(
            (r) => ids.includes(r.storeId) && inPeriod(r.soldAt, from, to),
          )
          .flatMap((r) => r.lines)
          .filter((l) => l.productId === product.id)
          .reduce(
            (sum, l) =>
              sum +
              (l.unit === 'pack'
                ? l.quantity * product.piecesPerPack
                : l.quantity),
            0,
          );
        const writeOffs = stock.writeOffs
          .filter(
            (d) =>
              d.status === 'posted' &&
              ids.includes(d.storeId) &&
              inPeriod(d.date, from, to),
          )
          .flatMap((d) => d.lines)
          .filter((l) => l.productId === product.id)
          .reduce(
            (sum, l) =>
              sum +
              (l.unit === 'pack'
                ? l.quantity * product.piecesPerPack
                : l.quantity),
            0,
          );
        const held = ids.reduce(
          (sum, id) =>
            sum +
            product.batches.reduce((s, b) => s + (stockAt(id)[b.id] ?? 0), 0),
          0,
        );
        return {
          product: product.name,
          receipt,
          transfers,
          sales: -packs(sold),
          writeOffs: -packs(writeOffs),
          stock: packs(held),
        };
      });
      return {
        columns: [
          col('product', 'text'),
          col('receipt', 'quantity'),
          col('transfers', 'quantity'),
          col('sales', 'quantity'),
          col('writeOffs', 'quantity'),
          col('stock', 'quantity'),
        ],
        rows,
        total: null,
      };
    }
    case 'supplier_debts': {
      const rows = stock.suppliers.map((supplier) => {
        const debt = debtOf(supplier.id);
        return {
          supplier: supplier.name,
          debt: debt.debtMinor,
          overdue: debt.overdueMinor,
          nextDueOn: debt.nextDueOn,
        };
      });
      return {
        columns: [
          col('supplier', 'text'),
          ...costCols(col('debt', 'money'), col('overdue', 'money')),
          col('nextDueOn', 'date'),
        ],
        rows,
        total: canSeeCost
          ? sumRows(rows, ['debt', 'overdue'], 'total', 'supplier')
          : null,
      };
    }
    case 'cashiers': {
      const rows = mockDb()
        .employees.filter(
          (e) =>
            e.storeIds !== null &&
            e.status === 'active' &&
            owner()
              .roles.find((r) => r.id === e.roleId)
              ?.permissions.includes('pos:create'),
        )
        .flatMap((e) => {
          const storeIdOf = e.storeIds?.find((id) =>
            scoped.some((s) => s.id === id),
          );
          if (!storeIdOf) return [];
          const day = storeDay[storeIdOf] ?? { receipts: 0, revenueMinor: 0 };
          const revenue = Math.round(day.revenueMinor * days * 0.45);
          const returns = -Math.round(revenue * 0.006);
          return [
            {
              cashier: e.shortName,
              store: scoped.find((s) => s.id === storeIdOf)?.name ?? '—',
              receipts: Math.round(day.receipts * days * 0.45),
              cash: Math.round(revenue * 0.55),
              card: Math.round(revenue * 0.35),
              qr:
                revenue -
                Math.round(revenue * 0.55) -
                Math.round(revenue * 0.35),
              returns,
              revenue: revenue + returns,
            },
          ];
        });
      return {
        columns: [
          col('cashier', 'text'),
          col('store', 'text'),
          col('receipts', 'count'),
          col('cash', 'money'),
          col('card', 'money'),
          col('qr', 'money'),
          col('returns', 'money'),
          col('revenue', 'money'),
        ],
        rows,
        total: null,
      };
    }
    case 'losses': {
      const names = scoped.map((s) => s.name);
      const writeOffs = stock.writeOffs
        .filter(
          (d) =>
            d.status === 'posted' &&
            names.includes(d.storeName) &&
            inPeriod(d.date, from, to),
        )
        .map((d) => ({
          number: d.number,
          date: d.date,
          store: d.storeName,
          product: d.lines[0]?.productName ?? '—',
          reason: d.reason,
          quantity: d.lines.reduce((sum, l) => sum + l.quantity, 0),
          amount: d.totalMinor ?? 0,
        }));
      const returns = mockDb()
        .pos.returns.filter(
          (r) => names.includes(r.storeName) && inPeriod(r.at, from, to),
        )
        .map((r) => ({
          number: r.number,
          date: r.at.slice(0, 10),
          store: r.storeName,
          product: r.summary,
          reason: r.reason,
          quantity: null,
          amount: -r.refundMinor,
        }));
      return {
        columns: [
          col('number', 'text'),
          col('date', 'date'),
          col('store', 'text'),
          col('product', 'text'),
          col('reason', 'reason'),
          col('quantity', 'quantity'),
          ...costCols(col('amount', 'money')),
        ],
        rows: [...writeOffs, ...returns].sort((a, b) =>
          b.date.localeCompare(a.date),
        ),
        total: null,
      };
    }
    case 'controlled': {
      const ids = scoped.map((s) => s.id);
      const rows = mockDb()
        .pos.receipts.filter(
          (r) => ids.includes(r.storeId) && inPeriod(r.soldAt, from, to),
        )
        .flatMap((r) =>
          r.lines
            .filter((l) => l.controlled !== null)
            .map((l) => ({
              at: r.soldAt,
              product: l.productName,
              batch: l.batchNumber,
              quantity: l.quantity,
              cashier: r.cashierName,
              receipt: `№${r.number}`,
              prescription: l.controlled
                ? `${l.controlled.prescriptionNumber} · ${l.controlled.clinic}`
                : '—',
            })),
        )
        .sort((a, b) => b.at.localeCompare(a.at));
      return {
        columns: [
          col('at', 'datetime'),
          col('product', 'text'),
          col('batch', 'text'),
          col('quantity', 'quantity'),
          col('cashier', 'text'),
          col('receipt', 'text'),
          col('prescription', 'text'),
        ],
        rows,
        total: null,
      };
    }
  }
}

/* ---------------- 1C ---------------- */

function unmappedProducts() {
  const articles = owner().articles1c;
  const used = new Map<string, string>();
  for (const [productId, article] of Object.entries(articles)) {
    if (used.has(article)) continue;
    used.set(article, productId);
  }
  return mockDb()
    .pos.products.filter(
      (p) => !articles[p.id] || used.get(articles[p.id]) !== p.id,
    )
    .map((p) => ({
      productId: p.id,
      productName: p.name,
      barcode: p.barcodes[0] ?? null,
      conflictArticle: articles[p.id] ?? null,
    }));
}

const xmlEscape = (value: string) =>
  value.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/* ---------------- settings ---------------- */

function settingsInput(body: NetworkSettings, correlationId: string) {
  const range = (field: keyof NetworkSettings, min: number, max: number) => {
    const value = body[field];
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw validation(correlationId, field, 'invalid');
    }
    if (value < min || value > max) {
      throw validation(correlationId, field, 'range');
    }
  };
  if (!body.networkName.trim()) {
    throw validation(correlationId, 'networkName', 'required');
  }
  range('returnWindowDays', 0, 365);
  range('posSessionTimeoutMinutes', 1, 240);
  range('minPinLength', 4, 8);
  range('expiryNoticeDays', 1, 365);
  return { ...body, networkName: body.networkName.trim() };
}

function requireOfflineStore(correlationId: string) {
  if (owner().deployment !== 'offline-store') {
    throw new ApiError(404, 'not_found', correlationId);
  }
}

export const ownerHandlers: Pick<MockHandlers, OwnerRoute> = {
  'stores.overview': ({ correlationId }) => {
    const { session } = context(correlationId, 'stores:view');
    const visible = session.stores
      .map((s) => ownerStore(s.id))
      .filter((s): s is OwnerStore => s !== null);
    return {
      stores:
        session.scope === 'network'
          ? [...visible, ...owner().extraStores]
          : visible,
    };
  },
  'stores.create': ({ body, correlationId, idempotencyKey }) => {
    const { session } = context(correlationId, 'stores:create', {
      write: true,
    });
    const repeated = idempotencyKey && owner().storeKeys[idempotencyKey];
    if (repeated) {
      const store = ownerStore(repeated);
      if (store) return store;
    }
    checkStore(body, correlationId);
    const code = body.code.trim().toUpperCase();
    if (storeCodes().includes(code)) {
      throw new ApiError(409, 'store_code_taken', correlationId, [
        { field: 'code', code: 'store_code_taken' },
      ]);
    }
    const legalEntityId = body.newLegalEntity
      ? createLegalEntity(
          legalEntityInput(
            body.newLegalEntity,
            correlationId,
            'newLegalEntity.',
          ) as LegalEntityInput,
          correlationId,
          'newLegalEntity.taxId',
        )
      : activeLegalEntity(body.legalEntityId ?? '', correlationId);
    // A new store is an active cloud store at once (spec 2026-10-06-owner-stores, section 3).
    const id = `store-${owner().counters.store++}`;
    stores.push({
      id,
      name: body.name.trim(),
      address: body.address.trim(),
      mode: 'cloud',
    });
    owner().storeDetails[id] = {
      code,
      kind: body.kind,
      legalEntityId,
      printReceiptDefault: body.printReceiptDefault,
      status: 'active',
      paidUntil: null,
      licenseValidUntil: null,
      closedOn: null,
      stockMovedTo: null,
    };
    if (idempotencyKey) owner().storeKeys[idempotencyKey] = id;
    appendAudit(session, {
      action: 'settings_change',
      object: body.name.trim(),
      details: 'Новая точка',
      storeName: null,
    });
    const store = ownerStore(id);
    if (!store) throw new ApiError(404, 'not_found', correlationId);
    return store;
  },
  'stores.update': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'stores:update', {
      write: true,
    });
    if (!body.name.trim()) throw invalid(correlationId, 'name', 'required');
    if (!body.address.trim()) {
      throw invalid(correlationId, 'address', 'required');
    }
    const legalEntityId = activeLegalEntity(body.legalEntityId, correlationId);
    const extra = owner().extraStores.find((s) => s.id === params.id);
    if (extra) {
      if (extra.status === 'closed') {
        throw new ApiError(409, 'store_closed', correlationId);
      }
      Object.assign(extra, {
        name: body.name.trim(),
        address: body.address.trim(),
        legalEntityId,
        legalEntityName: legalEntityName(legalEntityId),
        printReceiptDefault: body.printReceiptDefault,
      });
      return extra;
    }
    const base = stores.find((s) => s.id === params.id);
    // a store outside the scope does not exist for the employee
    if (!base || !session.stores.some((s) => s.id === base.id)) {
      throw new ApiError(404, 'not_found', correlationId);
    }
    base.name = body.name.trim();
    base.address = body.address.trim();
    Object.assign(owner().storeDetails[base.id], {
      legalEntityId,
      printReceiptDefault: body.printReceiptDefault,
    });
    appendAudit(session, {
      action: 'settings_change',
      object: base.name,
      details: 'Карточка точки',
      storeName: base.name,
    });
    mockDb().pos.catalogVersion += 1;
    const updated = ownerStore(base.id);
    if (!updated) throw new ApiError(404, 'not_found', correlationId);
    return updated;
  },
  'legalEntities.list': ({ correlationId }) => {
    context(correlationId, 'stores:view');
    return {
      items: owner()
        .legalEntities.map((e) => toLegalEntity(e.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
      defaults: {
        name: owner().settings.networkName,
        taxId: owner().legalEntities[0]?.taxId ?? null,
      },
    };
  },
  'legalEntities.create': ({ body, correlationId }) => {
    context(correlationId, 'stores:create', { write: true });
    const input = legalEntityInput(body, correlationId) as LegalEntityInput;
    return toLegalEntity(createLegalEntity(input, correlationId, 'taxId'));
  },
  'legalEntities.update': ({ params, body, correlationId }) => {
    context(correlationId, 'stores:update', { write: true });
    const entity = owner().legalEntities.find((e) => e.id === params.id);
    if (!entity) throw new ApiError(404, 'not_found', correlationId);
    const change = legalEntityInput(body, correlationId);
    if (change.taxId && taxIdTaken(change.taxId, entity.id)) {
      throw new ApiError(409, 'tax_id_taken', correlationId, [
        { field: 'taxId', code: 'tax_id_taken' },
      ]);
    }
    Object.assign(entity, change);
    return toLegalEntity(entity.id);
  },
  'stores.closingPreview': ({ params, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'stores:delete');
    if (!session.stores.some((s) => s.id === params.id)) {
      throw new ApiError(403, 'store_not_in_scope', correlationId);
    }
    const lines = mockDb().pos.products.flatMap((product) =>
      product.batches
        .map((batch) => ({ batch, held: stockAt(params.id)[batch.id] ?? 0 }))
        .filter(({ held }) => held > 0)
        .map(({ batch, held }) => ({
          productName: product.name,
          batchNumber: batch.number,
          expiresOn: batch.expiresOn,
          quantityPieces: held,
          piecesPerPack: product.piecesPerPack,
          ...(canSeeCost && {
            costMinor: Math.round(
              (held * (batch.costMinor ?? 0)) / product.piecesPerPack,
            ),
          }),
        })),
    );
    return {
      lines,
      positions: lines.length,
      ...(canSeeCost && {
        totalCostMinor: lines.reduce((sum, l) => sum + (l.costMinor ?? 0), 0),
      }),
    };
  },
  'stores.close': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'stores:delete', {
      write: true,
    });
    const store = stores.find((s) => s.id === params.id);
    if (!store) throw new ApiError(404, 'not_found', correlationId);
    if (store.mode === 'offline') {
      // the stock of an offline store moves only from the store itself (ADR-0014)
      throw new ApiError(409, 'offline_store_read_only', correlationId);
    }
    const receiver = stores.find((s) => s.id === body.receiverStoreId);
    if (!receiver || receiver.id === store.id || receiver.mode !== 'cloud') {
      throw validation(correlationId, 'receiverStoreId', 'invalid');
    }
    const lines = mockDb().pos.products.flatMap((product) =>
      product.batches
        .filter((b) => (stockAt(store.id)[b.id] ?? 0) >= product.piecesPerPack)
        .map((b) => ({
          productId: product.id,
          batchId: b.id,
          quantity: Math.floor(
            (stockAt(store.id)[b.id] ?? 0) / product.piecesPerPack,
          ),
        })),
    );
    if (lines.length === 0) {
      throw validation(correlationId, 'lines', 'empty_stock');
    }
    const transfer = stockHandlers['transfers.create']({
      params: undefined,
      query: undefined,
      body: {
        requestId: null,
        fromStoreId: store.id,
        toStoreId: receiver.id,
        send: true,
        lines,
      },
      correlationId,
    });
    const details = owner().storeDetails[store.id];
    Object.assign(details, {
      status: 'closing',
      closedOn: body.closeOn,
      stockMovedTo: receiver.name,
      closingTransferId: transfer.id,
    });
    appendAudit(session, {
      action: 'transfer',
      object: transfer.number,
      details: `Закрытие точки · ${store.name} → ${receiver.name}`,
      storeName: store.name,
    });
    const closing = ownerStore(store.id);
    if (!closing) throw new ApiError(404, 'not_found', correlationId);
    return { transferNumber: transfer.number, store: closing };
  },

  'services.list': ({ correlationId }) => {
    context(correlationId, 'services:view');
    return owner().services;
  },
  'services.request': ({ params, correlationId }) => {
    const { session } = context(correlationId, 'services:create', {
      write: true,
    });
    const service = owner().services.find((s) => s.key === params.key);
    if (!service) throw new ApiError(404, 'not_found', correlationId);
    if (service.state !== 'available') {
      throw new ApiError(409, 'service_requested', correlationId);
    }
    service.state = 'requested';
    service.requestedAt = new Date().toISOString();
    appendAudit(session, {
      action: 'settings_change',
      object: service.key,
      details: 'Запрос на подключение услуги',
      storeName: null,
    });
    return service;
  },
  'billing.get': ({ correlationId }) => {
    context(correlationId, 'billing:view');
    const [current, ...history] = owner().invoices;
    const activeStores = stores.filter(
      (s) => s.mode === 'cloud' && (storeDay[s.id]?.receipts ?? 0) > 0,
    ).length;
    return {
      current: {
        ...current,
        activeStores,
        pricePerStoreMinor: PRICE_PER_STORE_MINOR,
        amountMinor: activeStores * PRICE_PER_STORE_MINOR,
      },
      history,
    };
  },

  'reports.get': ({ params, query, correlationId }) => {
    const { session, canSeeCost } = context(correlationId, 'reports:view');
    if (query.storeId && !session.stores.some((s) => s.id === query.storeId)) {
      throw new ApiError(403, 'store_not_in_scope', correlationId);
    }
    if (query.from > query.to) {
      throw validation(correlationId, 'from', 'range');
    }
    const table = report(
      params.kind,
      session,
      canSeeCost,
      query.from,
      query.to,
      query.storeId,
    );
    // the cells of the columns left out are not sent either (ADR-0018, п. 6)
    const keys = new Set(table.columns.map((c) => c.key));
    const pick = (row: Record<string, ReportCell>) =>
      Object.fromEntries(Object.entries(row).filter(([key]) => keys.has(key)));
    return {
      kind: params.kind,
      columns: table.columns,
      rows: table.rows.map(pick),
      total: table.total ? pick(table.total) : null,
    };
  },

  'export1c.preview': ({ query, correlationId }) => {
    const { session } = context(correlationId, 'export-1c:view');
    const days = Math.max(1, daysBetween(query.from, query.to) + 1);
    const scoped = session.stores.filter(
      (s) => !query.storeId || s.id === query.storeId,
    );
    const stock = mockDb().stock;
    const documents = [
      ...stock.goodsReceipts,
      ...stock.writeOffs,
      ...stock.supplierReturns,
    ].filter(
      (d) =>
        d.status === 'posted' &&
        scoped.some((s) => s.id === d.storeId) &&
        inPeriod(d.date, query.from, query.to),
    ).length;
    return {
      receipts: scoped.reduce(
        (sum, s) => sum + (storeDay[s.id]?.receipts ?? 0) * days,
        0,
      ),
      documents,
      unmapped: unmappedProducts(),
    };
  },
  'export1c.setArticle': ({ params, body, correlationId }) => {
    context(correlationId, 'export-1c:export', { write: true });
    findDoc(mockDb().pos.products, params.productId, correlationId);
    const article = body.article.trim();
    if (!article) throw validation(correlationId, 'article', 'required');
    const taken = Object.entries(owner().articles1c).find(
      ([productId, value]) =>
        value === article && productId !== params.productId,
    );
    if (taken) throw new ApiError(409, 'article_taken', correlationId);
    owner().articles1c[params.productId] = article;
  },
  'export1c.run': ({ body, correlationId }) => {
    const { session } = context(correlationId, 'export-1c:export', {
      write: true,
    });
    const preview = ownerHandlers['export1c.preview']({
      params: undefined,
      query: {
        from: body.from,
        to: body.to,
        storeId: body.storeId ?? undefined,
      },
      body: undefined,
      correlationId,
    });
    const excluded = new Set(preview.unmapped.map((u) => u.productId));
    const goods = mockDb()
      .pos.products.filter((p) => !excluded.has(p.id))
      .map(
        (p) =>
          `<Товар><Ид>${xmlEscape(owner().articles1c[p.id] ?? '')}</Ид><Наименование>${xmlEscape(p.name)}</Наименование></Товар>`,
      )
      .join('');
    // a skeleton of the CommerceML document — the real one is built by apps/api
    const xml = `<?xml version="1.0" encoding="UTF-8"?><КоммерческаяИнформация ВерсияСхемы="2.10" ДатаФормирования="${today()}"><Каталог><Товары>${goods}</Товары></Каталог></КоммерческаяИнформация>`;
    appendAudit(session, {
      action: 'settings_change',
      object: '1С',
      details: `Выгрузка ${body.from} — ${body.to}`,
      storeName: null,
    });
    return {
      fileName: `export-1c_${body.from}_${body.to}.xml`,
      downloadUrl: `data:application/xml;charset=utf-8,${encodeURIComponent(xml)}`,
      receipts: preview.receipts,
      documents: preview.documents,
      excluded: excluded.size,
    };
  },

  'settings.get': ({ correlationId }) => {
    context(correlationId, 'settings:view');
    return owner().settings;
  },
  'settings.update': ({ body, correlationId }) => {
    const { session } = context(correlationId, 'settings:update', {
      write: true,
    });
    owner().settings = settingsInput(body, correlationId);
    appendAudit(session, {
      action: 'settings_change',
      object: 'Настройки сети',
      details: '—',
      storeName: null,
    });
    mockDb().pos.catalogVersion += 1;
    return owner().settings;
  },
  'settings.markups': ({ correlationId }) => {
    context(correlationId, 'settings:view');
    return activeCategories().map((c) => ({
      categoryId: c.id,
      categoryName: c.name,
      markupPercent: mockDb().stock.markup[c.id] ?? null,
      products: mockDb().pos.products.filter((p) => p.categoryId === c.id)
        .length,
    }));
  },
  'settings.updateMarkups': ({ body, correlationId }) => {
    const { session } = context(correlationId, 'settings:update', {
      write: true,
    });
    for (const markup of body.markups) {
      if (!activeCategories().some((c) => c.id === markup.categoryId)) {
        throw validation(correlationId, 'categoryId', 'unknown');
      }
      if (
        !Number.isInteger(markup.markupPercent) ||
        markup.markupPercent < 0 ||
        markup.markupPercent > 1000
      ) {
        throw validation(correlationId, 'markupPercent', 'range');
      }
    }
    for (const markup of body.markups) {
      mockDb().stock.markup[markup.categoryId] = markup.markupPercent;
    }
    appendAudit(session, {
      action: 'settings_change',
      object: 'Наценки категорий',
      details: '—',
      storeName: null,
    });
    return ownerHandlers['settings.markups']({
      params: undefined,
      query: undefined,
      body: undefined,
      correlationId,
    });
  },

  'sync.stores': ({ correlationId }) => {
    const { session } = context(correlationId, 'sync:view');
    return session.stores
      .filter((s) => s.mode === 'offline')
      .map((s) => ({
        storeId: s.id,
        storeName: s.name,
        lastSyncAt: owner().lastSyncAt,
        appliedLastDay: 48,
        quarantined: 0,
        licenseValidUntil:
          owner().storeDetails[s.id]?.licenseValidUntil ?? null,
        priceConflicts: mockDb().catalog.priceConflicts.filter(
          (c) => c.storeId === s.id,
        ).length,
        pendingDuplicates: mockDb().catalog.duplicates.filter(
          (d) => d.storeId === s.id && d.status === 'pending',
        ).length,
      }));
  },
  'sync.queue': ({ query, correlationId }) => {
    context(correlationId, 'sync:view');
    requireOfflineStore(correlationId);
    const items = owner().offlineQueue;
    const limit = query?.limit ?? 20;
    const offset = query?.offset ?? 0;
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
    };
  },
  'sync.run': ({ correlationId }) => {
    context(correlationId, 'sync:run', { write: true });
    requireOfflineStore(correlationId);
    const sent = owner().offlineQueue.length;
    owner().offlineQueue = [];
    owner().lastSyncAt = new Date().toISOString();
    return { sent, received: 12, finishedAt: owner().lastSyncAt };
  },
  'catalog.resolveDuplicate': ({ params, body, correlationId }) => {
    const { session } = context(correlationId, 'catalog:update', {
      write: true,
    });
    requireOfflineStore(correlationId);
    const duplicate = findDoc(
      mockDb().catalog.duplicates,
      params.id,
      correlationId,
    );
    // the store that added the product decides (ADR-0014)
    if (duplicate.storeId !== session.currentStoreId) {
      throw new ApiError(403, 'store_not_in_scope', correlationId);
    }
    if (duplicate.status !== 'pending') {
      throw new ApiError(409, 'duplicate_resolved', correlationId);
    }
    duplicate.status = body.decision === 'merge' ? 'merged' : 'kept';
  },
};

/** PIN rule with the network minimum (ADR-0008), for the handlers that set a PIN. */
export const networkPinProblem = (pin: string) =>
  checkPin(pin, owner().settings.minPinLength);
