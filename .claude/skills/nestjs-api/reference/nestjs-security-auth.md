# NestJS Security — аутентификация и авторизация Pharmacy

Аутентификация **самописная** (ADR-0008, accepted; поправка 2026-10-02): логин + пароль, PIN на
привязанном терминале. Транспорт сессии — **JWT через `@nestjs/jwt` в HttpOnly-cookie** (токен
несёт только идентификаторы), а источник истины — **серверная сессия** (облако — Redis,
офлайн-точка — PostgreSQL): токен без записи сессии недействителен. Авторизация — RBAC с
динамическими ролями тенанта и закрытым каталогом прав `модуль:действие` (ADR-0018).
Кросс-тенантный доступ оператора — отдельный путь (ADR-0013). OAuth/SSO и Passport — не стандарт
проекта; JWT без серверной сессии (stateless) — тоже.

Самописной криптографии нет: подпись и проверку JWT делает `@nestjs/jwt` (jsonwebtoken), хеши и
случайные значения — примитивы `node:crypto` (`scrypt`, `randomBytes`, `createHash('sha256')`,
`createHmac`, `timingSafeEqual`). Пароль, PIN, JWT и ключи подписи, handoff-код, pepper,
лицензионный ключ — никогда в логах, аудите, ответах об ошибках, URL.

## Модель (миграция `org-foundation`, модель данных `01-platform-org.md`)

| Таблица | Ключевые поля |
|---|---|
| `employees` | `(tenant_id, id)`, `login`, `phone` (E.164), `email` — каждый **глобально уникален** (`lower(login)`, `lower(email)`), чтобы вход шёл без кода сети; `last_login_at`, `employee_code`, `role_id`, `store_scope` `all`/`list`, `status` `active`/`blocked`/`archived`, `permissions_version` |
| `employee_credentials` | `password_hash` (PHC), `password_pepper_version`, `pin_hash`, `pin_failed_attempts`, `pin_locked_at`, одноразовый код первого входа. **Не синхронизируется**: на офлайн-точке учётные данные свои |
| `roles`, `role_permissions` | роль тенанта (`name jsonb`, `is_owner` — системная роль «Владелец», одна на тенанта), права — строки каталога |
| `employee_stores` | охват при `store_scope = 'list'` |
| `terminals` | `store_id`, `credential_hash`, `bound_by`, `bound_at`, `last_seen_at`, `revoked_at` |
| `operators`, `operator_credentials`, `license_keys` | платформа (ADR-0013) — в миграции модуля платформы (часть 3 проекта аутентификации) |

## Пароли и PIN

`PasswordHasher` (`apps/api/src/core/crypto`, глобальный `CryptoModule`) — единственный путь
хеширования пароля и PIN: `hash(secret)` → PHC-строка + версия pepper, `verify`
(`timingSafeEqual` внутри), `verifyDummy` (проверка фиктивного хеша той же стоимости),
`needsRehash` (параметры, алгоритм или pepper изменились).

Параметры (ADR-0008):
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

## Токен и серверная сессия

**Токен** — JWT, подписанный `SessionTokenService` (`core/crypto`, обёртка над `JwtService` из
`@nestjs/jwt`): `HS256`, заголовок `kid`, ключи — кольцо `SESSION_JWT_KEYS` /
`SESSION_JWT_ACTIVE_KID` (≥ 32 байт, ротация без разлогина); поля `jti` (id сессии), `sub`
(сотрудник), `tid` (сеть), `aud` (`web`), `iss`, `exp`. Алгоритм, издатель и аудитория
зафиксированы при проверке; `alg: none`, чужой `kid`, чужой `aud`, изменённый `tid`/payload —
отказ. Права и ПДн в токен не кладутся.

**Сессия** — запись на сервере по `jti` (`SessionStore`, порт: `RedisSessionStore` в облаке,
`PgSessionStore` на офлайн-точке — часть 4): снимок прав, охват точек, рабочая точка,
`permissionsVersion`, `idleTtlSeconds`, `absoluteExpiresAt`. `lookup(jti, tid, sub)` отдаёт запись
и текущую версию прав (`PermissionsVersionCache`, ключ `pv:<tid>:<eid>`) одним запросом; запись
чужой пары `(tid, sub)` считается отсутствующей. `DELETE /sessions/current` уничтожает запись —
тот же JWT после этого недействителен, хотя подпись и срок в порядке.

- **Транспорт (облако):** cookie `__Host-sid` (`Secure; HttpOnly; SameSite=Strict; Path=/`) на
  origin `apps/web`; оператор — `__Host-op_sid` на origin `apps/admin` (часть 3). Токен только из
  cookie (`TokenExtractor` → `CookieTokenExtractor`, `req.cookies` заполняет `cookie-parser` из
  `main.ts`), не из тела и query; заголовок Bearer для мобильного клиента — только после своего
  ADR. CORS выключен.
- **e2e:** `AUTH_TEST_COOKIES=true` даёт cookie `sid` без `Secure` — процесс с этим флагом не
  стартует при `APP_ENV` не `test`.
- **Офлайн-точка (`STORE_MODE=offline`, часть 4):** `http://localhost`, cookie `sid` / `term`
  (`Secure; HttpOnly; SameSite=Strict`, без префикса `__Host-`; имена — `cookieEnvFrom(config)`).
  Redis-клиента нет (`REDIS_CLIENT === null`): `SessionsModule` отдаёт `PgSessionStore` и
  `PgPermissionsVersionCache` (таблица `sessions`, класс `tenant`, `withTenant(OFFLINE_TENANT_ID)`;
  версия прав и отзыв терминала читаются тем же запросом; просроченные строки не принимаются и
  удаляются при `create`), лимиты — `MemoryLoginLimiter` вместо `RedisLoginLimiter` (обнуляются при
  перезапуске), throttler — в памяти. Точка обслуживает одну сеть: токен с другим `tid` — гость.
  Модули оператора не регистрируются (`ConditionalModule.registerWhen`), `/operator/*` → 404.
  Ключи точки — `scripts/generate-store-secrets.mjs --env-file <путь>`.
- **Жизнь:** idle-TTL = таймаут сети тенанта, зажатый в `[SESSION_IDLE_TIMEOUT_MIN_SECONDS,
  SESSION_IDLE_TIMEOUT_MAX_SECONDS]`, продлевается не чаще раза в 60 с; абсолютный срок
  `SESSION_ABSOLUTE_TTL_SECONDS`; новый токен при входе, PIN-переключении и смене пароля; смена
  пароля или блокировка сотрудника — `destroyAllFor`.
- В записи сессии нет пароля, PIN и ПДн — только идентификаторы и снимок прав.

## Контекст запроса: middleware строит, guard'ы только решают

`CorrelationIdMiddleware` → `SessionMiddleware` подключены в `AppModule.configure()` на все
маршруты. `SessionMiddleware` (`common/middleware`):
1. достаёт токен (`TokenExtractor`) и проверяет JWT (`SessionTokenService.verify`);
2. читает запись сессии и версию прав (`SessionStore.lookup`);
3. при расхождении версии перечитывает права, охват и статус (`PrincipalLoader.reload`):
   сотрудник не `active` — `destroyAllFor` и гость; иначе обновляет снимок;
4. продлевает бездействие и **один раз** собирает `RequestContext` (`runWithContext`: копия,
   рекурсивно `Object.freeze`) с `correlationId`, `tenantId` и принципалом (`EmployeePrincipal`)
   или `null` — гостем. Любой сбой разбора — гость (fail closed), без токенов в логах.

Дальше запрос идёт внутри этого контекста: `getPrincipal()` / `requirePrincipal()` /
`requireTenantId()` читают его из `AsyncLocalStorage`; контекст неизменяем, `TenantDatabase`
берёт тенанта только оттуда. **Guard'ы контекст не строят и не меняют — только решают** (пропустить
или бросить `ProblemException`). На маршрутах `/api/v1/operator/*` middleware строит `OperatorPrincipal`
(раздел «Оператор платформы»); `getPrincipal()`/`requirePrincipal()` возвращают только сотрудника,
оператора — `getOperator()`/`requireOperator()`.

**Порядок глобальных guard'ов** (`APP_GUARD` в `AppModule`, порядок регистрации важен):

| # | Guard | Решение |
|---|---|---|
| 1 | `AuthGuard` | нет принципала → `401 unauthenticated`, кроме `@Public()` |
| 2 | `CsrfGuard` | небезопасный метод: чужой `Sec-Fetch-Site`/`Origin`, не JSON → `403 csrf_rejected` (в том числе у `@Public()`) |
| 3 | `PrincipalThrottlerGuard` | лимит по сотруднику, для гостя — по IP → `429 too_many_requests` (хранилище — Redis, `RedisThrottlerStorage`) |
| 4 | `PermissionsGuard` | нет права или точки в охвате → `403 forbidden` + аудит `access.denied`; маршрут без маркера → запрет |
| 5 | `FreshAuthGuard` | `@RequireFreshAuth()`: сессия открыта паролем давно → `403 fresh_auth_required` |

Throttler стоит после `AuthGuard` и `CsrfGuard` и использует принципал из контекста; ошибки всех
guard'ов — `ProblemException(status, code)`, которое глобальный `ProblemDetailsFilter` (`APP_FILTER`)
отдаёт как `application/problem+json` с `correlationId` (без эха ввода и без стека).

## CSRF

Для небезопасных методов (`POST/PUT/PATCH/DELETE`) глобальный `CsrfGuard` проверяет:
1. `Sec-Fetch-Site`, если заголовок есть, — только `same-origin`;
2. иначе `Origin` обязан совпасть с `WEB_ORIGIN` (контур web; `ADMIN_ORIGIN` для admin — часть 3);
3. тело — только `application/json` (формы и «простые» запросы отклоняются).

`GET` — без побочных эффектов.

## Вход по логину и паролю

```typescript
// apps/api/src/app/auth/sessions.controller.ts (fragment)
@Public()
@Throttle({ default: AUTH_ROUTE_LIMIT })           // per IP; the main guard is the per-identifier LoginLimiter
@Post()                                            // POST /api/v1/sessions
@HttpCode(HttpStatus.CREATED)
async login(@Body() body: EmployeeLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
  const { token, maxAgeSeconds, session } = await this.sessions.login(body.login, body.password, req.ip ?? '');
  setSessionCookie(res, token, maxAgeSeconds, this.cookieEnv); // __Host-sid; the JWT is never in the body
  return session;                                             // EmployeeSession: profile, permissions, stores
}
```

- Идентификатор — логин, телефон (E.164) или e-mail (`normalizeIdentifier`); он глобально
  уникален, поэтому код сети во входе не нужен. Тенанта определяет резолвер `resolve_login`
  (SECURITY DEFINER, ADR-0013): до входа контекста тенанта ещё нет.
- Лимиты: `@nestjs/throttler` по IP и маршруту + `LoginLimiter` по идентификатору (Redis):
  `LOGIN_MAX_FAILURES` неудач → `429 login_locked` на `LOGIN_LOCK_SECONDS`, повторная — на час.
  Неудачный вход (`401 invalid_credentials`) занимает не меньше `LOGIN_FAILURE_FLOOR_MS`: ответ и
  время не различают неизвестный логин, неверный пароль, заблокированного сотрудника и сеть.
- Аудит `auth.login-succeeded` / `auth.login-failed` — в `audit_log` сети без секретов.
- Рабочую точку выбирает `PUT /sessions/current/store` (точка активна и в охвате, иначе 403);
  единственная точка охвата выбирается сама.
- Первый вход владельца — `POST /api/v1/activations { login, code, newPassword }` (`@Public()`):
  одноразовый код оператора (128 бит, в БД только SHA-256, срок `ACTIVATION_CODE_TTL_HOURS`),
  `204`, затем обычный вход.

## Терминал и PIN (`apps/api/src/app/terminals`)

1. **Привязка.** `POST /api/v1/terminals { storeId, name }` — `@RequirePermission('terminals:create',
   { storeBody: 'storeId' })` + `@RequireFreshAuth()`; точка `kind = 'pharmacy'` (иначе
   `422 store_not_pharmacy`). Секрет устройства `randomToken(32)` → device-cookie `__Host-term`
   (`term` при `AUTH_TEST_COOKIES`, 400 дней, `device-cookie.ts`); в `terminals.credential_hash` —
   SHA-256 секрета. Уже привязанный терминал этого браузера в той же сети отзывается. Имя уникально
   среди неотозванных терминалов точки (`409 terminal_name_taken`). Аудит `terminal.bound`.
2. **Текущий терминал.** `GET /api/v1/terminals/current` (`@Public`): SHA-256 cookie → резолвер
   `resolve_terminal` (ADR-0013) → `BoundTerminal` (кассиры с PIN, `pinLength`); нет, отозван или
   сеть не активна → `404 not_bound`. Работа в сети терминала — `TerminalsService.inTerminalTenant`.
3. **PIN-вход.** `POST /api/v1/terminal-sessions { employeeId, pin }` + device-cookie, по порядку:
   терминал → счётчик терминала (`LoginLimiter`, ключ `terminal-pin:<id>`, `TERMINAL_PIN_*`,
   `423 terminal_locked`) → сотрудник активен, есть доступ к точке, PIN задан (иначе тот же
   `401 invalid_pin`) → `pin_locked_at` (`423 pin_locked`) → scrypt. Неудача — атомарный
   `pin_failed_attempts + 1`, на 3-й — блокировка; аудит `auth.pin-failed` / `auth.pin-locked`.
   Успех: прежняя PIN-сессия терминала и сессия этого браузера уничтожаются, `SessionIssuer.issue`
   с `auth: 'pin'` и терминалом (охват и рабочая точка — точка терминала), аудит `auth.pin-succeeded`.
4. **Каждый запрос PIN-сессии** (`SessionMiddleware`, шаг 4): флаг отзыва `term-rev:<tid>:<id>` и
   совпадение SHA-256 device-cookie с `terminalCredentialHash` (`timingSafeEqual`); иначе сессия
   уничтожается, запрос — гость. При перечитывании прав охват остаётся `[точка терминала]`, а если
   доступ к ней потерян — сессия уничтожается.
5. **Отвязка.** `DELETE /api/v1/terminals/{id}` — `terminals:delete` + step-up; терминал вне охвата —
   `404 not_found`. `revoked_at` + аудит `terminal.revoked`, после коммита `markTerminalRevoked`
   (флаг живёт `SESSION_ABSOLUTE_TTL_SECONDS`) и `destroyForTerminal`; ошибка Redis — 500, повтор
   доделывает очистку.
6. **Свой PIN.** `POST /api/v1/me/pin { currentPin, newPin }` — только сессия по паролю (step-up);
   `currentPin` проверяется, если PIN задан и не заблокирован (`422 invalid_current_pin`, лимит
   `pin-change:<tid>:<eid>`); `checkPin` → `422 pin_length` / `pin_trivial`; сброс счётчика и
   блокировки — так кассир снимает свою блокировку. `GET /api/v1/me/terminals` — по аудиту
   `auth.pin-succeeded` за 90 дней.
7. **Step-up.** Привязка и отвязка терминала, смена своего пароля и PIN, управление сотрудниками
   и ролями — только в сессии, открытой паролем, не старше `STEP_UP_MAX_AGE_SECONDS`.

## Вход «от имени» — не реализуется

Поправка ADR-0008 от 2026-10-05: в MVP поддержка работает через AnyDesk по инициативе клиента (в
его же сессии, с фиксацией в заявке поддержки); после MVP — сессия поддержки только по разрешению
владельца в кабинете (уровень, срок, отзыв), отдельной поправкой ADR. До неё:
- нет маршрутов, сессий и значений `auth`, связанных с «от имени»; `EmployeeSession.impersonation`
  всегда `null`; у `OperatorPrincipal` нет тенанта, а `runWithContext` не принимает `tenantId` вместе
  с оператором;
- данные тенанта оператору недоступны: `PlatformDatabase` не имеет прав на тенантные таблицы;
- не добавляйте обходные пути (handoff-коды, режимы «только просмотр» поверх tenant-сессии) без
  нового решения в ADR.

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

Маркеры маршрута (`common/guards/decorators.ts`, `app/auth/decorators.ts`):
- `@Public()` — принципал не нужен (вход, активация, health); `@Authenticated()` — нужен принципал, но
  не право каталога (своя сессия, свой профиль); `@RequirePermission('<модуль>:<действие>', scope?)`
  — строка каталога из `@pharmacy/shared-domain` и, при необходимости, откуда брать точку
  (`storeParam` / `storeQuery` / `storeBody`); `@RequireFreshAuth()` — step-up.
- Маркер ближайшего уровня побеждает: маркер на методе целиком заменяет маркер класса
  (`resolveRouteAccess` общий для `AuthGuard` и `PermissionsGuard`), поэтому `@Public()` на
  классе не открывает метод с правом. Маршрут без маркера — запрет по умолчанию.

```typescript
// apps/api/src/app/pos/receipts.controller.ts (fragment)
@RequirePermission('pos:create', { storeBody: 'storeId' })
@Post()
create(@Body() dto: CreateReceiptDto) { /* ... */ }
```

`PermissionsGuard` берёт принципал из контекста (не из сессии напрямую): право должно быть в
снимке, точка из запроса — в охвате (у PIN-сессии — только точка терминала); каждый отказ —
`403 forbidden` и аудит `access.denied` (право и точка).

- **Сервер — источник истины;** права в профиле сессии (`GET /api/v1/sessions/current`) фронтенд
  использует только чтобы скрывать и отключать элементы UI.
- **Охват точек:** точка запроса (путь, тело, сессия) должна входить в охват сотрудника. Точка
  чужого тенанта — «не найдено» (404, tenant-scoped запрос и RLS), а не 403.
- **Запрет эскалации** (для `roles:manage` и `employees:assign-role`): права создаваемой или
  изменяемой роли ⊆ прав того, кто меняет; охват назначения ⊆ его охвата; менять собственные
  роль и охват нельзя; роль «Владелец» назначает только владелец; в сети всегда ≥ 1 активный
  владелец.
- **`permissions_version`:** растёт при изменении роли, её прав, охвата или блокировке
  сотрудника. `SessionMiddleware` на каждом запросе сверяет версию в записи сессии с кэшем (Redis; на
  офлайн-точке — PostgreSQL), при расхождении или отсутствии ключа перечитывает права, охват и
  статус сотрудника; блокировка уничтожает сессии. На офлайн-точке изменения
  вступают в силу после синхронизации (ADR-0014).
- **Видимость полей:** без `finance:view-cost` сервер не отдаёт закупочную цену, себестоимость
  и маржу — поля отсутствуют в response-DTO (отдельный DTO или маппинг по правам), а не
  скрываются на клиенте.
- **Правила режима поверх ролей** (роль не может их переопределить): склад офлайн-точки из
  облака — только чтение; права оператора — отдельный контур.
- Аудит: изменения ролей, прав, назначений и охвата, отказы `403` (право и точка) — отдельные
  события `audit_log` без секретов.

## Сотрудники и роли (`apps/api/src/app/staff`, спецификация 2026-10-06-staff-design)

- Правила назначения — чистые функции `assignment-rules.ts` (без БД): `isVisible` (охваты
  пересекаются; сотрудника «вся сеть» видит только «вся сеть»), `roleWithinEditor` (права роли ⊆ права
  редактора; «Владелец» — только владельцу), `scopeWithinEditor`, `sameScope`.
- Любое действие над **другим** сотрудником, чья роль сильнее редактора, — 403 `permission_escalation`:
  иначе сброс пароля передал бы чужие права. Свои роль, охват, статус, пароль и PIN через
  `/employees/{id}/*` не меняются (403 `own_assignment`) — свои секреты меняются в `/me` с текущим
  паролем. Роль, чьи текущие права шире редактора, не редактируется вовсе.
- Смена роли, охвата, статуса и прав роли — `PermissionsVersionService.bump(trx, ids)` в той же
  транзакции, `afterCommit()` после неё; блокировка и сброс пароля — `SessionStore.destroyAllFor` после
  коммита. Новый PIN обнуляет счётчик ошибок и снимает блокировку PIN.
- Названия ролей сравниваются в коде (`toLocaleLowerCase('ru')`): `lower()` базы зависит от локали
  кластера и может не понижать кириллицу.
- Роли новой сети создаёт `provision_tenant` (ADR-0013, поправка 2026-10-05, п. 6): «Владелец» + три
  обычные роли с правами по умолчанию из `roleTemplates`.

## Подтверждение паролем (ADR-0008, поправка 2026-10-06)

`POST /sessions/current/confirmation` (`SessionsService.confirm`): только парольная сессия (иначе 403
`password_session_required`); лимит `reconfirm:<tenant>:<employee>` в `LoginLimiter`; верный пароль —
`SessionStore.update(sessionId, { authenticatedAt })`, и `@RequireFreshAuth()` снова пропускает;
неверный — 422 `invalid_current_password` у поля `password`; аудит `auth.reconfirmed` /
`auth.reconfirm-failed`.

## Синхронизация офлайн-точек — лицензионный ключ (ADR-0014 §6–7)

- `Authorization: Bearer phk_<keyId>_<secret>`; ключ — `randomBytes(32)` base64url. В облаке —
  `key_id` + SHA-256 секрета (`license_keys`), сравнение `timingSafeEqual`.
- `LicenseKeyGuard` (для маршрутов sync — `@Public()` относительно сессии) находит ключ резолвером
  `resolve_license_key(key_hash)` (SECURITY DEFINER, ADR-0013) и кладёт `tenantId`/`storeId`
  точки в контекст; `storeId` в теле, если есть, обязан совпасть.
- Статусы лицензии: `active`, `expiring` (≤ N дней до срока), `expired`, `revoked`,
  `revoked-hard`, «точка закрыта», «тенант заблокирован» — в каждом ответе sync
  (`Pharmacy-License-Status`). При `revoked`/`expired` облако ещё льготный период (30 дней)
  принимает операции точки; `revoked-hard` — `401` `code: license-revoked`.
- Ключ на точке — в env-файле развёртывания; в логах, аудите и ошибках — никогда. Лимиты — по
  `keyId` и по IP для неудачных попыток.

## Оператор платформы (`apps/api/src/app/platform/auth`, apps/admin)

1. **Контур.** Ровно маршруты `/api/v1/operator/*` (`common/http/contour.ts`). Middleware на них читает
   только cookie `__Host-op_sid` (`op_sid` при `AUTH_TEST_COOKIES`), JWT `aud=admin` без `tid`
   (`SessionTokenService.signOperator`/`verifyOperator`), сессию `OperatorSessionStore`
   (`op-sess:<id>`, `op-emp-sess:<operatorId>`; бездействие `OPERATOR_SESSION_IDLE_SECONDS`, абсолютный
   срок `OPERATOR_SESSION_ABSOLUTE_SECONDS`) и **на каждом запросе** `operators.status` — заблокированный
   оператор теряет все сессии сразу. Порт `OperatorPrincipalResolver` (common) реализует
   `OperatorSessionResolver` (app/platform/auth): `PlatformDatabase` — только в `app/platform/**`.
   Cookie сотрудника на пути оператора не читается, cookie оператора на остальных путях — тоже.
2. **Guard'ы.** CSRF — `ADMIN_ORIGIN` на контуре оператора, `WEB_ORIGIN` на остальных. `PermissionsGuard`
   тенанта контур оператора пропускает; решает `OperatorPermissionsGuard` (после него): на
   `/operator/*` нужен `@Public()` или `@RequireOperatorPermission(...)` (каталог
   `OPERATOR_PERMISSIONS` в `libs/shared/domain`, роль `full_access` — все права), иначе `403` +
   `platform_audit_log` `access.denied`. Step-up для оператора — возраст `authenticatedAt`.
3. **Вход.** `POST /operator/sessions { login, password }` — как вход сотрудника: только e-mail, лимит
   `operator:<sha256>` до хеширования, фиктивный хеш, выравнивание неудачи, один `401
   invalid_credentials`; аудит `auth.operator-login-succeeded`/`-failed`. `GET`/`DELETE
   /operator/sessions/current` — `platform:view`.
4. **Первый оператор.** `scripts/create-operator.mjs --login <e-mail> --name "<ФИО>"` — одноразовый код
   (как у владельца), пароль оператор задаёт `POST /operator/activations { login, code, newPassword }`
   (`401 invalid_code`, `422 password_policy`, `429 login_locked`). Пароль в консоли не вводится.
5. **Журнал.** `PlatformAuditService.append(trx, event)` — actor (`operator`/`system`, `operator_id`, `job`)
   берётся из `app.actor` транзакции, не от вызывающего; `platform_audit_log` только дополняется.
6. **Сети (`app/platform/tenants`, модуль «сети»).** `GET/POST /operator/tenants`, `GET …/{id}`,
   `…/{id}/stores`, `POST …/{id}/owner-activation-codes`, `…/block`, `…/unblock`; мутации —
   `tenants:manage` + step-up. Создание и новый код — через `provision_tenant` / `issue_owner_code`
   (код 128 бит, показывается один раз, в БД — SHA-256). Блокировка: `tenants.status` + флаг
   `tenant-blocked:<tid>` (`SessionStore.markTenantBlocked`), который `lookup` читает вместе с сессией
   — сессии сети гаснут на следующем запросе; подстраховка — статус сети в `PrincipalLoader.reload`.
   Профиль и команда операторов — позже.

## Запрещено

- OAuth/SSO-провайдеры и Passport как замена; JWT без проверки серверной сессии (токен — только
  носитель идентификаторов); токен в `localStorage`, в URL, в теле ответа.
- Алгоритмы подписи, кроме `HS256`, и «разбор без проверки» (`decode`) как основание доступа.
- Guard или контроллер, который строит или меняет `RequestContext`; тенант, принципал или права из
  тела, заголовков и query клиента.
- Вход «от имени» и любые обходные пути к данным тенанта для оператора (раздел выше).
- Хранение пароля, PIN или токена в открытом виде, в логах, аудите, кэше.
- Маршрут без `@RequirePermission` / `@Authenticated()` и без `@Public()`; право не из каталога.
- Собственные реализации хеширования или шифрования; хеш паролей — только scrypt из `node:crypto`.
