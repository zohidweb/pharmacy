# NestJS Feature Templates — доменный модуль (пример: catalog / products)

Шаблон модуля apps/api: DTO в `libs/shared/dto`, репозиторий поверх tenant-транзакции,
права «модуль × действие × охват точек». Транзакционный сценарий кассы —
`nestjs-config-data-access.md`.

## Генерация

```bash
# Nx >= 20: generators take a path; check `npx nx g @nx/nest:<generator> --help` for your version
npx nx g @nx/nest:module     apps/api/src/modules/catalog/catalog
npx nx g @nx/nest:controller apps/api/src/modules/catalog/products
npx nx g @nx/nest:service    apps/api/src/modules/catalog/products
npx nx g @nx/js:library      libs/shared/dto   # once, if the lib does not exist yet
```

Сгенерированные `*.spec.ts` — это Jest; держите их рядом с кодом и дополняйте
(`nestjs-testing-unit-basics.md`).

## DTO (libs/shared/dto/src/catalog/*.ts)

Без импортов `@nestjs/*` — библиотеку используют web и admin.

```typescript
// libs/shared/dto/src/catalog/create-product.dto.ts
import { ArrayMaxSize, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateProductDto {
  @IsString() @IsNotEmpty() @MaxLength(300)
  nameRu!: string;

  @IsString() @IsNotEmpty() @MaxLength(300)
  nameTj!: string;

  /** International nonproprietary name (МНН) — basis for analog search at the POS */
  @IsOptional() @IsString() @MaxLength(300)
  inn?: string;

  @IsBoolean()
  isPrescription!: boolean;

  /** Controlled substance (ПКУ): separate sale permission + mandatory prescription fields */
  @IsBoolean()
  isControlledSubstance!: boolean;

  @IsArray() @ArrayMaxSize(20) @Matches(/^\d{8,14}$/, { each: true })
  barcodes!: string[];
}
```

```typescript
// libs/shared/dto/src/catalog/update-product.dto.ts
// Explicit class instead of PartialType: PartialType comes from @nestjs/* and is not allowed here
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProductDto {
  @IsOptional() @IsString() @MaxLength(300) nameRu?: string;
  @IsOptional() @IsString() @MaxLength(300) nameTj?: string;
  @IsOptional() @IsString() @MaxLength(300) inn?: string;
  @IsOptional() @IsBoolean() isPrescription?: boolean;
  @IsOptional() @IsBoolean() archived?: boolean;
}
```

```typescript
// libs/shared/dto/src/catalog/product.response.ts
export interface ProductResponseDto {
  id: string;
  nameRu: string;
  nameTj: string;
  inn: string | null;
  isPrescription: boolean;
  isControlledSubstance: boolean;
  barcodes: string[];
  archived: boolean;
}
```

Цена в карточке товара **не хранится**: розничные цены — модуль `pricing`, закупочная цена —
атрибут партии (`inventory`). Все суммы в DTO — `*Dirams: number` с `@IsInt() @Min(0)`.
`tenantId` в DTO **нет** — он берётся из сессии.

## Модуль

```typescript
// apps/api/src/modules/catalog/catalog.module.ts
import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsRepository } from './products.repository';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, ProductsRepository],
  exports: [ProductsService], // public interface for pos, inventory, pricing; repository stays private
})
export class CatalogModule {}
```

## Контроллер

```typescript
// apps/api/src/modules/catalog/products.controller.ts
import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateProductDto, Page, ProductListQueryDto, ProductResponseDto, UpdateProductDto } from '@pharmacy/shared/dto';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { ProductsService } from './products.service';

@ApiTags('catalog')
@Controller({ path: 'products', version: '1' }) // -> /api/v1/products
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('catalog', 'create')
  @ApiOperation({ summary: 'Create a product card' })
  create(@Body() dto: CreateProductDto): Promise<ProductResponseDto> {
    return this.products.create(dto);
  }

  @Get()
  @RequirePermission('catalog', 'read')
  list(@Query() query: ProductListQueryDto): Promise<Page<ProductResponseDto>> {
    return this.products.list(query);
  }

  @Get(':id')
  @RequirePermission('catalog', 'read')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ProductResponseDto> {
    return this.products.get(id);
  }

  @Patch(':id')
  @RequirePermission('catalog', 'update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto): Promise<ProductResponseDto> {
    return this.products.update(id, dto);
  }
}
```

Физического `DELETE` для товаров нет: на карточку ссылаются партии, движения, чеки.
Вывод из оборота — `PATCH { archived: true }`.

Каталог — справочник уровня сети, поэтому без охвата точек. Для точечных ресурсов
(остатки, смены, документы) охват обязателен:
`@RequirePermission('inventory', 'read', { storeParam: 'storeId' })` на маршруте
`/api/v1/stores/:storeId/stock` (`nestjs-security-auth.md`).

## Сервис

```typescript
// apps/api/src/modules/catalog/products.service.ts
import { Injectable } from '@nestjs/common';
import { CreateProductDto, Page, ProductListQueryDto, ProductResponseDto, UpdateProductDto } from '@pharmacy/shared/dto';
import { DatabaseService } from '../../core/database/database.service';
import { AuditService } from '../audit/audit.service';
import { ResourceNotFoundException } from '../../common/exceptions/domain.exceptions';
import { ProductsRepository, ProductRow } from './products.repository';

@Injectable()
export class ProductsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ProductsRepository,
    private readonly audit: AuditService,
  ) {}

  create(dto: CreateProductDto): Promise<ProductResponseDto> {
    return this.db.tenantTransaction(async (tx) => {
      const row = await this.repo.insert(tx, dto); // barcode unique per tenant -> 23505 -> 409
      await this.audit.append(tx, { action: 'product.created', entityType: 'product', entityId: row.id });
      return toProductResponse(row);
    });
  }

  list(query: ProductListQueryDto): Promise<Page<ProductResponseDto>> {
    return this.db.tenantTransaction(async (tx) => {
      const { rows, total } = await this.repo.search(tx, query);
      return { items: rows.map(toProductResponse), total, limit: query.limit, offset: query.offset };
    });
  }

  get(id: string): Promise<ProductResponseDto> {
    return this.db.tenantTransaction(async (tx) => {
      const row = await this.repo.findById(tx, id);
      if (!row) throw new ResourceNotFoundException('product', id);
      return toProductResponse(row);
    });
  }

  update(id: string, dto: UpdateProductDto): Promise<ProductResponseDto> {
    return this.db.tenantTransaction(async (tx) => {
      const row = await this.repo.update(tx, id, dto);
      if (!row) throw new ResourceNotFoundException('product', id);
      await this.audit.append(tx, { action: 'product.updated', entityType: 'product', entityId: id });
      return toProductResponse(row);
    });
  }
}

function toProductResponse(row: ProductRow): ProductResponseDto {
  return {
    id: row.id,
    nameRu: row.name_ru,
    nameTj: row.name_tj,
    inn: row.inn,
    isPrescription: row.is_prescription,
    isControlledSubstance: row.is_controlled_substance,
    barcodes: row.barcodes,
    archived: row.archived_at !== null,
  };
}
```

`AuditService` экспортируется модулем `audit` и пишет в ту же транзакцию: `tenantId`,
`employeeId`, `storeId`, `correlationId`, «от имени» (оператор) — из контекста запроса.

## Репозиторий

Шаблон и правила — `nestjs-config-data-access.md` (раздел «Tenant-scoped репозиторий»):
каждый SQL содержит `tenant_id = $1`, принимает `Tx`, возвращает строки, маппинг в DTO —
в сервисе. Поиск/сортировка/пагинация — `nestjs-rest-dto-pagination.md`.
