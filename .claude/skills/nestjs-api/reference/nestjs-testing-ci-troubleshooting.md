> **Pharmacy:** адаптировано под стек Pharmacy — Jest вместо Vitest; CI — GitHub Actions (ADR-0009); пока workflow-файлов нет — ручной прогон `npm run check` перед PR; пороги покрытия — дифференцированные по ADR-0009. Ограничения: `CLAUDE.md`.

# NestJS Testing — Coverage, Pre-MR Checks & Troubleshooting

## Пороги покрытия

Пороги задаются в `coverageThreshold` jest-конфига проекта — `npx nx test <proj> --coverage` падает, если они не достигнуты.

Пороги ADR-0009 (functions и statements = lines; ключи критичных модулей — **каталоги**: Jest
считает каталог агрегатно и вычитает его из global, а glob применяет порог к каждому файлу):

| Область | Lines | Branches |
|---|---|---|
| `libs/shared/util` (деньги, округление, даты) | 95 | 90 |
| `libs/shared/domain`, `libs/shared/testing` | 90 | 85 |
| `apps/api`: `src/app/pos/`, `inventory/`, `returns/`, `pricing/`, `billing/` | 85 | 75 |
| `apps/api`: global | 70 | 60 |
| `apps/web`: буфер офлайн-операций, мапперы, валидация | 80 | 70 |
| `libs/ui` | 70 | 60 |
| `apps/web`, `apps/admin`: global | 60 | 50 |

```typescript
// apps/api/jest.config.cts (fragment)
coverageThreshold: {
  global: { lines: 70, branches: 60, functions: 70, statements: 70 },
  './src/app/pos/': { lines: 85, branches: 75, functions: 85, statements: 85 },
  './src/app/inventory/': { lines: 85, branches: 75, functions: 85, statements: 85 },
  // returns/, pricing/, billing/ — the same
},
```

Пороги только повышаются («храповик»); на релизе 2 ориентир `apps/api` global — 80/70. Из
покрытия исключаются только `main.ts`, `*.module.ts`, `*.dto.ts`. Чек-лист обязательных кейсов
ниже — отдельный гейт, он не зависит от процентов.

## Проверка перед PR

CI — GitHub Actions (ADR-0009): гейты PR `checks` (`nx affected` lint/fsd/typecheck/test с
порогами/build), `api-e2e` (Node 22 и 24, PostgreSQL + Redis из compose), `web-e2e` (Playwright +
axe); ночью — `npm audit`, Trivy, Dependabot. Пока workflow-файлов нет, каждый разработчик
прогоняет локально:

```bash
npm ci                                   # строго по lock-файлу
npm run check                            # lint + test + build всех проектов
npx nx affected -t build test lint       # затронутые проекты, база — main
npx nx affected -t test --coverage       # пороги покрытия
npx nx run api:integration               # если затронут api: npm run dev:deps, БД pharmacy_test
npx nx run api:db-types-verify           # если менялась схема
npx nx e2e api-e2e
```

В описании PR — что запускалось и результат (Definition of Done).

## Чек-лист тестов

- [ ] Сервисы покрыты unit-тестами с моками `TenantDatabase`, репозиториев модуля и портов интеграций
- [ ] Контроллеры — unit-тесты с моками сервисов (без бизнес-логики в контроллере)
- [ ] **Изоляция тенантов**: интеграционный тест «A не видит/не меняет данные B» и зелёный тест каталога (`catalog.int-spec.ts`); в e2e — 404 на чужое
- [ ] **Идемпотентность**: повтор и гонка с тем же `Idempotency-Key` → без дублей
- [ ] **Атомарность**: чек/складской документ и движения партий откатываются вместе
- [ ] **Деньги**: только integer в дирамах; округление себестоимости — вверх
- [ ] Ошибки — `application/problem+json` (400, 401, 403, 404, 409)
- [ ] Права «модуль × действие × охват точек» проверены e2e
- [ ] Circuit breaker / retry для внешних интеграций — unit-тесты с fake timers
- [ ] Очередь-таблица: `SKIP LOCKED`, dedup по idempotency key, dead-статус — на реальной PostgreSQL
- [ ] Внешние интеграции (фискализация, синхронизация) замоканы — никаких реальных сетевых вызовов
- [ ] Данные тестов синтетические; ПДн и секретов в fixtures нет
- [ ] Тесты независимы от порядка; БД и моки сбрасываются между тестами
- [ ] Пороги покрытия выполнены; `npx nx affected -t build test lint` зелёный

## Troubleshooting

| Проблема | Симптом | Решение |
|---|---|---|
| **DI не резолвится** | `Nest can't resolve dependencies of X (?)` | Позиция `?` = индекс параметра конструктора; добавить провайдер/мок с тем же токеном (класс или Symbol-токен, напр. `FISCAL_REGISTRAR`) |
| **Нет метаданных декораторов** | `design:paramtypes` undefined, DI получает `undefined` | `emitDecoratorMetadata` + `experimentalDecorators` в `tsconfig.spec.json`; transform — `ts-jest` из Nx-пресета |
| **Не находит алиас** | `Cannot find module '@pharmacy/shared-dto'` | Путь в `tsconfig.base.json` → `paths`; конфиг наследует `jest.preset.js` Nx |
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

Инструмент — **autocannon** (dev-зависимость, скрипты в `tools/load/`, ADR-0009). Профиль: 5 чеков/с + 25 поисков/с в течение 15 минут, на горячем SKU 5 кассиров одной точки продают одну партию (конкуренция `FOR UPDATE`); данные стенда — не меньше года работы (≈ 10–17 млн движений). Стресс — 250 соединений без пауз, запас ≥ ×2. autocannon не выводит p95 — бюджет проверяется по **p97.5**: штрихкод ≤ 100 мс, текстовый поиск ≤ 200 мс, проведение чека ≤ 300 мс; 0 ответов 5xx, 0 дублей с тем же `Idempotency-Key`. Методика измерений — `nestjs-debugging-performance.md`.

## Snapshot-тесты

Допустимы для стабильных форматов (например, XML выгрузки 1С CommerceML, печатная форма чека), с нормализацией изменчивых полей:

```typescript
expect(normalizeXml(exportXml)).toMatchSnapshot();                       // export-1c
expect(res.body).toMatchSnapshot({ id: expect.any(String), createdAt: expect.any(String) });
```

---

**Главное:**
1. Jest (Nx): `npx nx test <proj>`, `npx nx e2e api-e2e`; пороги — в `coverageThreshold`.
2. CI — GitHub Actions (ADR-0009); пока workflow-файлов нет — перед PR вручную `npm run check`.
3. Обязательные кейсы проекта: изоляция тенантов, идемпотентность, атомарность, деньги integer.
4. Unit — fake timers и моки `TenantDatabase`/репозиториев; интеграционные и e2e — реальная PostgreSQL, прикладная роль без обхода RLS.
