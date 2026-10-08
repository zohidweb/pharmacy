import { Injectable } from '@nestjs/common';
import type {
  CatalogStatus,
  Category,
  CategoryInput,
  CategoryMarkup,
  UpdateMarkupsRequest,
} from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import {
  newId,
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database';
import { AuditService } from '../audit/audit.service';
import {
  CatalogRepository,
  type CategoryRow,
  localizedName,
  type NameLanguage,
  nameMap,
  nameOf,
} from './catalog.repository';

const notFound = () => new ProblemException(404, 'not_found');
const fieldOf = (language: NameLanguage) =>
  language === 'tj' ? 'nameTj' : 'nameRu';

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    nameRu: nameOf(row.name, 'ru'),
    nameTj: nameOf(row.name, 'tj'),
    markupPercent: row.markupBp === null ? null : row.markupBp / 100,
    status: row.status as CatalogStatus,
    products: row.products,
  };
}

// Categories of the network and their markups (spec 2026-10-07-catalog-pricing, section 5): a flat
// list, names unique in the network whatever the case, archived only without active products.
@Injectable()
export class CategoriesService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: CatalogRepository,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<Category[]> {
    const { tenantId } = requirePrincipal();
    const rows = await this.db.tenantTransaction((trx) =>
      this.repository.listCategories(trx, tenantId, false),
    );
    return rows.map(toCategory);
  }

  async create(input: CategoryInput): Promise<Category> {
    const { tenantId } = requirePrincipal();
    const id = newId();
    return this.db.tenantTransaction(async (trx) => {
      const name = await this.checkedName(trx, tenantId, input, null);
      await this.repository.insertCategory(trx, tenantId, id, name);
      await this.audit.append(trx, {
        action: 'category.created',
        entityType: 'category',
        entityId: id,
        details: { name },
      });
      return toCategory(await this.read(trx, tenantId, id));
    });
  }

  async update(id: string, input: CategoryInput): Promise<Category> {
    const { tenantId } = requirePrincipal();
    const categoryId = id.toLowerCase();
    return this.db.tenantTransaction(async (trx) => {
      if (
        (await this.repository.findCategory(trx, tenantId, categoryId)) === null
      ) {
        throw notFound();
      }
      const name = await this.checkedName(trx, tenantId, input, categoryId);
      await this.repository.renameCategory(trx, tenantId, categoryId, name);
      await this.audit.append(trx, {
        action: 'category.updated',
        entityType: 'category',
        entityId: categoryId,
        details: { name },
      });
      return toCategory(await this.read(trx, tenantId, categoryId));
    });
  }

  async setStatus(id: string, status: CatalogStatus): Promise<Category> {
    const { tenantId } = requirePrincipal();
    const categoryId = id.toLowerCase();
    return this.db.tenantTransaction(async (trx) => {
      // The lock orders this archive against a product written into the category meanwhile.
      if (
        (await this.repository.lockCategory(trx, tenantId, categoryId)) === null
      ) {
        throw notFound();
      }
      const current = await this.read(trx, tenantId, categoryId);
      if (current.status !== status) {
        if (status === 'archived' && current.products > 0) {
          throw new ProblemException(409, 'category_in_use');
        }
        await this.repository.setCategoryStatus(
          trx,
          tenantId,
          categoryId,
          status,
        );
        await this.audit.append(trx, {
          action: 'category.status_changed',
          entityType: 'category',
          entityId: categoryId,
          details: { status },
        });
      }
      return toCategory(await this.read(trx, tenantId, categoryId));
    });
  }

  async markups(): Promise<CategoryMarkup[]> {
    const { tenantId, locale } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const language = await this.repository.networkLanguage(trx, tenantId);
      const rows = await this.repository.listCategories(trx, tenantId, true);
      return rows.map((row) => ({
        categoryId: row.id,
        categoryName: localizedName(row.name, locale, language),
        markupPercent: row.markupBp === null ? null : row.markupBp / 100,
        products: row.products,
      }));
    });
  }

  async updateMarkups(
    request: UpdateMarkupsRequest,
  ): Promise<CategoryMarkup[]> {
    const { tenantId } = requirePrincipal();
    await this.db.tenantTransaction(async (trx) => {
      const active = new Set(
        (await this.repository.listCategories(trx, tenantId, true)).map(
          (row) => row.id,
        ),
      );
      const unknown = request.markups.findIndex(
        (markup) => !active.has(markup.categoryId.toLowerCase()),
      );
      if (unknown >= 0) {
        throw new FieldProblemException(400, 'validation_failed', [
          { field: `markups.${unknown}.categoryId`, code: 'unknown_category' },
        ]);
      }
      const markups = request.markups.map((markup) => ({
        categoryId: markup.categoryId.toLowerCase(),
        markupBp: markup.markupPercent * 100,
      }));
      await this.repository.setMarkups(trx, tenantId, markups);
      await this.audit.append(trx, {
        action: 'markups.updated',
        entityType: 'category',
        details: {
          markups: markups.map((m) => ({
            categoryId: m.categoryId,
            percent: m.markupBp / 100,
          })),
        },
      });
    });
    return this.markups();
  }

  private async read(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<CategoryRow> {
    const row = await this.repository.findCategory(trx, tenantId, id);
    if (row === null)
      throw new Error('The category just written is not readable');
    return row;
  }

  /** The name map of the input: the default language required, unique in the network. */
  private async checkedName(
    trx: TenantTransaction,
    tenantId: string,
    input: CategoryInput,
    exceptId: string | null,
  ) {
    const language = await this.repository.networkLanguage(trx, tenantId);
    const name = nameMap(input.nameRu, input.nameTj);
    if (!name[language]) {
      throw new FieldProblemException(400, 'validation_failed', [
        { field: fieldOf(language), code: 'required' },
      ]);
    }
    const wanted = Object.values(name).map((value) =>
      value.toLocaleLowerCase('ru'),
    );
    const rows = await this.repository.listCategories(trx, tenantId, false);
    const taken = rows.some(
      (row) =>
        row.id !== exceptId &&
        Object.values((row.name ?? {}) as Record<string, unknown>).some(
          (value) =>
            typeof value === 'string' &&
            wanted.includes(value.toLocaleLowerCase('ru')),
        ),
    );
    if (taken) {
      throw new FieldProblemException(409, 'category_name_taken', [
        { field: fieldOf(language), code: 'category_name_taken' },
      ]);
    }
    return name;
  }
}
