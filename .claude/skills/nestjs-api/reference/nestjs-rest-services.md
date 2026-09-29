# NestJS REST — сервисный слой и внешние клиенты

Паттерны сервисов apps/api. Внешние вызовы — **только** к системам закрытого списка:
курсы НБТ (HTTPS), фискализация (адаптер; в MVP — заглушка), синхронизация офлайн-точек
(HTTPS + лицензионный ключ), 1С (только файлы, без сетевого вызова). Новая интеграция =
сначала ADR. Прямого доступа к БД АБС нет.

## 1. Сервис со списком

```typescript
@Injectable()
export class SuppliersService {
  constructor(private readonly db: DatabaseService, private readonly repo: SuppliersRepository) {}

  list(q: SupplierListQueryDto): Promise<Page<SupplierResponseDto>> {
    return this.db.tenantTransaction(async (tx) => {
      const { rows, total } = await this.repo.search(tx, q);
      return { items: rows.map(toSupplierResponse), total, limit: q.limit, offset: q.offset };
    });
  }
}
```

## 2. Внешний клиент: курсы НБТ

Курс нужен на **дату операции** (закупочная цена партии в валюте → TJS). Курс, однажды
применённый к документу, сохраняется в документе и больше не пересчитывается.

```typescript
// apps/api/src/modules/pricing/nbt-rates.client.ts
import { BadGatewayException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import nbtConfig from '../../config/nbt.config';
import { getCorrelationId } from '../../common/context/request-context';

export interface NbtRate {
  currency: string;     // ISO 4217, e.g. 'USD'
  onDate: string;       // 'YYYY-MM-DD'
  /** Rate as a scaled integer: TJS dirams per `nominal` units of currency — never a float in business logic */
  diramsPerNominal: number;
  nominal: number;
}

@Injectable()
export class NbtRatesClient {
  private readonly logger = new Logger(NbtRatesClient.name);

  constructor(@Inject(nbtConfig.KEY) private readonly cfg: ConfigType<typeof nbtConfig>) {}

  async fetchRates(onDate: string): Promise<NbtRate[]> {
    const url = new URL('/<rates-path>', this.cfg.baseUrl); // real path/format — per NBT spec (JSON/HTML)
    url.searchParams.set('date', onDate);
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`NBT responded ${res.status}`);
      return this.parse(await res.text(), onDate); // strict parsing, reject unknown shapes
    } catch (error) {
      this.logger.warn(`NBT rates unavailable for ${onDate} [cid=${getCorrelationId()}]: ${(error as Error).message}`);
      throw new BadGatewayException('Exchange rate provider is unavailable');
    }
  }

  private parse(body: string, onDate: string): NbtRate[] {
    // convert the decimal string from NBT to a scaled integer here, once; no float arithmetic downstream
    throw new Error('implement per NBT format');
  }
}
```

- Загрузка курсов — плановая задача (`@nestjs/schedule`) с сохранением в таблицу курсов;
  прикладной код читает курс **из БД**, а не ходит в НБТ на каждый документ.
- Таймаут обязателен; повторы — ограниченные, вне транзакции БД. Автомат размыкания —
  `nestjs-resilience-circuit-breaker.md`.
- Нет курса на дату → документ нельзя провести (422 с понятным `code`), а не «подставить вчерашний» молча.
- Используется встроенный `fetch` Node LTS — отдельный HTTP-клиент не нужен.

## 3. Адаптер фискализации (порт + заглушка MVP)

Вендор ККМ не выбран (открытый вопрос stack.md). Касса зависит только от порта — замена
заглушки на реального вендора не меняет модуль `pos`.

```typescript
// apps/api/src/modules/fiscal/fiscal-registrar.port.ts
export interface FiscalReceipt {
  receiptId: string;
  storeId: string;
  totalDirams: number;
  lines: Array<{ name: string; quantity: number; amountDirams: number }>;
}

export interface FiscalResult {
  status: 'registered' | 'rejected';
  fiscalSign?: string;
}

export interface FiscalRegistrar {
  /** Must be idempotent by receiptId: resending the same receipt returns the same result */
  register(receipt: FiscalReceipt, idempotencyKey: string): Promise<FiscalResult>;
}

export const FISCAL_REGISTRAR = Symbol('FISCAL_REGISTRAR');
```

```typescript
// apps/api/src/modules/fiscal/stub-fiscal-registrar.ts — MVP: logs and returns success
@Injectable()
export class StubFiscalRegistrar implements FiscalRegistrar {
  private readonly logger = new Logger(StubFiscalRegistrar.name);

  async register(receipt: FiscalReceipt, idempotencyKey: string): Promise<FiscalResult> {
    this.logger.log(`[stub] fiscal registration receipt=${receipt.receiptId} key=${idempotencyKey}`);
    return { status: 'registered' };
  }
}

// fiscal.module.ts
@Module({
  providers: [FiscalService, { provide: FISCAL_REGISTRAR, useClass: StubFiscalRegistrar }],
  exports: [FiscalService],
})
export class FiscalModule {}
```

Отправка чека в фискализацию — **после** коммита транзакции чека, через очередь-таблицу
PostgreSQL (`nestjs-messaging-basics.md`): недоступность ККМ не блокирует продажу, повтор —
с тем же idempotency key.

## 4. Массовые операции

```typescript
// pricing: bulk retail price update for a set of stores — one transaction, one audit record per change
async bulkUpdatePrices(dto: BulkPriceUpdateDto): Promise<{ updated: number }> {
  return this.db.tenantTransaction(async (tx) => {
    let updated = 0;
    for (const item of dto.items) {                       // dto: @ArrayMaxSize(...) bounded
      updated += await this.prices.upsert(tx, item);      // WHERE tenant_id = $1 inside
      await this.audit.append(tx, { action: 'price.changed', entityType: 'product', entityId: item.productId });
    }
    return { updated };
  });
}
```

- Размер пакета ограничен в DTO; очень большие операции — порциями через очередь-таблицу.
- `ON CONFLICT DO NOTHING` / `skipDuplicates` не используем для молчаливого проглатывания
  дублей в финансовых данных — дубль должен быть явной ошибкой или идемпотентным повтором.
  Допустимый случай — `ON CONFLICT (tenant_id, idempotency_key) DO NOTHING` с последующим
  чтением и возвратом **исходного** результата (скил `postgres-best-practices`).

## 5. Удаление данных

- Товары, поставщики, сотрудники — архивирование (`archived_at`), не `DELETE`: на них
  ссылаются партии, движения, чеки, аудит.
- Движения остатков, чеки, аудит, журнал ПКУ — не удаляются и не изменяются никогда;
  исправление — сторно/возврат новым документом.
- Хранение аудита ≥ 3 лет (глоссарий). Сроки хранения ПДн — по закону РТ.

## 6. Кэш (Redis)

```typescript
const key = `t:${tenantId}:prices:store:${storeId}:v${priceListVersion}`; // tenant is always part of the key
```

- Ключ **всегда** содержит `tenantId`; без него кэш — утечка между тенантами.
- Кэшируем то, что нужно кассе за ≤ 1 сек: каталог, действующие цены точки, скидочные правила.
- Остатки не кэшируем как источник истины: касса проверяет остаток в транзакции чека.
- Инвалидация — при изменении (или версионированием ключа), TTL — страховка, не механизм
  согласованности.

## 7. Чек-лист сервиса

- [ ] Все запросы — в `db.tenantTransaction()`, SQL с `tenant_id`.
- [ ] Операция и её движения/аудит — в одной транзакции.
- [ ] Деньги — integer дирамы; округление по правилу ТЗ (себестоимость штуки — вверх).
- [ ] Финансовая операция — idempotency key; внешние вызовы — вне транзакции, с таймаутом.
- [ ] Внешний вызов только к системе из закрытого списка.
- [ ] Ошибки не проглатываются; доменные исключения вместо ручных ответов.
- [ ] Логи — `Logger`, с correlation ID, без ПДн.
