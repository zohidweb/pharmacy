import { Injectable } from '@nestjs/common';
import { hasPermissions } from '@pharmacy/shared-domain';
import type {
  CatalogImportCheck,
  CatalogImportRequest,
  CatalogImportResult,
  CatalogImportRow,
  ImportIssueCode,
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
import { importHashes, ImportIssues, ImportJobs } from '../../core/imports';
import { AuditService } from '../audit/audit.service';
import {
  CatalogRepository,
  type NameLanguage,
  nameOf,
} from './catalog.repository';
import { cardIssues, productValuesOf } from './product-rules';

/** What a check found: the rows to create, the rows already in the catalog, the categories to create. */
interface CatalogPlan {
  language: NameLanguage;
  creates: { row: CatalogImportRow; categoryKey: string }[];
  existing: number;
  /** Key → id of the active categories of the network. */
  categoryIds: Map<string, string>;
  /** Key → name (as the first row to create spells it) of the categories to create. */
  newCategories: Map<string, string>;
  issues: ImportIssues;
}

const productKey = (name: string, form: string, dosage: string): string =>
  [matchKey(name), matchKey(form), matchKey(dosage)].join('|');

/** The name of a product in the language of the network, else in the other one. */
const displayName = (name: unknown, language: NameLanguage): string =>
  nameOf(name, language) || nameOf(name, language === 'ru' ? 'tj' : 'ru');

const importInvalid = () => new ProblemException(422, 'import_invalid');

/** The name of a row in the language of the network, else the other one. */
const rowName = (row: CatalogImportRow, language: NameLanguage): string =>
  (language === 'tj' ? row.nameTj : row.nameRu) || row.nameRu || row.nameTj;

// Loading the catalog from a file (spec 2026-10-20-data-import, F6–F9, section 5): all or nothing; a row whose
// barcodes (or name, form and dosage) are already in the catalog is skipped, the existing card is not changed.
@Injectable()
export class CatalogImportService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: CatalogRepository,
    private readonly jobs: ImportJobs,
    private readonly audit: AuditService,
  ) {}

  async check(request: CatalogImportRequest): Promise<CatalogImportCheck> {
    const { tenantId, permissions } = requirePrincipal();
    const plan = await this.db.tenantTransaction((trx) =>
      this.evaluate(
        trx,
        tenantId,
        request.rows,
        hasPermissions(permissions, 'catalog:update'),
      ),
    );
    return {
      total: request.rows.length,
      create: plan.creates.length,
      existing: plan.existing,
      newCategories: [...plan.newCategories.values()],
      errors: plan.issues.list,
      errorsTotal: plan.issues.total,
    };
  }

  async apply(
    request: CatalogImportRequest,
    key: string,
  ): Promise<CatalogImportResult> {
    const { tenantId, employeeId, permissions } = requirePrincipal();
    const hashes = importHashes('catalog', request);
    const release = this.jobs.begin();
    const startedAt = Date.now();
    try {
      const done = await this.db.tenantTransaction(async (trx) => {
        await this.jobs.lock(trx, tenantId);
        const replayed = await this.jobs.replay<CatalogImportResult>(
          trx,
          tenantId,
          key,
          hashes,
        );
        if (replayed) return replayed;
        const canCreateCategories = hasPermissions(
          permissions,
          'catalog:update',
        );
        let plan = await this.evaluate(
          trx,
          tenantId,
          request.rows,
          canCreateCategories,
        );
        if (plan.newCategories.size > 0) {
          // new names wait for the card of a category (CategoriesService) — only when the load creates categories, so a
          // load of known categories does not hold the names of the network (final review I1); the plan is made again
          // under the lock: a category of the same name may have appeared meanwhile
          await this.repository.lockCategoryNames(trx, tenantId);
          plan = await this.evaluate(
            trx,
            tenantId,
            request.rows,
            canCreateCategories,
          );
        }
        if (!plan.issues.empty) throw importInvalid();
        // the categories the rows take stay active to the end, as the card locks its category; one archived meanwhile —
        // the catalog changed after the check (final review M1)
        const used = [
          ...new Set(
            plan.creates
              .map(({ categoryKey }) => plan.categoryIds.get(categoryKey))
              .filter((id): id is string => id !== undefined),
          ),
        ];
        if (
          !(await this.repository.lockActiveCategories(trx, tenantId, used))
        ) {
          throw importInvalid();
        }

        const categoryIds = new Map(plan.categoryIds);
        for (const [categoryKey, name] of plan.newCategories) {
          const id = newId();
          await this.repository.insertCategory(trx, tenantId, id, {
            [plan.language]: name,
          });
          categoryIds.set(categoryKey, id);
        }
        const products = plan.creates.map(({ row, categoryKey }) => {
          const categoryId = categoryIds.get(categoryKey);
          if (categoryId === undefined) {
            throw new Error('A row to create has no category');
          }
          return {
            id: newId(),
            values: productValuesOf(row, categoryId),
            barcodes: row.barcodes,
          };
        });
        await this.repository.insertProducts(trx, tenantId, products);
        await this.repository.insertBarcodes(
          trx,
          tenantId,
          products.flatMap((product) =>
            product.barcodes.map((barcode) => ({
              productId: product.id,
              barcode,
            })),
          ),
        );

        const result: CatalogImportResult = {
          importId: newId(),
          created: products.length,
          existing: plan.existing,
          categoriesCreated: plan.newCategories.size,
        };
        await this.jobs.record(trx, {
          tenantId,
          id: result.importId,
          kind: 'catalog',
          storeId: null,
          fileName: request.fileName,
          hashes,
          key,
          result,
          createdBy: employeeId,
        });
        await this.audit.append(trx, {
          action: 'product.imported',
          entityType: 'import',
          entityId: result.importId,
          details: {
            fileName: request.fileName,
            created: result.created,
            existing: result.existing,
            categoriesCreated: result.categoriesCreated,
          },
        });
        return result;
      });
      this.jobs.logged(
        'catalog',
        request.rows.length,
        `created ${done.created}, existing ${done.existing}`,
        startedAt,
      );
      return done;
    } catch (error) {
      // a card saved meanwhile took a barcode of the file: the catalog changed after the check (F7)
      if (uniqueConstraint(error) === 'product_barcodes_pkey') {
        throw importInvalid();
      }
      throw error;
    } finally {
      release();
    }
  }

  private async evaluate(
    trx: TenantTransaction,
    tenantId: string,
    rows: readonly CatalogImportRow[],
    canCreateCategories: boolean,
  ): Promise<CatalogPlan> {
    const language = await this.repository.networkLanguage(trx, tenantId);
    const issues = new ImportIssues();
    const add = (
      row: CatalogImportRow,
      field: string | null,
      code: ImportIssueCode,
      detail?: string,
    ) =>
      issues.add({
        line: row.line,
        field,
        code,
        ...(detail === undefined ? {} : { detail }),
      });

    // category names are unique in the network across both languages and statuses (CategoriesService)
    const categoryIds = new Map<string, string>();
    const archivedCategories = new Set<string>();
    for (const category of await this.repository.listCategories(
      trx,
      tenantId,
      false,
    )) {
      for (const name of [
        nameOf(category.name, 'ru'),
        nameOf(category.name, 'tj'),
      ]) {
        if (!name) continue;
        if (category.status === 'active')
          categoryIds.set(matchKey(name), category.id);
        else archivedCategories.add(matchKey(name));
      }
    }
    const forms = new Set(
      (await this.repository.dosageForms(trx, tenantId))
        .map((form) => nameOf(form, language))
        .filter((form) => form !== ''),
    );
    const owners = await this.repository.barcodeOwnersOf(trx, tenantId, [
      ...new Set(rows.flatMap((row) => row.barcodes)),
    ]);
    const knownKeys = new Set<string>();
    if (rows.some((row) => row.barcodes.length === 0)) {
      for (const product of await this.repository.productNameIndex(
        trx,
        tenantId,
      )) {
        for (const name of [
          nameOf(product.name, 'ru'),
          nameOf(product.name, 'tj'),
        ]) {
          if (name) {
            knownKeys.add(
              productKey(name, product.dosageForm ?? '', product.dosage ?? ''),
            );
          }
        }
      }
    }

    const creates: CatalogPlan['creates'] = [];
    const newCategories = new Map<string, string>();
    const codesInFile = new Set<string>();
    const keysInFile = new Set<string>();
    // a card of the file with barcodes takes its name: a row without a barcode of the same name, form and dosage is the
    // same card written twice (final review M3)
    const keysWithBarcode = new Set(
      rows
        .filter((row) => row.barcodes.length > 0)
        .map((row) => productKey(rowName(row, language), row.form, row.dosage)),
    );
    let existing = 0;
    for (const row of rows) {
      const before = issues.total;
      let inCatalog = false;
      if (row.barcodes.length > 0) {
        if (row.barcodes.some((code) => codesInFile.has(code))) {
          add(row, 'barcodes', 'duplicate_in_file');
        }
        for (const code of row.barcodes) codesInFile.add(code);
        const holders = row.barcodes.map((code) => owners.get(code) ?? null);
        const products = new Set(holders.map((holder) => holder?.productId));
        if (products.size === 1 && holders[0] !== null) {
          inCatalog = true;
        } else {
          const holder = holders.find((item) => item !== null);
          if (holder) {
            add(
              row,
              'barcodes',
              'barcode_conflict',
              displayName(holder.name, language),
            );
          }
        }
      } else {
        const rowKey = productKey(rowName(row, language), row.form, row.dosage);
        if (keysInFile.has(rowKey) || keysWithBarcode.has(rowKey)) {
          add(
            row,
            language === 'tj' ? 'nameTj' : 'nameRu',
            'duplicate_in_file',
          );
        }
        keysInFile.add(rowKey);
        inCatalog = knownKeys.has(rowKey);
      }
      if (inCatalog) {
        // a row already in the catalog is skipped: its card is not checked
        if (issues.total === before) existing += 1;
        continue;
      }

      for (const issue of cardIssues(row, row.barcodes, { language, forms })) {
        add(
          row,
          issue.field,
          (issue.code === 'duplicate'
            ? 'duplicate_in_file'
            : issue.code) as ImportIssueCode,
        );
      }
      const categoryKey = matchKey(row.category);
      if (categoryKey === '') {
        add(row, 'category', 'required');
      } else if (!categoryIds.has(categoryKey)) {
        if (archivedCategories.has(categoryKey)) {
          add(row, 'category', 'archived_category');
        } else if (!canCreateCategories) {
          add(row, 'category', 'unknown_category');
        } else if (!newCategories.has(categoryKey)) {
          newCategories.set(categoryKey, row.category.trim());
        }
      }
      if (issues.total === before) creates.push({ row, categoryKey });
    }
    // a category is created only for rows that are created
    const used = new Set(creates.map((item) => item.categoryKey));
    for (const categoryKey of [...newCategories.keys()]) {
      if (!used.has(categoryKey)) newCategories.delete(categoryKey);
    }
    return {
      language,
      creates,
      existing,
      categoryIds,
      newCategories,
      issues,
    };
  }
}
