import { Injectable } from '@nestjs/common';
import type {
  CreateStoreRequest,
  OwnerStore,
  StoreKind,
  StoresOverview,
  UpdateOwnerStoreRequest,
} from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import {
  newId,
  TenantDatabase,
  type TenantTransaction,
  uniqueConstraint,
} from '../../core/database';
import { AuditService } from '../audit/audit.service';
import {
  type ClosingTransfer,
  StoreClosingTransfers,
} from '../inventory/store-closing-transfers';
import { asConflict, LegalEntitiesService, notFound } from './legal-entities.service';
import { StoresRepository, type StoreRow } from './stores.repository';

/**
 * The store as the owner sees it; `transfers` — the transfers of its closing (spec
 * 2026-10-15-store-closing): the cancelled ones are not shown, an accepted one is `accepted`.
 */
export function toOwnerStore(
  row: StoreRow,
  transfers: readonly ClosingTransfer[] = [],
): OwnerStore {
  const shown = transfers.filter((t) => t.status !== 'cancelled');
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    address: row.address,
    kind: row.kind as StoreKind,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntityName,
    printReceiptDefault: row.printReceiptDefault,
    mode: row.mode === 'online' ? 'cloud' : 'offline',
    status:
      row.status === 'closed' || row.status === 'closing'
        ? row.status
        : row.mode === 'offline_pending'
          ? 'pending'
          : 'active',
    paidUntil: null,
    licenseValidUntil: null,
    receiptsThisMonth: 0,
    closedOn: row.status === 'closed' ? row.closedOn : null,
    stockMovedTo: row.closingReceiverName,
    closingTransfers: shown.map((t) => ({
      number: t.number,
      status: t.status === 'received' ? 'accepted' : 'in_transit',
    })),
    closingCancellable:
      row.status === 'closing' && shown.every((t) => t.status === 'in_transit'),
  };
}

// Stores of the owner (spec 2026-10-06-owner-stores, section 3): cloud stores only; the code and
// the kind are fixed after creation; a store outside the employee's scope does not exist for him.
@Injectable()
export class StoresService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: StoresRepository,
    private readonly legalEntities: LegalEntitiesService,
    private readonly audit: AuditService,
    private readonly closing: StoreClosingTransfers,
  ) {}

  async overview(): Promise<StoresOverview> {
    const { tenantId, storeScope } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const rows = await this.repository.listStores(trx, tenantId, storeScope);
      const stores: OwnerStore[] = [];
      for (const row of rows) {
        // the transfers of a closing are read for the closing and closed stores only
        const transfers =
          row.status === 'active'
            ? []
            : await this.closing.transfers(trx, tenantId, row.id);
        stores.push(toOwnerStore(row, transfers));
      }
      return { stores };
    });
  }

  /**
   * A new cloud store with an existing or a new legal entity, in one transaction. A repeated
   * Idempotency-Key returns the store created with it and writes nothing.
   */
  async create(
    request: CreateStoreRequest,
    idempotencyKey: string | null,
  ): Promise<OwnerStore> {
    const { tenantId } = requirePrincipal();
    if (Boolean(request.legalEntityId) === Boolean(request.newLegalEntity)) {
      throw new FieldProblemException(400, 'validation_failed', [
        { field: 'legalEntityId', code: 'exactly_one' },
      ]);
    }
    try {
      return await this.db.tenantTransaction(async (trx) => {
        if (idempotencyKey !== null) {
          const existing = await this.repository.findStoreByKey(trx, tenantId, idempotencyKey);
          if (existing !== null) return toOwnerStore(existing);
        }
        const legalEntityId = request.newLegalEntity
          ? await this.legalEntities.createIn(trx, tenantId, request.newLegalEntity)
          : await this.activeLegalEntity(trx, tenantId, request.legalEntityId ?? '');
        const id = newId();
        await this.repository.insertStore(trx, {
          tenantId,
          id,
          legalEntityId,
          name: request.name,
          code: request.code,
          address: request.address,
          kind: request.kind,
          printReceiptDefault: request.printReceiptDefault,
          idempotencyKey,
        });
        await this.audit.append(trx, {
          action: 'store.created',
          entityType: 'store',
          entityId: id,
          storeId: id,
          details: { code: request.code, kind: request.kind, legalEntityId },
        });
        return this.read(trx, tenantId, id);
      });
    } catch (error) {
      // Two requests with one key raced past the lookup: the loser fails on whichever unique index
      // PostgreSQL checks first (the INN of a new legal entity, the store code or the key itself),
      // so any unique violation re-reads the store by the key and returns the winner's store.
      if (idempotencyKey !== null && uniqueConstraint(error) !== null) {
        const winner = await this.db.tenantTransaction((trx) =>
          this.repository.findStoreByKey(trx, tenantId, idempotencyKey),
        );
        if (winner !== null) return toOwnerStore(winner);
      }
      throw asConflict(error, 'newLegalEntity.taxId');
    }
  }

  async update(id: string, request: UpdateOwnerStoreRequest): Promise<OwnerStore> {
    const { tenantId, storeScope } = requirePrincipal();
    const storeId = id.toLowerCase();
    if (storeScope !== 'all' && !storeScope.includes(storeId)) throw notFound();
    return this.db.tenantTransaction(async (trx) => {
      const store = await this.repository.findStore(trx, tenantId, storeId);
      if (store === null) throw notFound();
      if (store.status === 'closed') throw new ProblemException(409, 'store_closed');
      // its stock is on the way out (spec 2026-10-15-store-closing, E9)
      if (store.status === 'closing') throw new ProblemException(409, 'store_closing');
      const legalEntityId = await this.activeLegalEntity(trx, tenantId, request.legalEntityId);
      await this.repository.updateStore(trx, tenantId, storeId, {
        name: request.name,
        address: request.address,
        legalEntityId,
        printReceiptDefault: request.printReceiptDefault,
      });
      const changed = [
        store.name !== request.name && 'name',
        store.address !== request.address && 'address',
        store.legalEntityId !== legalEntityId && 'legalEntityId',
        store.printReceiptDefault !== request.printReceiptDefault && 'printReceiptDefault',
      ].filter((field): field is string => field !== false);
      if (changed.length > 0) {
        await this.audit.append(trx, {
          action: 'store.updated',
          entityType: 'store',
          entityId: storeId,
          storeId,
          details: { fields: changed },
        });
      }
      return this.read(trx, tenantId, storeId);
    });
  }

  // The id of an active legal entity of the network; 404 otherwise.
  private async activeLegalEntity(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<string> {
    const entity = await this.repository.findLegalEntity(trx, tenantId, id.toLowerCase());
    if (entity === null) throw notFound();
    return entity.id;
  }

  private async read(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<OwnerStore> {
    const row = await this.repository.findStore(trx, tenantId, id);
    if (row === null) throw new Error('The store just written is not readable');
    return toOwnerStore(row);
  }
}
