# Section Definitions

Разделы правил PostgreSQL для Pharmacy. Правило относится к разделу по префиксу имени файла.
Impact раздела — типичный уровень; у отдельного правила он может быть выше (см. frontmatter правила).
Порядок разделов — приоритет чтения для Pharmacy.

---

## 1. Security & Tenant Isolation (security)
**Impact:** CRITICAL
**Description:** tenant_id и RLS как второй рубеж изоляции тенантов, контекст `app.tenant_id` на транзакцию, разделение ролей владельца и приложения, минимальные привилегии.

## 2. Data Integrity & Access Patterns (data)
**Impact:** CRITICAL (integrity) / MEDIUM (access patterns)
**Description:** Остатки из движений по партиям (FEFO, `FOR UPDATE`, атомарная транзакция), ключи идемпотентности для чеков и синхронизации, N+1, пакетная вставка, пагинация, upsert справочников.

## 3. Schema Design (schema)
**Impact:** HIGH
**Description:** Деньги в дирамах (bigint), append-only аудит и журнал ПКУ, UUIDv7 для сущностей офлайн-точек, типы данных, индексы FK с tenant_id, именование, секционирование.

## 4. Query Performance (query)
**Impact:** HIGH
**Description:** Индексы с ведущим tenant_id, составные, покрывающие и частичные индексы, выбор типа индекса. Бюджет операции кассы ≤ 1 сек.

## 5. Connection Management (conn)
**Impact:** HIGH
**Description:** Пул на стороне приложения (PgBouncer — только через ADR), отсутствие сессионного состояния на пуловых соединениях, лимиты и таймауты для облака и офлайн-точки.

## 6. Concurrency & Locking (lock)
**Impact:** MEDIUM-HIGH
**Description:** Очереди-таблицы с `SKIP LOCKED` вместо брокеров (outbox, синхронизация), порядок блокировок партий, короткие транзакции без внешних вызовов, advisory-локи уровня транзакции.

## 7. Monitoring & Diagnostics (monitor)
**Impact:** LOW-MEDIUM
**Description:** pg_stat_statements, EXPLAIN ANALYZE под ролью приложения и контекстом тенанта, VACUUM/ANALYZE для append-only и очередей. Системы мониторинга не выбраны — вводятся через ADR.

## 8. Advanced Features (advanced)
**Impact:** MEDIUM
**Description:** Поиск по каталогу RU/TJ (tsvector + pg_trgm, штрихкоды), JSONB для расширяемых атрибутов. Расширения должны быть и в облаке, и в образе офлайн-точки.
