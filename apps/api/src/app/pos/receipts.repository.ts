import { Injectable } from '@nestjs/common';
import type { ReceiptPaymentMethod } from '@pharmacy/shared-dto';
import type { TenantTransaction } from '../../core/database';

export type DiscrepancyKind =
  | 'stock'
  | 'price'
  | 'discount'
  | 'catalog'
  | 'author'
  | 'closed_period';

export interface ReceiptValues {
  id: string;
  storeId: string;
  terminalId: string;
  shiftId: string;
  cashierId: string;
  number: string;
  soldAt: Date;
  receivedAt: Date;
  businessDate: string;
  subtotalDirams: number;
  discountRuleId: string | null;
  discountPercentBp: number;
  discountMinTotalDirams: number | null;
  discountDirams: number;
  totalDirams: number;
  cashTenderedDirams: number;
  changeDirams: number;
  discrepancyKinds: DiscrepancyKind[];
  correlationId: string;
  origin: 'online' | 'offline_buffer';
  language: 'ru' | 'tj';
  /** The number of the receipt of the terminal within its shift (P12); null for an older buffer. */
  localNumber: number | null;
}

export interface ReceiptLineValues {
  id: string;
  lineNo: number;
  productId: string;
  batchId: string;
  saleUnit: 'pack' | 'piece';
  piecesPerPack: number;
  qtyPieces: number;
  unitPriceDirams: number;
  lineAmountDirams: number;
  discountShareDirams: number;
  costDirams: bigint;
  batchChosenManually: boolean;
  shortfallPieces: number;
  currentPriceDirams: number | null;
}

// A paid receipt of the POS with its lines, payments and ПКУ records (data model 04; all
// append-only), written in the transaction of the sale with its movements.
@Injectable()
export class ReceiptsRepository {
  async insertReceipt(
    trx: TenantTransaction,
    tenantId: string,
    values: ReceiptValues,
  ): Promise<void> {
    await trx
      .insertInto('receipts')
      .values({
        tenantId,
        ...values,
        subtotalDirams: BigInt(values.subtotalDirams),
        discountMinTotalDirams:
          values.discountMinTotalDirams === null
            ? null
            : BigInt(values.discountMinTotalDirams),
        discountDirams: BigInt(values.discountDirams),
        totalDirams: BigInt(values.totalDirams),
        cashTenderedDirams: BigInt(values.cashTenderedDirams),
        changeDirams: BigInt(values.changeDirams),
      })
      .execute();
  }

  async insertLines(
    trx: TenantTransaction,
    tenantId: string,
    receiptId: string,
    lines: readonly ReceiptLineValues[],
  ): Promise<void> {
    await trx
      .insertInto('receiptLines')
      .values(
        lines.map((line) => ({
          tenantId,
          receiptId,
          ...line,
          unitPriceDirams: BigInt(line.unitPriceDirams),
          lineAmountDirams: BigInt(line.lineAmountDirams),
          discountShareDirams: BigInt(line.discountShareDirams),
          currentPriceDirams:
            line.currentPriceDirams === null
              ? null
              : BigInt(line.currentPriceDirams),
        })),
      )
      .execute();
  }

  async insertPayments(
    trx: TenantTransaction,
    tenantId: string,
    receiptId: string,
    payments: ReadonlyArray<{
      id: string;
      kind: ReceiptPaymentMethod;
      amountDirams: number;
    }>,
  ): Promise<void> {
    if (payments.length === 0) return;
    await trx
      .insertInto('payments')
      .values(
        payments.map((p) => ({
          tenantId,
          id: p.id,
          receiptId,
          kind: p.kind,
          amountDirams: BigInt(p.amountDirams),
        })),
      )
      .execute();
  }

  async insertControlled(
    trx: TenantTransaction,
    tenantId: string,
    records: ReadonlyArray<{
      id: string;
      receiptLineId: string;
      prescriptionNote: Record<string, string> | null;
      recordedBy: string;
      recordedAt: Date;
    }>,
  ): Promise<void> {
    if (records.length === 0) return;
    await trx
      .insertInto('controlledSaleRecords')
      .values(
        records.map((r) => ({
          tenantId,
          id: r.id,
          receiptLineId: r.receiptLineId,
          prescriptionNote:
            r.prescriptionNote === null
              ? null
              : JSON.stringify(r.prescriptionNote),
          recordedBy: r.recordedBy,
          recordedAt: r.recordedAt,
        })),
      )
      .execute();
  }
}
