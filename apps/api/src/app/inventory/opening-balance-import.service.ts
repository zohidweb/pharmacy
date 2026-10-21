import { Injectable } from '@nestjs/common';
import { hasPermissions, importLimits } from '@pharmacy/shared-domain';
import type {
  ImportIssueCode,
  OpeningBalanceImportCheck,
  OpeningBalanceImportRequest,
  OpeningBalanceImportResult,
  OpeningBalanceImportRow,
  OpeningBalanceInput,
} from '@pharmacy/shared-dto';
import { matchKey } from '@pharmacy/shared-util';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import {
  newId,
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database';
import { importHash, ImportIssues, ImportJobs } from '../../core/imports';
import { AuditService } from '../audit/audit.service';
import { type ImportProduct, ProductsReader } from '../catalog/products-reader';
import { StockDocumentsService } from './stock-documents.service';
import { StockRepository } from './stock.repository';
import { StoreAccess } from './store-access';

interface OpeningBalancePlan {
  lines: { row: OpeningBalanceImportRow; productId: string }[];
  issues: ImportIssues;
}

// Loading the opening balances of a store from a file (spec 2026-10-20-data-import, F9–F11, section 5): all or
// nothing; the rows become drafts of 500 lines, posted by hand as any draft. The store rules are those of a draft
// saved by hand: the scope, an active cloud store.
@Injectable()
export class OpeningBalanceImportService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly products: ProductsReader,
    private readonly documents: StockDocumentsService,
    private readonly stock: StockRepository,
    private readonly stores: StoreAccess,
    private readonly jobs: ImportJobs,
    private readonly audit: AuditService,
  ) {}

  async check(
    request: OpeningBalanceImportRequest,
  ): Promise<OpeningBalanceImportCheck> {
    const { tenantId } = this.requireCost();
    const storeId = request.storeId.toLowerCase();
    const hash = importHash(request.rows);
    return this.db.tenantTransaction(async (trx) => {
      await this.stores.writableStore(trx, tenantId, storeId);
      const plan = await this.evaluate(trx, tenantId, request.rows);
      const previous = await this.jobs.previous(
        trx,
        tenantId,
        'opening_balance',
        storeId,
        hash,
      );
      return {
        total: request.rows.length,
        documents: Math.ceil(request.rows.length / importLimits.documentLines),
        storeHasStock: await this.stock.hasMovements(trx, tenantId, storeId),
        previousImports: previous.map((job) => ({
          importId: job.id,
          createdAt: job.createdAt,
          documentNumbers: (
            (job.result as OpeningBalanceImportResult).documents ?? []
          ).map((doc) => doc.number),
        })),
        errors: plan.issues.list,
        errorsTotal: plan.issues.total,
      };
    });
  }

  async apply(
    request: OpeningBalanceImportRequest,
    key: string,
  ): Promise<OpeningBalanceImportResult> {
    const { tenantId, employeeId } = this.requireCost();
    const storeId = request.storeId.toLowerCase();
    const hash = importHash(request.rows);
    return this.db.tenantTransaction(async (trx) => {
      await this.jobs.lock(trx, tenantId);
      const replayed = await this.jobs.replay<OpeningBalanceImportResult>(
        trx,
        tenantId,
        key,
        hash,
      );
      if (replayed) return replayed;
      await this.stores.writableStore(trx, tenantId, storeId);
      const plan = await this.evaluate(trx, tenantId, request.rows);
      if (!plan.issues.empty) {
        throw new ProblemException(422, 'import_invalid');
      }

      const size = importLimits.documentLines;
      const count = Math.ceil(plan.lines.length / size);
      const documents: OpeningBalanceImportResult['documents'] = [];
      for (let part = 0; part < count; part += 1) {
        const chunk = plan.lines.slice(part * size, (part + 1) * size);
        const input: OpeningBalanceInput = {
          date: request.date,
          storeId,
          // the comment comes in the language of the interface; the part is added (clarification У4)
          comment:
            count > 1
              ? `${request.comment} (${part + 1}/${count})`.trim()
              : request.comment,
          lines: chunk.map(({ row, productId }) => ({
            productId,
            batchNumber: row.batchNumber,
            expiresOn: row.expiresOn,
            quantity: row.quantity,
            costMinor: row.costMinor,
            retailPriceMinor: row.retailPriceMinor,
            // a row without a series is the «starting batch» (F11, КП 3.4)
            starting: row.batchNumber === '',
          })),
        };
        const saved = await this.documents.saveOpeningBalanceDraft(
          trx,
          tenantId,
          input,
        );
        documents.push({ ...saved, lines: chunk.length });
      }

      const result: OpeningBalanceImportResult = {
        importId: newId(),
        documents,
      };
      await this.jobs.record(trx, {
        tenantId,
        id: result.importId,
        kind: 'opening_balance',
        storeId,
        fileName: request.fileName,
        hash,
        key,
        result,
        createdBy: employeeId,
      });
      await this.audit.append(trx, {
        action: 'document.imported',
        entityType: 'import',
        entityId: result.importId,
        storeId,
        details: {
          type: 'opening_balance',
          fileName: request.fileName,
          documents: documents.map((doc) => doc.number),
          lines: plan.lines.length,
        },
      });
      return result;
    });
  }

  /** A stock document without its purchase prices makes no sense (ADR-0018, п. 6; clarification У3). */
  private requireCost() {
    const principal = requirePrincipal();
    if (!hasPermissions(principal.permissions, 'finance:view-cost')) {
      throw new ProblemException(403, 'forbidden');
    }
    return principal;
  }

  private async evaluate(
    trx: TenantTransaction,
    tenantId: string,
    rows: readonly OpeningBalanceImportRow[],
  ): Promise<OpeningBalancePlan> {
    const issues = new ImportIssues();
    const add = (
      row: OpeningBalanceImportRow,
      field: string,
      code: ImportIssueCode,
    ) => issues.add({ line: row.line, field, code });

    const byBarcode = await this.products.importProductsByBarcodes(
      trx,
      tenantId,
      [...new Set(rows.flatMap((row) => row.barcodes))],
    );
    // the name index is read once, only when a row is matched by name
    let byName: Map<string, ImportProduct[]> | null = null;
    const named = async (key: string): Promise<ImportProduct[]> => {
      if (byName === null) {
        byName = new Map();
        for (const product of await this.products.importProductIndex(
          trx,
          tenantId,
        )) {
          for (const name of product.names) {
            const list = byName.get(matchKey(name)) ?? [];
            list.push(product);
            byName.set(matchKey(name), list);
          }
        }
      }
      return byName.get(key) ?? [];
    };

    const lines: OpeningBalancePlan['lines'] = [];
    for (const row of rows) {
      let product: ImportProduct | null = null;
      if (row.barcodes.length > 0) {
        const found = row.barcodes
          .map((code) => byBarcode.get(code))
          .filter((item): item is ImportProduct => item !== undefined);
        if (new Set(found.map((item) => item.id)).size > 1) {
          add(row, 'barcodes', 'barcode_conflict');
          continue;
        }
        product = found[0] ?? null;
      }
      // no barcode, or barcodes the catalog does not know: by name, form and dosage (F9)
      if (product === null) {
        if (matchKey(row.name) === '') {
          add(
            row,
            row.barcodes.length > 0 ? 'barcodes' : 'name',
            row.barcodes.length > 0 ? 'product_not_found' : 'required',
          );
          continue;
        }
        const form = matchKey(row.form);
        const dosage = matchKey(row.dosage);
        const candidates = [
          ...new Map(
            (await named(matchKey(row.name)))
              .filter((item) => form === '' || matchKey(item.form) === form)
              .filter(
                (item) => dosage === '' || matchKey(item.dosage) === dosage,
              )
              .map((item) => [item.id, item]),
          ).values(),
        ];
        if (candidates.length !== 1) {
          add(
            row,
            'name',
            candidates.length === 0 ? 'product_not_found' : 'product_ambiguous',
          );
          continue;
        }
        product = candidates[0];
      }
      if (product.status !== 'active') {
        add(
          row,
          row.barcodes.length > 0 ? 'barcodes' : 'name',
          'product_archived',
        );
        continue;
      }
      lines.push({ row, productId: product.id });
    }
    return { lines, issues };
  }
}
