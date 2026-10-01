# 6. Синхронизация, аудит, очередь, биллинг, служебное

Соглашения — в [README](README.md). Протокол синхронизации — ADR-0014, кросс-тенантный доступ — ADR-0013; здесь только таблицы.

## Синхронизация (ADR-0014)

Схема одна для облака и офлайн-точки: `sync_outbox` и `sync_feed_cursor` используются на точке, остальные таблицы — в облаке.

| Таблица | Класс | Колонки и правила |
|---|---|---|
| `sync_outbox` | tenant | `store_seq bigint identity` (порядок операций точки), `operation_id` UUIDv7 (уникален), `type`, `type_version`, `payload jsonb`, `payload_hash bytea` (SHA-256), `correlation_id`, `occurred_at`, `actor jsonb`, `status` `pending` / `sent`, `lease_until`, `sent_at`. Отправленные строки удаляются через 30 дней |
| `sync_feed_cursor` | tenant | Ключ `(tenant_id, store_id)`: `last_change_seq`, `updated_at` |
| `sync_inbox` | tenant | Месячные секции по `received_at`. Ключ `(tenant_id, store_id, operation_id, received_at)`. `store_seq`, `type`, `type_version`, `payload_hash`, `envelope jsonb` (исходный конверт), `status` `applied` / `duplicate` / `quarantined` / `rejected` / `pending_dependency`, `reason`, `applied_at` |
| `sync_changes` | tenant | Лента «облако → точка»: `change_seq bigint`, `scope_store_id null` (пусто — для всех точек сети), `entity_type`, `entity_id`, `op` `upsert` / `delete`, `changed_at`. Окно 90 дней (`platform_settings`), дальше — `resync-required` |
| `sync_runs` | tenant | Прогон: `store_id`, `batch_id`, `started_at`, `finished_at`, принято / дублей / в карантине, результат |
| `sync_conflicts` | tenant | `kind` `price` (решает владелец) / `duplicate_product` (решает точка), `store_id`, `entity_id`, `local_value jsonb`, `cloud_value jsonb`, `status` `open` / `resolved`, `resolution`, `resolved_by`, `resolved_at` |
| `store_sync_status` | tenant-export | Ключ `(tenant_id, store_id)`: `last_success_at`, `queue_size`, `last_checkpoint jsonb`, `checkpoint_mismatch boolean`, `client_version`, `clock_skew_sec`. Читают владелец и оператор |
| `idempotency_keys` | tenant | Ключ `(tenant_id, scope, key)`: `request_hash bytea`, `response jsonb`, `status_code`, `expires_at`. Для HTTP-операций буфера перебоев облачных точек; тот же ключ с другим хешем — отказ |

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
| `details jsonb` | Без секретов |
| `source` | `cloud` / `offline_store` |

Индексы: `(tenant_id, recorded_at)`, `(tenant_id, employee_id, recorded_at)`, `(tenant_id, store_id, recorded_at)` — фильтры экрана аудита (БЛ W1-16).

**`platform_audit_log` (platform):** `recorded_at`, `actor_kind` `operator` / `system`, `operator_id null`, `job text null`, `action`, `tenant_id null`, `entity_type`, `entity_id`, `details jsonb`. Журнал операторов: создание тенанта, платёж, ключ, услуга, «от имени».

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
| `platform_settings` | platform | Одна строка: `vat_bp`, `store_monthly_price_dirams`, `offline_store_billing_kind` `monthly` / `one_time` / `free` и `offline_store_price_dirams` (тариф офлайн-точки настраивается, решение 2026-10-01), `feed_window_days` (90), `revoked_key_grace_days` (30) |
| `store_billing` | platform | Ключ `(tenant_id, store_id)`: `paid_until date null`. Ведёт оператор; поле «оплачено до» не в `stores`, потому что `stores` пишет владелец |
| `store_usage_monthly` | tenant-export | Ключ `(tenant_id, store_id, month)`: `receipts_count`, `first_sale_at`, `last_sale_at`, `computed_at`. Пересчёт ночью, отсечка — 3-е число (ADR-0013) |
| `tenant_stats_daily` | tenant-export | Ключ `(tenant_id, day)`: счётчики чеков и активных точек, без сумм позиций и ПДн |
| `invoices` | platform | `tenant_id`, `period_month`, `number` unique, `status` `issued` / `partially_paid` / `paid` / `cancelled` (статус оплаты выводится из распределённых платежей), `subtotal_dirams`, `vat_bp`, `vat_dirams`, `total_dirams`, `issued_at`. Один счёт в месяц: точки, офлайн-точки и услуги — отдельными строками. PDF генерируется по данным при запросе, не хранится |
| `invoice_lines` | platform | `invoice_id`, `kind` `store` / `offline_store` / `service`, `store_id null`, `service_id null`, `active_days null`, `amount_dirams` |
| `tenant_payments` | platform | `tenant_id`, `amount_dirams`, `paid_on`, `method text`, `comment`, `recorded_by`. **Оплаты через платформу нет** (решение 2026-10-01): оператор вручную отмечает в админке, кто и сколько оплатил. Платёж не обязательно привязан к счёту |
| `tenant_payment_allocations` | platform | Ключ `(payment_id, invoice_id)`, `amount_dirams > 0`. По умолчанию платёж закрывает самые ранние неоплаченные счета, оператор может распределить вручную; нераспределённый остаток — аванс. По распределению обновляются `invoices.status` и `store_billing.paid_until` |
| `services` | shared | Каталог услуг: `name jsonb`, `billing_kind` `one_time` / `monthly`, `price_dirams`, `status` |
| `tenant_services` | platform | `tenant_id`, `service_id`, `status` `active` / `disabled`, `activated_at`, `activated_by`. Тенант читает свои строки |
| `service_requests` | tenant-export | Заявка владельца: `service_id`, `requested_by`, `requested_at`, `comment`. Пишет тенант, видит оператор. Подключение — запись в `tenant_services`; статус заявки выводится из неё |

Точка попадает в счёт, если `stores.kind = 'pharmacy'`, режим облачный и в `store_usage_monthly` за месяц есть хотя бы одна продажа (АП 3). Пропорция — по дням активности в месяце.

## Служебное

| Таблица | Класс | Колонки и правила |
|---|---|---|
| `notifications` | tenant | `recipient_employee_id null` или `recipient_permission` + `store_id` (все, у кого есть право на точке), `type`, `entity_type`, `entity_id`, `payload jsonb`, `created_at`, `read_at` (для адресных). Только интерфейс (КП 9) |
| `platform_notifications` | platform | То же для операторов |
| `import_jobs` | tenant | `kind` `catalog` / `opening_balance`, `store_id null`, `file_sha256` (уникален в `(tenant_id, kind, store_id, file_sha256)` — повтор не создаёт дублей), `status` `validating` / `failed` / `applied`, `errors jsonb` (строка, причина), `created_by`. Частичной загрузки нет (КП 10) |
| `export_1c_runs` | tenant | `legal_entity_id`, `period_from`, `period_to`, `status`, `unmapped_count`, `file_sha256`, `created_by`. Файл генерируется при запросе |
| `export_1c_nomenclature_map` | tenant | Ключ `(tenant_id, product_id)`: `external_code` (код 1С). По умолчанию сопоставляется по штрихкоду или артикулу, несопоставленные не выгружаются (КП 8) |
| `sessions` | tenant | Только офлайн-точка (в облаке — Redis, ADR-0008): `token_hash bytea` PK, `employee_id`, `terminal_id null`, `auth_method`, `authenticated_at`, `idle_expires_at`, `absolute_expires_at`, `permissions_version`. Читается резолвером `resolve_session` (ADR-0013) |
