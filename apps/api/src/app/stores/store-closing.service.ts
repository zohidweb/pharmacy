import { Injectable, type OnModuleInit } from '@nestjs/common';
import { hasPermissions } from '@pharmacy/shared-domain';
import type {
  CloseStoreRequest,
  CloseStoreResponse,
  OwnerStore,
  StoreClosingBlocker,
  StoreClosingPreview,
  StoreClosingWarning,
} from '@pharmacy/shared-dto';
import { sql } from 'kysely';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { TenantDatabase, type TenantTransaction } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { StoreClosingTransfers } from '../inventory/store-closing-transfers';
import { TransferAcceptance } from '../inventory/transfer-acceptance';
import { PosShifts } from '../pos/pos-shifts';
import { StoreDiscountDetachment } from '../pricing/store-discount-detachment';
import { SupplierDues } from '../purchasing/supplier-dues';
import { TerminalsService } from '../terminals/terminals.service';
import { StoresRepository, type StoreRow } from './stores.repository';
import { toOwnerStore } from './stores.service';

/** Lines a transfer of the closing takes: the limit of the acceptance (E6). */
const CLOSING_LINES = 500;

const notFound = () => new ProblemException(404, 'not_found');

// The closing of a store (spec 2026-10-15-store-closing): the whole stock leaves by transfers of 500
// lines (inventory), the store is `closing` while they travel and `closed` when the last one is
// accepted — a store without stock at once. Open shifts (pos), a running count, transfers on the way,
// open requests, a negative stock and a closed period forbid it; the drafts, the open orders and the
// unpaid receipts only stay behind (purchasing). Cancelled while nothing is accepted.
@Injectable()
export class StoreClosingService implements OnModuleInit {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: StoresRepository,
    private readonly transfers: StoreClosingTransfers,
    private readonly shifts: PosShifts,
    private readonly dues: SupplierDues,
    private readonly audit: AuditService,
    private readonly acceptance: TransferAcceptance,
    private readonly terminals: TerminalsService,
    private readonly discounts: StoreDiscountDetachment,
  ) {}

  preview(id: string): Promise<StoreClosingPreview> {
    const principal = requirePrincipal();
    const { tenantId } = principal;
    const storeId = id.toLowerCase();
    const canSeeCost = hasPermissions(principal.permissions, 'finance:view-cost');
    return this.db.tenantTransaction(async (trx) => {
      const row = await this.repository.findStore(trx, tenantId, storeId);
      await this.closable(trx, tenantId, row);
      const stock = await this.transfers.stock(trx, tenantId, storeId);
      const lines = stock.map((line) => ({
        productName: line.productName,
        batchNumber: line.batchNumber,
        expiresOn: line.expiresOn,
        quantityPieces: line.qtyPieces,
        piecesPerPack: line.piecesPerPack,
        ...(canSeeCost && { costMinor: line.qtyPieces * line.costPerPieceMinor }),
      }));
      return {
        lines,
        positions: lines.length,
        ...(canSeeCost && {
          totalCostMinor: lines.reduce((sum, line) => sum + (line.costMinor ?? 0), 0),
        }),
        transfers: Math.ceil(lines.length / CLOSING_LINES),
        blockers: await this.blockers(trx, tenantId, storeId),
        warnings: await this.warnings(trx, tenantId, storeId, canSeeCost),
      };
    });
  }

  async close(id: string, body: CloseStoreRequest): Promise<CloseStoreResponse> {
    const { tenantId, employeeId } = requirePrincipal();
    const storeId = id.toLowerCase();
    let after: (() => Promise<void>) | null = null;
    const response = await this.db.tenantTransaction(async (trx) => {
      // the row first: an opening of a shift or a stock write waits for the closing, or the closing
      // sees what it did (Review Focus 1)
      const row = await this.repository.lockStore(trx, tenantId, storeId);
      await this.closable(trx, tenantId, row);
      const blockers = await this.blockers(trx, tenantId, storeId);
      if (blockers.length > 0) {
        throw new FieldProblemException(
          409,
          'store_not_closable',
          blockers.map((blocker) => ({ field: blocker.code, code: 'blocked' })),
        );
      }
      const stock = await this.transfers.stock(trx, tenantId, storeId);
      if (stock.length === 0) {
        // a store without stock closes at once, without a receiver (Z4)
        await this.repository.startClosing(trx, tenantId, storeId, employeeId, null);
        const started = await this.repository.findStore(trx, tenantId, storeId);
        if (started === null) throw notFound();
        after = await this.complete(trx, tenantId, started);
        return {
          transferNumbers: [] as string[],
          store: await this.read(trx, tenantId, storeId),
        };
      }
      const receiverId = await this.receiver(trx, tenantId, storeId, body.receiverStoreId);
      const sent = await this.transfers.send(
        trx,
        { tenantId, employeeId },
        storeId,
        receiverId,
      );
      await this.repository.startClosing(trx, tenantId, storeId, employeeId, receiverId);
      await this.audit.append(trx, {
        action: 'store.closing-started',
        entityType: 'store',
        entityId: storeId,
        storeId,
        details: {
          receiverStoreId: receiverId,
          transfers: sent.map((transfer) => transfer.number),
          positions: stock.length,
        },
      });
      return {
        transferNumbers: sent.map((transfer) => transfer.number),
        store: await this.read(trx, tenantId, storeId),
      };
    });
    // the terminal sessions of a store closed at once end after the commit
    const work = after as (() => Promise<void>) | null;
    if (work !== null) await work();
    return response;
  }

  cancel(id: string): Promise<OwnerStore> {
    const { tenantId, employeeId } = requirePrincipal();
    const storeId = id.toLowerCase();
    return this.db.tenantTransaction(async (trx) => {
      const row = await this.repository.lockStore(trx, tenantId, storeId);
      if (row === null) throw notFound();
      this.inScope(storeId);
      if (row.status === 'closed') throw new ProblemException(409, 'store_closed');
      if (row.status !== 'closing') throw notFound();
      const recalled = await this.transfers.cancel(
        trx,
        { tenantId, employeeId },
        storeId,
      );
      await this.repository.cancelClosing(trx, tenantId, storeId);
      await this.audit.append(trx, {
        action: 'store.closing-cancelled',
        entityType: 'store',
        entityId: storeId,
        storeId,
        details: { transfers: recalled },
      });
      return this.read(trx, tenantId, storeId);
    });
  }

  /** The closing ends with the acceptance of its last transfer (E11). */
  onModuleInit(): void {
    this.acceptance.register(async (trx, tenantId, transferId) => {
      const storeId = await this.transfers.storeOfTransfer(trx, tenantId, transferId);
      if (storeId === null) return;
      const row = await this.repository.lockStore(trx, tenantId, storeId);
      if (row === null || row.status !== 'closing') return;
      const transfers = await this.transfers.transfers(trx, tenantId, storeId);
      if (transfers.some((transfer) => transfer.status === 'in_transit')) return;
      return this.complete(trx, tenantId, row);
    });
  }

  /**
   * `closing` → `closed` in the transaction that ends the closing (E11, E12): the terminals of the
   * store are revoked by who started the closing, the store leaves the discount rules; the employee
   * scope keeps it as history. Returns the work for after the commit (the terminal sessions).
   */
  private async complete(
    trx: TenantTransaction,
    tenantId: string,
    row: StoreRow,
  ): Promise<() => Promise<void>> {
    const storeId = row.id;
    await this.repository.markClosed(trx, tenantId, storeId);
    const terminals = await this.terminals.revokeOfStore(
      trx,
      tenantId,
      storeId,
      row.closingStartedBy as string,
    );
    const rules = await this.discounts.detachStore(trx, tenantId, storeId);
    await this.audit.append(trx, {
      action: 'store.closed',
      entityType: 'store',
      entityId: storeId,
      storeId,
      details: {
        terminals: terminals.length,
        rulesDetached: rules.detached,
        rulesArchived: rules.archived,
      },
    });
    return () => this.terminals.afterRevokeAll(tenantId, terminals);
  }

  /**
   * The store may be closed (E2): in the scope (403), cloud (409), active (409), not the last
   * active store of the network (409 `last_store`).
   */
  private async closable(
    trx: TenantTransaction,
    tenantId: string,
    row: StoreRow | null,
  ): Promise<void> {
    if (row === null) throw notFound();
    this.inScope(row.id);
    if (row.status === 'closed') throw new ProblemException(409, 'store_closed');
    if (row.status === 'closing') throw new ProblemException(409, 'store_closing');
    if (row.mode !== 'online') {
      throw new ProblemException(409, 'offline_store_read_only');
    }
    if ((await this.repository.activeCount(trx, tenantId)) <= 1) {
      throw new ProblemException(409, 'last_store');
    }
  }

  private inScope(storeId: string): void {
    const { storeScope } = requirePrincipal();
    if (storeScope !== 'all' && !storeScope.includes(storeId)) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
  }

  /** The receiver (E3): another active cloud store of the network, else 422 `receiverStoreId`. */
  private async receiver(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    receiverStoreId: string | null,
  ): Promise<string> {
    const invalid = () =>
      new FieldProblemException(422, 'validation_failed', [
        { field: 'receiverStoreId', code: 'invalid' },
      ]);
    if (receiverStoreId === null) throw invalid();
    const id = receiverStoreId.toLowerCase();
    if (id === storeId) throw invalid();
    const receiver = await this.repository.findStore(trx, tenantId, id);
    if (receiver === null || receiver.status !== 'active' || receiver.mode !== 'online') {
      throw invalid();
    }
    return id;
  }

  /** What forbids the closing (E7): the open shifts and the blockers of the stock. */
  private async blockers(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<StoreClosingBlocker[]> {
    const openShifts = await this.shifts.openShiftsOfStore(trx, tenantId, storeId);
    return [
      ...(openShifts > 0 ? [{ code: 'open_shift' as const, count: openShifts }] : []),
      ...(await this.transfers.blockers(
        trx,
        tenantId,
        storeId,
        await this.today(trx, tenantId),
      )),
    ];
  }

  /** What stays behind the closing (E8); the unpaid amount only with `finance:view-cost`. */
  private async warnings(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    canSeeCost: boolean,
  ): Promise<StoreClosingWarning[]> {
    const drafts = await this.transfers.draftDocuments(trx, tenantId, storeId);
    const open = await this.dues.openOfStore(trx, tenantId, storeId);
    const warnings: StoreClosingWarning[] = [
      { code: 'draft_documents', count: drafts },
      { code: 'open_purchase_orders', count: open.openOrders },
      {
        code: 'unpaid_receipts',
        count: open.unpaidReceipts,
        ...(canSeeCost && { amountMinor: open.unpaidMinor }),
      },
    ];
    return warnings.filter((warning) => warning.count > 0);
  }

  /** The business date of the network. */
  private async today(trx: TenantTransaction, tenantId: string): Promise<string> {
    const result = await sql<{ today: string }>`
      select (now() at time zone coalesce(
        (select ts.timezone from pharmacy.tenant_settings ts where ts.tenant_id = ${tenantId}),
        'Asia/Dushanbe'))::date::text as today`.execute(trx);
    return result.rows[0].today;
  }

  private async read(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<OwnerStore> {
    const row = await this.repository.findStore(trx, tenantId, storeId);
    if (row === null) throw notFound();
    return toOwnerStore(row, await this.transfers.transfers(trx, tenantId, storeId));
  }
}
