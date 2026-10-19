# 6. Синхронизация, аудит, очередь, биллинг, служебное

Соглашения — в [README](README.md). Протокол синхронизации — ADR-0014, кросс-тенантный доступ — ADR-0013; здесь только таблицы.

## Синхронизация (ADR-0014)

Схема одна для облака и офлайн-точки: `sync_outbox` и `sync_feed_cursor` используются на точке, остальные таблицы — в облаке.

| Таблица | Класс | Колонки и правила |
|---|---|---|
| `sync_outbox` | tenant | `store_seq bigint identity` (порядок операций точки), `operation_id` UUIDv7 (уникален), `type`, `type_version`, `payload jsonb`, `payload_hash bytea` (SHA-256), `correlation_id`, `occurred_at`, `actor jsonb`, `status` `pending` / `sent`, `lease_until`, `sent_at`. Отправленные строки удаляются через 30 дней |
| `sync_feed_cursor` | tenant | Ключ `(tenant_id, store_id)`: `last_change_seq`, `updated_at` |
| `sync_inbox` | tenant | **Без секций** (поправка 2026-10-16, спецификация `2026-10-16-offline-sync`, E40: ключ секционированной таблицы обязан включать `received_at`, и повтор операции в следующем месяце не встретил бы `on conflict`). Ключ `(tenant_id, store_id, operation_id)`. `store_seq`, `type`, `type_version`, `payload_hash` (hex), `envelope jsonb` (исходная операция), `status` `applied` / `quarantined` / `rejected` / `pending_dependency` (`duplicate` — только ответ, строкой не хранится), `reason`, `received_at`, `applied_at`, `attempts`. Ключи не удаляются; архивация сырых конвертов — отдельной задачей (миграция `sync-receive`) |
| `sync_changes` | tenant | Лента «облако → точка»: `change_seq bigint`, `scope_store_id null` (пусто — для всех точек сети), `entity_type`, `entity_id`, `op` `upsert` / `delete`, `changed_at`. Окно 90 дней (`platform_settings`), дальше — `resync-required` |
| `sync_runs` | tenant | Прогон (handshake … итог): `store_id`, `started_at`, `finished_at`, версии точки (`protocol_version`, `app_version`, `schema_version`), `outbox_depth`, `oldest_pending_at`, `feed_cursor`, счётчики батчей (`operations_received`, `applied`, `duplicate`, `quarantined`, `rejected`, `pending_dependency`, `bytes_received`), `client_report jsonb` (итог глазами точки), `result` `open` / `ok` / `errors`, `correlation_id` |
| `sync_conflicts` | tenant | `kind` `price` (решает владелец) / `duplicate_product` (решает точка), `store_id`, `entity_id`, `local_value jsonb`, `cloud_value jsonb`, `status` `open` / `resolved`, `resolution`, `resolved_by`, `resolved_at`. Открытый конфликт — не больше одного на (точка, вид, сущность) (миграция `sync-local-catalog`). Значения: `price` (`entity_id` — товар) — `local_value {priceDirams, piecePriceDirams, basePriceVersion, changedBy, changedAt}`, `cloud_value {priceDirams, piecePriceDirams, priceVersion, changedBy, changedAt}`, повторная правка точки обновляет открытый конфликт; `duplicate_product` (`entity_id` — товар точки) — `local_value {productId, name, createdBy, pendingBarcodes}`, `cloud_value {productId, matchedBy: barcode / name, barcode}` |
| `store_sync_status` | tenant-export | Ключ `(tenant_id, store_id)`: `last_contact_at`, `last_success_at`, `last_run_id`, версии, `outbox_depth`, `oldest_pending_at`, `feed_cursor`, `clock_skew_sec`, `license_status`, `quarantined`, `last_checkpoint jsonb` (сверка: точка и облако), `checkpoint_mismatch boolean`, `updated_at`. Читают владелец и оператор |
| `idempotency_keys` | tenant | Ключ `(tenant_id, scope, key)`: `request_hash bytea`, `response jsonb`, `status_code`, `expires_at`. Для HTTP-операций буфера перебоев облачных точек; тот же ключ с другим хешем — отказ. Введена миграцией `pos-shifts-sales` (2026-10-13): области `receipt`, `shift.open`, `shift.cash`, `shift.close`, ключ — `id` операции, срок 30 дней; область `return` (возврат покупателя, онлайн) — миграцией `customer-returns` |

## Аудит

Обе таблицы — только добавление, запрет `UPDATE`/`DELETE` на уровне БД (БЛ 6.2), хранение ≥ 3 лет (КП 12). Секреты и персональные данные рецептов в них не пишутся.

**`audit_log` (tenant):** месячные секции по `recorded_at`, ключ `(tenant_id, id, recorded_at)`.

| Колонка | Правило |
|---|---|
| `recorded_at` | Время записи |
| `business_date` | Дата документа — для «документ от … · введено …» |
| `employee_id`, `store_id`, `terminal_id` | null там, где неприменимо |
| `acting_operator_id`, `impersonation_id` | Вход «от имени» (ADR-0008) |
| `correlation_id` | |
| `action` | `receipt.completed`, `price.changed`, `auth.pin-failed`, `access.denied`, `role.changed`… |
| `entity_type`, `entity_id` | |
| `details jsonb` | Без секретов. События `document.posted` / `document.unposted` документов с датой, которую ставит человек, пишут `documentDate` — журнал показывает «документ от …» (кабинет владельца, E8, 2026-10-14) |
| `source` | `cloud` / `offline_store` |

Индексы: `(tenant_id, recorded_at)`, `(tenant_id, employee_id, recorded_at)`, `(tenant_id, store_id, recorded_at)` — фильтры экрана аудита (БЛ W1-16); `(tenant_id, entity_type, entity_id, recorded_at)` — события о сущности: история карточки сотрудника, «Мои терминалы» (миграция `db-guards`, 2026-10-14).

Только добавление: строковый триггер запрета UPDATE/DELETE клонируется на секции сам, а запрет TRUNCATE (триггер уровня оператора) стоит на родителе **и на каждой секции** — триггеры уровня оператора на секции не клонируются. Секция, созданная позже, получает тот же `audit_log_no_truncate` (контракт плановой задачи создания секций).

**`platform_audit_log` (platform):** `recorded_at`, `actor_kind` `operator` / `system`, `operator_id null`, `job text null`, `action`, `tenant_id null`, `entity_type`, `entity_id`, `details jsonb`. Журнал операторов: вход и доступ (`auth.*`, `operator.*`, `access.denied`), сети (`tenant.*`), платежи и счета, ключи, услуги, настройки — вид события определяется префиксом кода. Чтение — `GET /api/v1/operator/operator-audit-log` (фильтры: оператор — его действия и события о его учётной записи, например неудачный вход, auth3-M3, 2026-10-16; сеть, вид, даты платформы, `Asia/Dushanbe`); наружу из `details` отдаются только коды (`permission`, `reason`, `created`), без IP-адресов (2026-10-13). Индексы: `(recorded_at)`, `(operator_id, recorded_at)`, `(tenant_id, recorded_at)` — журнал одной сети (миграция `db-guards`, 2026-10-14); `(entity_type, entity_id, recorded_at)` для фильтра «Оператор» (auth3-M3, миграция `audit-entity-index-return-keys`, 2026-10-16).

## Очередь задач

**`job_queue` (system):**
- `id`, `tenant_id null` — пусто = платформенная задача;
- `type` — `fiscal.send`, `sync.apply`, `export-1c.build`, `usage.recompute`, `billing.invoice`…;
- `payload jsonb`;
- `status` — `pending` / `processing` / `done` / `dead`;
- `attempts`, `run_at`, `lease_until`, `last_error`, `correlation_id`;
- `dedupe_key null` — уникален среди незавершённых.

Захват — `FOR UPDATE SKIP LOCKED` в цикле по тенантам (ADR-0013 §4).

## Биллинг и услуги

| Таблица | Класс | Колонки и правила |
|---|---|---|
| `platform_settings` | shared | Одна строка (`id = 1`, создаёт миграция `billing-services`). Тариф облачной аптеки в месяц без НДС `store_monthly_price_dirams` (1…10 000 000 000, по умолчанию 40 000). Ставка НДС `vat_bp` — целый процент в bp (0…9900, по умолчанию 1400 — 14 %, решение 2026-10-13). Новые значения действуют для счетов, сформированных после изменения; выставленный счёт хранит свои. Реквизиты получателя: `supplier_name`, `supplier_inn` (9 цифр), `supplier_bank_account` (20 цифр), `supplier_bank_name`, `supplier_bank_bik` (9 цифр), `supplier_bank_corr_account` (20 цифр), `payment_purpose_template` с `{number}`; пустые, пока оператор их не заполнит. Плюс `updated_at`, `updated_by`. Читают все сети (оценка месяца, спецификация 2026-10-15-billing-services, 3.1 п. 1), пишет только платформа. Офлайн-настройки (тариф офлайн-точки, `feed_window_days`, `revoked_key_grace_days`) появятся с синхронизацией |
| `store_usage_monthly` | tenant-export | Ключ `(tenant_id, store_id, month)`, `month` — 1-е число: `receipts_count > 0`, `first_sale_date`, `last_sale_date` (в месяце), `first_sale_ever_date` (первая продажа точки за всё время, B15), `closed_on` (бизнес-дата закрытия в часовом поясе сети, A2), `computed_at`. Только облачные аптеки (A21). Пересчитывает сеть в своём контексте по нажатию оператора (предпросмотр, формирование, пересчёт счёта; B13): строки месяца удаляются и вставляются заново из `receipts`. Платформа читает (`platform_read`) |
| `tenant_stats_daily` | tenant-export | Ключ `(tenant_id, day)`: счётчики чеков и активных точек, без сумм позиций и ПДн |
| `invoices` | platform | Счёт сети за месяц: `tenant_id`, `period_month` (уникален в сети), `number` `СЧ-ГГГГ-ММ-NNN` (уникален, NNN по порядку в периоде по всем сетям), `issued_at`, `due_on` (15-е следующего месяца, но не раньше выставления + 10 дней), `price_per_store_dirams` и `vat_bp` на момент выставления, `subtotal_dirams`, `vat_dirams`, `total_dirams`, `paid_dirams` и `paid_on` (пишет распределение платежей), снимок плательщика и реквизитов платформы, `payment_purpose`, `recalculated_at`, `created_by`. Статус не хранится: `paid` / `partially_paid` / `issued` по оплаченному, просрочка — остаток после `due_on`. Отмены счёта нет. Сеть читает свои строки |
| `invoice_lines` | platform | Строка счёта: `kind` `store` (`store_id`, `store_name`, `days`, `days_in_month`, `base_dirams`, `discount_bp`) или `service` (`tenant_service_id`, `description` — RU-название, `provided_on`), `position`, `amount_dirams`. `discount_id` — скидка, которую взяла строка точки. Строки не удаляются (B18): пересчёт и отмена услуги снимают строку — `removed_at`, `removed_reason` `recalculated` / `service_cancelled`; суммы счёта — по действующим строкам. Услуга — не больше чем в одной действующей строке. Сеть читает свои строки |
| `tenant_payments` | platform | Платёж сети: `id` — ключ идемпотентности от клиента, `request_hash` первого запроса, `tenant_id`, `amount_dirams`, `paid_on`, `method` `bank_transfer` / `cash`, `comment`, `preferred_invoice_id` («сначала на этот счёт»), `status` `active` / `cancelled` с причиной, кем и когда, `recorded_by`, `created_at`, `updated_at`. **Оплаты через платформу нет** (решение 2026-10-01): оператор вручную отмечает в админке, кто и сколько оплатил. Сеть не читает |
| `tenant_payment_allocations` | platform | Ключ `(payment_id, invoice_id)`, `tenant_id`, `amount_dirams ≥ 0`. Производная: при каждом изменении платежей или счетов сети пересчитывается целиком под блокировкой строки сети (`FOR NO KEY UPDATE`) — активные платежи по `(paid_on, created_at, id)` сначала на свой счёт, потом на старые счета; остаток — аванс (`tenants.billing_advance_dirams`). Строки не удаляются (B18): пара, которая больше не покрывает счёт, получает 0. Сеть не читает |
| `tenant_discounts` | platform | Скидка сети на тариф точек: `percent_bp` (100…10 000), `from_month` … `to_month` (1-е числа, включительно), `created_by`, `created_at`, `updated_at`, `removed_at` и `removed_by` (удаление — пометкой, B18). Сроки действующих скидок сети не пересекаются (сервис, под блокировкой сети). Удалить можно скидку, не попавшую в счёт (на неё не ссылается действующая строка, `invoice_lines.discount_id`); у попавшей срок сокращается не раньше последнего месяца, счёт которого её взял. Сеть читает свои строки (поправка ADR-0013 2026-10-15) |
| `services` | shared | Каталог разовых услуг (перенос данных, выезд инженера, обучение): `name jsonb` и `description jsonb` (`ru` обязательно, `tj` — нет), базовая цена `base_price_dirams` (ориентир; цену заказа назначает оператор), `visible` (видна владельцу), `archived`, `created_at`, `updated_at`. Ежемесячных услуг нет |
| `service_requests` | tenant-export | Заявка сети: ключ `(tenant_id, id)`, `service_id`, `comment null` (до 500), `requested_by` (сотрудник), `requested_at`. Пишет и удаляет (отзыв до решения) сеть, читает платформа. Пока в `tenant_services` нет строки с этой заявкой, она ждёт решения; заявку с решением удалить нельзя (внешний ключ) |
| `tenant_services` | platform | Решение оператора по заявке (одно на заявку: `request_id` уникален) или услуга, добавленная без заявки: `tenant_id`, `service_id`, `request_id null`, `price_dirams` (нет только у отклонённой), `status` `approved` / `rejected` / `cancelled` / `provided`, `reason` (у отклонённой и отменённой), `decided_by`, `decided_at`, `provided_on` и `provided_by` (у оказанной), `updated_at`, `request_hash` (повтор добавления без заявки, B17); уникальность `(tenant_id, id)` — для ссылки из `invoice_lines`. Сеть читает свои строки. Оказанная услуга попадает в счёт месяца даты оказания или, если тот уже выставлен, в ближайший следующий (A11); цена и отметка «оказано» услуги в счёте не меняются, отмена снимает строку только из неоплаченного счёта (A13) |

Точка попадает в счёт, если `stores.kind = 'pharmacy'`, режим облачный и в `store_usage_monthly` за месяц есть хотя бы одна продажа (АП 3). Дни — с первой продажи точки за всё время или с 1-го числа по дату закрытия или конец месяца; строка = тариф × дни / дней в месяце, скидка и НДС — с округлением half up в дирамах (спецификация, A2, A3).

**Поправка 2026-10-15** (спецификация `2026-10-15-billing-services-design.md`, утверждена архитектором): `platform_settings`, `services`, `service_requests`, `tenant_services` — по описанию выше (PR 1). `store_billing` не создаётся: «оплачено до» заменено долгом и авансом сети. Счета, платежи, распределения, скидки и `store_usage_monthly` — PR 2 по разделам 4 и 3.2 спецификации (строки выше; миграция `billing-invoices`). На таблицах класса `platform` строки не удаляются (B18).

## Служебное

| Таблица | Класс | Колонки и правила |
|---|---|---|
| `notifications` | tenant | Введено миграцией `owner-cabinet` (спецификация `2026-10-14-owner-cabinet-design.md`, поправка 3.1 п. 2): `kind` (8 видов), `store_id null` (пусто — вся сеть), `dedupe_key` (уникален среди неснятых), `entity_type`, `entity_id`, `params jsonb`, `created_at`, `resolved_at null`. Получатели не хранятся: право вида (`inventory:view` / `purchasing:view` / `shifts:view`) + `notifications:view` + охват точек (E10). Состояния (сроки, мало на складе, оплата поставщику, перемещение в пути) обновляют `params` и снимаются; события (расхождение смены, продажа в минус) не снимаются и видны 30 дней. Только интерфейс (КП 9) |
| `notification_reads` | tenant | Ключ `(tenant_id, notification_id, employee_id)`: `read_at` — «прочитано» у сотрудника (E12) |
| `notification_refresh` | tenant | Ключ `tenant_id`: `refreshed_at`, `events_after`. Уведомления обновляются при чтении (`GET /notifications`, `GET /dashboard`), не чаще раза в 5 минут или после изменения `tenant_settings`, под `pg_try_advisory_xact_lock` по тенанту (E11) — фоновых задач и `job_queue` пока нет |
| `platform_notifications` | platform | То же для операторов |
| `import_jobs` | tenant | `kind` `catalog` / `opening_balance`, `store_id null`, `file_sha256` (уникален в `(tenant_id, kind, store_id, file_sha256)` — повтор не создаёт дублей), `status` `validating` / `failed` / `applied`, `errors jsonb` (строка, причина), `created_by`. Частичной загрузки нет (КП 10) |
| `export_1c_runs` | tenant | `legal_entity_id`, `period_from`, `period_to`, `status`, `unmapped_count`, `file_sha256`, `created_by`. Файл генерируется при запросе |
| `export_1c_nomenclature_map` | tenant | Ключ `(tenant_id, product_id)`: `external_code` (код 1С). По умолчанию сопоставляется по штрихкоду или артикулу, несопоставленные не выгружаются (КП 8) |
| `sessions` | tenant | Только офлайн-точка (в облаке — Redis, ADR-0008): ключ `(tenant_id, jti)` — `jti` из JWT сессии, `employee_id`, `terminal_id null`, `auth_method`, `authenticated_at`, `idle_expires_at`, `absolute_expires_at`, снимок прав и `permissions_version`. Ищется под RLS в `withTenant(tid из JWT)`; резолвер `resolve_session` не нужен (поправка 2026-10-02) |

## Поправка 2026-10-02 (аутентификация)

Решения архитектора по спецификации `docs/superpowers/specs/2026-10-02-auth-design.md` (ADR-0008 и ADR-0013, поправки той же даты).

- `sessions` (офлайн-точка): ключ `(tenant_id, jti)` вместо `token_hash`; токен сессии — JWT, значение cookie в таблице не хранится.
- `audit_log` секционируется по месяцам с первой миграции аутентификации: секции созданы статически до 2027-12; плановая задача (роль-владелец), создающая последующие, ещё не сделана — нужна до 2027-11, см. `docs/superpowers/plans/2026-09-30-data-layer-followups.md`. События входа: `auth.login-succeeded`, `auth.login-failed`, `auth.pin-succeeded`, `auth.pin-failed`, `auth.pin-locked`, `access.denied`, `terminal.bound`, `terminal.revoked`.
