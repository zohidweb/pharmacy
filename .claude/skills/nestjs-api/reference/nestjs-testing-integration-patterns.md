> **Pharmacy:** адаптировано под стек Pharmacy — Jest + supertest в `apps/api-e2e`; добавлены обязательные кейсы проекта (изоляция тенантов, идемпотентность, атомарность чек+движения, деньги в integer); JWT заменён на серверные сессии; пагинация limit/offset. Ограничения: `CLAUDE.md`.

# NestJS Integration Testing — Patterns

Каркас (`TestDb`, `TestSeeder`, `loginAs`) — в `nestjs-testing-integration-setup.md`. Эндпоинты и поля ниже — иллюстрация; контракты — в `libs/shared/dto`.

## Обязательные кейсы проекта

Каждый модуль, который пишет прикладные данные, покрывает релевантные кейсы из этого раздела. Без них PR не проходит Definition of Done.

### 0. Каталог и изоляция на уровне БД (интеграционные тесты `apps/api`, ADR-0013 §8)

Уже есть и обязаны оставаться зелёными при каждой миграции (`npx nx run api:integration`):

- `catalog.int-spec.ts` — каждая таблица схемы `pharmacy` есть в `table-classes.ts` и наоборот
  (включая представления); RLS `ENABLE` + `FORCE`; **точные наборы прав** по ролям и классам
  (`pharmacy_app` на тенантных — ровно `SELECT/INSERT/UPDATE/DELETE`, никаких `TRUNCATE`,
  `REFERENCES`, `TRIGGER`, `MAINTAIN`); `pharmacy_platform` видит только колонки реестра
  `stores`; `BYPASSRLS` только у суперпользователя; SECURITY DEFINER-функции = список
  резолверов; нет политик `TO public`; нет default privileges для `pharmacy_app`; ведущий
  `tenant_id` в первичном ключе; нет `default` у `id`; нет ролевых настроек `app.*`.
- `isolation.int-spec.ts` — тенанты A и B: чтение и изменение строк B из контекста A — 0 строк,
  вставка с `tenant_id` B — `42501`, запрос без контекста — ошибка, составные ссылки не дают
  сослаться на точку или юрлицо чужого тенанта (`23503`), платформа не читает тенантные таблицы.
- `tenant-database.int-spec.ts` / `platform-database.int-spec.ts` — контекст и таймауты живут
  только до конца транзакции (пул из одного соединения), откат и освобождение соединения.

Новая таблица добавляется в манифест, получает гранты по классу — и эти тесты подтверждают это
автоматически. Для append-only таблиц разрешённый набор прав в тесте каталога — `SELECT, INSERT`.

### 1. Изоляция тенантов

Запрос тенанта A не видит и не меняет данные тенанта B — ни списком, ни по id. Чужой ресурс отвечает **404** (не 403 — не раскрываем факт существования).

```typescript
// apps/api-e2e/src/catalog/tenant-isolation.spec.ts
// db, seeder, loginAs, baseUrl, TENANT_A/B, KEEP_SEED (seed tables kept by reset) — from ../support; randomUUID — node:crypto
type Agent = ReturnType<typeof request.agent>;
const productBody = (barcode: string) => ({
  name: { ru: 'Тестовый товар', tj: 'Тестовый товар' }, piecesPerPack: 1,
  isPrescription: false, isControlled: false, barcodes: [barcode],
});

describe('Tenant isolation', () => {
  let productOfB: { id: string };

  beforeEach(async () => {
    await db.reset(KEEP_SEED);
    await seeder.productWithStock(TENANT_A.id, TENANT_A.storeId, 5);
    ({ product: productOfB } = await seeder.productWithStock(TENANT_B.id, TENANT_B.storeId, 5));
  });

  it('list returns only caller tenant rows', async () => {
    const agent = await loginAs(baseUrl, TENANT_A.owner);
    const res = await agent.get('/api/v1/products').query({ limit: 100, offset: 0 }).expect(200);

    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.map((p: { id: string }) => p.id)).not.toContain(productOfB.id);
  });

  it.each([
    ['get', (a: Agent) => a.get(`/api/v1/products/${productOfB.id}`)],
    ['patch', (a: Agent) => a.patch(`/api/v1/products/${productOfB.id}`).send({ nameRu: 'hacked' })],
  ])('%s of another tenant resource returns 404', async (_name, call) => {
    const agent = await loginAs(baseUrl, TENANT_A.owner);
    await call(agent).expect(404);

    const [row] = await db.query<{ name_ru: string }>('SELECT name_ru FROM products WHERE id = $1', [productOfB.id]);
    expect(row.name_ru).not.toBe('hacked');
  });

  it('tenant id from request body/headers is ignored (tenant comes from session only)', async () => {
    const agent = await loginAs(baseUrl, TENANT_A.owner);
    const res = await agent
      .post('/api/v1/products')
      .set('x-tenant-id', TENANT_B.id)
      .send({ tenantId: TENANT_B.id, ...productBody('4600000000031') });

    // whitelist validation rejects unknown field, or it is stripped — either way no row in B
    const rows = await db.query('SELECT 1 FROM products WHERE tenant_id = $1 AND $2 = ANY(barcodes)', [TENANT_B.id, '4600000000031']);
    expect(rows).toHaveLength(0);
    expect([201, 400]).toContain(res.status);
  });
});

```

Если RLS включена вторым рубежом, добавьте прямую проверку политики на уровне БД под прикладной ролью (`appRoleDb` — `TestDb`, созданный с URL прикладной роли):

```typescript
it('RLS: app role sees only rows of app.tenant_id', async () => {
  const rows = await appRoleDb.inTransaction(async (q) => {
    await q("SELECT set_config('app.tenant_id', $1, true)", [TENANT_A.id]); // = SET LOCAL
    return q<{ tenant_id: string }>('SELECT DISTINCT tenant_id FROM products');
  });
  expect(rows.map((r) => r.tenant_id)).toEqual([TENANT_A.id]);
});
```

### 2. Идемпотентность повтора

Тот же `Idempotency-Key` → исходный результат и **ни одного дубля** (чек, движения, задачи очереди). Проверяйте последовательный повтор и гонку двух одновременных запросов. Эндпоинт — `POST /api/v1/stores/{storeId}/receipts` (`nestjs-rest-workflow.md`).

```typescript
// apps/api-e2e/src/pos/receipts-idempotency.spec.ts
const receiptsUrl = (storeId: string) => `/api/v1/stores/${storeId}/receipts`;
const sale = (batchId: string, quantity = 2) => ({
  lines: [{ batchId, quantity, unitPriceDirams: 1250 }],
  payments: [{ method: 'cash', amountDirams: 1250 * quantity }],
});

it('same key twice → original receipt, one set of movements', async () => {
  const { batch } = await seeder.productWithStock(TENANT_A.id, TENANT_A.storeId, 10);
  const agent = await loginAs(baseUrl, TENANT_A.cashier);
  const key = randomUUID();

  const first = await agent.post(receiptsUrl(TENANT_A.storeId)).set('Idempotency-Key', key).send(sale(batch.id)).expect(201);
  const second = await agent.post(receiptsUrl(TENANT_A.storeId)).set('Idempotency-Key', key).send(sale(batch.id));

  expect([200, 201]).toContain(second.status);
  expect(second.body.id).toBe(first.body.id);

  const receipts = await db.query('SELECT id FROM receipts WHERE tenant_id = $1', [TENANT_A.id]);
  const movements = await db.query(
    "SELECT quantity FROM stock_movements WHERE batch_id = $1 AND source_type = 'receipt'", [batch.id],
  );
  expect(receipts).toHaveLength(1);
  expect(movements).toEqual([{ quantity: -2 }]);
});

it('concurrent requests with the same key → exactly one receipt', async () => {
  const { batch } = await seeder.productWithStock(TENANT_A.id, TENANT_A.storeId, 10);
  const agent = await loginAs(baseUrl, TENANT_A.cashier);
  const key = randomUUID();

  const results = await Promise.all([
    agent.post(receiptsUrl(TENANT_A.storeId)).set('Idempotency-Key', key).send(sale(batch.id)),
    agent.post(receiptsUrl(TENANT_A.storeId)).set('Idempotency-Key', key).send(sale(batch.id)),
  ]);

  expect(results.every((r) => r.status < 300)).toBe(true);        // loser of the race replays, not 500
  expect(await db.query('SELECT id FROM receipts WHERE tenant_id = $1', [TENANT_A.id])).toHaveLength(1);
});

it('same key with a different body is rejected', async () => {
  const { batch } = await seeder.productWithStock(TENANT_A.id, TENANT_A.storeId, 10);
  const agent = await loginAs(baseUrl, TENANT_A.cashier);
  const key = randomUUID();

  await agent.post(receiptsUrl(TENANT_A.storeId)).set('Idempotency-Key', key).send(sale(batch.id, 2)).expect(201);
  const res = await agent.post(receiptsUrl(TENANT_A.storeId)).set('Idempotency-Key', key).send(sale(batch.id, 3));

  expect([409, 422]).toContain(res.status); // exact status/code — per nestjs-enterprise-patterns.md
});

it('missing Idempotency-Key → 400', async () => {
  const { batch } = await seeder.productWithStock(TENANT_A.id, TENANT_A.storeId, 10);
  const agent = await loginAs(baseUrl, TENANT_A.cashier);
  await agent.post(receiptsUrl(TENANT_A.storeId)).send(sale(batch.id)).expect(400);
});
```

Тот же принцип — для синхронизации офлайн-точек: повторная досылка пачки с теми же `operationId` не создаёт дублей (`nestjs-messaging-basics.md`).

### 3. Атомарность: чек + движения партий

Чек, его движения и запись аудита — одна транзакция. Ошибка на любой строке → нет ни чека, ни движений, ни задачи фискализации; остаток (сумма движений) не изменился. Сбой вызывается через данные — вторая строка превышает остаток.

```typescript
// apps/api-e2e/src/pos/receipts-atomicity.spec.ts
const stockOf = async (batchId: string) => {
  const [row] = await db.query<{ qty: string }>(
    'SELECT COALESCE(SUM(quantity), 0) AS qty FROM stock_movements WHERE batch_id = $1', [batchId],
  );
  return Number(row.qty);
};

it('rolls back receipt, movements and outbox when one line fails', async () => {
  const { batch: ok } = await seeder.productWithStock(TENANT_A.id, TENANT_A.storeId, 10);
  const { batch: short } = await seeder.productWithStock(TENANT_A.id, TENANT_A.storeId, 1);
  const agent = await loginAs(baseUrl, TENANT_A.cashier);

  const res = await agent.post(receiptsUrl(TENANT_A.storeId))
    .set('Idempotency-Key', randomUUID())
    .send({
      lines: [
        { batchId: ok.id, quantity: 2, unitPriceDirams: 1000 },
        { batchId: short.id, quantity: 5, unitPriceDirams: 1000 }, // insufficient stock
      ],
      payments: [{ method: 'cash', amountDirams: 7000 }],
    });

  expect(res.status).toBe(422);
  expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
  expect(res.body.code).toBe('INSUFFICIENT_STOCK');
  expect(await db.query('SELECT 1 FROM receipts WHERE tenant_id = $1', [TENANT_A.id])).toHaveLength(0);
  expect(await stockOf(ok.id)).toBe(10);
  expect(await stockOf(short.id)).toBe(1);
  expect(await db.query("SELECT 1 FROM job_queue WHERE queue = 'fiscal.send'")).toHaveLength(0);
});

it('concurrent sales cannot oversell one batch', async () => {
  const { batch } = await seeder.productWithStock(TENANT_A.id, TENANT_A.storeId, 3);
  const agent = await loginAs(baseUrl, TENANT_A.cashier);

  await Promise.all([1, 2].map(() =>
    agent.post(receiptsUrl(TENANT_A.storeId)).set('Idempotency-Key', randomUUID()).send(sale(batch.id, 2))));

  expect(await stockOf(batch.id)).toBe(1);        // exactly one sale succeeded; never negative
});
```

Аналогично — складские документы (приход, перемещение, списание, инвентаризация): проведение документа и его движения атомарны.

### 4. Деньги — integer в дирамах

```typescript
it('all money fields in the response are integers (dirams)', async () => {
  const { batch } = await seeder.productWithStock(TENANT_A.id, TENANT_A.storeId, 10);
  const agent = await loginAs(baseUrl, TENANT_A.cashier);

  const res = await agent.post(receiptsUrl(TENANT_A.storeId))
    .set('Idempotency-Key', randomUUID())
    .send({ lines: [{ batchId: batch.id, quantity: 3, unitPriceDirams: 333 }], payments: [{ method: 'cash', amountDirams: 999 }] })
    .expect(201);

  const moneyFields = Object.entries(res.body).filter(([k]) => k.endsWith('Dirams'));
  expect(moneyFields.length).toBeGreaterThan(0);
  for (const [, v] of moneyFields) expect(Number.isInteger(v)).toBe(true);
});

it('rejects fractional amounts with 400', async () => {
  const { batch } = await seeder.productWithStock(TENANT_A.id, TENANT_A.storeId, 10);
  const agent = await loginAs(baseUrl, TENANT_A.cashier);
  await agent.post(receiptsUrl(TENANT_A.storeId))
    .set('Idempotency-Key', randomUUID())
    .send({ lines: [{ batchId: batch.id, quantity: 1, unitPriceDirams: 12.5 }], payments: [{ method: 'cash', amountDirams: 13 }] })
    .expect(400);
});
```

Правило округления себестоимости штуки при делении упаковки (вверх) — unit-тест `libs/shared/util` (`nestjs-testing-unit-basics.md`) плюс e2e прихода в модуле purchasing.

## Аутентификация и права

Самописная аутентификация: логин+пароль → серверная сессия в Redis; PIN — переключение кассира на привязанном терминале. Права — «модуль × действие × охват точек» (`nestjs-security-auth.md`).

```typescript
describe('Auth & permissions', () => {
  it('401 without session', () => request(baseUrl).get('/api/v1/products').expect(401));

  it('403 when role lacks the module action', async () => {
    const agent = await loginAs(baseUrl, TENANT_A.cashier);            // no catalog:create
    await agent.post('/api/v1/products').send(productBody('4600000000048')).expect(403);
  });

  it('403 when store is outside the employee store scope', async () => {
    const { batch } = await seeder.productWithStock(TENANT_A.id, TENANT_A.store2Id, 5);
    const agent = await loginAs(baseUrl, TENANT_A.cashierOfStore1);
    await agent.post(receiptsUrl(TENANT_A.store2Id)).set('Idempotency-Key', randomUUID()).send(sale(batch.id)).expect(403);
  });

  it('404 for a store of another tenant', async () => {
    const agent = await loginAs(baseUrl, TENANT_A.owner);               // storeScope 'all' within tenant A
    const res = await agent.post(receiptsUrl(TENANT_B.storeId)).set('Idempotency-Key', randomUUID())
      .send(sale('00000000-0000-4000-8000-000000000999'));
    expect(res.status).toBe(404);
  });

  it.todo('controlled substance (ПКУ): no permission → 403; missing prescription fields → 400; journal row appended');
});
```

## Валидация

```typescript
it('rejects unknown fields (whitelist + forbidNonWhitelisted)', async () => {
  const agent = await loginAs(baseUrl, TENANT_A.owner);
  const res = await agent.post('/api/v1/products').send({ ...productBody('4600000000055'), isAdmin: true }).expect(400);
  expect(res.body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
});
```

## Пагинация limit/offset

```typescript
it('paginates with limit/offset', async () => {
  for (let i = 0; i < 25; i++) await seeder.productWithStock(TENANT_A.id, TENANT_A.storeId, 1);
  const agent = await loginAs(baseUrl, TENANT_A.owner);

  const res = await agent.get('/api/v1/products').query({ limit: 10, offset: 20 }).expect(200);

  expect(res.body.items).toHaveLength(5);
  expect(res.body).toMatchObject({ total: 25, limit: 10, offset: 20 });
});
```

## Запуск

```bash
npx nx run api:integration                       # data layer + catalog + isolation (needs npm run dev:deps)
npx nx e2e api-e2e                               # все e2e (поднимает api через dependsOn)
npx nx e2e api-e2e --testFile=receipts-atomicity.spec.ts
npx nx e2e api-e2e --testNamePattern="Tenant isolation"
```

---

**Главное:**
1. e2e — чёрный ящик: supertest против запущенного api + реальная PostgreSQL; `apps/api-e2e` не импортирует `apps/api`.
2. Обязательные кейсы: изоляция тенантов (404 на чужое), идемпотентность (повтор и гонка), атомарность чек+движения (откат, отсутствие перепродажи партии), деньги integer.
3. Состояние проверяйте в БД, а не только в ответе API; остаток — сумма движений.
4. Ошибки — `application/problem+json` (RFC 7807) с `code` и `correlationId`.
5. Прикладная роль БД в тестах — не суперпользователь, иначе RLS не проверяется.
