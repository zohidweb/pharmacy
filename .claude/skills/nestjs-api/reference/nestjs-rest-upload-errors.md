# NestJS REST — выгрузка/загрузка файлов, ошибки RFC 7807

Файловые сценарии Pharmacy: **выгрузка в 1С** (CommerceML/XML, вручную за период),
PDF счёта тенанта (billing), при необходимости — загрузка файла (например, начальные остатки,
если сценарий есть в ТЗ). Файлы не отправляются во внешние SaaS-хранилища.

## Выгрузка 1С (download, модуль export-1c)

```typescript
// apps/api/src/modules/export-1c/export-1c.controller.ts
import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { ExportPeriodQueryDto } from '@pharmacy/shared/dto';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { Export1cService } from './export-1c.service';

@Controller({ path: 'exports/1c', version: '1' }) // /api/v1/exports/1c?from=2026-09-01&to=2026-09-30&storeId=...
export class Export1cController {
  constructor(private readonly exports: Export1cService) {}

  @Get()
  @RequirePermission('export-1c', 'run', { storeQuery: 'storeId' })
  async download(@Query() q: ExportPeriodQueryDto): Promise<StreamableFile> {
    const { stream, fileName } = await this.exports.buildCommerceMl(q); // audit record inside
    return new StreamableFile(stream, {
      type: 'application/xml; charset=utf-8',
      disposition: `attachment; filename="${fileName}"`, // fileName built from ids/dates only
    });
  }
}
```

- Период ограничен (`from`/`to` обязательны, максимальная длина периода — в DTO).
- XML строится потоково из курсора/порций, не собирается целиком в памяти для больших периодов.
- Экранирование XML — через сериализатор, не конкатенацией строк.
- Факт выгрузки (кто, период, точки) — в аудит.
- Формат CommerceML и соответствие справочникам 1С — по согласованной спецификации обмена.

## Загрузка файла (upload) — только при наличии сценария в ТЗ

Express-адаптер: `FileInterceptor` из `@nestjs/platform-express` (Multer входит в адаптер).

```typescript
import { Controller, HttpStatus, ParseFilePipeBuilder, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

const MAX_BYTES = 5 * 1024 * 1024;

@Controller({ path: 'stores/:storeId/opening-balance-imports', version: '1' })
export class OpeningBalanceImportsController {
  @Post()
  @RequirePermission('inventory', 'import', { storeParam: 'storeId' })
  // no 'dest'/'storage' -> Multer keeps the file in memory (Buffer), nothing is written to disk
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  upload(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: 'text/csv' })
        .addMaxSizeValidator({ maxSize: MAX_BYTES })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
  ) {
    // parse -> validate every row -> create a draft document (status 'draft'), never post stock directly
  }
}
```

- MIME от клиента подделывается: содержимое всё равно парсится и валидируется построчно.
- Результат импорта — **черновик документа** (приход/ввод начальных остатков), который
  проводится отдельным действием; движения появляются только при проведении.
- Файл не пишется на диск api и не хранится вне PostgreSQL без отдельного решения.

## Ошибки — RFC 7807

Единый формат `application/problem+json` формирует глобальный `ProblemDetailsFilter`
(`nestjs-enterprise-patterns.md`): `type`, `title`, `status`, `detail`, `instance`, `code`,
`correlationId`, `errors[]` для валидации. Правила:

- Не формировать JSON ошибки вручную в контроллере — бросить доменное исключение.
- `detail` — без SQL, стеков, имён констрейнтов, значений полей и ПДн.
- Ошибки файловых эндпоинтов — тоже problem+json (фильтр перехватывает и их), даже если
  успешный ответ — XML/PDF.

## Версионирование

URI: `/api/v1/…` (`nestjs-enterprise-patterns.md`). Новая мажорная версия — только при
несовместимом изменении контракта `libs/shared/dto`, с учётом офлайн-точек на старых версиях.
