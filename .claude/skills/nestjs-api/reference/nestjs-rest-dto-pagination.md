# NestJS REST — DTO, маппинг, пагинация limit/offset

DTO и контракты — в `libs/shared/dto` (без `@nestjs/*`). Маппинг «строка БД → DTO» — в
сервисе apps/api. Пагинация — **limit/offset**, ответ списка — `{ items, total, limit, offset }`.

## Маппинг: функция рядом с сервисом

```typescript
// apps/api/src/modules/inventory/batches.mapper.ts
import type { BatchResponseDto } from '@pharmacy/shared/dto';
import { toDirams } from '@pharmacy/shared/util';

export interface BatchRow {
  id: string;
  product_id: string;
  expires_on: string;           // DATE -> 'YYYY-MM-DD', no timezone games
  purchase_price_dirams: string; // int8 arrives from pg as string
  currency: string;             // purchase currency; TJS amount is fixed at the NBT rate on the document date
  supplier_id: string;
}

export function toBatchResponse(row: BatchRow, quantityOnHand: number): BatchResponseDto {
  return {
    id: row.id,
    productId: row.product_id,
    expiresOn: row.expires_on,
    purchasePriceDirams: toDirams(row.purchase_price_dirams), // safe-integer check, never parseFloat
    currency: row.currency,
    supplierId: row.supplier_id,
    quantityOnHand,               // derived from stock_movements, not a stored column
  };
}
```

Правила:
- Response DTO — явный список полей. Никогда не отдавать строку БД целиком (`SELECT *` →
  JSON): утекут `tenant_id`, служебные поля, ПДн.
- Деньги в ответе — integer дирамы; форматирование «сомони, дирамы» и локаль RU/TJ — на
  фронтенде через `libs/shared/util`.
- Даты без времени (срок годности, дата документа) — строка `YYYY-MM-DD`; моменты
  времени — ISO 8601 с зоной.

## Query-DTO пагинации (libs/shared/dto/src/common/page-query.dto.ts)

```typescript
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit: number = 50;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000)
  offset: number = 0;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
```

## Фильтры и сортировка — через whitelist

```typescript
// libs/shared/dto/src/catalog/product-list-query.dto.ts
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PageQueryDto } from '../common/page-query.dto';

export const PRODUCT_SORT_FIELDS = ['nameRu', 'nameTj', 'createdAt'] as const;

export class ProductListQueryDto extends PageQueryDto {
  /** Name (RU/TJ), INN or barcode */
  @IsOptional() @IsString() @MaxLength(100)
  search?: string;

  @IsOptional() @Transform(({ value }) => value === 'true') @IsBoolean()
  includeArchived?: boolean;

  @IsOptional() @IsIn(PRODUCT_SORT_FIELDS)
  sortBy: (typeof PRODUCT_SORT_FIELDS)[number] = 'nameRu';

  @IsOptional() @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'asc';
}
```

## Репозиторий: поиск + total

```typescript
// apps/api/src/modules/catalog/products.repository.ts (fragment)
const SORT_COLUMNS: Record<ProductListQueryDto['sortBy'], string> = {
  nameRu: 'name_ru',
  nameTj: 'name_tj',
  createdAt: 'created_at',
};

async search(tx: Tx, q: ProductListQueryDto): Promise<{ rows: ProductRow[]; total: number }> {
  const params: unknown[] = [tx.tenantId];
  const where = ['tenant_id = $1'];
  if (!q.includeArchived) where.push('archived_at IS NULL');
  if (q.search) {
    params.push(`%${escapeLike(q.search)}%`, q.search); // escapeLike: escape %, _ and backslash in user input
    where.push(`(name_ru ILIKE $2 OR name_tj ILIKE $2 OR inn ILIKE $2 OR $3 = ANY(barcodes))`);
  }
  // ORDER BY cannot be parameterized: column comes from a fixed map, direction from a validated enum
  const orderBy = `${SORT_COLUMNS[q.sortBy]} ${q.sortOrder === 'desc' ? 'DESC' : 'ASC'}, id`;

  const rows = await tx.query<ProductRow>(
    `SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY ${orderBy}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.limit, q.offset],
  );
  const [{ count }] = await tx.query<{ count: string }>(
    `SELECT count(*) FROM products WHERE ${where.join(' AND ')}`,
    params,
  );
  return { rows, total: Number(count) };
}
```

- Стабильный порядок: всегда добавлять уникальный хвост (`, id`), иначе страницы «плывут».
- Большой `offset` дорог; для длинных журналов (движения, аудит) — фильтр по периоду
  обязателен, `offset` ограничен (`@Max`). Keyset-пагинация — только если limit/offset
  реально упрётся в производительность (изменение конвенции → ADR/согласование).
- `count(*)` на больших таблицах — только с тем же фильтром тенанта/периода.
- Поиск по подстроке на кассе должен укладываться в ≤ 1 сек: индексы (например, trigram) —
  по скилу `postgres-best-practices`, решение о расширении PostgreSQL — в миграции с ревью.

## Вложенные DTO (строки чека)

```typescript
// libs/shared/dto/src/pos/complete-receipt.dto.ts
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsIn, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';

export class ReceiptLineDto {
  @IsUUID() batchId!: string;
  @IsInt() @Min(1) quantity!: number;          // in minimal accounting units
  @IsInt() @Min(0) unitPriceDirams!: number;   // integer dirams, no floats
}

export class ReceiptPaymentDto {
  @IsIn(['cash', 'card', 'qr', 'nfc']) method!: 'cash' | 'card' | 'qr' | 'nfc';
  @IsInt() @Min(1) amountDirams!: number;
}

export class CompleteReceiptDto {
  @ValidateNested({ each: true }) @Type(() => ReceiptLineDto)
  @ArrayMinSize(1) @ArrayMaxSize(200)
  lines!: ReceiptLineDto[];

  @ValidateNested({ each: true }) @Type(() => ReceiptPaymentDto)
  @ArrayMinSize(1) @ArrayMaxSize(5)
  payments!: ReceiptPaymentDto[];
}
```

Итог чека, скидку (одно наиболее выгодное правило) и сверку «сумма оплат = итог» считает
**сервер**; присланные клиентом цены сверяются с актуальными ценами `pricing`, а не
принимаются на веру.
