> **Pharmacy:** адаптировано под стек Pharmacy — Jest вместо Vitest; пайплайны CI (GitHub Actions/GitLab CI) удалены: категория CI/CD радара «На утверждении», до решения — локальный прогон `npx nx affected -t build test lint` перед MR и пороги покрытия в jest-конфиге. Ограничения: `CLAUDE.md`.

# NestJS Testing — Coverage, Pre-MR Checks & Troubleshooting

## Пороги покрытия

Пороги задаются в `coverageThreshold` jest-конфига проекта — `npx nx test <proj> --coverage` падает, если они не достигнуты.

| Метрика | Минимум (стартовое предложение) |
|---|---|
| Lines | 90% |
| Functions | 90% |
| Branches | 80% |
| Statements | 90% |

```typescript
// apps/api/jest.config.ts (fragment)
coverageThreshold: {
  global: { lines: 90, functions: 90, branches: 80, statements: 90 },
  // stricter bar for money/stock invariants:
  './src/modules/pos/': { lines: 95, branches: 90 },
  './src/modules/inventory/': { lines: 95, branches: 90 },
},
```

Окончательные значения порогов фиксирует команда. Из покрытия исключайте только `main.ts`, `*.module.ts`, `*.dto.ts` — не бизнес-логику.

## Проверка перед MR (вместо CI-пайплайна)

Категория CI/CD техрадара «На утверждении» — не создавайте пайплайны (`.github/workflows`, `.gitlab-ci.yml` и т.п.). До утверждения каждый разработчик прогоняет локально:

```bash
npm ci                                   # строго по lock-файлу
npx nx affected -t build test lint       # затронутые проекты, база — main
npx nx affected -t test --coverage       # пороги покрытия
npx nx e2e api-e2e                       # если затронут api: нужна PostgreSQL из docker compose
```

В описании MR — что запускалось и результат (Definition of Done). После утверждения CI/CD в радаре (`/update-radar`) этот раздел заменяется правилами утверждённого пайплайна.

## Чек-лист тестов

- [ ] Сервисы покрыты unit-тестами с моками `DatabaseService`, репозиториев модуля и клиентов интеграций
- [ ] Контроллеры — unit-тесты с моками сервисов (без бизнес-логики в контроллере)
- [ ] **Изоляция тенантов**: e2e «A не видит/не меняет данные B» (404 на чужое)
- [ ] **Идемпотентность**: повтор и гонка с тем же `Idempotency-Key` → без дублей
- [ ] **Атомарность**: чек/складской документ и движения партий откатываются вместе
- [ ] **Деньги**: только integer в дирамах; округление себестоимости — вверх
- [ ] Ошибки — `application/problem+json` (400, 401, 403, 404, 409)
- [ ] Права «модуль × действие × охват точек» проверены e2e
- [ ] Circuit breaker / retry для внешних интеграций — unit-тесты с fake timers
- [ ] Очередь-таблица: `SKIP LOCKED`, dedup по idempotency key, dead-статус — на реальной PostgreSQL
- [ ] Внешние интеграции (НБТ, фискализация, синхронизация) замоканы — никаких реальных сетевых вызовов
- [ ] Данные тестов синтетические; ПДн и секретов в fixtures нет
- [ ] Тесты независимы от порядка; БД и моки сбрасываются между тестами
- [ ] Пороги покрытия выполнены; `npx nx affected -t build test lint` зелёный

## Troubleshooting

| Проблема | Симптом | Решение |
|---|---|---|
| **DI не резолвится** | `Nest can't resolve dependencies of X (?)` | Позиция `?` = индекс параметра конструктора; добавить провайдер/мок с тем же токеном (класс или Symbol-токен, напр. `FISCAL_REGISTRAR`) |
| **Нет метаданных декораторов** | `design:paramtypes` undefined, DI получает `undefined` | `emitDecoratorMetadata` + `experimentalDecorators` в `tsconfig.spec.json`; transform — `ts-jest` из Nx-пресета |
| **Не находит алиас** | `Cannot find module '@pharmacy/shared/dto'` | Путь в `tsconfig.base.json` → `paths`; конфиг наследует `jest.preset.js` Nx |
| **Jest не завершается** | `Jest did not exit one second after the test run` | Закрывать `app.close()`, пул БД, Redis-клиент в `afterAll`; диагностика — `--detectOpenHandles` |
| **Таймаут** | `Exceeded timeout of 5000 ms` | Для e2e `testTimeout: 60_000`; в unit — fake timers вместо реальных ожиданий; искать незавершённые промисы |
| **Нет соединения с БД в e2e** | `ECONNREFUSED` / `database does not exist` | Поднят ли `postgres` из docker compose; задан ли `TEST_DATABASE_URL`; применены ли миграции в globalSetup |
| **RLS «не работает» в тестах** | Тест изоляции видит чужие строки | Приложение подключено суперпользователем или владельцем таблиц без `FORCE ROW LEVEL SECURITY`; `set_config('app.tenant_id', …, true)` вызван вне транзакции |
| **Загрязнение состояния** | Поодиночке зелёные, вместе красные | `db.reset()` в `beforeEach`; `clearMocks: true`; `maxWorkers: 1` для e2e |
| **Мок не вызван** | `toHaveBeenCalled` падает | Мок зарегистрирован под другим токеном; реальный провайдер пришёл из импортированного модуля — используйте `overrideProvider` |
| **Асинхронная проверка не выполнилась** | Тест зелёный без проверки | `await expect(...).rejects.toThrow()`; `expect.assertions(n)` для колбэков |

### Отладка тестов

```bash
npx nx test api --testFile=receipts.service.spec.ts --runInBand
node --inspect-brk node_modules/jest/bin/jest.js --config apps/api/jest.config.ts --runInBand receipts.service
# затем chrome://inspect или VS Code «Attach to Node Process»
npx nx test api --detectOpenHandles
```

### Типичные ошибки моков

```typescript
// ❌ mock object created but never registered in the testing module
const repo = { findById: jest.fn() };

// ✅ registered under the same DI token the service injects
await Test.createTestingModule({
  providers: [ProductsService, { provide: ProductsRepository, useValue: repo }],
}).compile();
```

```typescript
// ❌ missing await — assertion runs before the promise settles
it('sells', () => { service.completeReceipt(storeId, dto, key); expect(repo.insert).toHaveBeenCalled(); });

// ✅
it('sells', async () => { await service.completeReceipt(storeId, dto, key); expect(repo.insert).toHaveBeenCalled(); });
```

## Нагрузочная проверка

Ориентир ТЗ: операция кассы ≤ 1 сек; до 50 одновременных кассиров с запасом ×5. Инструмент нагрузочного тестирования (autocannon, k6 и т.п.) в радаре не описан — **согласовать** перед добавлением. Сценарий: поиск товара по штрихкоду → чек с FEFO-списанием → оплата, 250 параллельных «кассиров», проверка p95 и отсутствия ошибок/дублей. Методика измерений — `nestjs-debugging-performance.md`.

## Snapshot-тесты

Допустимы для стабильных форматов (например, XML выгрузки 1С CommerceML, печатная форма чека), с нормализацией изменчивых полей:

```typescript
expect(normalizeXml(exportXml)).toMatchSnapshot();                       // export-1c
expect(res.body).toMatchSnapshot({ id: expect.any(String), createdAt: expect.any(String) });
```

---

**Главное:**
1. Jest (Nx): `npx nx test <proj>`, `npx nx e2e api-e2e`; пороги — в `coverageThreshold`.
2. CI-пайплайнов нет до утверждения категории радара — перед MR локально `npx nx affected -t build test lint`.
3. Обязательные кейсы проекта: изоляция тенантов, идемпотентность, атомарность, деньги integer.
4. Unit — fake timers и моки `DatabaseService`/репозиториев; e2e — реальная PostgreSQL, прикладная роль без обхода RLS.
