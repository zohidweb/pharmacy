# NestJS REST — сервисный слой и внешние клиенты

Паттерны сервисов apps/api. Внешние вызовы — **только** к системам закрытого списка:
фискализация (адаптер; в MVP — заглушка), синхронизация офлайн-точек (HTTPS + лицензионный
ключ), 1С (только файлы, без сетевого вызова). Валюта — только TJS (ADR-0016).
Новая интеграция = сначала ADR.

## 1. Сервис со списком

```typescript
@Injectable()
export class SuppliersService {
  constructor(private readonly db: TenantDatabase, private readonly repo: SuppliersRepository) {}

  list(q: SupplierListQueryDto): Promise<Page<SupplierResponseDto>> {
    const tenantId = requireTenantId();
    return this.db.tenantTransaction(async (trx) => {
      const { rows, total } = await this.repo.search(trx, tenantId, q);
      return { items: rows.map(toSupplierResponse), total, limit: q.limit, offset: q.offset };
    });
  }
}
```

## 2. Адаптер фискализации (порт + заглушка MVP)

Вендор ККМ не выбран (открытый вопрос stack.md). Касса зависит только от порта — замена
заглушки на реального вендора не меняет модуль `pos`.

```typescript
// apps/api/src/app/fiscal/fiscal-registrar.port.ts
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
// apps/api/src/app/fiscal/stub-fiscal-registrar.ts — MVP: logs and returns success
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

## 3. Внешний HTTP-клиент: реализация адаптера фискализации

Образец исходящего HTTP-вызова в проекте (кроме синхронизации точек) — реализация порта
`FiscalRegistrar` для вендора ККМ. Вендор не выбран: путь, формат тела и имя заголовка
идемпотентности — по его спецификации; до выбора работает `StubFiscalRegistrar`.

```typescript
// apps/api/src/app/fiscal/http-fiscal-registrar.ts — skeleton until the KKM vendor is chosen
import { BadGatewayException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import fiscalConfig from '../../config/fiscal.config';
import { getCorrelationId } from '../../common/context/request-context';
import { FiscalReceipt, FiscalRegistrar, FiscalResult } from './fiscal-registrar.port';

@Injectable()
export class HttpFiscalRegistrar implements FiscalRegistrar {
  private readonly logger = new Logger(HttpFiscalRegistrar.name);

  constructor(@Inject(fiscalConfig.KEY) private readonly cfg: ConfigType<typeof fiscalConfig>) {}

  async register(receipt: FiscalReceipt, idempotencyKey: string): Promise<FiscalResult> {
    const url = new URL('/<receipts-path>', this.cfg.baseUrl); // real path/format — per vendor spec
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,          // header name — per vendor spec
          'X-Correlation-Id': getCorrelationId() ?? idempotencyKey,
        },
        body: JSON.stringify(this.toVendorPayload(receipt)), // amounts stay integer dirams (TJS only)
      });
      if (!res.ok) throw new Error(`KKM vendor responded ${res.status}`);
      return this.parse(await res.text()); // strict parsing, reject unknown shapes
    } catch (error) {
      this.logger.warn(`fiscal registration failed receipt=${receipt.receiptId} [cid=${getCorrelationId()}]: ${(error as Error).message}`);
      throw new BadGatewayException('Fiscal registrar is unavailable');
    }
  }

  private toVendorPayload(receipt: FiscalReceipt): unknown {
    throw new Error('implement per vendor format'); // no PII beyond what the fiscal law requires
  }

  private parse(body: string): FiscalResult {
    throw new Error('implement per vendor format');
  }
}
```

```typescript
// fiscal.module.ts — after the vendor is chosen: implementation selected by config (FISCAL_ADAPTER)
{
  provide: FISCAL_REGISTRAR,
  inject: [fiscalConfig.KEY],
  useFactory: (cfg: ConfigType<typeof fiscalConfig>): FiscalRegistrar =>
    cfg.adapter === 'http' ? new HttpFiscalRegistrar(cfg) : new StubFiscalRegistrar(),
}
```

- Вызов идёт только из обработчика задачи `fiscal.send` (очередь-таблица), никогда из
  транзакции чека; касса не ждёт ККМ.
- Таймаут обязателен (`FISCAL_TIMEOUT_MS`); повторы — ограниченные, вне транзакции БД, всегда с
  тем же idempotency key задачи. Автомат размыкания — `nestjs-resilience-circuit-breaker.md`.
- Бизнес-отказ вендора (`status: 'rejected'`) отличайте от сбоя транспорта: повторяется только
  сбой (сеть, таймаут, 5xx → `BadGatewayException`), отказ фиксируется в результате фискализации.
- Используется встроенный `fetch` Node LTS — отдельный HTTP-клиент не нужен. Адрес вендора — из
  конфигурации (`nestjs-config-basics.md`), только HTTPS.

## 4. Массовые операции

```typescript
// pricing: bulk retail price update for a set of stores — one transaction, one audit record per change
async bulkUpdatePrices(dto: BulkPriceUpdateDto): Promise<{ updated: number }> {
  return this.db.tenantTransaction(async (trx) => {
    let updated = 0;
    for (const item of dto.items) {                       // dto: @ArrayMaxSize(...) bounded
      updated += await this.prices.upsert(trx, tenantId, item); // filters by tenant_id inside
      await this.audit.append(trx, { action: 'price.changed', entityType: 'product', entityId: item.productId });
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
