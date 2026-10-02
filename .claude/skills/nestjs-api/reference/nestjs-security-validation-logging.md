# NestJS Security — валидация входа, маскирование ПДн, безопасный SQL

Закон — РТ (не GDPR). Персональные данные в системе: сотрудники, поставщики (контактные
лица), поля рецептов ПКУ (пациент, врач, номер рецепта). Они не попадают в логи, тела ошибок
и во внешние системы (включая внешние LLM/SaaS).

## 1. Валидация DTO

Глобальный `ValidationPipe` (`nestjs-templates-core.md`): `whitelist`, `forbidNonWhitelisted`,
`transform`, `forbidUnknownValues`, `validationError: { target: false, value: false }`.

Правила для DTO в `libs/shared/dto`:
- у каждой строки — `@MaxLength`, у каждого массива — `@ArrayMaxSize`, у вложенных —
  `@ValidateNested` + `@Type`;
- деньги и количества — `@IsInt()` + `@Min()`; никаких `@IsNumber()` для сумм (пропустит `12.5`);
- идентификаторы — `@IsUUID()`; даты без времени — `@Matches(/^\d{4}-\d{2}-\d{2}$/)` + проверка в сервисе;
- перечисления — `@IsIn([...])` по константам из `libs/shared/domain`;
- **нет полей** `tenantId`, `employeeId`, `createdBy`, `permissions` — это сервер берёт из сессии.

```typescript
// libs/shared/dto/src/pos/controlled-substance-prescription.dto.ts
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/** Mandatory prescription fields for a controlled substance (ПКУ) line — personal data */
export class ControlledSubstancePrescriptionDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  prescriptionNumber!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  issuedOn!: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  patientFullName!: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  doctorFullName!: string;
}
```

Санитайзеры HTML (DOMPurify и т.п.) на входе api не нужны: api хранит данные как есть и
отдаёт JSON; экранирование — задача рендера во фронтенде (React экранирует по умолчанию).

## 2. Маскирование ПДн и секретов в логах

Логгер — встроенный `Logger` Nest (библиотека логирования пока не выбрана — pino/winston только через ADR). Маскирование —
до передачи объекта в логгер.

```typescript
// apps/api/src/common/logging/mask.ts
const SECRET_KEYS = /pass(word)?|pin|token|secret|sid|session|license|authorization|cookie/i;
const PII_KEYS = /fullname|firstname|lastname|patient|doctor|phone|email|address|passport|prescription|inn_personal|taxid/i;

export function mask(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => mask(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEYS.test(k) ? '***' : PII_KEYS.test(k) ? maskPii(v) : mask(v, depth + 1),
      ]),
    );
  }
  return value;
}

function maskPii(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0) return '***';
  return `${v[0]}***`; // keep the first letter for support, nothing else
}
```

```typescript
this.logger.warn({ msg: 'controlled substance sale rejected', correlationId, receipt: mask(dto) });
```

Правила:
- Тела запросов/ответов целиком не логируем. Логируем идентификаторы (`receiptId`,
  `storeId`, `employeeId`), `code` ошибки, `correlationId`.
- `tenantId` и `employeeId` — не ПДн сами по себе, их логировать можно и нужно.
- Список ключей `PII_KEYS` поддерживается вместе с DTO: новое поле с ПДн → ключ в маске и тест.
- Журнал ПКУ и аудит хранят данные рецепта в БД (так требует учёт), но не в логах приложения.

## 3. Безопасный SQL

```typescript
// BAD: input inlined into SQL -> injection and tenant leak
await sql`select * from receipts where number = ${sql.raw(`'${number}'`)}`.execute(trx);

// GOOD: Kysely builder (values are always parameters) + explicit tenant filter
await trx.selectFrom('receipts').select(['id', 'number', 'totalDirams'])
  .where('tenantId', '=', tenantId).where('number', '=', number).executeTakeFirst();

// GOOD: raw SQL only through the sql tag — ${value} becomes a parameter
await sql`select id from receipts where tenant_id = ${tenantId} and number = ${number}`.execute(trx);
```

- Всё, что пришло от клиента, — только параметрами (builder или `${…}` в теге `sql`);
  `sql.raw`/`sql.lit` со входными данными запрещены (ADR-0006 п. 6).
- Идентификаторы SQL (колонки сортировки, направления) — только из фиксированного словаря
  (`nestjs-rest-dto-pagination.md`).
- `LIKE`-шаблоны — экранировать `%`, `_`, `\` во входе.

## 4. Шифрование полей

Прикладное шифрование отдельных полей БД — **не делаем без ADR** (самописная криптография
запрещена — только примитивы `node:crypto` и проверенные алгоритмы; хеш паролей и PIN — scrypt,
ADR-0008). Защита
данных на MVP — изоляция тенантов, права, TLS, доступ к БД только у api.

## 5. OWASP Top 10 — что это значит здесь

- [ ] **A01 Broken Access Control** — глобальные `SessionAuthGuard` + `PermissionsGuard`, охват точек, `tenant_id` в каждом запросе, RLS; чужой ресурс → 404.
- [ ] **A02 Cryptographic Failures** — только хеширование паролей/PIN из accepted ADR (ADR-0008), HTTPS везде, токены сессий хранятся хешем.
- [ ] **A03 Injection** — параметризованный SQL, whitelist сортировок, DTO с whitelist.
- [ ] **A04 Insecure Design** — инварианты: остатки из движений, append-only аудит, идемпотентность финопераций.
- [ ] **A05 Misconfiguration** — helmet, явный CORS, Swagger выключен в проде, fail-fast конфиг.
- [ ] **A06 Vulnerable Components** — `npm audit` перед MR, только технологии из stack.md и accepted ADR.
- [ ] **A07 Auth Failures** — блокировки после неудач (пароль и PIN), idle-таймаут сети тенанта, отзыв всех сессий при смене пароля.
- [ ] **A08 Integrity Failures** — лицензионный ключ точки, идемпотентная очередь синхронизации, миграции только версионированные.
- [ ] **A09 Logging Failures** — аудит всех входов и значимых действий; ПДн и секреты замаскированы; correlation ID везде.
- [ ] **A10 SSRF** — исходящие вызовы только на адреса закрытого списка из конфига; URL из входных данных не запрашиваются.
