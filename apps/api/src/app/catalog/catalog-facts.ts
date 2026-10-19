import { Injectable } from '@nestjs/common';
import type {
  ProductCreatedLocallyPayload,
  ProductDuplicateResolvedPayload,
  SyncAuditRow,
  SyncOperationType,
} from '@pharmacy/shared-dto';
import { isUuid, type TenantTransaction } from '../../core/database';
import {
  type AppliedOperation,
  type FactApplier,
  isMoney,
  lockConflict,
  openConflict,
  requireEmployees,
  resolveConflict,
  sameStore,
  storeTime,
  SyncApplyError,
  SyncAppliers,
} from '../../core/sync';
import { AuditService } from '../audit/audit.service';
import { CatalogRepository, type ProductValues } from './catalog.repository';

// The local products of an offline store applied in the cloud (ADR-0014 §4; spec 2026-10-16-offline-sync, E26,
// E35, E36): the card goes in with the store's id as `origin = local`. A barcode already taken in the network is
// not inserted (a scan keeps finding the existing card); a taken barcode or the same INN, form, dosage and
// manufacturer opens a duplicate conflict that the store decides — `merge` aliases its card to the card the
// conflict found, `keep` leaves both.
@Injectable()
export class CatalogFacts implements FactApplier {
  readonly types: readonly SyncOperationType[] = [
    'product.created-locally',
    'product.duplicate-resolved',
  ];

  constructor(
    appliers: SyncAppliers,
    private readonly repository: CatalogRepository,
    private readonly audit: AuditService,
  ) {
    appliers.register(this);
  }

  async apply(
    trx: TenantTransaction,
    operation: AppliedOperation,
  ): Promise<void> {
    if (operation.type === 'product.created-locally') {
      return this.created(
        trx,
        operation as AppliedOperation<ProductCreatedLocallyPayload>,
      );
    }
    if (operation.type === 'product.duplicate-resolved') {
      return this.resolved(
        trx,
        operation as AppliedOperation<ProductDuplicateResolvedPayload>,
      );
    }
    throw new SyncApplyError('unsupported_type');
  }

  private async created(
    trx: TenantTransaction,
    {
      tenantId,
      storeId,
      payload,
    }: AppliedOperation<ProductCreatedLocallyPayload>,
  ): Promise<void> {
    const { product, createdBy } = payload;
    sameStore(product.createdAtStoreId, storeId);
    const createdAt = storeTime(product.createdAt);
    if (
      product.maxRetailPricePerPackDirams !== null &&
      !isMoney(product.maxRetailPricePerPackDirams)
    ) {
      throw new SyncApplyError('invalid_price');
    }
    const codes = [...new Set(payload.barcodes)].sort();
    if (codes.some((code) => !/^[0-9]{8,14}$/.test(code))) {
      throw new SyncApplyError('invalid_barcode');
    }
    await requireEmployees(trx, tenantId, [createdBy]);
    if (
      !(await this.repository.categoryExists(trx, tenantId, product.categoryId))
    ) {
      throw new SyncApplyError('unknown_category');
    }
    if (await this.repository.productExists(trx, tenantId, product.id)) {
      throw new SyncApplyError('id_reused');
    }

    const values: ProductValues = {
      name: product.name,
      inn: product.inn,
      dosageForm: product.dosageForm,
      dosage: product.dosage,
      manufacturer: product.manufacturer,
      country: product.country,
      unit: product.unit,
      piecesPerPack: product.piecesPerPack,
      soldByPiece: product.soldByPiece,
      isPrescription: product.isPrescription,
      isControlled: product.isControlled,
      isPriceRegulated: product.isPriceRegulated,
      maxRetailPricePerPackDirams: product.maxRetailPricePerPackDirams,
      categoryId: product.categoryId,
      markupBp: product.markupBp,
      defaultMinStockPieces: product.defaultMinStockPieces,
    };
    await this.repository.insertLocalProduct(
      trx,
      tenantId,
      product.id,
      values,
      storeId,
      createdAt,
    );

    const owners = await this.repository.barcodeOwners(trx, tenantId, codes);
    const free = codes.filter((code) => !owners.has(code));
    const pending = codes.filter((code) => owners.has(code));
    await this.repository.replaceBarcodes(trx, tenantId, product.id, free);

    const taken = pending[0];
    const match =
      taken !== undefined
        ? {
            productId: owners.get(taken) as string,
            matchedBy: 'barcode',
            barcode: taken,
          }
        : await this.nameMatch(trx, tenantId, product.id, values);
    if (match !== null) {
      await openConflict(
        trx,
        {
          tenantId,
          storeId,
          kind: 'duplicate_product',
          entityId: product.id,
          localValue: {
            productId: product.id,
            name: product.name,
            createdBy,
            pendingBarcodes: pending,
          },
          cloudValue: match,
        },
        'keep',
      );
    }
    await this.appendAudit(trx, tenantId, storeId, payload.audit);
  }

  private async nameMatch(
    trx: TenantTransaction,
    tenantId: string,
    productId: string,
    values: ProductValues,
  ): Promise<Record<string, unknown> | null> {
    const twin = await this.repository.findNameTwin(
      trx,
      tenantId,
      productId,
      values,
    );
    return twin === null
      ? null
      : { productId: twin, matchedBy: 'name', barcode: null };
  }

  private async resolved(
    trx: TenantTransaction,
    {
      tenantId,
      storeId,
      payload,
    }: AppliedOperation<ProductDuplicateResolvedPayload>,
  ): Promise<void> {
    const resolvedAt = storeTime(payload.resolvedAt);
    if (!isUuid(payload.conflictId))
      throw new SyncApplyError('unknown_conflict');
    const conflict = await lockConflict(trx, tenantId, payload.conflictId);
    if (
      conflict === null ||
      conflict.kind !== 'duplicate_product' ||
      conflict.storeId !== storeId ||
      conflict.entityId !== payload.productId
    ) {
      throw new SyncApplyError('unknown_conflict');
    }
    if (conflict.status !== 'open') {
      throw new SyncApplyError('conflict_resolved');
    }
    await requireEmployees(trx, tenantId, [payload.resolvedBy]);

    if (payload.decision === 'merge') {
      const target = payload.mergedIntoProductId;
      const found = (conflict.cloudValue as { productId?: unknown }).productId;
      if (target === null || target !== found) {
        throw new SyncApplyError('merge_target_mismatch');
      }
      // locked in the order of the ids, as every writer of two cards
      const [first, second] = [payload.productId, target].sort();
      const states = new Map([
        [first, await this.repository.lockMergeState(trx, tenantId, first)],
        [second, await this.repository.lockMergeState(trx, tenantId, second)],
      ]);
      const into = states.get(target);
      if (!into || into.mergedIntoProductId !== null) {
        throw new SyncApplyError('merge_target_mismatch');
      }
      if (!states.get(payload.productId)) {
        throw new SyncApplyError('unknown_product');
      }
      await this.repository.mergeProduct(
        trx,
        tenantId,
        payload.productId,
        target,
        resolvedAt,
      );
    } else if (
      payload.decision !== 'keep' ||
      payload.mergedIntoProductId !== null
    ) {
      throw new SyncApplyError('invalid_decision');
    }

    await resolveConflict(trx, {
      tenantId,
      id: payload.conflictId,
      resolution: payload.decision,
      resolvedBy: payload.resolvedBy,
      resolvedAt,
    });
    await this.appendAudit(trx, tenantId, storeId, payload.audit);
  }

  private async appendAudit(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    rows: SyncAuditRow[],
  ): Promise<void> {
    for (const row of rows) {
      if (row.storeId !== null) sameStore(row.storeId, storeId);
      await this.audit.appendFact(trx, tenantId, row, storeId);
    }
  }
}
