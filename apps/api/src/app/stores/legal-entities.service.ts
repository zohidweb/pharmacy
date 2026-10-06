import { Injectable } from '@nestjs/common';
import type {
  LegalEntitiesResponse,
  LegalEntity,
  LegalEntityInput,
  UpdateLegalEntityRequest,
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
import { StoresRepository } from './stores.repository';

export const notFound = () => new ProblemException(404, 'not_found');

/**
 * A unique violation of the stores module as its 409 problem (spec 2026-10-06-owner-stores,
 * section 7); any other error unchanged. `taxIdField` names the INN field of the request.
 */
export function asConflict(error: unknown, taxIdField: string): unknown {
  switch (uniqueConstraint(error)) {
    case 'stores_tenant_id_code_key':
      return new FieldProblemException(409, 'store_code_taken', [
        { field: 'code', code: 'store_code_taken' },
      ]);
    case 'legal_entities_tax_id_active_uq':
      return new FieldProblemException(409, 'tax_id_taken', [
        { field: taxIdField, code: 'tax_id_taken' },
      ]);
    default:
      return error;
  }
}

// Legal entities of the network (spec 2026-10-06-owner-stores, section 3): the owner creates them
// in the store form; there is no archive yet.
@Injectable()
export class LegalEntitiesService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: StoresRepository,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<LegalEntitiesResponse> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => ({
      items: await this.repository.listLegalEntities(trx, tenantId),
      defaults: await this.repository.networkDefaults(trx, tenantId),
    }));
  }

  async create(input: LegalEntityInput): Promise<LegalEntity> {
    const { tenantId } = requirePrincipal();
    try {
      return await this.db.tenantTransaction(async (trx) => {
        const id = await this.createIn(trx, tenantId, input);
        return this.read(trx, tenantId, id);
      });
    } catch (error) {
      throw asConflict(error, 'taxId');
    }
  }

  /** Creates a legal entity inside the caller's transaction (also used by store creation). */
  async createIn(
    trx: TenantTransaction,
    tenantId: string,
    input: LegalEntityInput,
  ): Promise<string> {
    const id = newId();
    await this.repository.insertLegalEntity(trx, tenantId, id, input);
    await this.audit.append(trx, {
      action: 'legal-entity.created',
      entityType: 'legal-entity',
      entityId: id,
      details: { name: input.name, taxId: input.taxId },
    });
    return id;
  }

  async update(id: string, change: UpdateLegalEntityRequest): Promise<LegalEntity> {
    const { tenantId } = requirePrincipal();
    const entityId = id.toLowerCase();
    // Only the fields that were sent change.
    const fields = Object.fromEntries(
      Object.entries(change).filter(([, value]) => value !== undefined),
    ) as UpdateLegalEntityRequest;
    try {
      return await this.db.tenantTransaction(async (trx) => {
        if ((await this.repository.findLegalEntity(trx, tenantId, entityId)) === null) {
          throw notFound();
        }
        if (Object.keys(fields).length > 0) {
          await this.repository.updateLegalEntity(trx, tenantId, entityId, fields);
          await this.audit.append(trx, {
            action: 'legal-entity.updated',
            entityType: 'legal-entity',
            entityId,
            details: { fields: Object.keys(fields) },
          });
        }
        return this.read(trx, tenantId, entityId);
      });
    } catch (error) {
      throw asConflict(error, 'taxId');
    }
  }

  private async read(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<LegalEntity> {
    const entity = await this.repository.findLegalEntity(trx, tenantId, id);
    if (entity === null) throw new Error('The legal entity just written is not readable');
    return entity;
  }
}
