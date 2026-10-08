import { Injectable } from '@nestjs/common';
import {
  countries,
  isCountryCode,
  productUnits,
  type ProductUnit,
} from '@pharmacy/shared-domain';
import type {
  CatalogFlag,
  CatalogListResponse,
  CatalogProduct,
  CatalogProductInput,
  CatalogReferences,
  CatalogStatus,
  PrescriptionKind,
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
  CatalogRepository,
  localizedName,
  type NameLanguage,
  nameMap,
  nameOf,
  type ProductRow,
  type ProductValues,
} from './catalog.repository';

const notFound = () => new ProblemException(404, 'not_found');
const archived = () => new ProblemException(409, 'product_archived');
const invalid = (field: string, code: string) =>
  new FieldProblemException(400, 'validation_failed', [{ field, code }]);
const barcodeTaken = () =>
  new FieldProblemException(409, 'barcode_taken', [
    { field: 'barcodes', code: 'barcode_taken' },
  ]);

// Columns of the stock threshold are integers: packs × pieces must fit.
const MAX_MIN_STOCK_PIECES = 2_000_000_000;

function prescriptionOf(
  row: Pick<ProductRow, 'isPrescription' | 'isControlled'>,
): PrescriptionKind {
  if (row.isControlled) return 'controlled';
  return row.isPrescription ? 'rx' : 'none';
}

const percentOf = (bp: number | null): number | null =>
  bp === null ? null : bp / 100;

function toProduct(
  row: ProductRow,
  locale: 'ru' | 'tg',
  language: NameLanguage,
): CatalogProduct {
  return {
    id: row.id,
    nameRu: nameOf(row.name, 'ru'),
    nameTj: nameOf(row.name, 'tj'),
    inn: nameOf(row.inn, 'ru'),
    categoryId: row.categoryId,
    categoryName: localizedName(row.categoryName, locale, language),
    form: row.dosageForm ?? '',
    dosage: row.dosage ?? '',
    manufacturer: row.manufacturer ?? '',
    countryCode: row.country ?? '',
    unit: row.unit as ProductUnit,
    piecesPerPack: row.piecesPerPack,
    divisible: row.soldByPiece,
    barcodes: row.barcodes.map((code) => ({ code })),
    prescription: prescriptionOf(row),
    maxPriceMinor:
      row.maxRetailPricePerPackDirams === null
        ? null
        : Number(row.maxRetailPricePerPackDirams),
    markupPercent: percentOf(row.markupBp),
    minStockPacks:
      row.defaultMinStockPieces === null
        ? 0
        : Math.floor(row.defaultMinStockPieces / row.piecesPerPack),
    status: row.status as CatalogStatus,
  };
}

/** Field names of the contract whose value differs (the audit of a product update). */
function changedFields(
  before: CatalogProduct,
  after: CatalogProduct,
): string[] {
  const keys = Object.keys(after) as Array<keyof CatalogProduct>;
  return keys.filter(
    (key) =>
      key !== 'categoryName' &&
      key !== 'status' &&
      JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}

// Products of the network (spec 2026-10-07-catalog-pricing, section 5): the card holds all its own
// attributes (D4); a barcode is unique in the network; a product is archived, never deleted.
@Injectable()
export class ProductsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: CatalogRepository,
    private readonly audit: AuditService,
  ) {}

  async list(query: {
    q?: string;
    categoryId?: string;
    form?: string;
    flag?: CatalogFlag;
    status?: CatalogStatus;
    limit?: number;
    offset?: number;
  }): Promise<CatalogListResponse> {
    const { tenantId, locale, currentStoreId } = requirePrincipal();
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    return this.db.tenantTransaction(async (trx) => {
      const language = await this.repository.networkLanguage(trx, tenantId);
      const { rows, total } = await this.repository.listProducts(
        trx,
        tenantId,
        { ...query, status: query.status ?? 'active' },
        { limit, offset },
        language,
        currentStoreId,
      );
      const kpi = await this.repository.productKpi(trx, tenantId);
      return {
        items: rows.map((row) => {
          const flags: CatalogFlag[] = [];
          if (row.isPrescription && !row.isControlled) flags.push('rx');
          if (row.isControlled) flags.push('controlled');
          if (row.isPriceRegulated) flags.push('regulated');
          if (row.barcodeCount === 0) flags.push('no_barcode');
          return {
            id: row.id,
            name: localizedName(row.name, locale, language),
            inn: nameOf(row.inn, 'ru'),
            barcode: row.barcode,
            categoryName: localizedName(row.categoryName, locale, language),
            form: row.dosageForm ?? '',
            manufacturer: row.manufacturer ?? '',
            unit: row.unit as ProductUnit,
            piecesPerPack: row.piecesPerPack,
            retailPriceMinor:
              row.priceDirams === null ? null : Number(row.priceDirams),
            flags,
            status: row.status as CatalogStatus,
          };
        }),
        total,
        limit,
        offset,
        kpi: { ...kpi, duplicates: 0 },
      };
    });
  }

  async get(id: string): Promise<CatalogProduct> {
    const { tenantId, locale } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const language = await this.repository.networkLanguage(trx, tenantId);
      const row = await this.repository.findProduct(
        trx,
        tenantId,
        id.toLowerCase(),
      );
      if (row === null) throw notFound();
      return toProduct(row, locale, language);
    });
  }

  async references(): Promise<CatalogReferences> {
    const { tenantId, locale } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const language = await this.repository.networkLanguage(trx, tenantId);
      const categories = await this.repository.listCategories(
        trx,
        tenantId,
        true,
      );
      const forms = await this.repository.dosageForms(trx, tenantId);
      const { manufacturers, inns } = await this.repository.suggestions(
        trx,
        tenantId,
      );
      return {
        categories: categories.map((row) => ({
          id: row.id,
          name: localizedName(row.name, locale, language),
        })),
        forms: forms.map(
          (name) =>
            nameOf(name, language) || localizedName(name, locale, language),
        ),
        units: [...productUnits],
        manufacturers,
        inns,
        countries: countries.map((country) => ({
          code: country.code,
          name: locale === 'tg' ? country.name.tj : country.name.ru,
        })),
      };
    });
  }

  async create(input: CatalogProductInput): Promise<CatalogProduct> {
    const { tenantId, locale } = requirePrincipal();
    const id = newId();
    return this.write(async (trx) => {
      const language = await this.repository.networkLanguage(trx, tenantId);
      const { values, codes } = await this.values(
        trx,
        tenantId,
        input,
        language,
        null,
      );
      await this.repository.insertProduct(trx, tenantId, id, values);
      await this.repository.replaceBarcodes(trx, tenantId, id, codes);
      const product = toProduct(
        await this.read(trx, tenantId, id),
        locale,
        language,
      );
      await this.audit.append(trx, {
        action: 'product.created',
        entityType: 'product',
        entityId: id,
        details: {
          name: product.nameRu || product.nameTj,
          barcodes: codes.length,
        },
      });
      return product;
    });
  }

  async update(
    id: string,
    input: CatalogProductInput,
  ): Promise<CatalogProduct> {
    const { tenantId, locale } = requirePrincipal();
    const productId = id.toLowerCase();
    return this.write(async (trx) => {
      const language = await this.repository.networkLanguage(trx, tenantId);
      const current = await this.repository.findProduct(
        trx,
        tenantId,
        productId,
      );
      if (current === null) throw notFound();
      if (current.status === 'archived') throw archived();
      const { values, codes } = await this.values(
        trx,
        tenantId,
        input,
        language,
        productId,
      );
      await this.repository.updateProduct(trx, tenantId, productId, values);
      await this.repository.replaceBarcodes(trx, tenantId, productId, codes);
      const before = toProduct(current, locale, language);
      const product = toProduct(
        await this.read(trx, tenantId, productId),
        locale,
        language,
      );
      await this.audit.append(trx, {
        action: 'product.updated',
        entityType: 'product',
        entityId: productId,
        details: { fields: changedFields(before, product) },
      });
      return product;
    });
  }

  async setStatus(id: string, status: CatalogStatus): Promise<CatalogProduct> {
    const { tenantId, locale } = requirePrincipal();
    const productId = id.toLowerCase();
    return this.db.tenantTransaction(async (trx) => {
      const language = await this.repository.networkLanguage(trx, tenantId);
      const current = await this.repository.findProduct(
        trx,
        tenantId,
        productId,
      );
      if (current === null) throw notFound();
      if (current.status !== status) {
        await this.repository.setProductStatus(
          trx,
          tenantId,
          productId,
          status,
        );
        await this.audit.append(trx, {
          action: 'product.status_changed',
          entityType: 'product',
          entityId: productId,
          details: { status },
        });
      }
      return toProduct(
        await this.read(trx, tenantId, productId),
        locale,
        language,
      );
    });
  }

  // A barcode taken by a concurrent request surfaces as the primary key of product_barcodes.
  private async write<T>(
    work: (trx: TenantTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.db.tenantTransaction(work);
    } catch (error) {
      if (uniqueConstraint(error) === 'product_barcodes_pkey')
        throw barcodeTaken();
      throw error;
    }
  }

  private async read(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<ProductRow> {
    const row = await this.repository.findProduct(trx, tenantId, id);
    if (row === null)
      throw new Error('The product just written is not readable');
    return row;
  }

  /** The columns of the input after the rules of section 5 of the spec. */
  private async values(
    trx: TenantTransaction,
    tenantId: string,
    input: CatalogProductInput,
    language: NameLanguage,
    productId: string | null,
  ): Promise<{ values: ProductValues; codes: string[] }> {
    const name = nameMap(input.nameRu, input.nameTj);
    if (!name[language])
      throw invalid(language === 'tj' ? 'nameTj' : 'nameRu', 'required');

    const category = await this.repository.lockCategory(
      trx,
      tenantId,
      input.categoryId,
    );
    if (category === null || category.status !== 'active') {
      throw invalid('categoryId', 'unknown_category');
    }
    if (input.form !== '') {
      const forms = await this.repository.dosageForms(trx, tenantId);
      if (!forms.some((form) => nameOf(form, language) === input.form)) {
        throw invalid('form', 'unknown_form');
      }
    }
    if (input.countryCode !== '' && !isCountryCode(input.countryCode)) {
      throw invalid('countryCode', 'unknown_country');
    }
    if (input.divisible && input.piecesPerPack < 2)
      throw invalid('divisible', 'not_divisible');
    const minStockPieces = input.minStockPacks * input.piecesPerPack;
    if (minStockPieces > MAX_MIN_STOCK_PIECES)
      throw invalid('minStockPacks', 'max');

    const codes = input.barcodes.map((barcode) => barcode.code);
    if (new Set(codes).size !== codes.length)
      throw invalid('barcodes', 'duplicate');
    if (
      (await this.repository.takenBarcodes(trx, tenantId, codes, productId))
        .length > 0
    ) {
      throw barcodeTaken();
    }

    return {
      codes,
      values: {
        name,
        inn: input.inn === '' ? null : { ru: input.inn },
        dosageForm: input.form || null,
        dosage: input.dosage || null,
        manufacturer: input.manufacturer || null,
        country: input.countryCode || null,
        unit: input.unit,
        piecesPerPack: input.piecesPerPack,
        soldByPiece: input.divisible,
        isPrescription: input.prescription !== 'none',
        isControlled: input.prescription === 'controlled',
        isPriceRegulated: input.maxPriceMinor !== null,
        maxRetailPricePerPackDirams: input.maxPriceMinor,
        categoryId: input.categoryId,
        markupBp:
          input.markupPercent === null ? null : input.markupPercent * 100,
        defaultMinStockPieces: minStockPieces,
      },
    };
  }
}
