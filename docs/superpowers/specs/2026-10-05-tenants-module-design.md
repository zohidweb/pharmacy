# Модуль «сети» (оператор платформы) — спецификация

Дата: 2026-10-05. Статус: утверждено архитектором 2026-10-05. Связано: ADR-0008 (поправка 2026-10-05 — доступ оператора
к данным сети), ADR-0013 (поправка 2026-10-05 — функции создания сети), спецификация
аутентификации `2026-10-02-auth-design.md` (части 1 и 3).

## 1. Цель и критерии успеха

Оператор платформы в админке видит сети, создаёт новую сеть с её владельцем и выдаёт владельцу
одноразовый код активации, при необходимости — новый код; блокирует и разблокирует сеть, и
блокировка закрывает все сессии сети на следующем запросе.

Успех:
- оператор не может читать или менять бизнес-данные сети: из контура оператора к тенантным
  таблицам ведут только две узкие функции базы (создать новую сеть, выдать код владельцу);
- код активации показывается один раз, в базе — только SHA-256;
- после блокировки ни один сотрудник сети не работает дольше одного запроса;
- админка работает с настоящим API для сетей, остальные экраны — на моках.

## 2. Решения, принятые при обсуждении (2026-10-05)

| # | Вопрос | Решение |
|---|---|---|
| T1 | Объём первой версии | Ядро без биллинга: список, карточка, точки (реестр), создание, новый код владельцу, блокировка/разблокировка. Биллинг, лицензии, счета, услуги, статистика, аудит сети — позже своими модулями |
| T2 | Первая точка | Её заводит владелец после активации в кабинете (ADR-0013, решение 4 не меняется). Шаг «первая точка» из мастера убирается |
| T3 | Как контур платформы пишет владельца | Узкие SECURITY DEFINER-функции `provision_tenant` и `issue_owner_code` — владелец новая роль `pharmacy_provisioner` (вариант A). Запись через `TenantDatabase` из платформенного кода отклонена |
| T4 | Блокировка | `tenants.status` + флаг `tenant-blocked:<tid>` в Redis, читаемый middleware вместе с сессией; подстраховка — проверка статуса сети при перечитывании прав |

## 3. API (`apps/api/src/app/platform/tenants`, только `PlatformDatabase`)

Все маршруты — контур оператора (`/api/v1/operator/*`), `@RequireOperatorPermission`, CSRF по
`ADMIN_ORIGIN`.

| Маршрут | Право | Step-up | Ответ |
|---|---|---|---|
| `GET /operator/tenants?filter&q&sort&direction&limit&offset` | `tenants:view` | — | `TenantListResponse` |
| `GET /operator/tenants/{id}` | `tenants:view` | — | `TenantDetails` |
| `GET /operator/tenants/{id}/stores` | `tenants:view` | — | `StoreSummary[]` (реестр точек: колонки, доступные `pharmacy_platform`) |
| `POST /operator/tenants` | `tenants:manage` | да | `201 CreateTenantResponse { id, activationCode }` |
| `POST /operator/tenants/{id}/owner-activation-codes` | `tenants:manage` | да | `201 { activationCode }` |
| `POST /operator/tenants/{id}/block { reason }` | `tenants:manage` | да | `TenantDetails` |
| `POST /operator/tenants/{id}/unblock` | `tenants:manage` | да | `TenantDetails` |

- **Список.** Фильтры `all` / `active` / `blocked`; `unpaid` до биллинга даёт пустую выборку,
  счётчик 0. Поиск `q` — по названию, городу, ИНН, ФИО и логину владельца (без учёта регистра).
  Сортировка `name` / `owner` / `stores`; `paidUntil` и `monthlyCharge` — до биллинга как `name`.
  Пагинация limit/offset (по умолчанию 20, максимум 100).
- **Поля биллинга** (`overdue`, `paidUntil`, `monthlyChargeMinor`) до модуля биллинга — `false`,
  `null`, `0`. `cloudStores` / `offlineStores` — по реестру точек (`mode`).
- **Владелец в списке и карточке.** ФИО, логин, телефон и e-mail владельца в `employees` — тенантные
  данные, роль платформы их не читает. Решение: `provision_tenant` записывает контакт владельца ещё
  и в платформенные колонки `tenants` (`owner_full_name`, `owner_login`, `owner_phone`,
  `owner_email`) — это контакт сети для платформы, как реквизиты для счёта, а не данные сотрудника.
  В первой версии карточка показывает контакт на момент создания сети; если владелец сменит
  телефон в кабинете, контакт обновит модуль сотрудников (вне объёма).
- **Контракт.** `CreateTenantRequest` теряет `firstStore`, `paidUntil`, `pricePerStoreMinor`
  (вернутся с биллингом и лицензиями): `{ name, city, inn, owner: TenantOwner }`.
  Новый `IssueOwnerCodeResponse { activationCode }`.

## 4. Данные (миграция)

- `tenants`: `city text not null default ''`, `owner_full_name`, `owner_login`, `owner_phone`,
  `owner_email` (text, контакт сети для платформы), `blocked_at timestamptz`, `blocked_by uuid`
  (оператор, без FK — класс `platform`, оператор может быть удалён позже), `block_reason text`;
  `check` — поля блокировки заданы вместе и только при `status = 'blocked'`. ИНН — существующая
  `billing_tax_id`.
- `tenants.code` генерируется приложением: `t-` + 8 символов base32 в нижнем регистре; при
  конфликте уникальности — новая попытка (до 3). Во входе не участвует.
- Роль `pharmacy_provisioner` (NOLOGIN, `docker/postgres/initdb/01-roles.sh`):
  - `INSERT` на `tenants`, `tenant_settings`, `roles`, `employees`, `employee_credentials`;
  - `UPDATE (one_time_code_hash, one_time_code_expires_at, updated_at)` на `employee_credentials`;
  - `SELECT` колонок, нужных для проверок (`tenants.id, status`; `roles.tenant_id, id, is_owner`;
    `employees.tenant_id, id, role_id, status`);
  - политики RLS `TO pharmacy_provisioner` (тенантные таблицы — `FORCE RLS`);
  - `grant pharmacy_provisioner to pharmacy_owner` (чтобы миграция могла сделать её владельцем
    функций), `usage, create on schema pharmacy`.
- Тома dev и test пересоздаются один раз (роль создаёт только `initdb` на пустом томе, у
  `pharmacy_owner` нет `CREATEROLE`) — с подтверждения пользователя; данные там синтетические.

## 5. Функции создания сети (поправка ADR-0013)

```
pharmacy.provision_tenant(
  p_tenant_id uuid, p_code text, p_name text, p_city text, p_inn text,
  p_owner_employee_id uuid, p_owner_role_id uuid, p_owner_role_name jsonb,
  p_owner_full_name text, p_owner_login text, p_owner_phone text, p_owner_email text,
  p_code_hash text, p_code_expires_at timestamptz
) returns void
```
- одна транзакция вызывающего; `insert` в `tenants` (с контактом владельца), `tenant_settings`
  (значения по умолчанию), `roles` (`is_owner = true`, `template_key = 'owner'`, `status
  'active'`), `employees` (`store_scope = 'all'`, `status 'active'`, нормализованные логин и
  e-mail — `lower()`, телефон E.164), `employee_credentials` (только код и срок);
- `id` строк передаёт приложение (UUIDv7, в базе нет id по умолчанию);
- существующий `tenant_id` → ошибка уникальности: функция не меняет существующие сети;
- дубль логина / телефона / e-mail → ошибка уникального индекса; приложение отвечает
  `409 login_taken` / `phone_taken` / `email_taken` (по имени индекса).

```
pharmacy.issue_owner_code(p_tenant_id uuid, p_code_hash text, p_expires_at timestamptz,
  p_operator_id uuid, p_audit_id uuid, p_correlation_id text) returns boolean
```
- в той же транзакции пишет в `audit_log` сети `owner.activation-code-issued` (`entity_type
  'employee'`, `entity_id` — владелец, `acting_operator_id`, `source 'cloud'`, бизнес-дата — по
  `tenant_settings.timezone`): владелец видит выдачу в журнале сети (дополнено 2026-10-06, ADR-0008
  поправка 2026-10-05 п. 7 — выдача только по звонку владельца с фиксацией в заявке);
- обновляет только `one_time_code_hash`, `one_time_code_expires_at`, `updated_at` у
  `employee_credentials` владельца сети (роль `is_owner`, сотрудник `active`), строку создаёт, если
  её нет; сеть не `active` или владельца нет → `false` (приложение: `409 tenant_blocked` /
  `404 not_found`);
- пароль владельца остаётся до использования кода (как у `create-activation-code.mjs`).

Обе: `language plpgsql`, `security definer`, `set search_path = ''`, владелец
`pharmacy_provisioner`, `revoke all ... from public`, `grant execute ... to pharmacy_platform`.
Только идентификаторы и фиксированные поля на входе; ничего не возвращают из тенантных таблиц.

Каталог-тест (ADR-0013, раздел 8) расширяется: список `PROVISIONING_FUNCTIONS` в
`table-classes.ts` — ровно эти функции, владелец `pharmacy_provisioner`, `search_path` закреплён,
нет `EXECUTE` у `PUBLIC` и у `pharmacy_app`; у `pharmacy_resolver` нет прав на запись ни в одну
таблицу.

## 6. Блокировка и сессии

- `block`: в платформенной транзакции `status = 'blocked'`, `blocked_at = now()`, `blocked_by`,
  `block_reason` + аудит `tenant.blocked`; после коммита — `SET tenant-blocked:<tid> 1` (без срока
  жизни). Повторная блокировка заблокированной — `409 already_blocked`.
- `unblock`: поля блокировки очищаются, аудит `tenant.unblocked`; после коммита — `DEL` флага.
  Разблокировка незаблокированной — `409 not_blocked`.
- `SessionStore.lookup` (Redis) читает флаг в том же обращении: `MGET` сессии, версии прав и
  `tenant-blocked:<tid>`; флаг есть → сессия уничтожается, запрос — гость (401). Порт получает поле
  `tenantBlocked` в `SessionLookup`.
- `PrincipalLoader.reload` читает `tenants.status` (своя строка доступна `pharmacy_app`): не
  `active` → `destroyAllFor` и гость — подстраховка, если флаг потерян.
- Офлайн-точка: `PgSessionStore.lookup` берёт `tenants.status` тем же запросом.
- Ошибка Redis после коммита блокировки → `500` с записью в лог. Повторный `block` уже
  заблокированной сети заново ставит флаг (`SET`, идемпотентно) и отвечает `409 already_blocked` —
  так повтор после сбоя Redis доводит блокировку до конца. Так же `unblock` незаблокированной
  повторяет `DEL` и отвечает `409 not_blocked`.
- Журнал платформы: `tenant.created`, `tenant.owner-code-issued`, `tenant.blocked`,
  `tenant.unblocked` — `tenant_id`, без логинов, кодов и причин целиком (причина — в `tenants`).

## 7. Админка (`apps/admin`)

- Пути API переносятся с `/platform/tenants…` на `/operator/tenants…` (контур оператора — только
  `/api/v1/operator/*`).
- Режим транспорта `NEXT_PUBLIC_API_MOCKS=partial`: маршруты из списка готовых (вход оператора,
  сеть: список, карточка, точки, создание, код, блокировка) идут в API, остальные — в моки;
  `true` — всё в моках (как сейчас), не задано — всё в API.
- Экраны: «Компании» (список), «Компания» (основное, точки, блокировка, кнопка «Новый код
  владельцу» с показом кода один раз), «Новая компания» (мастер без шагов точки и биллинга; после
  создания — экран с кодом и подсказкой «передайте владельцу»).
- Вход оператора в админку — через настоящий API в режимах `partial` и без моков.

## 8. Ошибки

| Статус | Коды |
|---|---|
| 404 | `not_found` |
| 409 | `inn_taken`, `login_taken`, `phone_taken`, `email_taken`, `already_blocked`, `not_blocked`, `tenant_blocked` |
| 400 | `validation_failed` с `errors[]` (DTO, ADR-0015): ИНН — 9 цифр (формат ИНН Таджикистана); город и название — 1–120 символов; логин, телефон, e-mail — правила `normalizeIdentifier`; причина блокировки — 5–500 символов |

## 9. Вне объёма

Биллинг, лицензии офлайн-точек, счета, платежи, услуги, статистика и аудит сети в админке;
управление точками и сотрудниками владельцем (следующий план — API точек в кабинете); смена
владельца; удаление сети; доступ оператора к данным сети (ADR-0008, поправка 2026-10-05).

## 10. Проверка

Новые автотесты не пишутся до MVP (решение 2026-10-05). Существующие наборы — зелёные (каталог-тест
расширяется под новые правила). Ручная проверка — сценарий в плане: создание сети → код → активация
владельца → вход → блокировка (сессия владельца → 401, вход → 401) → разблокировка → вход;
дубль логина → 409; новый код → старый код недействителен.
