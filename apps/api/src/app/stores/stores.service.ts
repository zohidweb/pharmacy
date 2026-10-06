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
import { asConflict, LegalEntitiesService, notFound } from './legal-entities.service';
import { StoresRepository, type StoreRow } from './stores.repository';

const IDEMPOTENCY_CONSTRAINT = 'stores_idempotency_key_uq';

export function toOwnerStore(row: StoreRow): OwnerStore {
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
      row.status === 'closed'
        ? 'closed'
        : row.mode === 'offline_pending'
          ? 'pending'
          : 'active',
    paidUntil: null,
    licenseValidUntil: null,
    receiptsThisMonth: 0,
    closedOn: row.closedAt ? row.closedAt.toISOString().slice(0, 10) : null,
    stockMovedTo: null,
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
  ) {}

  async overview(): Promise<StoresOverview> {
    const { tenantId, storeScope } = requirePrincipal();
    const rows = await this.db.tenantTransaction((trx) =>
      this.repository.listStores(trx, tenantId, storeScope),
    );
    return { stores: rows.map(toOwnerStore) };
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
      // Two requests with one key raced: the loser returns the winner's store.
      if (idempotencyKey !== null && uniqueConstraint(error) === IDEMPOTENCY_CONSTRAINT) {
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
