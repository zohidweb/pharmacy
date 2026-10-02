# NestJS REST — DTO, маппинг, пагинация limit/offset

DTO и контракты — в `libs/shared/dto` (без `@nestjs/*`). Маппинг «строка БД → DTO» — в
сервисе apps/api. Пагинация — **limit/offset**, ответ списка — `{ items, total, limit, offset }`.

## Маппинг: функция рядом с сервисом

```typescript
// apps/api/src/app/inventory/batches.mapper.ts
import type { BatchResponseDto } from '@pharmacy/shared-dto';
import { toSafeInt } from '@pharmacy/shared-util'; // bigint -> number, throws outside Number.MAX_SAFE_INTEGER

// A Kysely row (CamelCasePlugin): pool type parser gives int8 -> bigint, date -> 'YYYY-MM-DD' string (ADR-0006 p. 3)
export interface BatchRow {
  id: string;
  productId: string;
  expiryDate: string;                  // DATE -> 'YYYY-MM-DD', no timezone games
  purchasePricePerPackDirams: bigint;  // TJS only, no currency column (ADR-0016)
  supplierId: string | null;
}

export function toBatchResponse(row: BatchRow, onHandPieces: bigint): BatchResponseDto {
  return {
    id: row.id,
    productId: row.productId,
    expiryDate: row.expiryDate,
    purchasePricePerPackDirams: toSafeInt(row.purchasePricePerPackDirams),
    supplierId: row.supplierId,
    onHandPieces: toSafeInt(onHandPieces),            // stock is derived from movements, not a stored column
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
// apps/api/src/app/catalog/products.repository.ts (fragment)
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

// ORDER BY cannot be parameterized: the expression comes from a fixed map, direction from a validated enum
const SORT_COLUMNS = {
  nameRu: sql<string>`name->>'ru'`,
  nameTj: sql<string>`name->>'tj'`,
  createdAt: sql<Date>`created_at`,
} as const satisfies Record<ProductListQueryDto['sortBy'], unknown>;

async search(trx: TenantTransaction, tenantId: string, q: ProductListQueryDto) {
  let base = trx.selectFrom('products').where('tenantId', '=', tenantId);
  if (!q.includeArchived) base = base.where('status', '=', 'active');
  if (q.search) {
    const like = `%${escapeLike(q.search)}%`; // escapeLike: escape %, _ and backslash in user input
    base = base.where((eb) =>
      eb.or([
        eb(sql`name->>'ru'`, 'ilike', like),
        eb(sql`name->>'tj'`, 'ilike', like),
        eb(sql`inn->>'ru'`, 'ilike', like),
        eb.exists(
          eb.selectFrom('productBarcodes')
            .select('productBarcodes.productId')
            .whereRef('productBarcodes.tenantId', '=', 'products.tenantId')
            .whereRef('productBarcodes.productId', '=', 'products.id')
            .where('productBarcodes.barcode', '=', q.search!),
        ),
      ]),
    );
  }
  const [rows, { total }] = await Promise.all([
    base
      .selectAll()
      .orderBy(SORT_COLUMNS[q.sortBy], q.sortOrder === 'desc' ? 'desc' : 'asc')
      .orderBy('id')
      .limit(q.limit)
      .offset(q.offset)
      .execute(),
    base.select((eb) => eb.fn.countAll<bigint>().as('total')).executeTakeFirstOrThrow(),
  ]);
  return { rows, total: toSafeInt(total) };
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
