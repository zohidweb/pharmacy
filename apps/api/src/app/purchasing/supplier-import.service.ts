import { Injectable } from '@nestjs/common';
import type {
  SupplierImportCheck,
  SupplierImportRequest,
  SupplierImportResult,
  SupplierImportRow,
} from '@pharmacy/shared-dto';
import { matchKey } from '@pharmacy/shared-util';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import {
  newId,
  TenantDatabase,
  type TenantTransaction,
  uniqueConstraint,
} from '../../core/database';
import { importHash, ImportIssues, ImportJobs } from '../../core/imports';
import { AuditService } from '../audit/audit.service';
import { PurchasingRepository } from './purchasing.repository';
import { valuesOf } from './suppliers.service';

interface SupplierPlan {
  creates: SupplierImportRow[];
  existing: number;
  issues: ImportIssues;
}

const importInvalid = () => new ProblemException(422, 'import_invalid');

// Loading the suppliers of the network from a file (spec 2026-10-20-data-import, F8, section 5): all or nothing; a
// supplier whose name the network has (any case, any status) is skipped, its card is not changed.
@Injectable()
export class SupplierImportService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: PurchasingRepository,
    private readonly jobs: ImportJobs,
    private readonly audit: AuditService,
  ) {}

  async check(request: SupplierImportRequest): Promise<SupplierImportCheck> {
    const { tenantId } = requirePrincipal();
    const plan = await this.db.tenantTransaction((trx) =>
      this.evaluate(trx, tenantId, request.rows),
    );
    return {
      total: request.rows.length,
      create: plan.creates.length,
      existing: plan.existing,
      errors: plan.issues.list,
      errorsTotal: plan.issues.total,
    };
  }

  async apply(
    request: SupplierImportRequest,
    key: string,
  ): Promise<SupplierImportResult> {
    const { tenantId, employeeId } = requirePrincipal();
    const hash = importHash(request.rows);
    try {
      return await this.db.tenantTransaction(async (trx) => {
        await this.jobs.lock(trx, tenantId);
        const replayed = await this.jobs.replay<SupplierImportResult>(
          trx,
          tenantId,
          key,
          hash,
        );
        if (replayed) return replayed;
        const plan = await this.evaluate(trx, tenantId, request.rows);
        if (!plan.issues.empty) throw importInvalid();

        await this.repository.insertSuppliers(
          trx,
          tenantId,
          plan.creates.map((row) => ({ id: newId(), values: valuesOf(row) })),
        );
        const result: SupplierImportResult = {
          importId: newId(),
          created: plan.creates.length,
          existing: plan.existing,
        };
        await this.jobs.record(trx, {
          tenantId,
          id: result.importId,
          kind: 'suppliers',
          storeId: null,
          fileName: request.fileName,
          hash,
          key,
          result,
          createdBy: employeeId,
        });
        await this.audit.append(trx, {
          action: 'supplier.imported',
          entityType: 'import',
          entityId: result.importId,
          details: {
            fileName: request.fileName,
            created: result.created,
            existing: result.existing,
          },
        });
        return result;
      });
    } catch (error) {
      // a supplier saved meanwhile took a name of the file: the network changed after the check (F7)
      if (uniqueConstraint(error) === 'suppliers_name_uq')
        throw importInvalid();
      throw error;
    }
  }

  private async evaluate(
    trx: TenantTransaction,
    tenantId: string,
    rows: readonly SupplierImportRow[],
  ): Promise<SupplierPlan> {
    const issues = new ImportIssues();
    const known = new Set(
      (await this.repository.supplierNames(trx, tenantId)).map(matchKey),
    );
    const inFile = new Set<string>();
    const creates: SupplierImportRow[] = [];
    let existing = 0;
    for (const row of rows) {
      const key = matchKey(row.name);
      if (inFile.has(key)) {
        issues.add({
          line: row.line,
          field: 'name',
          code: 'duplicate_in_file',
        });
        continue;
      }
      inFile.add(key);
      if (known.has(key)) existing += 1;
      else creates.push(row);
    }
    return { creates, existing, issues };
  }
}
