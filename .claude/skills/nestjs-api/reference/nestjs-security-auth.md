# NestJS Security — аутентификация и авторизация Pharmacy

Аутентификация **самописная** (ADR-0008, accepted): логин + пароль, PIN на привязанном
терминале, **cookie-сессии** (облако — Redis, офлайн-точка — PostgreSQL). Авторизация — RBAC с
динамическими ролями тенанта и закрытым каталогом прав `модуль:действие` (ADR-0018).
Кросс-тенантный доступ оператора — отдельный путь (ADR-0013). JWT, OAuth/SSO, Passport — не
стандарт проекта.

Самописной криптографии нет: только примитивы `node:crypto` (`scrypt`, `randomBytes`,
`createHash('sha256')`, `createHmac`, `timingSafeEqual`). Пароль, PIN, токены сессий и терминала,
handoff-код, pepper, лицензионный ключ — никогда в логах, аудите, ответах об ошибках, URL.

## Модель (миграция `org-foundation`, модель данных `01-platform-org.md`)

| Таблица | Ключевые поля |
|---|---|
| `employees` | `(tenant_id, id)`, `login` (уникален в тенанте без учёта регистра), `employee_code`, `role_id`, `store_scope` `all`/`list`, `status` `active`/`blocked`/`archived`, `permissions_version` |
| `employee_credentials` | `password_hash` (PHC), `password_pepper_version`, `pin_hash`, `pin_failed_attempts`, `pin_locked_at`, одноразовый код первого входа. **Не синхронизируется**: на офлайн-точке учётные данные свои |
| `roles`, `role_permissions` | роль тенанта (`name jsonb`, `is_owner` — системная роль «Владелец», одна на тенанта), права — строки каталога |
| `employee_stores` | охват при `store_scope = 'list'` |
| `terminals` | `store_id`, `credential_hash`, `bound_by`, `bound_at`, `last_seen_at`, `revoked_at` |
| `operators`, `impersonations`, `license_keys` | платформа (ADR-0013) — в миграции модуля платформы |

## Пароли и PIN

```typescript
// apps/api/src/app/auth/password-hasher.port.ts
export interface PasswordHasher {
  hash(secret: string): Promise<string>;                        // PHC string + pepper version
  verify(secret: string, stored: StoredHash): Promise<boolean>; // timingSafeEqual inside
  needsRehash(stored: StoredHash): boolean;                     // params, algorithm or pepper changed
}
export interface StoredHash { phc: string; pepperVersion: number }
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
```

Реализация `NodeScryptPasswordHasher` (ADR-0008):
- `crypto.scrypt`, параметры **`N=2^15, r=8, p=3`**, `keylen = 32`, соль — 16 случайных байт,
  `maxmem` задан явно (≥ `128·N·r·2`);
- pepper: перед scrypt — `HMAC-SHA-256(pepper, secret)`; pepper 256 бит, свой на облако и на
  каждую офлайн-точку, с версией для ротации; бэкап — отдельно от бэкапов БД;
- формат: `$scrypt$ln=15,r=8,p=3$<salt>$<hash>` + `password_pepper_version`;
- `needsRehash` → перехеширование при следующем успешном входе (так же — будущий переход на
  Argon2id после отказа от Node 22, без массового сброса);
- самопроверка на старте API: тест-вектор scrypt из RFC 7914 и наличие `crypto.scrypt` /
  `timingSafeEqual`, иначе процесс не стартует.

Правила:
- неизвестный логин и неверный пароль неразличимы — ни по ответу, ни по времени (при
  отсутствии логина — проверка фиктивного хеша);
- верхний предел длины пароля — в DTO (защита от DoS дорогим хешем);
- PIN — ≥ 4 цифр (по умолчанию 4, сеть может повысить — `tenant_settings.pin_min_length`);
  тривиальные PIN (`1111`, `1234`, `0000`…) запрещены; PIN — не идентификатор: сначала выбор
  кассира, потом PIN.

## Сессии

```typescript
// apps/api/src/app/auth/session.store.ts — port; RedisSessionStore (cloud) and PgSessionStore (offline store)
export interface SessionData {
  tenantId: string;
  employeeId: string;
  storeId?: string;                       // working store chosen at login; must be in the scope
  storeScope: 'all' | string[];
  terminalId?: string;                    // PIN session: scope = the terminal's store only
  authMethod: 'password' | 'pin' | 'impersonation';
  authenticatedAt: number;                // step-up: sensitive actions need a fresh password session
  impersonationId?: string;
  actingOperatorId?: string;
  permissions: string[];                  // snapshot of the role's permissions
  permissionsVersion: number;             // compared with Redis on every request (ADR-0018 p. 7)
  absoluteExpiresAt: number;
}

export interface SessionStore {
  create(data: SessionData, idleTtlSeconds: number): Promise<string>; // returns the raw token once
  touch(token: string, idleTtlSeconds: number): Promise<SessionData | null>;
  destroy(token: string): Promise<void>;
  destroyAllFor(tenantId: string, employeeId: string): Promise<void>;
}
```

```typescript
// RedisSessionStore (fragment) — node-redis 6, the project's only Redis client
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const sessionKey = (token: string) => `sess:${sha256(token)}`;        // the raw token is never stored
const indexKey = (tenantId: string, employeeId: string) => `sess-idx:${tenantId}:${employeeId}`;

async create(data: SessionData, idleTtlSeconds: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await this.redis
    .multi()
    .set(sessionKey(token), JSON.stringify(data), { EX: idleTtlSeconds })
    .sAdd(indexKey(data.tenantId, data.employeeId), sha256(token))
    .exec();
  return token;
}
```

- **Транспорт (облако):** cookie `__Host-sid` (`Secure; HttpOnly; SameSite=Strict; Path=/`) на
  origin `apps/web`; оператор — `__Host-op_sid` на origin `apps/admin`. Tenant-cookie принимается
  только с origin web, operator-cookie — только с origin admin. CORS выключен. Токен только из
  cookie, не из заголовков и тела.
- **Транспорт (офлайн-точка):** `http://localhost`, cookie `sid` / `term` с `Secure; HttpOnly;
  SameSite=Strict` без префикса `__Host-`.
- **Жизнь:** idle-TTL = таймаут сети тенанта, зажатый в `[SESSION_IDLE_TIMEOUT_MIN, MAX]`;
  абсолютный срок; новый токен при входе, PIN-переключении и смене привилегий; смена пароля
  или блокировка сотрудника — `destroyAllFor`.
- **Офлайн-точка:** `PgSessionStore` — таблица `sessions` (ключ — SHA-256 токена), читается
  резолвером `resolve_session` (ADR-0013); throttler — in-memory.
- В сессии нет пароля, PIN и ПДн — только идентификаторы и снимок прав.

## CSRF

Для небезопасных методов (`POST/PUT/PATCH/DELETE`) глобальный guard проверяет:
1. `Sec-Fetch-Site`, если заголовок есть, — только `same-origin`;
2. иначе `Origin` обязан совпасть с разрешённым origin продукта (web для `__Host-sid`, admin для
   `__Host-op_sid`);
3. тело — только `application/json` (формы и «простые» запросы отклоняются).

`GET` — без побочных эффектов.

## Вход по логину и паролю

```typescript
// apps/api/src/app/auth/sessions.controller.ts (fragment)
@Public()
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Post('sessions')                                   // POST /api/v1/sessions
async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): Promise<SessionResponseDto> {
  const { token, session } = await this.auth.loginWithPassword(dto); // tenantCode + login + password
  res.cookie(this.cookies.sessionName, token, this.cookies.sessionOptions); // __Host-sid, Path=/
  return toSessionResponse(session); // profile + permissions for the UI; no token in the body
}
```

- Тенант по коду сети определяет резолвер `resolve_tenant_by_code` (SECURITY DEFINER, ADR-0013):
  до входа контекста тенанта ещё нет.
- Лимиты: `@nestjs/throttler` по IP и маршруту (своё `ThrottlerStorage` на node-redis) + счётчик
  по `(tenantCode, login)` с прогрессивной блокировкой. Все входы, неудачи, блокировки — в аудит
  без секретов.

## Терминал и PIN

1. **Привязка.** Сотрудник с правом `terminals:create` входит паролем на этом ПК →
   `POST /api/v1/terminals` (точка из его охвата, имя) → `terminals` с `credential_hash`
   (SHA-256 от `randomBytes(32)`), device-cookie `__Host-term`, аудит. Отзыв — `revoked_at`,
   действует немедленно (статус кэшируется в Redis с инвалидацией).
2. **PIN-переключение.** `POST /api/v1/terminal-sessions` `{ employeeId | employeeCode, pin }` +
   device-cookie. Проверки: терминал не отозван (резолвер `resolve_terminal`), сотрудник активен
   и имеет доступ к точке терминала, PIN не заблокирован, PIN верен. Предыдущая PIN-сессия
   терминала уничтожается; новая — с `terminalId`, охват = только точка терминала.
3. **Лимиты.** По `(tenant, employee, terminal)`: **после 3 неудач** PIN сотрудника блокируется
   (вход только паролем, разблокировка — заведующим или успешным входом с заменой PIN) + аудит.
   По терминалу: `TERMINAL_PIN_MAX_FAILURES` (10) неудач по разным кассирам за 15 мин — PIN-вход
   на терминале закрыт на 15 мин + уведомление заведующему.
4. **Step-up.** Привязка и отвязка терминала, управление сотрудниками и ролями, смена своего
   пароля — только в сессии, открытой паролем, не старше `STEP_UP_MAX_AGE`.

## От имени

Оператор с правом `platform:impersonate` и свежим step-up в админке →
`POST /api/v1/operator/impersonations` `{ tenantId, reason }` → запись `impersonations` +
одноразовый handoff-код (TTL ≤ 60 с, однократный, в Redis только хеш) → админка делает
top-level `POST` формы на origin web (код — в теле, **не в URL**) → tenant-сессия с
`authMethod: 'impersonation'`, `actingOperatorId`, `impersonationId`:
- абсолютный TTL 60 мин без продления;
- **только просмотр**: guard на уровне сессии отклоняет `POST/PUT/PATCH/DELETE` к прикладным
  ресурсам независимо от набора прав;
- постоянный баннер в UI; начало, конец и просмотры чувствительных разделов — в `audit_log`
  тенанта с `acting_operator_id` и `impersonation_id`;
- отзыв сессии оператора каскадно гасит его impersonation-сессии.

Иначе данные тенанта оператору недоступны: `PlatformDatabase` не имеет прав на тенантные таблицы.

## Авторизация

**Каталог прав** — закрытый список строк `<модуль>:<действие>` в `libs/shared/domain`
(общий для api, web, admin; ADR-0018):
- модули: `pos`, `shifts`, `returns`, `inventory`, `purchasing`, `catalog`, `pricing`,
  `discounts`, `reports`, `export-1c`, `employees`, `roles`, `terminals`, `stores`, `services`,
  `billing`, `audit`, `settings`, `sync`;
- действия: `view`, `create`, `update`, `post`, `unpost`, `delete`, `receive`, `export`;
- спецправа: `pos:sell-controlled`, `returns:without-receipt`, `pos:choose-batch`,
  `pricing:update-store`, `pricing:update-network`, `discounts:manage-store`,
  `discounts:manage-network`, `finance:view-cost`, `roles:manage`, `employees:assign-role`,
  `sync:run`.

Новое право — изменение каталога в коде и миграция шаблонов ролей; права на новые
возможности у существующих ролей сами не появляются (кроме роли «Владелец» — у неё всегда все).

```typescript
// apps/api/src/app/auth/decorators.ts
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface StoreScopeOptions { storeParam?: string; storeQuery?: string; storeBody?: string }
export const PERMISSION = 'permission';
export const RequirePermission = (permission: Permission, scope?: StoreScopeOptions) =>
  SetMetadata(PERMISSION, { permission, scope }); // Permission — union type from @pharmacy/shared-domain
```

```typescript
// apps/api/src/app/auth/guards/permissions.guard.ts (fragment)
canActivate(ctx: ExecutionContext): boolean {
  if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
  const req = this.reflector.getAllAndOverride<{ permission: Permission; scope?: StoreScopeOptions }>(
    PERMISSION, [ctx.getHandler(), ctx.getClass()]);
  if (!req) throw new ForbiddenException();             // deny by default: no declared permission
  const session = this.sessions.current();               // permissions snapshot, version checked
  if (!session.permissions.includes(req.permission)) throw this.denied(req.permission);
  const storeId = storeIdFrom(ctx, req.scope);
  if (req.scope && !storeId) throw this.denied(req.permission);
  if (storeId && session.storeScope !== 'all' && !session.storeScope.includes(storeId)) {
    throw this.denied(req.permission, storeId);          // 403 + audit event "access.denied"
  }
  return true;
}
```

- **Сервер — источник истины;** права в профиле сессии (`GET /api/v1/sessions/current`) фронтенд
  использует только чтобы скрывать и отключать элементы UI.
- **Охват точек:** точка запроса (путь, тело, сессия) должна входить в охват сотрудника. Точка
  чужого тенанта — «не найдено» (404, tenant-scoped запрос и RLS), а не 403.
- **Запрет эскалации** (для `roles:manage` и `employees:assign-role`): права создаваемой или
  изменяемой роли ⊆ прав того, кто меняет; охват назначения ⊆ его охвата; менять собственные
  роль и охват нельзя; роль «Владелец» назначает только владелец; в сети всегда ≥ 1 активный
  владелец.
- **`permissions_version`:** растёт при изменении роли, её прав, охвата или блокировке
  сотрудника. Каждый запрос сверяет версию в сессии с Redis (на офлайн-точке — с PostgreSQL) и
  при расхождении перечитывает права; блокировка уничтожает сессии. На офлайн-точке изменения
  вступают в силу после синхронизации (ADR-0014).
- **Видимость полей:** без `finance:view-cost` сервер не отдаёт закупочную цену, себестоимость
  и маржу — поля отсутствуют в response-DTO (отдельный DTO или маппинг по правам), а не
  скрываются на клиенте.
- **Правила режима поверх ролей** (роль не может их переопределить): склад офлайн-точки из
  облака — только чтение; сессия «от имени» — только просмотр; права оператора — отдельный
  контур.
- Аудит: изменения ролей, прав, назначений и охвата, отказы `403` (право и точка) — отдельные
  события `audit_log` без секретов.

## Синхронизация офлайн-точек — лицензионный ключ (ADR-0014 §6–7)

- `Authorization: Bearer phk_<keyId>_<secret>`; ключ — `randomBytes(32)` base64url. В облаке —
  `key_id` + SHA-256 секрета (`license_keys`), сравнение `timingSafeEqual`.
- `LicenseKeyGuard` (сессионный guard для маршрутов sync — `@Public()`) находит ключ резолвером
  `resolve_license_key(key_hash)` (SECURITY DEFINER, ADR-0013) и кладёт `tenantId`/`storeId`
  точки в контекст; `storeId` в теле, если есть, обязан совпасть.
- Статусы лицензии: `active`, `expiring` (≤ N дней до срока), `expired`, `revoked`,
  `revoked-hard`, «точка закрыта», «тенант заблокирован» — в каждом ответе sync
  (`Pharmacy-License-Status`). При `revoked`/`expired` облако ещё льготный период (30 дней)
  принимает операции точки; `revoked-hard` — `401` `code: license-revoked`.
- Ключ на точке — в env-файле развёртывания; в логах, аудите и ошибках — никогда. Лимиты — по
  `keyId` и по IP для неудачных попыток.

## Оператор платформы (apps/admin)

Сессии `__Host-op_sid` с отдельным префиксом ключей, `OperatorSessionGuard` и
`@RequireOperatorPermission`; контроллеры — только `/api/v1/operator/*` в `app/platform/**`, доступ
к данным — `PlatformDatabase.platformTransaction({ kind: 'operator', operatorId }, …)`
(`nestjs-config-data-access.md`). Tenant-сессия там не принимается.

## Запрещено

- JWT/OAuth/SSO-провайдеры как замена серверным сессиям без ADR.
- Хранение пароля, PIN или токена в открытом виде, в логах, аудите, кэше.
- `tenantId`, охват точек или права, пришедшие от клиента, как источник истины.
- Маршрут без `@RequirePermission` и без `@Public()`; право не из каталога.
- Собственные реализации хеширования или шифрования; хеш паролей — только scrypt из `node:crypto`.
