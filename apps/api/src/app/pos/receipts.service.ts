import { Injectable, Logger } from '@nestjs/common';
import {
  bestDiscount,
  hasPermissions,
  piecePriceMinor,
} from '@pharmacy/shared-domain';
import type { ControlledSaleData, CreatedReceipt } from '@pharmacy/shared-dto';
import {
  getPrincipal,
  getTerminal,
  requireTenantId,
} from '../../common/context/request-context';
import {
  type FieldError,
  FieldProblemException,
} from '../../common/errors/validation-failed.exception';
import { newId, TenantDatabase } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import {
  type PosCatalogProduct,
  ProductsReader,
} from '../catalog/products-reader';
import { Numbering } from '../inventory/numbering';
import { PosStock } from '../inventory/pos-stock';
import { StorePricesReader } from '../pricing/store-prices-reader';
import type { CreateReceiptDto } from './dto/pos.dto';
import { PosIdempotency } from './idempotency';
import {
  ONLINE_WITHIN_MS,
  PosContext,
  type PosOperation,
  terminalAuthor,
  terminalVia,
} from './pos-context';
import { PosRepository } from './pos.repository';
import {
  cashPart,
  checkArithmetic,
  discountShares,
} from './receipt-pricing';
import {
  discountError,
  mayAcceptDiscrepancy,
  priceErrors,
  PriceRulesViolated,
} from './receipt-rules';
import {
  type DiscrepancyKind,
  type ReceiptLineValues,
  ReceiptsRepository,
} from './receipts.repository';
import { operationMoment, ShiftsService } from './shifts.service';

const NOTE_FIELDS: Array<keyof ControlledSaleData> = [
  'prescriptionNumber',
  'prescriptionDate',
  'clinic',
  'doctor',
  'buyerName',
  'buyerDocument',
];

const HOUR_MS = 3_600_000;

const invalid = (errors: FieldError[]) =>
  new FieldProblemException(400, 'validation_failed', errors);

/** The prescription data that was filled in, or null (K3: every field optional). */
function noteOf(data: ControlledSaleData | null): Record<string, string> | null {
  if (data === null) return null;
  const note: Record<string, string> = {};
  for (const field of NOTE_FIELDS) {
    const value = data[field]?.trim();
    if (value) note[field] = value;
  }
  return Object.keys(note).length > 0 ? note : null;
}

// The sale of a cloud store (spec 2026-10-13-pos-shift-sale, 4.5; ADR-0015 «продажа — факт»): the
// receipt, its lines (one batch each), payments, ПКУ records and `sale` movements in one
// transaction under its idempotency key. Only what cannot be a fact even after the sale is refused
// (E6); stock, price, discount, catalog, author and closed-period differences are marks (E5). A price or a discount
// that was never the store's is refused, unless a manager accepts it (security review 2026-10-22, I2; ADR-0015,
// amendment 2026-10-23).
@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    private readonly db: TenantDatabase,
    private readonly context: PosContext,
    private readonly idempotency: PosIdempotency,
    private readonly repository: PosRepository,
    private readonly receipts: ReceiptsRepository,
    private readonly shifts: ShiftsService,
    private readonly products: ProductsReader,
    private readonly prices: StorePricesReader,
    private readonly stock: PosStock,
    private readonly numbering: Numbering,
    private readonly audit: AuditService,
  ) {}

  async create(
    body: CreateReceiptDto,
    key: string | undefined,
    sentAt?: string,
    acceptDiscrepancy = false,
  ): Promise<CreatedReceipt> {
    this.idempotency.checkHeader(key, body.id);
    this.context.requireStore(body.storeId);
    const id = body.id.toLowerCase();
    const replay = await this.idempotency.replay<CreatedReceipt>(
      requireTenantId(),
      'receipt',
      id,
      body,
    );
    if (replay) return replay.response;
    const arithmetic = checkArithmetic(body);
    if (arithmetic.length > 0) throw invalid(arithmetic);
    const op = await this.context.operation(body, 'pos:create', sentAt, {
      shiftId: body.shiftId.toLowerCase(),
    });
    try {
      return await this.accept(body, id, op, acceptDiscrepancy);
    } catch (error) {
      // a refused receipt leaves only this trace for the owner's journal (I2): nothing of the sale is written
      if (error instanceof PriceRulesViolated) {
        // the trace never replaces the answer: the POS must get the 422 and quarantine the sale
        await this.db
          .tenantTransaction((trx) =>
            this.audit.append(trx, {
              action: 'receipt.refused',
              entityType: 'receipt',
              entityId: id,
              storeId: op.storeId,
              ...terminalAuthor(op),
              details: {
                ...terminalVia(op),
                shiftId: body.shiftId.toLowerCase(),
                authorId: op.author.id,
                totalMinor: body.totalMinor,
                errors: error.errors,
              },
            }),
          )
          .catch((failure: unknown) =>
            this.logger.error(
              `the refusal of a receipt was not journaled [correlationId=${op.correlationId}]`,
              failure instanceof Error ? failure.stack : undefined,
            ),
          );
      }
      throw error;
    }
  }

  private accept(
    body: CreateReceiptDto,
    id: string,
    op: PosOperation,
    acceptDiscrepancy: boolean,
  ): Promise<CreatedReceipt> {
    const { tenantId, storeId } = op;
    return this.db.tenantTransaction((trx) =>
      this.idempotency.run(trx, tenantId, 'receipt', id, body, 201, async () => {
        const shift = await this.shifts.lockOpenShift(
          trx,
          tenantId,
          body.shiftId,
          op.terminalId,
          'share',
        );
        const store = await this.context.cloudStore(trx, tenantId, storeId);
        const ruleId = body.discountRuleId?.split(':')[0].toLowerCase() ?? null;
        if (
          ruleId !== null &&
          !(await this.prices.ruleExists(trx, tenantId, ruleId))
        ) {
          throw invalid([{ field: 'discountRuleId', code: 'unknown_discount' }]);
        }
        const productIds = [
          ...new Set(body.lines.map((l) => l.productId.toLowerCase())),
        ];
        const products = new Map(
          (await this.products.listForPos(trx, tenantId, productIds)).map(
            (p): [string, PosCatalogProduct] => [p.id, p],
          ),
        );
        const batches = await this.stock.lockBatches(
          trx,
          tenantId,
          storeId,
          body.lines.map((l) => l.batchId.toLowerCase()),
        );
        const soldAt = operationMoment(op, shift.openedAt);
        const businessDate = await this.repository.businessDate(
          trx,
          tenantId,
          soldAt,
        );
        const errors: FieldError[] = [];
        body.lines.forEach((line, i) => {
          const batch = batches.get(line.batchId.toLowerCase());
          if (!products.has(line.productId.toLowerCase())) {
            errors.push({ field: `lines.${i}.productId`, code: 'unknown_product' });
          } else if (!batch) {
            errors.push({ field: `lines.${i}.batchId`, code: 'unknown_batch' });
          } else if (batch.productId !== line.productId.toLowerCase()) {
            errors.push({ field: `lines.${i}.batchId`, code: 'mismatch' });
          } else if (batch.expiryDate < businessDate) {
            // the expired batch is a hard ban without a bypass (ТЗ), even after the fact
            errors.push({ field: `lines.${i}.batchId`, code: 'batch_expired' });
          }
        });
        if (errors.length > 0) throw invalid(errors);

        const settings = await this.repository.settings(trx, tenantId);
        const current = await this.prices.pricesOfStore(
          trx,
          tenantId,
          storeId,
          productIds,
        );
        const tiers = await this.prices.activeTiers(
          trx,
          tenantId,
          storeId,
          businessDate,
        );
        const kinds = new Set<DiscrepancyKind>();
        const author = op.author;
        if (author.flagged) kinds.add('author');
        const best = bestDiscount(
          body.subtotalMinor,
          tiers.map((t) => ({
            id: `${t.ruleId}:${t.minSubtotalDirams}`,
            minSubtotalMinor: t.minSubtotalDirams,
            percent: t.percent,
          })),
        );
        if (
          best.amountMinor !== body.discountMinor ||
          (best.ruleId?.toLowerCase() ?? null) !==
            (body.discountRuleId?.toLowerCase() ?? null)
        ) {
          kinds.add('discount');
        }
        if (store.closedUntil !== null && businessDate <= store.closedUntil) {
          kinds.add('closed_period');
        }

        // the price and the discount by the rules of the store (I2): the current ones, or those of the moment of the
        // POS snapshot when it is not older than the buffer of the network allows (ADR-0015, amendment 2026-10-23)
        const snapshotAt = new Date(
          Math.min(body.priceListVersion, op.receivedAt.getTime()),
        );
        const snapshotUsable =
          snapshotAt.getTime() >=
          soldAt.getTime() - settings.bufferLimits.maxHours * HOUR_MS;
        const then = snapshotUsable
          ? await this.prices.packPricesAround(
              trx,
              tenantId,
              storeId,
              current,
              productIds,
              snapshotAt,
            )
          : new Map<string, number[]>();
        const snapshotDate = snapshotUsable
          ? await this.repository.businessDate(trx, tenantId, snapshotAt)
          : businessDate;
        const snapshotTiers =
          snapshotDate === businessDate
            ? []
            : await this.prices.activeTiers(trx, tenantId, storeId, snapshotDate);
        const unitPriceOf = (
          line: CreateReceiptDto['lines'][number],
          packDirams: number | undefined,
        ): number | null => {
          const product = products.get(
            line.productId.toLowerCase(),
          ) as PosCatalogProduct;
          if (packDirams === undefined) return null;
          if (line.unit === 'pack') return packDirams;
          return product.divisible && product.piecesPerPack > 1
            ? piecePriceMinor(
                packDirams,
                product.piecesPerPack,
                current.get(product.id)?.ownPieceDirams ?? null,
                settings.pieceStepDirams,
              )
            : null;
        };
        const nowPrices = body.lines.map((line) =>
          unitPriceOf(line, current.get(line.productId.toLowerCase())?.packDirams),
        );
        const ruleErrors = priceErrors(
          body.lines.map((line, i) => ({
            unitPriceMinor: line.unitPriceMinor,
            allowed: [
              nowPrices[i],
              ...(then.get(line.productId.toLowerCase()) ?? []).map((pack) =>
                unitPriceOf(line, pack),
              ),
            ],
          })),
        );
        const discountRefused = discountError(body, [...tiers, ...snapshotTiers]);
        if (discountRefused) ruleErrors.push(discountRefused);
        let acceptedBy: string | null = null;
        if (ruleErrors.length > 0) {
          // «Принять расхождение»: the employee of the request, never the author, with the rights on the store; under
          // the terminal — the session the request came with
          const principal =
            getPrincipal() ?? getTerminal()?.sessionPrincipal ?? null;
          if (
            !acceptDiscrepancy ||
            principal === null ||
            !mayAcceptDiscrepancy(principal, storeId, ruleErrors)
          ) {
            throw new PriceRulesViolated(ruleErrors);
          }
          acceptedBy = principal.employeeId;
        }

        const number = await this.numbering.next(
          trx,
          tenantId,
          store,
          'receipt',
          businessDate,
        );
        const shares = discountShares(
          body.lines.map((l) => l.amountMinor),
          body.discountMinor,
        );
        const left = new Map(
          [...batches.values()].map((b) => [b.id, b.stockPieces]),
        );
        const lines: ReceiptLineValues[] = body.lines.map((line, i) => {
          const product = products.get(
            line.productId.toLowerCase(),
          ) as PosCatalogProduct;
          const batch = batches.get(line.batchId.toLowerCase());
          if (!batch) throw new Error('batch checked above');
          const pieces =
            line.unit === 'pack'
              ? line.quantity * line.piecesPerPack
              : line.quantity;
          const after = (left.get(batch.id) ?? 0) - pieces;
          left.set(batch.id, after);
          const shortfall = after < 0 ? Math.min(pieces, -after) : 0;
          if (shortfall > 0) kinds.add('stock');
          const now = nowPrices[i];
          const priceDiffers = now !== line.unitPriceMinor;
          if (priceDiffers) kinds.add('price');
          const controlled = line.controlled !== null;
          if (
            line.piecesPerPack !== product.piecesPerPack ||
            (line.unit === 'piece' && !product.divisible) ||
            controlled !== (product.prescription === 'controlled')
          ) {
            kinds.add('catalog');
          }
          if (
            (controlled &&
              !hasPermissions(author.permissions, 'pos:sell-controlled')) ||
            (line.batchChosenManually &&
              !hasPermissions(author.permissions, 'pos:choose-batch'))
          ) {
            kinds.add('author');
          }
          return {
            id: newId(),
            lineNo: i + 1,
            productId: product.id,
            batchId: batch.id,
            saleUnit: line.unit,
            piecesPerPack: line.piecesPerPack,
            qtyPieces: pieces,
            unitPriceDirams: line.unitPriceMinor,
            lineAmountDirams: line.amountMinor,
            discountShareDirams: shares[i],
            costDirams: BigInt(pieces) * batch.costPerPieceDirams,
            batchChosenManually: line.batchChosenManually,
            shortfallPieces: shortfall,
            currentPriceDirams: priceDiffers ? now : null,
          };
        });

        const discrepancyKinds = [...kinds].sort();
        const cash = cashPart(body);
        await this.receipts.insertReceipt(trx, tenantId, {
          id,
          storeId,
          terminalId: op.terminalId,
          shiftId: shift.id,
          cashierId: author.id,
          number,
          soldAt,
          receivedAt: op.receivedAt,
          businessDate,
          subtotalDirams: body.subtotalMinor,
          discountRuleId: ruleId,
          discountPercentBp: ruleId === null ? 0 : body.discountPercent * 100,
          discountMinTotalDirams:
            ruleId === null ? null : body.discountMinSubtotalMinor,
          discountDirams: body.discountMinor,
          totalDirams: body.totalMinor,
          cashTenderedDirams: cash > 0 ? body.cashTenderedMinor : 0,
          changeDirams: body.changeMinor,
          discrepancyKinds,
          correlationId: op.correlationId,
          origin:
            op.receivedAt.getTime() - soldAt.getTime() > ONLINE_WITHIN_MS
              ? 'offline_buffer'
              : 'online',
          language: body.language,
          localNumber: body.localNumber ?? null,
        });
        await this.receipts.insertLines(trx, tenantId, id, lines);
        // the cash line holds what was handed over: Σ payments = total + change (E10)
        await this.receipts.insertPayments(
          trx,
          tenantId,
          id,
          body.payments.map((p) => ({
            id: newId(),
            kind: p.method,
            amountDirams:
              p.method === 'cash' ? body.cashTenderedMinor : p.amountMinor,
          })),
        );
        await this.receipts.insertControlled(
          trx,
          tenantId,
          body.lines.flatMap((line, i) => {
            const product = products.get(line.productId.toLowerCase());
            const isControlled =
              line.controlled !== null || product?.prescription === 'controlled';
            return isControlled
              ? [
                  {
                    id: newId(),
                    receiptLineId: lines[i].id,
                    prescriptionNote: noteOf(line.controlled),
                    recordedBy: author.id,
                    recordedAt: soldAt,
                  },
                ]
              : [];
          }),
        );
        await this.stock.recordSale(
          trx,
          tenantId,
          lines.map((line) => ({
            storeId,
            batchId: line.batchId,
            qtyPieces: line.qtyPieces,
            receiptId: id,
            lineId: line.id,
            businessDate,
          })),
        );
        // no prescription data in the audit (data model 06)
        await this.audit.append(trx, {
          action: 'receipt.completed',
          entityType: 'receipt',
          entityId: id,
          storeId,
          ...terminalAuthor(op),
          details: {
            ...terminalVia(op),
            number,
            localNumber: body.localNumber ?? null,
            shiftId: shift.id,
            authorId: author.id,
            totalMinor: body.totalMinor,
            discrepancyKinds,
            ...(acceptedBy === null
              ? {}
              : { acceptedBy, acceptedErrors: ruleErrors }),
          },
        });
        return {
          id,
          number,
          fiscal: null,
          discrepancies: discrepancyKinds.length,
        };
      }),
    );
  }
}
