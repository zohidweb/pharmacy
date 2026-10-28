# 1. Платформа и организация сети

Соглашения (ключи, типы, архивирование) — в [README](README.md). У каждой таблицы класса `tenant` есть `tenant_id`, первичный ключ `(tenant_id, id)` и `created_at` — в списках колонок они не повторяются.

```mermaid
erDiagram
  tenants ||--|| tenant_settings : "settings"
  tenants ||--o{ legal_entities : ""
  tenants ||--o{ stores : ""
  legal_entities ||--o{ stores : "requisites"
  tenants ||--o{ roles : ""
  roles ||--o{ role_permissions : ""
  roles ||--o{ employees : "one role"
  employees ||--|| employee_credentials : "hashes"
  employees ||--o{ employee_stores : "scope"
  stores ||--o{ employee_stores : ""
  stores ||--o{ terminals : ""
  tenants ||--o{ expenses : "other expenses"
  stores ||--o{ expenses : ""
  stores ||--o{ license_keys : "offline"
  operators ||--|| operator_credentials : ""
  operators ||--o{ impersonations : ""
  tenants ||--o{ impersonations : ""
```

## `tenants` — сеть (класс `platform`)

Создаёт оператор (АП 2). Тенант видит только свою строку (политика `FOR SELECT TO pharmacy_app`). Синхронизация: облако → точка, своя строка.

| Колонка | Тип | Правило |
|---|---|---|
| `id` | uuid PK | |
| `code` | text unique | Код сети: `^[a-z0-9-]{3,32}$`. Во входе не участвует (сеть определяется по идентификатору сотрудника, поправка 2026-10-02) |
| `name` | text | Название сети |
| `status` | text | `active` / `blocked` (АП 2, 6). Заблокированный тенант не входит, данные сохраняются |
| `billing_name`, `billing_tax_id`, `billing_address`, `billing_phone`, `billing_email` | text null | Реквизиты для счёта платформы отдельными полями; ИНН — проверка формата в приложении (решение 2026-10-01) |
| `billing_bank_details` | text null | Банковские реквизиты одним текстом |
| `billing_advance_dirams` | bigint ≥ 0 | Аванс сети — платежи, не распределённые по счетам; пишет пересчёт распределения (спецификация 2026-10-15-billing-services, 3.1 п. 3) |
| `city` | text | Город сети (модуль «сети», 2026-10-05) |
| `owner_full_name`, `owner_login`, `owner_phone`, `owner_email` | text null | Контакт владельца для платформы; пишет `provision_tenant` при создании сети (ADR-0013, поправка 2026-10-05) — `employees` платформа не читает |
| `blocked_at`, `blocked_by`, `block_reason` | null | Блокировка оператором: заданы вместе и только у `blocked` (`blocked_by` — оператор, без FK) |
| `created_at`, `updated_at` | timestamptz | |

ИНН (`billing_tax_id`) уникален среди сетей (`tenants_inn_uq`). Сеть с её владельцем создаёт только
функция `provision_tenant`, новый код владельцу — `issue_owner_code` (SECURITY DEFINER, владелец
`pharmacy_provisioner`, вызывает `pharmacy_platform`). Вместе с ролью «Владелец» функция создаёт три
обычные роли сети — «Заведующий точкой», «Фармацевт-кассир», «Бухгалтер» — с правами по умолчанию из
`roleTemplates` (`template_key` пустой; ADR-0013, поправка 2026-10-05, п. 6).

## `tenant_settings` — настройки сети (класс `tenant`, одна строка на тенанта)

Первичный ключ — `tenant_id`. Синхронизация: облако → точка.

| Колонка | Тип | По умолчанию | Источник |
|---|---|---|---|
| `default_language` | text `ru`/`tj` | `ru` | Обязательный язык названий (D6), язык чека |
| `timezone` | text | `Asia/Dushanbe` | Бизнес-дата |
| `return_period_days` | integer ≥ 0 | 14 | КП 7 |
| `customer_return_otc` | boolean | true | Возврат по желанию покупателя: товары без рецепта (миграция `customer-returns`, R3) |
| `customer_return_rx` | boolean | false | То же: рецептурные |
| `customer_return_controlled` | boolean | false | То же: ПКУ; брак принимается всегда |
| `cashier_session_idle_min` | integer | 15 | КП 12; ограничения — ADR-0008 |
| `pin_min_length` | integer ≥ 4 | 4 | ADR-0008 |
| `sync_interval_min` | integer 5…1440 | 15 | ADR-0014 |
| `receipt_footer` | jsonb null | | Текст внизу чека по языкам (КП 5) |
| `expiry_reminder_days` | integer | 30 | БЛ W1-17 |
| `supplier_payment_reminder_days` | integer | 3 | БЛ W2-02 |
| `piece_price_rounding_dirams` | integer ≥ 1 | 10 | Шаг округления вверх расчётной цены штуки (решение 2026-09-30) |
| `backdating_max_days` | integer ≥ 0 | 30 | На сколько дней назад можно поставить дату документа (решение 2026-10-01) |
| `prescription_retention_days` | integer 1…3650 | 90 | Срок хранения данных рецептов ПКУ (решение 2026-09-30; подтвердить с юристом); меняет владелец на экране настроек, данные старше срока очищаются ежечасно (спецификация `2026-10-21-pos-offline-limits`, P2, P3) |
| `warn_below_cost` | boolean | true | Предупреждать о розничной цене ниже закупочной на экране цен (кабинет владельца, E15; миграция `owner-cabinet`) |
| `disabled_notifications` | text[] | `{}` | Выключенные виды уведомлений сети (E13): только известные виды — `batch_expiring`, `low_stock`, `supplier_payment_due`, `transfer_in_transit`, `shift_discrepancy`, `negative_stock`, `sync_conflict`, `license_expiring` (миграция `owner-cabinet`), `service_decided`, `invoice_overdue` (`billing-services`), `receipt_discrepancy` (`receipt-discrepancy-notification`, ревью безопасности I2), `login_locked` (`login-locked-notification`, ревью безопасности A2) |
| `pos_buffer_max_hours` | integer 1…72 | 24 | Предел буфера перебоев кассы по возрасту самой старой операции, часы (спецификация `2026-10-21-pos-offline-limits`, P6; ADR-0015) |
| `pos_buffer_max_operations` | integer 50…2000 | 500 | Предел буфера по числу ожидающих операций терминала (P6) |
| `pos_controlled_max_hours` | integer 1…24 | 8 | Предел ПКУ без связи по возрасту самого старого чека с ПКУ в буфере, часы; не больше `pos_buffer_max_hours` (P6) |
| `pos_controlled_max_operations` | integer 1…200 | 20 | Предел ПКУ без связи по числу чеков с ПКУ в буфере; не больше `pos_buffer_max_operations` (P6) |
| `updated_at`, `updated_by` | | | |

## `legal_entities` — юрлица сети (класс `tenant`, D5)

Синхронизация: облако → точка.

| Колонка | Тип | Правило |
|---|---|---|
| `name` | text | Полное название юрлица / ИП для чека |
| `tax_id` | text | ИНН; уникален в `(tenant_id, tax_id)` среди активных |
| `legal_address` | text | |
| `phone`, `email` | text null | |
| `bank_details` | text null | Банковские реквизиты одним текстом (решение 2026-10-01) |
| `closed_until` | date null | Закрытый период (решение 2026-10-01): документы точек этого юрлица с датой ≤ `closed_until` нельзя проводить и отменять. Закрывает вручную владелец или бухгалтер, обычно после выгрузки в 1С; каждое изменение — в `audit_log` |
| `closed_until_set_by`, `closed_until_set_at` | null | |
| `status`, `archived_at` | text / timestamptz | `active` / `archived` |

## `stores` — точка (класс `tenant`)

Создаёт и закрывает владелец (ADR-0013). Реестр видит платформа: колонки `id, tenant_id, name, mode, status, created_at, closed_at`, `kind` (поправка ADR-0013 2026-10-19, п. 3: статистика админки считает только аптеки) и `address` (поправка ADR-0013 2026-10-23: карточка точки в админке). Режим меняет оператор (`UPDATE (mode)`). Синхронизация: облако → точка.

| Колонка | Тип | Правило |
|---|---|---|
| `legal_entity_id` | uuid | → `legal_entities` |
| `name` | text | |
| `code` | text | Короткий код точки для номеров документов (`01`, `DSH1`): шаблон `^[A-Z0-9]{1,8}$`, уникален в `(tenant_id, code)`; задаёт владелец (решение 2026-09-30) |
| `address` | text | Фактический адрес для чека |
| `kind` | text | `pharmacy` / `warehouse` (решение 2026-10-01): склад пока не продаёт — терминалы и смены для него запрещает приложение, а не база, чтобы позже разрешить розницу без миграции; в биллинг не входит; может быть офлайн-точкой |
| `mode` | text | `online` / `offline_pending` / `offline`. `offline_pending`: выпущен флеш-комплект, запись склада в облаке закрыта (ADR-0014 §4) |
| `status` | text | `active` / `closing` / `closed`. `closing` — товар точки в пути к получателю: продажи и складские документы запрещены; `closed` — получатель принял последнее перемещение закрытия, у пустой точки — сразу (спецификация 2026-10-15-store-closing). «Ожидает активации» в макете — это `mode = 'offline_pending'` |
| `print_receipt_default` | boolean | true (КП 5) |
| `closed_at` | timestamptz null | Обязателен при `status = 'closed'`; дата закрытия — его бизнес-дата в часовом поясе сети |
| `closing_started_at`, `closing_started_by` | timestamptz / uuid null | Кто и когда начал закрытие; обязательны при `status = 'closing'`; `closing_started_by` → `employees` |
| `closing_receiver_store_id` | uuid null | Получатель товара закрытия (→ `stores`); null у пустой точки |
| `idempotency_key` | uuid null | Ключ повтора создания точки (заголовок `Idempotency-Key`, спецификация 2026-10-06-owner-stores); уникален в сети, если задан |

Ключи и индексы: `unique (tenant_id, id)` — цель составных ссылок; `(tenant_id, legal_entity_id)`;
`(tenant_id, closing_started_by)`, `(tenant_id, closing_receiver_store_id)`.

При закрытии отзываются терминалы точки, точка убирается из `discount_rule_stores` (правило без точек — в архив),
а `employee_stores` остаются: по ним сотрудник видит историю закрытой точки, работать на ней он не может.

## `employees` — сотрудник (класс `tenant`)

Синхронизация: облако → точка, **без** `employee_credentials`.

| Колонка | Тип | Правило |
|---|---|---|
| `role_id` | uuid | → `roles`; одна роль (ADR-0018) |
| `login` | text | Глобально уникален: `lower(login)` на всей платформе (вход по логину, телефону или e-mail; поправка 2026-10-02) |
| `full_name` | text | |
| `employee_code` | text null | Табельный код для выбора кассира на терминале; уникален в тенанте |
| `phone` | text null | E.164 (`check` формата); глобально уникален среди заданных; идентификатор входа. Вопрос 9 разбора ТЗ: нужен для доставки ключа по SMS |
| `email` | text null | Глобально уникален: `lower(email)` среди заданных; идентификатор входа (поправка 2026-10-02) |
| `language` | text null | `ru` / `tj`; пусто — язык сети |
| `store_scope` | text | `all` / `list`; при `list` точки — в `employee_stores` |
| `status` | text | `active` / `blocked` / `archived` |
| `permissions_version` | bigint default 1 | Растёт при изменении роли, прав, охвата или блокировке (ADR-0018 п. 7) |
| `last_login_at` | timestamptz null | Время последнего успешного входа; показывается в `GET /me` (поправка 2026-10-02) |
| `updated_at` | | |

## `employee_credentials` — учётные данные (класс `tenant`)

Первичный ключ `(tenant_id, employee_id)`. **Не синхронизируется**: на офлайн-точке учётные данные свои (ADR-0008). Отдельная таблица, чтобы хеши не попадали в ленту и обычные выборки сотрудников.

| Колонка | Тип | Правило |
|---|---|---|
| `password_hash` | text null | PHC-строка scrypt (ADR-0008); пусто — вход только по одноразовому коду |
| `password_pepper_version` | integer null | |
| `password_changed_at` | timestamptz null | |
| `pin_hash`, `pin_pepper_version` | text / integer null | |
| `pin_failed_attempts` | integer default 0 | После 3 — блокировка PIN |
| `pin_locked_at` | timestamptz null | |
| `one_time_code_hash`, `one_time_code_expires_at` | text / timestamptz null | Код активации владельца, первый вход на офлайн-точке и сброс пароля. Код — 128 бит из `randomBytes`; хранится hex SHA-256 (не scrypt и без pepper, поправка 2026-10-02); срок — `ACTIVATION_CODE_TTL_HOURS` |
| `updated_at` | | |

## `roles`, `role_permissions`, `employee_stores` (класс `tenant`, ADR-0018)

Синхронизация: облако → точка.

- **`roles`:** `name jsonb` (D6), `is_owner boolean` — одна роль-владелец на тенанта (уникальный частичный индекс), `template_key text null` — шаблон, из которого создана роль (`owner` / `manager` / `cashier` / `accountant`, ключи `RoleTemplateKey` в `libs/shared/domain`; у своих ролей — null), `status`.
- **`role_permissions`:** ключ `(tenant_id, role_id, permission)`, `permission text` по шаблону `^[a-z0-9-]+:[a-z0-9-]+$`. Каталог прав — в коде `libs/shared/domain`, проверка допустимости — в приложении.
- **`employee_stores`:** ключ `(tenant_id, employee_id, store_id)`, обе ссылки составные.

## `terminals` — касса (класс `tenant`, ADR-0008)

Синхронизация: терминалами офлайн-точки владеет точка (`terminal.bound` / `terminal.revoked` → облако).

| Колонка | Тип | Правило |
|---|---|---|
| `store_id` | uuid | Точка `kind = 'pharmacy'` |
| `name` | text | Уникально в точке |
| `credential_hash` | bytea | SHA-256 device-credential; уникален |
| `bound_by`, `bound_at` | uuid / timestamptz | |
| `last_seen_at` | timestamptz null | |
| `revoked_at`, `revoked_by` | null | Отзыв действует немедленно |

## `expenses` — прочие расходы (класс `tenant`, поправка 2026-10-14, PR 3)

Прочие расходы месяца — аренда, зарплата, коммуналка, прочее (спецификация 2026-10-14-owner-cabinet, O4, O5,
E16). Владелец вносит их раз в месяц по точке или по всей сети. Отчёт за часть месяца берёт долю дней
(`prorateExpense` в `libs/shared/domain`). Изъятия из кассы «на расходы» сюда не копируются: отчёты читают их из
`shift_cash_operations` (O9). Синхронизация: только облако.

| Колонка | Тип | Правило |
|---|---|---|
| `month` | date | Первое число месяца (`check`); не позже текущего месяца сети — проверяет приложение |
| `store_id` | uuid null | Точка (аптека или склад); `null` — вся сеть: её видит и меняет только сотрудник с охватом «вся сеть» |
| `kind` | text | `rent` / `salary` / `utilities` / `other` |
| `amount_dirams` | bigint | `> 0` |
| `comment` | text null | ≤ 500 |
| `created_by` | uuid | Сотрудник |
| `updated_by`, `updated_at` | null | Последняя правка |

- Индексы: `(tenant_id, month)`, а также по внешним ключам `store_id`, `created_by`, `updated_by`.
- Правка и удаление разрешены (полный DML у `pharmacy_app`). Каждое изменение пишется в `audit_log`
  (`expense.created` / `updated` / `deleted`) с прежними значениями.
- Права: `expenses:view` / `create` / `update` / `delete`. По умолчанию они есть только у владельца.

## `operators`, `operator_credentials` (класс `platform`)

- **`operators`:** `login` unique, `full_name`, `status` `active` / `blocked`, `language` `ru` / `tj` (по умолчанию `ru`; язык админки, применяется при входе — миграция `operator-language`, 2026-10-14), `muted_notification_topics text[]` — темы, выключенные в колокольчике и счётчике меню (`billing`, `keys`, `services`, `sync`; миграция `operator-notifications`, 2026-10-19; `leads` — заявки сайта, миграция `public-site`, ADR-0023). В MVP одна роль с полным доступом (АП 6), права оператора — в коде.
- **`operator_credentials`:** хеш пароля и версия pepper, как у сотрудника; одноразовый код первого входа — только SHA-256 и срок.
- **Команда и профиль** (2026-10-14). Оператора добавляет другой оператор в админке, `POST /operator/operators`, или скрипт `create-operator.mjs`; код показывается один раз. Новый код — `POST /operator/operators/{id}/activation-codes`: прежний код перестаёт действовать, пароль остаётся до ввода нового кода; себе код не выдаётся. Отключение — `POST /operator/operators/{id}/deactivation`: `status = 'blocked'`, сеансы завершаются; себя отключить нельзя. Строки действующего оператора и цели блокируются вместе (по порядку id), поэтому два оператора не отключат друг друга одновременно и активный оператор всегда остаётся. Включения нет: отключение необратимо, логин остаётся занят. Эти три действия требуют повторного входа (step-up). **Принятый риск:** код действует и при заданном пароле, поэтому оператор может выдать код другому и войти под ним. В MVP у всех операторов одна роль с полным доступом, так что новых прав это не даёт, а выдача кода видна в журнале. Профиль `/operator/me`: имя, язык, смена пароля по текущему паролю (без step-up, другие сеансы завершаются, неиспользованный код сбрасывается), список сеансов и завершение остальных, последние действия из `platform_audit_log`. Вход сверяет `password_changed_at` под блокировкой строки `operator_credentials`: сеанс, открытый паролем, который сменили во время входа, не создаётся. В журнал пишутся `operator.code-issued` (`created` true/false), `operator.disabled`, `operator.renamed`, `auth.operator-password-changed`, `auth.operator-password-change-failed`.

## `announcements` — объявления сетям (класс `shared`, 2026-10-19)

Технические работы и другие объявления платформы (спецификация `2026-10-19-operator-notifications-design.md`, N11–N14;
миграция `operator-notifications`). `title` (3–120), `text` (10–1000) — как написал оператор, без перевода; `starts_at`,
`ends_at` (`ends_at > starts_at`) — показ; `scope` `all` / `cloud` / `offline` — сети с открытой точкой нужного режима;
`created_by`, `created_at`; снятие — `cancelled_at`, `cancelled_by`, строки не удаляются. Пишет `pharmacy_platform`,
читают все сети (`SELECT` у `pharmacy_app`): маршрут `GET /announcements` отдаёт идущие объявления круга сети.

## Публичный сайт (класс `platform`, ADR-0023, 2026-10-28)

Спецификация `2026-10-28-public-site-design.md`, раздел 7.1; миграции `public-site`, `public-site-checks`. Открыты только
`pharmacy_platform` (RLS включена и принудительна, без DELETE): оператор пишет, публичный контур `/api/v1/public/*` читает.

- **`site_settings`** — настройки сайта, одна строка (`id = 1`): тексты RU/TG (`jsonb`), контакты, картинки логотипа, значка и превью ссылки.
- **`site_media`** — картинки сайта в базе (`bytea` до 2 МиБ; jpeg/png/webp по сигнатуре; `sha256` unique — тот же файл хранится один раз).
- **`articles`** — статьи блога: `slug` (не меняется после первой публикации), статус `draft`/`published`/`unpublished`/`archived`, обложка, `version` для оптимистичной блокировки.
- **`article_translations`** — язык статьи (`ru`/`tg`): заголовок, анонс, текст в ограниченном Markdown, SEO-поля; ключ `(article_id, locale)`.
- **`legal_document_revisions`** — опубликованные редакции оферты и политики ПДн по языку, append-only (триггер и гранты): заявка ссылается на редакцию, с которой согласились.
- **`legal_document_drafts`** — черновик следующей редакции, один на вид и язык.
- **`connection_requests`** — заявки на подключение с формы сайта: статус `new`/`in_progress`/`connected`/`rejected`/`spam`, ПДн контакта, редакция политики, сеть после подключения; ПДн и причина отказа обезличиваются через 180 дней после отказа или спама (`anonymized_at`).

## `impersonations` — вход «от имени» (класс `platform`, ADR-0008 E2)

> **Отложено** (поправка ADR-0008 от 2026-10-05): в MVP вход «от имени» не реализуется, таблица не
> создаётся. Её состав пересматривается вместе с доступом по разрешению владельца (уровень, срок,
> отзыв) отдельной поправкой ADR.

| Колонка | Тип | Правило |
|---|---|---|
| `operator_id`, `tenant_id` | uuid | |
| `reason` | text | Обязательна |
| `started_at`, `expires_at`, `ended_at` | timestamptz | TTL ≤ 60 мин, без продления |

Владелец видит факт входа в `audit_log` своего тенанта, каждая запись которого несёт `impersonation_id`.

## `license_keys` — ключ офлайн-точки (класс `platform`, ADR-0013, ADR-0014 §6–7)

Тенант читает ключи своих точек. Резолвер `resolve_license_key(key_id)` (SECURITY DEFINER, владелец `pharmacy_resolver`) отдаёт `key_hash, tenant_id, store_id, status, valid_until, revoked_at, notify_before_days` ключа, статус, дату закрытия и режим точки, статус сети и время её блокировки — по ним облако вычисляет состояние лицензии (спецификация `2026-10-16-offline-sync`, E10, E12; миграции `sync-receive`, `license-key-block-time`). Первичный ключ — `id uuid`.

| Колонка | Тип | Правило |
|---|---|---|
| `key_id` | text unique | Открытая часть `phk_<keyId>_<secret>`: 16 hex-символов; секрет — 32 случайных байта base64url |
| `key_hash` | bytea unique | SHA-256 секрета |
| `tenant_id`, `store_id` | uuid | → `stores (tenant_id, id)` |
| `valid_until` | timestamptz | |
| `notify_before_days` | integer default 7 | АП 4.3 |
| `status` | text | `active` / `revoked` / `revoked_hard`; «истекает» и «истёк» вычисляются из `valid_until` |
| `issued_by`, `issued_at`, `revoked_by`, `revoked_at` | | |
| `replaces_key_id` | uuid null | Ротация: старый действует до первого прогона с новым |

У точки не больше одного ключа `active` (уникальный частичный индекс по `(tenant_id, store_id)`).

## Поправка 2026-10-02 (аутентификация)

Решения архитектора по спецификации `docs/superpowers/specs/2026-10-02-auth-design.md` (ADR-0008 и ADR-0013, поправки той же даты); миграции — в части 1 реализации.

- **Вход по глобально уникальному идентификатору.** `employees.login`, `phone` (E.164) и `email` уникальны на всей платформе (`lower(login)`, `phone`, `lower(email)`); индекс `employees_login_uq (tenant_id, lower(login))` заменяется глобальными. Сеть при входе определяет резолвер `resolve_login(kind, value)`; `tenants.code` во входе не участвует.
- Новые колонки `employees.email`, `employees.last_login_at`, `roles.template_key`.
- Одноразовый код (`employee_credentials.one_time_code_hash`) — hex SHA-256 от 128 бит `randomBytes`.
